import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

function assertCanonicalDirectory(directory) {
  const metadata = lstatSync(directory)
  if (metadata.isSymbolicLink()) throw new Error('state path must not contain symbolic links')
  if (!metadata.isDirectory()) throw new Error('state path must contain directories only')
  if (realpathSync(directory) !== directory) {
    throw new Error('state path must not contain symbolic links')
  }
}

function nearestExistingAncestor(directory) {
  let cursor = directory
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('state path has no existing ancestor')
    cursor = parent
  }
  return cursor
}

export function prepareStateDirectory(directory) {
  if (!isAbsolute(directory)) throw new Error('state path must be absolute')
  const canonicalInput = resolve(directory)
  assertCanonicalDirectory(nearestExistingAncestor(canonicalInput))
  mkdirSync(canonicalInput, { recursive: true, mode: 0o700 })
  assertCanonicalDirectory(canonicalInput)
  return canonicalInput
}
