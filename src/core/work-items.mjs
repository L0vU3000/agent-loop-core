import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'

import {
  descriptorChild,
  openChildDirectoryNoFollow,
  openExistingDirectoryNoFollow,
  readUtf8RegularFileAt,
} from '../paths/state-access.mjs'
import { prepareStateDirectory } from '../paths/state-mutation.mjs'

const MAX_WORK_ITEM_BYTES = 64 * 1024
const CANONICAL_WORK_ITEM = /^---\npipeline: bug-fix\n---\n([\s\S]*)$/
const HEX64 = /^[a-f0-9]{64}$/
const OUTCOME_FILE = 'outcome.json'
const MAX_OUTCOME_BYTES = 1024

function readBoundedWorkItemDescriptor(descriptor) {
  const metadata = fstatSync(descriptor)
  if (!metadata.isFile()) throw new Error('work item must be a regular file')
  if (metadata.size === 0) throw new Error('work item must not be empty')
  if (metadata.size > MAX_WORK_ITEM_BYTES) throw new Error('work item exceeds size limit')

  const buffer = Buffer.alloc(MAX_WORK_ITEM_BYTES + 1)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead)
    if (count === 0) break
    bytesRead += count
  }
  if (bytesRead > MAX_WORK_ITEM_BYTES) throw new Error('work item exceeds size limit')
  try {
    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)),
      metadata,
    }
  } catch {
    throw new Error('work item must contain valid UTF-8')
  }
}

function readBoundedWorkItem(workItemPath) {
  let descriptor
  try {
    descriptor = openSync(
      workItemPath,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
  } catch {
    throw new Error('work item must be a readable regular file')
  }

  try {
    return readBoundedWorkItemDescriptor(descriptor).content
  } finally {
    closeSync(descriptor)
  }
}

function assertCanonicalWorkItem(content) {
  const match = CANONICAL_WORK_ITEM.exec(content)
  if (!match) {
    throw new Error('work item must have frontmatter containing only "pipeline: bug-fix"')
  }
  if (match[1].trim().length === 0) {
    throw new Error('work item body must not be empty')
  }
}

export function hashWorkItem(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function claimedFilename(workItemDigest) {
  return `${workItemDigest}.md`
}

function claimedElsewhere(paths, filename) {
  return [paths.pending, paths.inProgress, paths.done, paths.failed]
    .some((directory) => existsSync(join(directory, filename)))
}

export function reserveClaimDigest({ paths, workItemDigest }) {
  if (!HEX64.test(workItemDigest)) throw new Error('workItemDigest must be a sha256 hex digest')
  prepareStateDirectory(paths.claims)
  const markerPath = join(paths.claims, workItemDigest)
  try {
    mkdirSync(markerPath, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`WORK_ITEM_ALREADY_CLAIMED: ${workItemDigest}`)
    throw error
  }
  return markerPath
}

// Reserve the in-progress slot with an exclusive hard link rather than a rename: rename(2) silently
// replaces an existing destination, which would let a losing claimant clobber a claim that already
// landed in-progress. linkSync fails closed (EEXIST) instead, so at most one claimant ever wins.
export function reserveInProgress({ pendingPath, claimedPath, workItemDigest }) {
  prepareStateDirectory(dirname(pendingPath))
  prepareStateDirectory(dirname(claimedPath))
  try {
    linkSync(pendingPath, claimedPath)
  } catch (error) {
    unlinkSync(pendingPath)
    if (error.code === 'EEXIST') throw new Error(`WORK_ITEM_ALREADY_CLAIMED: ${workItemDigest}`)
    throw error
  }
  unlinkSync(pendingPath)
}

// Bounded read-once claim: hash the work item, then reserve it pending -> in-progress with a single
// atomic exclusive reservation so a second concurrent claim of the same content can never win both
// stages, and can never silently replace a claim that already completed.
export function claimWorkItem({ paths, workItemPath }) {
  const content = readBoundedWorkItem(workItemPath)
  assertCanonicalWorkItem(content)
  const workItemDigest = hashWorkItem(content)
  const filename = claimedFilename(workItemDigest)

  for (const directory of [paths.pending, paths.inProgress, paths.done, paths.failed, paths.claims]) {
    prepareStateDirectory(directory)
  }

  const claimMarkerPath = reserveClaimDigest({ paths, workItemDigest })
  if (claimedElsewhere(paths, filename)) {
    throw new Error(`WORK_ITEM_ALREADY_CLAIMED: ${workItemDigest}`)
  }

  const pendingPath = join(paths.pending, filename)
  try {
    writeFileSync(pendingPath, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`WORK_ITEM_ALREADY_CLAIMED: ${workItemDigest}`)
    throw error
  }

  const claimedPath = join(paths.inProgress, filename)
  reserveInProgress({ pendingPath, claimedPath, workItemDigest })

  return Object.freeze({ workItemDigest, content, claimedPath, claimMarkerPath })
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function openWorkItemAt(directoryDescriptor, filename, allowMissing = false) {
  let descriptor
  try {
    descriptor = openSync(
      descriptorChild(directoryDescriptor, filename),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null
    throw new Error('work item must be a readable regular file')
  }
  try {
    const value = readBoundedWorkItemDescriptor(descriptor)
    return { descriptor, ...value }
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function normalizeOutcomeReservation(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('outcome reservation must be an object')
  }
  if (Object.keys(value).sort().join(',') !== 'outcome,schemaVersion,workItemDigest') {
    throw new Error('outcome reservation has unknown or missing fields')
  }
  if (value.schemaVersion !== 1) throw new Error('outcome reservation schemaVersion must be 1')
  if (!HEX64.test(value.workItemDigest)) throw new Error('outcome reservation digest is invalid')
  if (value.outcome !== 'pass' && value.outcome !== 'fail') {
    throw new Error('outcome reservation outcome is invalid')
  }
  return {
    schemaVersion: 1,
    workItemDigest: value.workItemDigest,
    outcome: value.outcome,
  }
}

function reserveOutcome(claimDescriptor, workItemDigest, outcome) {
  const reservation = { schemaVersion: 1, workItemDigest, outcome }
  const serialized = `${JSON.stringify(reservation, null, 2)}\n`
  try {
    writeFileSync(descriptorChild(claimDescriptor, OUTCOME_FILE), serialized, {
      flag: 'wx',
      mode: 0o600,
    })
    return
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const existing = readUtf8RegularFileAt(
    claimDescriptor,
    OUTCOME_FILE,
    MAX_OUTCOME_BYTES,
    'outcome reservation',
  )
  let normalized
  try {
    normalized = normalizeOutcomeReservation(JSON.parse(existing))
  } catch {
    throw new Error(`WORK_ITEM_OUTCOME_CONFLICT: ${workItemDigest}`)
  }
  if (
    existing !== `${JSON.stringify(normalized, null, 2)}\n`
    || normalized.workItemDigest !== workItemDigest
    || normalized.outcome !== outcome
  ) {
    throw new Error(`WORK_ITEM_OUTCOME_CONFLICT: ${workItemDigest}`)
  }
}

export function resolveWorkItem({ paths, workItemDigest, outcome }) {
  if (outcome !== 'pass' && outcome !== 'fail') {
    throw new Error(`outcome must be "pass" or "fail", got "${outcome}"`)
  }
  if (!HEX64.test(workItemDigest)) throw new Error('workItemDigest must be a sha256 hex digest')

  const filename = claimedFilename(workItemDigest)
  const targetDirectory = outcome === 'pass' ? paths.done : paths.failed
  const conflictingDirectory = outcome === 'pass' ? paths.failed : paths.done
  const descriptors = []
  let sourceHandle
  let targetHandle
  let createdTarget = false
  try {
    const inProgressDescriptor = openExistingDirectoryNoFollow(paths.inProgress)
    descriptors.push(inProgressDescriptor)
    const targetDescriptor = openExistingDirectoryNoFollow(targetDirectory)
    descriptors.push(targetDescriptor)
    const conflictingDescriptor = openExistingDirectoryNoFollow(conflictingDirectory)
    descriptors.push(conflictingDescriptor)
    const claimsDescriptor = openExistingDirectoryNoFollow(paths.claims)
    descriptors.push(claimsDescriptor)
    const claimDescriptor = openChildDirectoryNoFollow(claimsDescriptor, workItemDigest)
    descriptors.push(claimDescriptor)

    reserveOutcome(claimDescriptor, workItemDigest, outcome)

    const sourcePath = descriptorChild(inProgressDescriptor, filename)
    const targetPath = descriptorChild(targetDescriptor, filename)
    const conflicting = openWorkItemAt(conflictingDescriptor, filename, true)
    if (conflicting !== null) {
      closeSync(conflicting.descriptor)
      throw new Error(`WORK_ITEM_OUTCOME_CONFLICT: ${workItemDigest}`)
    }

    sourceHandle = openWorkItemAt(inProgressDescriptor, filename, true)
    if (sourceHandle === null) {
      targetHandle = openWorkItemAt(targetDescriptor, filename, true)
      if (targetHandle === null) throw new Error(`claimed work item not found: ${workItemDigest}`)
      assertCanonicalWorkItem(targetHandle.content)
      if (hashWorkItem(targetHandle.content) !== workItemDigest) {
        throw new Error(`WORK_ITEM_RESOLUTION_CONFLICT: ${workItemDigest}`)
      }
      return Object.freeze({ workItemDigest, outcome, path: join(targetDirectory, filename) })
    }

    assertCanonicalWorkItem(sourceHandle.content)
    if (hashWorkItem(sourceHandle.content) !== workItemDigest) {
      throw new Error(`WORK_ITEM_DIGEST_MISMATCH: ${workItemDigest}`)
    }

    try {
      linkSync(sourcePath, targetPath)
      createdTarget = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }

    targetHandle = openWorkItemAt(targetDescriptor, filename)
    let targetIsCanonical = true
    try {
      assertCanonicalWorkItem(targetHandle.content)
    } catch {
      targetIsCanonical = false
    }
    if (
      !targetIsCanonical
      || !sameInode(sourceHandle.metadata, targetHandle.metadata)
      || hashWorkItem(targetHandle.content) !== workItemDigest
    ) {
      if (createdTarget) unlinkSync(targetPath)
      throw new Error(`WORK_ITEM_ALREADY_RESOLVED: ${workItemDigest}`)
    }

    const lateConflict = openWorkItemAt(conflictingDescriptor, filename, true)
    if (lateConflict !== null) {
      closeSync(lateConflict.descriptor)
      if (createdTarget) unlinkSync(targetPath)
      throw new Error(`WORK_ITEM_OUTCOME_CONFLICT: ${workItemDigest}`)
    }

    const currentSource = openWorkItemAt(inProgressDescriptor, filename, true)
    if (currentSource !== null) {
      try {
        if (!sameInode(sourceHandle.metadata, currentSource.metadata)) {
          throw new Error(`WORK_ITEM_RESOLUTION_CONFLICT: ${workItemDigest}`)
        }
      } finally {
        closeSync(currentSource.descriptor)
      }
      try {
        unlinkSync(sourcePath)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }

    return Object.freeze({ workItemDigest, outcome, path: join(targetDirectory, filename) })
  } finally {
    if (targetHandle != null) closeSync(targetHandle.descriptor)
    if (sourceHandle != null) closeSync(sourceHandle.descriptor)
    for (const descriptor of descriptors.reverse()) closeSync(descriptor)
  }
}
