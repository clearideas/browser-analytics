import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

// Export the same stylesheet used by the built-in banner for strict-CSP hosts.
const source = readFileSync(new URL('../src/banner.ts', import.meta.url), 'utf8')
const match = source.match(/const STYLES = `([\s\S]*?)`/)
assert(match && !match[1].includes('${'), 'Expected a static consent stylesheet')
writeFileSync(new URL('../dist/consent.css', import.meta.url), match[1].trim() + '\n')
