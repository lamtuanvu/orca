import type { PluginManifest } from './plugin-manifest'

/** Direct sources a renderer may ask main to install or update from. Paths are
 * chosen on the machine running Orca, which is also where plugins install. */
export type PluginDirectInstallRequestSource =
  | { kind: 'local-path'; path: string }
  | { kind: 'archive'; path: string }
  | { kind: 'git'; url: string; ref: string }

/** What an in-place update would change, shown before anything is replaced. */
export type PluginUpdatePreview = {
  pluginKey: string
  currentVersion: string | null
  nextVersion: string
  /** Hash of the reviewed bytes; the update fails if the source changes before apply. */
  contentHash: string
  consentFingerprint: string
  manifest: PluginManifest
  /** Identical bytes are already installed. */
  sameContent: boolean
  /** Capabilities or worker tier changed, so the plugin needs approval again. */
  permissionsChanged: boolean
  downgrade: boolean
}
