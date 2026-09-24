/** Runs the bundled CV Hub plugin against a local API fixture in an isolated, hidden app. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test } from './helpers/orca-app'

const pluginPath = process.env.CV_HUB_PLUGIN_PATH

test('opens immutable CV Hub contents in the native diff viewer', async ({
  orcaPage
}, testInfo) => {
  test.skip(!pluginPath, 'Set CV_HUB_PLUGIN_PATH to the built CV Hub plugin directory')
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  orcaPage.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[cv-console]', message.text())
    }
  })
  const head = 'a'.repeat(40)
  const base = 'b'.repeat(40)
  const requests: string[] = []
  let origin = ''
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin)
    requests.push(url.pathname + url.search)
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== 'Bearer cv_pat_fixture') {
      res.writeHead(401).end('{}')
      return
    }
    let body: unknown
    if (url.pathname === '/api/auth/me') {
      body = { user: { id: 'u', username: 'alice' } }
    } else if (url.pathname === '/api/mcp/connection-info') {
      body = { transport: 'streamable-http', mcpUrl: `${origin}/mcp` }
    } else if (url.pathname === '/api/v1/repos') {
      body = {
        repositories: [{ id: 'r', slug: 'demo', owner: { slug: 'acme' } }],
        pagination: { total: 1 }
      }
    } else if (url.pathname.endsWith('/review-snapshot')) {
      body = {
        snapshot: {
          owner: 'acme',
          repo: 'demo',
          repositoryId: 'r',
          number: 7,
          title: 'Change greeting',
          baseSha: base,
          mergeBaseSha: base,
          headSha: head,
          files: [{ path: 'hello.ts', status: 'modified', additions: 1, deletions: 1 }]
        }
      }
    } else if (url.pathname.endsWith('/review-file')) {
      body = {
        kind: 'text',
        content:
          url.searchParams.get('sha') === base
            ? 'export const greeting = "before"\n'
            : 'export const greeting = "after"\n'
      }
    } else {
      const pull = {
        number: 7,
        title: 'Change greeting',
        state: 'open',
        body: 'Review the greeting',
        sourceBranch: 'feature',
        targetBranch: 'main',
        author: { username: 'alice' }
      }
      if (url.pathname.endsWith('/pulls')) {
        body = { pullRequests: [pull], total: 1 }
      } else if (url.pathname.endsWith('/pulls/7')) {
        body = { pullRequest: pull }
      } else {
        res.writeHead(404).end('{}')
        return
      }
    }
    res.end(JSON.stringify(body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('No fixture port')
  }
  origin = `http://127.0.0.1:${address.port}`
  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await window.api.plugins.refresh()
      const state = window.__store?.getState()
      state?.openSettingsTarget({ pane: 'plugins', repoId: null })
      state?.openSettingsPage()
      return result
    }, pluginPath!)
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
    await orcaPage.getByRole('button', { name: 'CV Hub', exact: true }).click()
    const panel = orcaPage.frameLocator('iframe[title="CV Hub"]')
    await panel.locator('#origin').fill(origin)
    await panel.locator('#token').fill('cv_pat_fixture')
    await panel.locator('#connect-button').click()
    await panel.getByRole('button', { name: /#7 Change greeting/ }).click()
    await panel.getByRole('button', { name: 'Open changes in Orca' }).click()
    const review = orcaPage.getByRole('dialog', { name: /acme\/demo #7/ })
    await expect(review).toBeVisible()
    await expect(review.locator('.monaco-diff-editor')).toBeVisible()
    await expect(review.locator('.view-lines')).toContainText(['before', 'after'])
    expect(requests).toContain(
      `/api/v1/repos/acme/demo/pulls/7/review-file?sha=${base}&path=hello.ts`
    )
    expect(requests).toContain(
      `/api/v1/repos/acme/demo/pulls/7/review-file?sha=${head}&path=hello.ts`
    )
    await review.screenshot({ path: testInfo.outputPath('native-review.png') })
    await review.getByRole('button', { name: 'Unified view' }).click()
    await review.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Submit review', exact: true })).toBeEnabled()
    expect(pageErrors).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
