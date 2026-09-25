import {
  PLUGIN_WORKSPACE_REMOTE_LIMIT,
  PLUGIN_WORKSPACE_REMOTE_NAME_MAX_LENGTH,
  PLUGIN_WORKSPACE_REMOTE_URL_MAX_LENGTH
} from '../../shared/plugins/plugin-host-api'

export type PluginGitRemote = { name: string; url: string }

// user@host:path, the scp-like form git accepts for SSH. It can't carry a password.
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/\/)/

/** A remote URL safe to show a plugin, or null. Credentials are removed from URL-form remotes;
 *  local paths and file: URLs are dropped because they reveal the filesystem. */
export function sanitizePluginGitRemoteUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url || url.length > PLUGIN_WORKSPACE_REMOTE_URL_MAX_LENGTH) {
    return null
  }
  if (SCP_LIKE.test(url)) {
    return url
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol) || !parsed.host) {
    return null
  }
  // Why: HTTPS remotes often embed a token as userinfo; ssh:// keeps only the login name.
  parsed.password = ''
  if (parsed.protocol !== 'ssh:') {
    parsed.username = ''
  }
  return parsed.toString()
}

/** Parses `git remote -v`, keeping one sanitized fetch URL per remote name. */
export function parsePluginGitRemotes(stdout: string): PluginGitRemote[] {
  const remotes: PluginGitRemote[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)\s*$/.exec(line.trim())
    if (!match) {
      continue
    }
    const [, name, rawUrl] = match
    if (seen.has(name) || name.length > PLUGIN_WORKSPACE_REMOTE_NAME_MAX_LENGTH) {
      continue
    }
    const url = sanitizePluginGitRemoteUrl(rawUrl)
    if (!url) {
      continue
    }
    seen.add(name)
    remotes.push({ name, url })
    if (remotes.length >= PLUGIN_WORKSPACE_REMOTE_LIMIT) {
      break
    }
  }
  return remotes
}
