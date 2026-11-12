import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

// Export the same stylesheet used by the built-in banner for strict-CSP hosts.
const source = readFileSync(new URL('../src/banner.ts', import.meta.url), 'utf8')
const match = source.match(/const STYLES = `([\s\S]*?)`/)
assert(match && !match[1].includes('${'), 'Expected a static consent stylesheet')
writeFileSync(new URL('../dist/consent.css', import.meta.url), match[1].trim() + '\n')

// Nuxt scans plugin entries for an actual default export declaration. Rollup's
// `export { setup as default }` form is not recognized by that scanner.
writeFileSync(
  new URL('../dist/nuxt.client.mjs', import.meta.url),
  "import setup from './nuxt.mjs'\nexport default setup\n",
)
