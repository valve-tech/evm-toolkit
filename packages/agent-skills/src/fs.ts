/**
 * @fileoverview The filesystem seam. Everything in this package that
 * touches disk goes through `FileSystem`, so the scan/plan/apply/check
 * logic is testable against in-memory fixtures and the only Node-bound
 * code is the one real implementation below.
 *
 * This package is a Node-only dev tool — the toolkit's browser-safety
 * invariant applies to library packages, not to this CLI.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'

/** A single directory entry as returned by {@link FileSystem.listDir}. */
export interface DirEntry {
  name: string
  isDirectory: boolean
}

/**
 * The injected filesystem surface. Paths are absolute; joining is the
 * caller's job (use `joinPath` so tests and prod agree on separators).
 */
export interface FileSystem {
  /** True if a file OR directory exists at `p`. */
  exists(p: string): boolean
  /** Entries of directory `p` (empty array if `p` doesn't exist). */
  listDir(p: string): DirEntry[]
  /** UTF-8 file contents. Throws if missing. */
  readFile(p: string): string
  /** Write UTF-8 contents, creating parent directories as needed. */
  writeFile(p: string, contents: string): void
  /** Recursively delete `p` (no-op if missing). */
  rm(p: string): void
  /**
   * Resolve symlinks to the real absolute path. Used to detect
   * workspace-symlinked packages (in-repo `node_modules` links that
   * point back into the project) so `install` skips them.
   */
  realpath(p: string): string
}

/** Join path segments with the platform separator. */
export const joinPath = (...segments: string[]): string =>
  path.join(...segments)

/** Hex SHA-256 of a UTF-8 string — the manifest's file fingerprint. */
export const sha256 = (contents: string): string =>
  createHash('sha256').update(contents, 'utf8').digest('hex')

/** The one real `FileSystem`. Everything else injects it. */
export const nodeFileSystem: FileSystem = {
  exists: (p) => fs.existsSync(p),
  listDir: (p) => {
    if (!fs.existsSync(p)) return []
    return fs
      .readdirSync(p, { withFileTypes: true })
      .map((entry) => ({
        name: entry.name,
        // Stat through symlinks: a symlinked package dir counts as a
        // directory here; workspace-link detection happens via realpath.
        isDirectory: entry.isSymbolicLink()
          ? fs.statSync(path.join(p, entry.name)).isDirectory()
          : entry.isDirectory(),
      }))
  },
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, contents) => {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, contents, 'utf8')
  },
  rm: (p) => fs.rmSync(p, { recursive: true, force: true }),
  realpath: (p) => fs.realpathSync(p),
}
