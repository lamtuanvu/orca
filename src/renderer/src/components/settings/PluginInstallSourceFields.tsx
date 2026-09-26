import { useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import type { PluginInstallSourceKind } from './plugin-install-source'

export type PluginInstallSourceValues = Record<PluginInstallSourceKind, string>

export const EMPTY_PLUGIN_INSTALL_SOURCE_VALUES: PluginInstallSourceValues = {
  'local-path': '',
  archive: '',
  git: ''
}

export function installValidationMessage(reason: string): string {
  switch (reason) {
    case 'missing-local-path':
      return translate(
        'auto.components.settings.PluginInstallDialog.localRequired',
        'Enter the plugin folder path.'
      )
    case 'missing-archive-path':
      return translate(
        'auto.components.settings.PluginInstallDialog.archiveRequired',
        'Choose a plugin zip file.'
      )
    case 'missing-git-url':
      return translate(
        'auto.components.settings.PluginInstallDialog.gitUrlRequired',
        'Enter a repository URL.'
      )
    case 'invalid-git-url':
      return translate(
        'auto.components.settings.PluginInstallDialog.gitUrlInvalid',
        'Use an HTTPS or SSH Git URL. Executable Git helper protocols are not allowed.'
      )
    default:
      return translate(
        'auto.components.settings.PluginInstallDialog.gitRefRequired',
        'Add an explicit #ref (tag or commit) so the install is pinned — for example #v0.1.0.'
      )
  }
}

function isPluginKind(value: string): value is PluginInstallSourceKind {
  return value === 'local-path' || value === 'archive' || value === 'git'
}

// Why: web/mobile renderers have no native picker; typed paths still work there.
function canPickInstallSource(): boolean {
  return typeof window.api?.plugins?.pickInstallSource === 'function'
}

type PluginPathFieldProps = {
  id: string
  kind: 'local-path' | 'archive'
  value: string
  invalid: boolean
  describedBy?: string
  disabled: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
}

function PluginPathField({
  id,
  kind,
  value,
  invalid,
  describedBy,
  disabled,
  autoFocus,
  onChange
}: PluginPathFieldProps): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const browse = async (): Promise<void> => {
    setPicking(true)
    try {
      const picked = await window.api.plugins.pickInstallSource({
        kind: kind === 'local-path' ? 'folder' : 'archive'
      })
      if (picked) {
        onChange(picked)
      }
    } catch (cause) {
      console.warn('[plugins] install source picker failed:', cause)
    } finally {
      setPicking(false)
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        className="font-mono text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          kind === 'local-path'
            ? translate(
                'auto.components.settings.PluginInstallDialog.localPlaceholder',
                '/Users/you/plugins/my-plugin or C:\\Users\\you\\plugins\\my-plugin'
              )
            : translate(
                'auto.components.settings.PluginInstallDialog.archivePlaceholder',
                '/Users/you/Downloads/my-plugin.zip'
              )
        }
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
      />
      {canPickInstallSource() ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || picking}
          onClick={() => void browse()}
        >
          {picking ? <Loader2 className="animate-spin" /> : <FolderOpen />}
          {translate('auto.components.settings.PluginInstallDialog.browse', 'Browse…')}
        </Button>
      ) : null}
    </div>
  )
}

type PluginInstallSourceFieldsProps = {
  kind: PluginInstallSourceKind
  values: PluginInstallSourceValues
  error: string | null
  errorId: string
  disabled: boolean
  onKindChange: (kind: PluginInstallSourceKind) => void
  onValueChange: (kind: PluginInstallSourceKind, value: string) => void
}

export function PluginInstallSourceFields({
  kind,
  values,
  error,
  errorId,
  disabled,
  onKindChange,
  onValueChange
}: PluginInstallSourceFieldsProps): React.JSX.Element {
  const describedBy = error ? errorId : undefined
  return (
    <Tabs value={kind} onValueChange={(value) => isPluginKind(value) && onKindChange(value)}>
      <TabsList
        aria-label={translate(
          'auto.components.settings.PluginInstallDialog.source',
          'Install source'
        )}
      >
        <TabsTrigger value="local-path">
          {translate('auto.components.settings.PluginInstallDialog.localTab', 'Local folder')}
        </TabsTrigger>
        <TabsTrigger value="archive">
          {translate('auto.components.settings.PluginInstallDialog.archiveTab', 'Zip file')}
        </TabsTrigger>
        <TabsTrigger value="git">
          {translate('auto.components.settings.PluginInstallDialog.gitTab', 'Git URL')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="local-path">
        <div className="space-y-2 pt-2">
          <Label htmlFor="plugin-local-path">
            {translate(
              'auto.components.settings.PluginInstallDialog.localLabel',
              'Plugin folder path'
            )}
          </Label>
          <PluginPathField
            id="plugin-local-path"
            kind="local-path"
            value={values['local-path']}
            invalid={kind === 'local-path' && Boolean(error)}
            describedBy={describedBy}
            disabled={disabled}
            autoFocus
            onChange={(value) => onValueChange('local-path', value)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.settings.PluginInstallDialog.localCopyHelp',
              'A folder containing orca-plugin.json on this computer. Orca copies it; later edits to the folder need an update.'
            )}
          </p>
        </div>
      </TabsContent>
      <TabsContent value="archive">
        <div className="space-y-2 pt-2">
          <Label htmlFor="plugin-archive-path">
            {translate('auto.components.settings.PluginInstallDialog.archiveLabel', 'Zip file')}
          </Label>
          <PluginPathField
            id="plugin-archive-path"
            kind="archive"
            value={values.archive}
            invalid={kind === 'archive' && Boolean(error)}
            describedBy={describedBy}
            disabled={disabled}
            onChange={(value) => onValueChange('archive', value)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.settings.PluginInstallDialog.archiveHelp',
              'A .zip with orca-plugin.json at its top level or inside one top-level folder, such as a Git host "Download ZIP" file.'
            )}
          </p>
        </div>
      </TabsContent>
      <TabsContent value="git">
        <div className="space-y-2 pt-2">
          <Label htmlFor="plugin-git-url">
            {translate(
              'auto.components.settings.PluginInstallDialog.gitLabel',
              'Repository URL with #ref'
            )}
          </Label>
          <Input
            id="plugin-git-url"
            className="font-mono text-xs"
            value={values.git}
            onChange={(event) => onValueChange('git', event.target.value)}
            placeholder={translate(
              'auto.components.settings.PluginInstallDialog.gitPlaceholder',
              'https://git.example/acme/orca-notes#v0.1.0'
            )}
            spellCheck={false}
            disabled={disabled}
            aria-invalid={kind === 'git' && Boolean(error)}
            aria-describedby={describedBy}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.settings.PluginInstallDialog.gitHelp',
              'Append an explicit #ref — a tag or commit — so the install is pinned. Works with GitHub, GitLab, and any git host.'
            )}
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}
