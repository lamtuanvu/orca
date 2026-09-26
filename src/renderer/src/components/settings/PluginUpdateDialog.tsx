import { useState } from 'react'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import type {
  PluginHostInstallSource,
  PluginHostListEntry,
  PluginUpdatePreview
} from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { parsePluginInstallSource, type PluginInstallSourceKind } from './plugin-install-source'
import { pluginInstallErrorMessage } from './plugin-error-presentation'
import {
  EMPTY_PLUGIN_INSTALL_SOURCE_VALUES,
  PluginInstallSourceFields,
  installValidationMessage,
  type PluginInstallSourceValues
} from './PluginInstallSourceFields'

type PluginUpdateDialogProps = {
  plugin: PluginHostListEntry | null
  onCancel: () => void
  onUpdated: (pluginKey: string) => Promise<void>
}

/** Prefills the source the plugin was installed from so "update from the same place" is one click. */
function initialSource(plugin: PluginHostListEntry | null): {
  kind: PluginInstallSourceKind
  values: PluginInstallSourceValues
} {
  const source = plugin?.source
  if (source?.kind === 'local-path') {
    return {
      kind: 'local-path',
      values: { ...EMPTY_PLUGIN_INSTALL_SOURCE_VALUES, 'local-path': source.reference }
    }
  }
  if (source?.kind === 'git') {
    return {
      kind: 'git',
      values: {
        ...EMPTY_PLUGIN_INSTALL_SOURCE_VALUES,
        git: source.ref ? `${source.reference}#${source.ref}` : source.reference
      }
    }
  }
  return {
    kind: source?.kind === 'archive' ? 'archive' : 'local-path',
    values: EMPTY_PLUGIN_INSTALL_SOURCE_VALUES
  }
}

function UpdateSummary({ preview }: { preview: PluginUpdatePreview }): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span>v{preview.currentVersion ?? '?'}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <span className="font-semibold">v{preview.nextVersion}</span>
      </div>
      {preview.sameContent ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.PluginUpdateDialog.sameContent',
            'These exact files are already installed. Nothing will change.'
          )}
        </p>
      ) : null}
      {preview.downgrade ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {translate(
            'auto.components.settings.PluginUpdateDialog.downgrade',
            'This is an older version than the one installed.'
          )}
        </p>
      ) : null}
      {preview.permissionsChanged ? (
        <p className="flex items-start gap-1.5 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {translate(
            'auto.components.settings.PluginUpdateDialog.permissionsChanged',
            'Its permissions changed. The plugin stays off until you review and approve them again.'
          )}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        {translate(
          'auto.components.settings.PluginUpdateDialog.dataKept',
          'Plugin data and settings are kept. You can roll back to the current version afterwards.'
        )}
      </p>
    </div>
  )
}

export function PluginUpdateDialog({
  plugin,
  onCancel,
  onUpdated
}: PluginUpdateDialogProps): React.JSX.Element {
  const initial = initialSource(plugin)
  const [kind, setKind] = useState<PluginInstallSourceKind>(initial.kind)
  const [values, setValues] = useState<PluginInstallSourceValues>(initial.values)
  const [reviewed, setReviewed] = useState<{
    source: PluginHostInstallSource
    preview: PluginUpdatePreview
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const review = async (): Promise<void> => {
    if (!plugin) {
      return
    }
    const parsed = parsePluginInstallSource(kind, values[kind])
    if (!parsed.ok) {
      setError(installValidationMessage(parsed.reason))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const preview = await window.api.plugins.previewUpdate({
        pluginKey: plugin.pluginKey,
        source: parsed.source
      })
      setReviewed({ source: parsed.source, preview })
    } catch (cause) {
      console.warn('[plugins] update preview failed:', cause)
      setError(pluginInstallErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!plugin || !reviewed) {
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await window.api.plugins.update({
        pluginKey: plugin.pluginKey,
        source: reviewed.source,
        expectedContentHash: reviewed.preview.contentHash
      })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await onUpdated(plugin.pluginKey)
    } catch (cause) {
      console.warn('[plugins] update failed:', cause)
      setError(pluginInstallErrorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(plugin)} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.PluginUpdateDialog.title', 'Update {{value0}}', {
              value0: plugin?.name ?? ''
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.PluginUpdateDialog.description',
              'Replace the installed version from a folder, zip file, or Git ref. The new files must be the same plugin.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void (reviewed ? apply() : review())
          }}
        >
          {reviewed ? (
            <UpdateSummary preview={reviewed.preview} />
          ) : (
            <PluginInstallSourceFields
              kind={kind}
              values={values}
              error={error}
              errorId="plugin-update-error"
              disabled={busy}
              onKindChange={(nextKind) => {
                setKind(nextKind)
                setError(null)
              }}
              onValueChange={(sourceKind, value) =>
                setValues((current) => ({ ...current, [sourceKind]: value }))
              }
            />
          )}
          {error ? (
            <p id="plugin-update-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => (reviewed ? setReviewed(null) : onCancel())}
            >
              {reviewed
                ? translate('auto.components.settings.PluginUpdateDialog.back', 'Back')
                : translate('auto.components.settings.PluginUpdateDialog.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || Boolean(reviewed?.preview.sameContent)}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {reviewed
                ? translate('auto.components.settings.PluginUpdateDialog.apply', 'Update plugin')
                : translate('auto.components.settings.PluginUpdateDialog.review', 'Review update')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
