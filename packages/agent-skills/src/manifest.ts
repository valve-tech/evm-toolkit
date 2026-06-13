/**
 * @fileoverview The provenance manifest at
 * `.claude/skills/.valve-tech-agent-skills.json`. It records which
 * skill directories THIS tool installed (source package + version +
 * per-file content hashes), so re-runs can distinguish "ours, refresh
 * in place" from "the user's, never touch" and `check` can detect
 * local edits and upgrades.
 */

/** One installed file: path relative to the skill dir + content hash. */
export interface ManifestFile {
  path: string
  sha256: string
}

/** Provenance for one installed skill directory. */
export interface ManifestEntry {
  /** Source npm package, e.g. `@valve-tech/gas-oracle`. */
  package: string
  /** The source package's version at install time. */
  version: string
  /** Every file the installer wrote, with content fingerprints. */
  files: ManifestFile[]
}

/** Skill-dir-name → provenance. The manifest file's whole shape. */
export type Manifest = Record<string, ManifestEntry>

/** Manifest filename inside `.claude/skills/`. */
export const MANIFEST_FILENAME = '.valve-tech-agent-skills.json'

/**
 * Parse manifest JSON, returning an empty manifest for missing/invalid
 * input. Invalid JSON is treated as empty rather than fatal: the
 * conservative consequence is that existing dirs become conflicts
 * (never touched), not that anything gets overwritten.
 */
export const parseManifest = (raw: string | null): Manifest => {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Manifest
  } catch {
    return {}
  }
}

/** Serialize a manifest deterministically (sorted keys, two-space). */
export const serializeManifest = (manifest: Manifest): string => {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  )
  return JSON.stringify(sorted, null, 2) + '\n'
}
