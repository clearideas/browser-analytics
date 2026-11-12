// Serve each built example on its own port (so each is its own origin, like a real site).
// Requests resolve to the file, <path>.html, <path>/index.html, or the app's index.html
// (single-page app fallback).
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APPS } from './apps.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

const only = process.argv.slice(2)
for (const app of APPS.filter(a => only.length === 0 || only.includes(a.name))) {
  const root = resolve(here, app.output)
  if (!existsSync(root)) {
    console.error(`[serve] ${app.name}: ${root} not built (run npm run examples:build)`)
    continue
  }
  const isFile = path => existsSync(path) && statSync(path).isFile()
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const target = normalize(join(root, path))
    if (!target.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    const candidates = [target, `${target}.html`, join(target, 'index.html'), join(root, 'index.html')]
    const file = candidates.find(isFile)
    if (!file) {
      res.writeHead(404).end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  }).listen(app.port, () => console.log(`[serve] ${app.name}: http://localhost:${app.port}`))
}
