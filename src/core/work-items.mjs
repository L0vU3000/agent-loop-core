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

import { prepareStateDirectory } from '../paths/state-mutation.mjs'

const MAX_WORK_ITEM_BYTES = 64 * 1024
const CANONICAL_WORK_ITEM = /^---\npipeline: bug-fix\n---\n([\s\S]*)$/
const HEX64 = /^[a-f0-9]{64}$/

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
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    } catch {
      throw new Error('work item must contain valid UTF-8')
    }
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

export function resolveWorkItem({ paths, workItemDigest, outcome }) {
  if (outcome !== 'pass' && outcome !== 'fail') {
    throw new Error(`outcome must be "pass" or "fail", got "${outcome}"`)
  }
  if (!HEX64.test(workItemDigest)) throw new Error('workItemDigest must be a sha256 hex digest')

  const filename = claimedFilename(workItemDigest)
  prepareStateDirectory(paths.inProgress)
  const source = join(paths.inProgress, filename)
  if (!existsSync(source)) {
    throw new Error(`claimed work item not found: ${workItemDigest}`)
  }

  const targetDirectory = outcome === 'pass' ? paths.done : paths.failed
  prepareStateDirectory(targetDirectory)
  const targetPath = join(targetDirectory, filename)
  try {
    linkSync(source, targetPath)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`WORK_ITEM_ALREADY_RESOLVED: ${workItemDigest}`)
    throw error
  }
  unlinkSync(source)

  return Object.freeze({ workItemDigest, outcome, path: targetPath })
}
