/**
 * @fileoverview In-memory {@link FileSystem} for tests. Excluded from
 * the build (see tsconfig `exclude`) so it never ships in `dist`.
 *
 * Files are a flat map of absolute path → contents; directories are
 * implied by the paths under them. Symlinks are an optional path →
 * real-target map, enough to exercise the scan's workspace-link
 * detection (a `node_modules/@valve-tech/*` entry that resolves back
 * into the project).
 */

import path from 'node:path'
import type { DirEntry, FileSystem } from './fs.js'

const norm = (p: string): string => path.posix.normalize(p)

/** Options for {@link createMemFs}. */
export interface MemFsOptions {
  /** Absolute path → UTF-8 contents. Parent dirs are implied. */
  files?: Record<string, string>
  /** Symlink path → real target path (resolved by `realpath`). */
  symlinks?: Record<string, string>
}

/** An in-memory `FileSystem` plus a `snapshot()` of current files. */
export interface MemFs extends FileSystem {
  /** Current path → contents map (post-writes), for assertions. */
  snapshot(): Record<string, string>
}

/** Build an in-memory `FileSystem` seeded with `files`/`symlinks`. */
export const createMemFs = (options: MemFsOptions = {}): MemFs => {
  const files = new Map<string, string>(
    Object.entries(options.files ?? {}).map(([p, c]) => [norm(p), c]),
  )
  const symlinks = new Map<string, string>(
    Object.entries(options.symlinks ?? {}).map(([p, t]) => [norm(p), norm(t)]),
  )

  const realpath = (p: string): string => {
    let resolved = norm(p)
    for (;;) {
      let changed = false
      for (const [link, target] of symlinks) {
        if (resolved === link) {
          resolved = target
          changed = true
          break
        }
        if (resolved.startsWith(link + '/')) {
          resolved = target + resolved.slice(link.length)
          changed = true
          break
        }
      }
      if (!changed) return resolved
    }
  }

  const exists = (p: string): boolean => {
    const real = realpath(p)
    if (files.has(real)) return true
    const prefix = real + '/'
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) return true
    }
    return false
  }

  const listDir = (p: string): DirEntry[] => {
    const real = realpath(p)
    const prefix = real + '/'
    const children = new Map<string, boolean>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        if (!children.has(rest)) children.set(rest, false)
      } else {
        children.set(rest.slice(0, slash), true)
      }
    }
    for (const link of symlinks.keys()) {
      if (norm(path.posix.dirname(link)) === real) {
        children.set(path.posix.basename(link), true)
      }
    }
    return [...children].map(([name, isDirectory]) => ({ name, isDirectory }))
  }

  const readFile = (p: string): string => {
    const real = realpath(p)
    const contents = files.get(real)
    if (contents === undefined) throw new Error(`ENOENT: ${p}`)
    return contents
  }

  const writeFile = (p: string, contents: string): void => {
    files.set(realpath(p), contents)
  }

  const rm = (p: string): void => {
    const real = realpath(p)
    const prefix = real + '/'
    files.delete(real)
    for (const key of [...files.keys()]) {
      if (key.startsWith(prefix)) files.delete(key)
    }
  }

  return {
    exists,
    listDir,
    readFile,
    writeFile,
    rm,
    realpath,
    snapshot: () => Object.fromEntries(files),
  }
}
