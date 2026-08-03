import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW

export function descriptorRoot() {
  if (process.platform !== 'linux') {
    throw new Error('descriptor-relative state access requires Linux')
  }
  return '/proc/self/fd'
}

export function descriptorChild(descriptor, name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('/') || name === '.' || name === '..') {
    throw new Error('descriptor child name must be one safe path segment')
  }
  return join(descriptorRoot(), String(descriptor), name)
}

export function openExistingDirectoryNoFollow(directory) {
  if (!isAbsolute(directory)) throw new Error('state path must be absolute')
  const descriptors = []
  try {
    descriptors.push(openSync(sep, DIRECTORY_FLAGS))
    for (const segment of resolve(directory).split(sep).filter(Boolean)) {
      descriptors.push(openSync(descriptorChild(descriptors.at(-1), segment), DIRECTORY_FLAGS))
    }
    const result = descriptors.pop()
    for (const descriptor of descriptors.reverse()) closeSync(descriptor)
    return result
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try { closeSync(descriptor) } catch {}
    }
    throw error
  }
}

export function openChildDirectoryNoFollow(parentDescriptor, name) {
  return openSync(descriptorChild(parentDescriptor, name), DIRECTORY_FLAGS)
}

export function readUtf8RegularFileAt(directoryDescriptor, name, maxBytes, label) {
  let descriptor
  try {
    descriptor = openSync(descriptorChild(directoryDescriptor, name), FILE_FLAGS)
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`)
    if (metadata.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`)
    const bytes = readFileSync(descriptor)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`${label} must contain valid UTF-8`)
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
