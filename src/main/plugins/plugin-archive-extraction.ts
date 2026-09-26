import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { openPromise, type Entry } from 'yauzl'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'
import { pluginPathSegmentError } from '../../shared/plugins/plugin-path-safety'
import { MAX_PLUGIN_FILES, MAX_PLUGIN_TOTAL_BYTES } from './plugin-content-hash'

/** Compressed archive cap; the uncompressed tree is separately capped while writing. */
export const PLUGIN_ARCHIVE_MAX_BYTES = MAX_PLUGIN_TOTAL_BYTES

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

export type PluginArchiveExtraction = {
  /** Directory holding orca-plugin.json: the extraction root or its single top-level folder. */
  rootDir: string
  sha256: string
}

/** Archive tool metadata that is never plugin content. */
function isArchiveMetadata(segments: readonly string[]): boolean {
  return segments[0] === '__MACOSX' || segments.at(-1) === '.DS_Store'
}

function entryKind(entry: Entry): 'file' | 'directory' | 'unsupported' {
  const unixMode = (entry.externalFileAttributes >>> 16) & S_IFMT
  if (entry.fileName.endsWith('/')) {
    return unixMode === 0 || unixMode === S_IFDIR ? 'directory' : 'unsupported'
  }
  // Why: symlinks and device entries could point outside the staged tree once written.
  return unixMode === 0 || unixMode === S_IFREG ? 'file' : 'unsupported'
}

export async function hashPluginArchive(archivePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archivePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/** Extracts a plugin zip into an empty destination. Every entry is validated
 * before it is written; nothing inside the archive is executed. */
export async function extractPluginArchive(input: {
  archivePath: string
  destination: string
}): Promise<PluginArchiveExtraction> {
  const archiveStat = await stat(input.archivePath).catch(() => null)
  if (!archiveStat?.isFile()) {
    throw new Error(`plugin archive not found: ${input.archivePath}`)
  }
  if (archiveStat.size > PLUGIN_ARCHIVE_MAX_BYTES) {
    throw new Error(`plugin archive exceeds the ${PLUGIN_ARCHIVE_MAX_BYTES}-byte limit`)
  }
  // Why: provenance only; integrity is anchored by hashing the extracted tree afterwards.
  const sha256 = await hashPluginArchive(input.archivePath)
  const zip = await openPromise(input.archivePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true
  }).catch((error: unknown) => {
    throw new Error(
      `not a readable zip archive: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  const seenPaths = new Set<string>()
  let entryCount = 0
  let totalBytes = 0
  try {
    for await (const entry of zip.eachEntry()) {
      const segments = entry.fileName.replace(/\/$/, '').split('/')
      if (isArchiveMetadata(segments)) {
        continue
      }
      for (const segment of segments) {
        const error = pluginPathSegmentError(segment)
        if (error) {
          throw new Error(`unsafe archive path "${entry.fileName}": ${error}`)
        }
      }
      // Why: case-insensitive filesystems (macOS, Windows) would merge these entries.
      const identity = segments.join('/').toLowerCase()
      if (seenPaths.has(identity)) {
        throw new Error(`archive contains duplicate path: ${entry.fileName}`)
      }
      seenPaths.add(identity)
      entryCount += 1
      if (entryCount > MAX_PLUGIN_FILES) {
        throw new Error(`plugin archive exceeds the ${MAX_PLUGIN_FILES}-entry limit`)
      }
      if (entry.isEncrypted()) {
        throw new Error(`encrypted archive entries are not supported: ${entry.fileName}`)
      }
      const kind = entryKind(entry)
      if (kind === 'unsupported') {
        throw new Error(`archive entry is not a regular file or folder: ${entry.fileName}`)
      }
      const target = join(input.destination, ...segments)
      if (kind === 'directory') {
        await mkdir(target, { recursive: true })
        continue
      }
      if (!entry.canDecodeFileData()) {
        throw new Error(`unsupported compression in archive entry: ${entry.fileName}`)
      }
      await mkdir(join(input.destination, ...segments.slice(0, -1)), { recursive: true })
      // Why: count bytes actually inflated so a lying size header cannot bypass the cap.
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          totalBytes += chunk.byteLength
          callback(
            totalBytes > MAX_PLUGIN_TOTAL_BYTES
              ? new Error(`plugin archive exceeds the ${MAX_PLUGIN_TOTAL_BYTES}-byte limit`)
              : null,
            chunk
          )
        }
      })
      await pipeline(
        await zip.openReadStreamPromise(entry),
        limiter,
        createWriteStream(target, { flags: 'wx', mode: 0o644 })
      )
    }
  } finally {
    zip.close()
  }
  return { rootDir: await findPluginArchiveRoot(input.destination), sha256 }
}

/** Accepts the manifest at the top level or inside one wrapper folder, which
 * is how Git hosts' "Download ZIP" archives are laid out. */
async function findPluginArchiveRoot(destination: string): Promise<string> {
  const entries = await readdir(destination, { withFileTypes: true })
  if (entries.some((entry) => entry.isFile() && entry.name === PLUGIN_MANIFEST_FILENAME)) {
    return destination
  }
  if (entries.length === 1 && entries[0]!.isDirectory()) {
    const nested = join(destination, entries[0]!.name)
    const nestedEntries = await readdir(nested, { withFileTypes: true })
    if (nestedEntries.some((entry) => entry.isFile() && entry.name === PLUGIN_MANIFEST_FILENAME)) {
      return nested
    }
  }
  throw new Error(
    `no ${PLUGIN_MANIFEST_FILENAME} found at the top of the archive or inside a single top-level folder`
  )
}
