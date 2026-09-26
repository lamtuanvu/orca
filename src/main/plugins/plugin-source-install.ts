import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'
import {
  isAllowedPluginGitUrl,
  type PluginInstallSource
} from '../../shared/plugins/plugin-install-lockfile'
import { extractPluginArchive } from './plugin-archive-extraction'
import { checkoutPluginGitSource } from './plugin-git-repository'
import { serializePluginMutation } from './plugin-mutation-queue'
import {
  inspectPluginInstallTree,
  installStagedPluginTree,
  type PluginInstallInspection,
  type PluginInstallResult
} from './plugin-install-staging'

/** Sources a user can install or update from directly (not via a marketplace). */
export type PluginDirectInstallSource =
  | { kind: 'local-path'; path: string }
  | { kind: 'archive'; path: string }
  | { kind: 'git'; url: string; ref: string }

type StagedPluginSource = {
  rootDir: string
  installSource: PluginInstallSource
  resolvedCommit: string | null
}

/** Materializes a source as a readable tree, runs `operation`, then deletes any temp copy. */
async function withStagedPluginSource<T>(
  source: PluginDirectInstallSource,
  operation: (staged: StagedPluginSource) => Promise<T>
): Promise<T> {
  if (source.kind === 'local-path') {
    if (!existsSync(join(source.path, PLUGIN_MANIFEST_FILENAME))) {
      throw new Error(`no ${PLUGIN_MANIFEST_FILENAME} found in ${source.path}`)
    }
    return operation({
      rootDir: source.path,
      installSource: { kind: 'local-path', path: source.path },
      resolvedCommit: null
    })
  }
  if (source.kind === 'git' && !isAllowedPluginGitUrl(source.url)) {
    throw new Error('plugin Git URL must use HTTPS or SSH')
  }
  const stagingDir = await mkdtemp(join(tmpdir(), `orca-plugin-${source.kind}-`))
  try {
    if (source.kind === 'archive') {
      const extracted = await extractPluginArchive({
        archivePath: source.path,
        destination: stagingDir
      })
      return await operation({
        rootDir: extracted.rootDir,
        installSource: {
          kind: 'archive',
          fileName: basename(source.path),
          sha256: extracted.sha256
        },
        resolvedCommit: null
      })
    }
    const ref = source.ref.trim()
    const resolvedCommit = await checkoutPluginGitSource({
      url: source.url,
      ref,
      destination: stagingDir,
      workingDirectory: tmpdir()
    })
    return await operation({
      rootDir: stagingDir,
      installSource: { kind: 'git', url: source.url, ref },
      resolvedCommit
    })
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

function errorResult(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

/** Installs or replaces a plugin from a direct source. Replacing keeps the
 * plugin's data directory and retains the previous version for rollback. */
export async function installPluginFromSource(input: {
  pluginsDir: string
  source: PluginDirectInstallSource
  hostVersion: string
  /** Set for updates: the new bytes must carry this identity. */
  expectedPluginKey?: string
  expectedContentHash?: string
  blockedPluginReason?: (pluginKey: string) => string | null
}): Promise<PluginInstallResult> {
  return serializePluginMutation(input.pluginsDir, async () => {
    try {
      return await withStagedPluginSource(input.source, async (staged) => {
        if (input.expectedPluginKey) {
          const identityError = await checkExpectedIdentity(
            staged.rootDir,
            input.hostVersion,
            input.expectedPluginKey
          )
          if (identityError) {
            return { ok: false, error: identityError }
          }
        }
        return installStagedPluginTree({
          pluginsDir: input.pluginsDir,
          stagingDir: staged.rootDir,
          hostVersion: input.hostVersion,
          source: staged.installSource,
          resolvedCommit: staged.resolvedCommit,
          ...(input.expectedContentHash ? { expectedContentHash: input.expectedContentHash } : {}),
          blockedPluginReason: input.blockedPluginReason
        })
      })
    } catch (error) {
      return errorResult(error)
    }
  })
}

async function checkExpectedIdentity(
  rootDir: string,
  hostVersion: string,
  expectedPluginKey: string
): Promise<string | null> {
  const inspection = await inspectPluginInstallTree({ rootDir, hostVersion })
  if (!inspection.ok) {
    return inspection.error
  }
  return inspection.pluginKey === expectedPluginKey
    ? null
    : `this source contains ${inspection.pluginKey}, not ${expectedPluginKey}`
}

export type PluginSourceInspection =
  | (Extract<PluginInstallInspection, { ok: true }> & {
      installSource: PluginInstallSource
      resolvedCommit: string | null
    })
  | { ok: false; error: string }

/** Validates and hashes a direct source without publishing it. */
export async function inspectPluginSource(input: {
  source: PluginDirectInstallSource
  hostVersion: string
}): Promise<PluginSourceInspection> {
  try {
    return await withStagedPluginSource(input.source, async (staged) => {
      const inspection = await inspectPluginInstallTree({
        rootDir: staged.rootDir,
        hostVersion: input.hostVersion
      })
      return inspection.ok
        ? {
            ...inspection,
            installSource: staged.installSource,
            resolvedCommit: staged.resolvedCommit
          }
        : inspection
    })
  } catch (error) {
    return errorResult(error)
  }
}
