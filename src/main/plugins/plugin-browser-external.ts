import { pluginWebUrlSchema } from '../../shared/plugins/plugin-browser-contract'

type Open = (url: string) => Promise<void>

async function loadDesktopOpener(): Promise<Open | null> {
  const { shell } = await import('electron')
  return shell?.openExternal ? (url) => shell.openExternal(url) : null
}

export class PluginExternalBrowser {
  private generation = 0

  constructor(
    private readonly resolve: (key: string) => object | null,
    private readonly loadOpener: () => Promise<Open | null> = loadDesktopOpener
  ) {}

  async open(plugin: string, url: string): Promise<{ opened: boolean }> {
    const target = pluginWebUrlSchema.parse(url)
    const identity = this.resolve(plugin)
    const generation = this.generation
    if (!identity) {
      throw new Error('Plugin unavailable')
    }
    let open: Open | null
    try {
      open = await this.loadOpener()
    } catch {
      return { opened: false }
    }
    // Loading Electron yields; consent or activation may have changed in the meantime.
    if (generation !== this.generation || this.resolve(plugin) !== identity) {
      throw new Error('Plugin unavailable')
    }
    if (!open) {
      return { opened: false }
    }
    try {
      await open(target)
      return { opened: true }
    } catch {
      return { opened: false }
    }
  }

  clear(): void {
    this.generation++
  }
}
