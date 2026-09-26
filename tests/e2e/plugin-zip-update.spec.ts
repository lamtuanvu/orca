/**
 * Invariant: a plugin installed from a zip can be updated in place from a newer
 * zip through the settings UI, keeps its stored data, and can roll back.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import {
  buildTestZip,
  testPluginManifest
} from '../../src/main/plugins/__mocks__/plugin-archive-test-fixture'
import { expect, test } from './helpers/orca-app'

const PLUGIN_KEY = 'orca-samples.demo'

async function writePluginZip(root: string, version: string): Promise<string> {
  const path = join(root, `demo-${version}.zip`)
  await writeFile(
    path,
    buildTestZip([
      { name: 'demo/', mode: 0o040755 },
      { name: 'demo/orca-plugin.json', data: testPluginManifest({ version }) },
      { name: 'demo/panel.html', data: `<h1>Demo ${version}</h1>` }
    ])
  )
  return path
}

async function openPluginSettings(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    window.__store?.setState({ settings })
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.locator('[data-settings-section="plugins"]')).toBeVisible()
}

async function chooseZip(page: Page, dialogName: string | RegExp, zipPath: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: dialogName })
  await dialog.getByRole('tab', { name: 'Zip file' }).click()
  await dialog.locator('#plugin-archive-path').fill(zipPath)
}

test('installs a plugin from a zip, updates it in place, and rolls back', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-zip-e2e-'))
  try {
    const v1 = await writePluginZip(tempRoot, '1.0.0')
    const v2 = await writePluginZip(tempRoot, '2.0.0')
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))

    await openPluginSettings(orcaPage)
    await orcaPage.getByRole('button', { name: 'Install plugin' }).click()
    await chooseZip(orcaPage, 'Install plugin', v1)
    await orcaPage
      .getByRole('dialog', { name: 'Install plugin' })
      .getByRole('button', { name: 'Install', exact: true })
      .click()

    const consent = orcaPage.getByRole('dialog', { name: 'Review plugin' })
    await expect(consent).toContainText('Zip file')
    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()

    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${PLUGIN_KEY}"]`)
    await expect(row).toContainText('v1.0.0')
    await expect(row).toContainText('Enabled')

    const dataDir = join(userData, 'plugins-data', PLUGIN_KEY)
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'storage.json'), '{"notes":"kept"}')

    await row.getByRole('button', { name: /More actions/ }).click()
    await orcaPage.getByRole('menuitem', { name: 'Update…' }).click()
    await chooseZip(orcaPage, /^Update /, v2)
    const update = orcaPage.getByRole('dialog', { name: /^Update / })
    await update.getByRole('button', { name: 'Review update' }).click()
    await expect(update).toContainText('v1.0.0')
    await expect(update).toContainText('v2.0.0')
    await expect(update).toContainText('Plugin data and settings are kept')
    await testInfo.attach('update-review', {
      body: await update.screenshot(),
      contentType: 'image/png'
    })
    await update.getByRole('button', { name: 'Update plugin' }).click()
    await expect(update).toBeHidden()

    // Same permissions, so the plugin stays enabled without another review.
    await expect(row).toContainText('v2.0.0')
    await expect(row).toContainText('Enabled')
    await expect(readFile(join(dataDir, 'storage.json'), 'utf8')).resolves.toBe('{"notes":"kept"}')

    await row.getByRole('button', { name: /More actions/ }).click()
    await orcaPage.getByRole('menuitem', { name: 'Roll back' }).click()
    await orcaPage
      .getByRole('dialog', { name: 'Roll back plugin?' })
      .getByRole('button', { name: 'Roll back plugin' })
      .click()
    await expect(row).toContainText('v1.0.0')
    await expect(readFile(join(dataDir, 'storage.json'), 'utf8')).resolves.toBe('{"notes":"kept"}')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
