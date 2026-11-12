// Build the example apps against the packed library, exactly as users install it.
//   node examples/build.mjs [app...]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APPS } from './apps.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..')
const packDir = join(here, '.pack')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })

// 1. Build and pack the library once.
run('npm', ['run', 'build'], root)
rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir)
run('npm', ['pack', '--ignore-scripts', '--pack-destination', packDir], root)
const tarball = readdirSync(packDir).find(f => f.endsWith('.tgz'))
renameSync(join(packDir, tarball), join(packDir, 'clearideas-analytics.tgz'))

// 2. Install each example's own dependencies, add the tarball, build.
const only = process.argv.slice(2)
for (const app of APPS.filter(a => only.length === 0 || only.includes(a.name))) {
  const dir = join(here, app.name)
  console.log(`\n=== ${app.name} ===`)
  const flags = ['--no-audit', '--no-fund', '--ignore-scripts', ...(app.npmFlags ?? [])]
  run('npm', ['ci', ...flags], dir)
  run('npm', ['install', '--no-save', ...flags, join(packDir, 'clearideas-analytics.tgz')], dir)
  run('npm', ['run', 'build'], dir)
}
