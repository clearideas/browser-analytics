// Start the collector API, and in DEV_MODE the playground on a second port, so the
// playground is a cross-origin client exactly like a real website.
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { SqliteStore } from './sqlite-store.ts'

const config = loadConfig()
const store = new SqliteStore(config.databasePath)
const { app } = createApp({ config, store })

const api = serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`Collector API      http://localhost:${info.port}  (spec: spec/openapi.yaml)`)
})

let playground: ReturnType<typeof serve> | undefined

if (config.devMode) {
  const playgroundDir = fileURLToPath(new URL('../playground/', import.meta.url))
  const libDir = fileURLToPath(new URL('../../dist/', import.meta.url))
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json',
  }

  // Serve a file from `root` without allowing path traversal.
  const serveFile = async (root: string, relative: string) => {
    const path = resolve(root, `.${sep}${relative}`)
    if (!path.startsWith(root)) return null
    try {
      const body = await readFile(path)
      return new Response(body, {
        headers: {
          'Content-Type': types[extname(path)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      return null
    }
  }

  const site = new Hono()
  site.get('/playground-config.js', c =>
    c.body(
      `window.PLAYGROUND = ${JSON.stringify({
        apiBaseUrl: `http://localhost:${config.port}/`,
        siteKey: config.sites[0]!.siteKey,
      })};`,
      200,
      { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
    ),
  )
  // A plain (non-framework) site using the script-tag build: full page loads between
  // /plain pages, plus a pushState navigation handled by History API detection.
  site.get('/plain/*', c =>
    c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Plain site ${c.req.path}</title>
  <script>
    window.ciAnalyticsConfig = { banner: { title: 'Cookies on this plain site' } };
    (window.ciAnalyticsQueue = window.ciAnalyticsQueue || []).push(['trackEvent', 'queued_before_load', { from: 'inline' }]);
  </script>
  <script async src="/lib/analytics.js"
          data-api-base-url="http://localhost:${config.port}/"
          data-site-key="${config.sites[0]!.siteKey}"></script>
</head>
<body>
  <h1 id="where">${c.req.path}</h1>
  <p>A static site with only a script tag (dist/analytics.js).</p>
  <a id="full-load" href="/plain/second">Another page (full page load)</a>
  <button id="spa-nav" onclick="history.pushState({}, '', '/plain/spa'); document.getElementById('where').textContent = location.pathname">pushState to /plain/spa</button>
  <button id="track" onclick="ClearIdeasAnalytics.get().trackEvent('plain_click', { button: 'track' })">Track event</button>
</body>
</html>`),
  )
  // Third-party tools: directory plugins (with local stand-ins for the vendors' scripts),
  // consent-gated scripts, a footer settings link, and a strict Content Security Policy.
  //   ?csp=off       no CSP and no nonces
  //   ?lib=tampered  plugin files altered in transit (integrity check must block them)
  site.get('/tools/*', c => {
    const cspOn = c.req.query('csp') !== 'off'
    const libBase = c.req.query('lib') === 'tampered' ? '/tampered-lib' : '/lib'
    const nonce = cspOn ? randomBytes(16).toString('base64') : ''
    const n = cspOn ? ` nonce="${nonce}"` : ''
    if (cspOn) {
      c.header(
        'Content-Security-Policy',
        `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'`,
      )
    }
    const settings = {
      banner: { title: 'Cookies on the tools demo' },
      integrations: {
        metaPixel: { pixelId: '1234567890', scriptUrl: '/vendor/fbevents.js' },
        hotjar: { siteId: 42, scriptUrl: '/vendor/hotjar.js' },
      },
    }
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Third-party tools</title>
  <script${n}>window.ciAnalyticsConfig = ${JSON.stringify(settings)};</script>
  <script${n} async src="${libBase}/analytics.js"
          data-api-base-url="http://localhost:${config.port}/"
          data-site-key="${config.sites[0]!.siteKey}"></script>
  <!-- A vendor library and the inline snippet that uses it, both waiting for marketing consent -->
  <script type="text/plain" data-ci-consent="marketing" data-ci-cookies="_vendorlib*"${n} src="/vendor/lib.js"></script>
  <script type="text/plain" data-ci-consent="marketing"${n}>
    window.inlineSawLib = window.vendorLib === true;
    document.cookie = '_vendorlib_id=1; Path=/';
  </script>
</head>
<body>
  <h1>Third-party tools</h1>
  ${
    cspOn
      ? `<div class="comment" data-testid="comment">A visitor's comment containing markup:
    <script type="text/plain" data-ci-consent="marketing">window.injectedInline = true</script>
    <script type="text/plain" data-ci-consent="marketing" src="/vendor/evil.js"></script>
  </div>`
      : ''
  }
  <footer><a href="#ci-consent-settings">Cookie settings</a></footer>
</body>
</html>`)
  })
  // Stand-ins for vendor scripts: they record what they receive.
  const vendorScripts: Record<string, string> = {
    // Like fbevents.js: takes over the queue and records every call.
    'fbevents.js': `window.__meta = window.fbq.queue.map(function (args) { return Array.from(args) });
window.fbq.callMethod = function () { window.__meta.push(Array.from(arguments)) };`,
    'hotjar.js': `window.__hotjarRuns = (window.__hotjarRuns || 0) + 1;
document.cookie = '_hjSession_42=1; Path=/'; localStorage.setItem('_hjLocal', '1');`,
    'lib.js': `window.vendorLib = true;`,
    'evil.js': `window.injectedExternal = true;`,
  }
  site.get('/vendor/:file', c => {
    const body = vendorScripts[c.req.param('file')]
    return body === undefined
      ? c.notFound()
      : c.body(body, 200, { 'Content-Type': 'text/javascript; charset=utf-8' })
  })
  // The library with its plugin files altered (as by a compromised CDN or proxy).
  site.get('/tampered-lib/*', async c => {
    const relative = c.req.path.slice('/tampered-lib/'.length)
    const file = await serveFile(libDir, relative)
    if (!file || !relative.startsWith('script-plugins/')) return file ?? c.notFound()
    const code = `${await file.text()}\nwindow.tampered = true;`
    return c.body(code, 200, { 'Content-Type': 'text/javascript; charset=utf-8' })
  })
  site.get('/lib/*', async c => {
    const file = await serveFile(libDir, c.req.path.slice('/lib/'.length))
    return file ?? c.text('Library not built. Run `npm run build` in the repository root.', 404)
  })
  site.get(
    '/assets/*',
    async c =>
      (await serveFile(playgroundDir, c.req.path.slice('/assets/'.length))) ?? c.notFound(),
  )
  // Every other path is the single-page app (so /pricing and landing URLs work on reload).
  site.get('*', async () => (await serveFile(playgroundDir, 'index.html'))!)

  playground = serve({ fetch: site.fetch, port: config.playgroundPort }, info => {
    console.log(`Playground         http://localhost:${info.port}`)
    console.log(
      'DEV_MODE is on: /_dev endpoints and the geo override are enabled. Do not use in production.',
    )
  })
}

const shutdown = () => {
  api.close()
  playground?.close()
  store.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
