import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

type PluginRemoveDialogProps = {
  plugin: PluginHostListEntry | null
  busy: boolean
  onCancel: () => void
  onConfirm: (pluginKey: string, keepData: boolean) => void
}

export function PluginRemoveDialog({
  plugin,
  busy,
  onCancel,
  onConfirm
}: PluginRemoveDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [keepData, setKeepData] = useState(false)
  return (
    <Dialog open={Boolean(plugin)} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.PluginRemoveDialog.title', 'Remove plugin?')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.PluginRemoveDialog.descriptionWithoutData',
              'This removes {{value0}} from this computer. You can install it again later.',
              { value0: plugin?.name ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-xs">
          <Checkbox
            checked={keepData}
            disabled={busy}
            onCheckedChange={(checked) => setKeepData(checked === true)}
          />
          <span className="space-y-1">
            <span className="block font-medium text-foreground">
              {translate(
                'auto.components.settings.PluginRemoveDialog.keepData',
                'Keep plugin data'
              )}
            </span>
            <span className="block text-muted-foreground">
              {translate(
                'auto.components.settings.PluginRemoveDialog.keepDataHelp',
                'Its stored data and settings stay on this computer and come back if you install it again. Otherwise they are deleted.'
              )}
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={onCancel}>
            {translate('auto.components.settings.PluginRemoveDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !plugin}
            onClick={() => plugin && onConfirm(plugin.pluginKey, keepData)}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.settings.PluginRemoveDialog.remove', 'Remove plugin')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
