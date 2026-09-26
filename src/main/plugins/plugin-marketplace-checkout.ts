import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { PluginMarketplaceCheckoutSource } from '../../shared/plugins/plugin-marketplace'
import { isSafePluginRelativePath } from '../../shared/plugins/plugin-path-safety'
import { checkoutPluginGitSource } from './plugin-git-repository'

/** Checks out a listing's repository and returns the plugin root inside it. */
export async function checkoutMarketplacePlugin(input: {
  source: PluginMarketplaceCheckoutSource
  destination: string
  workingDirectory: string
}): Promise<{ resolvedCommit: string; rootDir: string }> {
  const resolvedCommit = await checkoutPluginGitSource({
    url: input.source.url,
    ref: input.source.ref,
    destination: input.destination,
    workingDirectory: input.workingDirectory
  })
  if (!input.source.path) {
    return { resolvedCommit, rootDir: input.destination }
  }
  return {
    resolvedCommit,
    rootDir: await resolvePluginFolder(input.destination, input.source.path)
  }
}

async function resolvePluginFolder(checkoutDir: string, path: string): Promise<string> {
  if (!isSafePluginRelativePath(path)) {
    throw new Error(`unsafe marketplace plugin path: ${path}`)
  }
  const candidate = join(checkoutDir, ...path.split('/'))
  const stat = await lstat(candidate).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`marketplace plugin folder not found: ${path}`)
  }
  // Why: a committed symlink in an intermediate segment could point outside the checkout.
  const [rootReal, candidateReal] = await Promise.all([realpath(checkoutDir), realpath(candidate)])
  const fromRoot = relative(rootReal, candidateReal)
  if (!fromRoot || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`marketplace plugin folder escapes the repository: ${path}`)
  }
  return candidate
}
