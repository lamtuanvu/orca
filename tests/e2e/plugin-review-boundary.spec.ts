/** Exercises the real iframe → worker → native viewer path without a service account. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

function createReviewPlugin(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-review-boundary-'))
  const empty = { type: 'object', properties: {}, additionalProperties: false }
  const manifest = {
    manifestVersion: 1,
    id: 'review-boundary',
    publisher: 'orca-tests',
    name: 'Review Boundary',
    version: '1.0.0',
    engines: { orca: '>=1.4.0' },
    pluginApi: 1,
    main: 'main.mjs',
    capabilities: [{ kind: 'commands:invoke-own' }, { kind: 'diffs:open' }],
    contributes: {
      panels: [{ id: 'review', title: 'Review Boundary', entry: 'panel.html' }],
      commands: [
        { id: 'snapshot', title: 'Snapshot loader' },
        { id: 'contents', title: 'Content loader' },
        { id: 'write', title: 'Internal write' },
        {
          id: 'status',
          title: 'Status',
          panel: {
            effect: 'read',
            input: empty,
            output: { type: 'integer', minimum: 0 }
          }
        }
      ],
      reviewProviders: [
        {
          id: 'pull-request',
          title: 'Pull request',
          snapshotCommand: 'snapshot',
          contentCommand: 'contents',
          input: empty
        }
      ]
    }
  }
  writeFileSync(join(root, 'orca-plugin.json'), JSON.stringify(manifest))
  writeFileSync(
    join(root, 'main.mjs'),
    `
    export default function activate(orca) {
      let writes = 0;
      orca.commands.register('write', () => ++writes);
      orca.commands.register('status', () => writes);
      orca.commands.register('snapshot', () => ({
        title: 'Boundary review', revision: 'immutable-head', context: { secret: 'host-context' },
        files: [{ path: 'hello.ts', status: 'modified', additions: 1, deletions: 1 }]
      }));
      orca.commands.register('contents', () => ({
        original: { kind: 'text', content: 'export const greeting = "before"\\n' },
        modified: { kind: 'text', content: 'export const greeting = "after"\\n' }
      }));
    }
  `
  )
  writeFileSync(
    join(root, 'panel.html'),
    `<!doctype html><html><body>
    <button id="probe">Probe denied paths</button><output id="probes"></output>
    <button id="open">Open review</button><output id="result"></output>
    <script>
      let sequence = 0;
      const pending = new Map();
      function call(action, params) {
        return new Promise(resolve => {
          const requestId = 'request-' + ++sequence;
          pending.set(requestId, resolve);
          parent.postMessage({ type: 'orca-panel-action', requestId, action, params }, '*');
        });
      }
      addEventListener('message', event => {
        const data = event.data;
        if (event.source !== parent || data?.type !== 'orca-panel-action-result') return;
        const resolve = pending.get(data.requestId);
        pending.delete(data.requestId);
        resolve?.(data);
      });
      document.getElementById('probe').onclick = async () => {
        const loader = await call('commands.invokeOwn', { commandId: 'contents', args: {} });
        const writer = await call('commands.invokeOwn', { commandId: 'write', args: {} });
        const injection = await call('diffs.openReview', {
          commandId: 'write', contentCommandId: 'contents', args: {}
        });
        const status = await call('commands.invokeOwn', { commandId: 'status', args: {} });
        document.getElementById('probes').textContent =
          !loader.ok && !writer.ok && !injection.ok && status.ok && status.value === 0
            ? 'Denied; writes: 0' : 'Boundary failed';
      };
      document.getElementById('open').onclick = async () => {
        const result = await call('diffs.openReview', { providerId: 'pull-request', args: {} });
        const keys = Object.keys(result.value || {}).sort().join(',');
        document.getElementById('result').textContent = result.ok && keys === 'reviewId,revision'
          ? 'Opened: ' + result.value.revision : 'Unexpected response: ' + JSON.stringify(result);
      };
    </script></body></html>`
  )
  return root
}

test('panel authority is bounded while native reviews remain usable', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const pluginPath = createReviewPlugin()
  registerPostElectronShutdownCleanup(async () =>
    rmSync(pluginPath, { recursive: true, force: true })
  )
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  const installed = await orcaPage.evaluate(async (sourcePath) => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    window.__store?.setState({ settings })
    const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
    if (!result.ok) {
      throw new Error(result.error)
    }
    await window.api.plugins.refresh()
    window.__store?.getState().openSettingsTarget({ pane: 'plugins', repoId: null })
    window.__store?.getState().openSettingsPage()
    return result
  }, pluginPath)
  await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
  const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
  await row.getByRole('button', { name: 'Review & enable' }).click()
  await orcaPage
    .getByRole('dialog', { name: 'Review permissions' })
    .getByRole('button', { name: 'Enable plugin' })
    .click()
  await expect(row).toContainText('Enabled')
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.closeSettingsPage()
    if (state && !state.rightSidebarOpen) {
      state.toggleRightSidebar()
    }
  })
  await orcaPage.getByRole('button', { name: 'Review Boundary', exact: true }).click()
  const panel = orcaPage.frameLocator('iframe[title="Review Boundary"]')
  await panel.getByRole('button', { name: 'Probe denied paths' }).click()
  await expect(panel.locator('#probes')).toHaveText('Denied; writes: 0')
  await panel.getByRole('button', { name: 'Open review' }).click()
  const review = orcaPage.getByRole('dialog', { name: 'Boundary review' })
  await expect(review).toBeVisible()
  await expect(review.locator('.monaco-diff-editor')).toBeVisible()
  await expect(review.locator('.view-lines')).toContainText(['before', 'after'])
  await review.screenshot({ path: testInfo.outputPath('native-review-boundary.png') })
  await review.getByRole('button', { name: 'Unified view' }).click()
  await review.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel.locator('#result')).toHaveText('Opened: immutable-head')
  expect(pageErrors).toEqual([])
})
