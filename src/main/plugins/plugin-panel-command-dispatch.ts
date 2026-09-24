import type { PluginManifest } from '../../shared/plugins/plugin-manifest'
import { compilePluginDataSchema } from '../../shared/plugins/plugin-data-schema'

export async function invokePanelCommand(
  manifest: PluginManifest,
  commandId: string,
  args: unknown,
  invoke: (command: string, args: unknown) => Promise<unknown>
): Promise<unknown> {
  const command = manifest.contributes.commands.find((entry) => entry.id === commandId)
  if (!command?.panel || command.action !== undefined) {
    throw new Error('Command is not exposed to panels')
  }
  const input = compilePluginDataSchema(command.panel.input)
  const output = compilePluginDataSchema(command.panel.output)
  let parsed: unknown
  try {
    parsed = input.parse(args === undefined ? {} : args)
  } catch {
    throw new Error('Invalid panel command arguments')
  }
  const result = await invoke(commandId, parsed)
  try {
    return output.parse(result)
  } catch {
    throw new Error('Invalid panel command result')
  }
}
