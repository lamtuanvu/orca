import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PluginHostInstallSource } from '../../../../preload/api-types'
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

type PluginInstallDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstall: (source: PluginHostInstallSource) => Promise<void>
}

export function PluginInstallDialog({
  open,
  onOpenChange,
  onInstall
}: PluginInstallDialogProps): React.JSX.Element {
  const [kind, setKind] = useState<PluginInstallSourceKind>('local-path')
  const [values, setValues] = useState<PluginInstallSourceValues>(
    EMPTY_PLUGIN_INSTALL_SOURCE_VALUES
  )
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  const submit = async (): Promise<void> => {
    const parsed = parsePluginInstallSource(kind, values[kind])
    if (!parsed.ok) {
      setError(installValidationMessage(parsed.reason))
      return
    }
    setError(null)
    setInstalling(true)
    try {
      await onInstall(parsed.source)
    } catch (cause) {
      console.warn('[plugins] installation failed:', cause)
      setError(pluginInstallErrorMessage(cause))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !installing && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.PluginInstallDialog.title', 'Install plugin')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.PluginInstallDialog.description',
              'Installing copies the plugin into Orca and shows its permissions for review. No plugin code runs until you enable it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <PluginInstallSourceFields
            kind={kind}
            values={values}
            error={error}
            errorId="plugin-install-error"
            disabled={installing}
            onKindChange={(nextKind) => {
              setKind(nextKind)
              setError(null)
            }}
            onValueChange={(sourceKind, value) =>
              setValues((current) => ({ ...current, [sourceKind]: value }))
            }
          />
          {error ? (
            <p id="plugin-install-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={installing}
              onClick={() => onOpenChange(false)}
            >
              {translate('auto.components.settings.PluginInstallDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" className="w-31" disabled={installing}>
              {installing ? <Loader2 className="animate-spin" /> : null}
              {installing
                ? translate(
                    'auto.components.settings.PluginInstallDialog.installing',
                    'Installing…'
                  )
                : translate('auto.components.settings.PluginInstallDialog.install', 'Install')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
