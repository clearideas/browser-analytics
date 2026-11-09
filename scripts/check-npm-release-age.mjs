#!/usr/bin/env node

import fs from 'node:fs/promises'

const minAgeDays = Number(process.env.NPM_RELEASE_AGE_DAYS ?? '3')
const allowedScopes = new Set(['@awesome.me', '@clearideas', '@fortawesome'])
const allowedHosts = new Set(['npm.fontawesome.com', 'registry.npmjs.org'])
const now = Date.now()
const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000

const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'))
const packages = Object.entries(lock.packages ?? {})
const metadataCache = new Map()
const failures = []
const checks = []

function packageNameFromPath(path) {
  const parts = path.split('node_modules/')
  return parts[parts.length - 1]
}

function scopeOf(name) {
  return name.startsWith('@') ? name.split('/').slice(0, 1)[0] : null
}

function registryUrlFor(name) {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)
  return `https://registry.npmjs.org/${encoded}`
}

function hostOf(resolved) {
  try {
    return new URL(resolved).host
  } catch {
    return null
  }
}

async function publishedAt(name, version) {
  if (!metadataCache.has(name)) {
    let response
    let lastError
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await fetch(registryUrlFor(name))
        if (response.ok) break
        lastError = new Error(`HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }

    if (!response?.ok) {
      throw new Error(`Unable to fetch npm metadata for ${name}: ${lastError?.message ?? 'unknown error'}`)
    }
    metadataCache.set(name, await response.json())
  }

  const published = metadataCache.get(name).time?.[version]
  return published ? Date.parse(published) : null
}

async function checkPackage(name, pkg) {
  const published = await publishedAt(name, pkg.version)
  if (!published) {
    failures.push(`${name}@${pkg.version} has no npm publish timestamp`)
    return
  }

  const ageMs = now - published
  if (ageMs < minAgeMs) {
    const ageHours = Math.max(0, ageMs / (60 * 60 * 1000)).toFixed(1)
    failures.push(`${name}@${pkg.version} is ${ageHours} hours old`)
  }
}

for (const [path, pkg] of packages) {
  if (!path || !path.includes('node_modules/') || !pkg.version) continue

  const name = pkg.name ?? packageNameFromPath(path)
  const scope = scopeOf(name)
  const host = pkg.resolved ? hostOf(pkg.resolved) : null

  if (allowedScopes.has(scope) || allowedHosts.has(host)) continue

  if (pkg.resolved?.startsWith('git+')) {
    failures.push(`${name}@${pkg.version} resolves from git (${pkg.resolved})`)
    continue
  }

  if (host && host !== 'registry.npmjs.org') continue

  checks.push(() => checkPackage(name, pkg))
}

for (let i = 0; i < checks.length; i += 8) {
  await Promise.all(checks.slice(i, i + 8).map((check) => check()))
}

if (failures.length) {
  console.error(`Found npm packages newer than ${minAgeDays} days:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`All public npm packages are at least ${minAgeDays} days old.`)
