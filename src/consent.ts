// Consent management (v1 contract).
//
// The visitor's decision is stored in the browser (first-party localStorage) and is the
// source of truth. The collector only receives append-only consent records (proof of
// consent, GDPR Art. 7(1)) via POST /v1/consent. The consent *policy* (is consent
// required, which policy version) comes from GET /v1/context and is cached by
// storage.setGeoContext().
import type { CategoryChoices, CategoryState } from './categories'
import {
  allCategories,
  completeChoices,
  decisionOf,
  OPTIONAL_CATEGORIES,
  UNDECIDED,
} from './categories'
import { generateObjectId, isAnonymousTrackable, isEssentialEvent } from './core'
import {
  getGeoContext,
  getLocalConsentStatus,
  getStorageItem,
  setLocalConsentStatus,
  setStorageItem,
} from './storage'
import type { AnalyticsConfig, ConsentRecord } from './types'
import { debugLog, getSiteKey, STORAGE_KEYS } from './types'

const MAX_PENDING_CONSENT_RECORDS = 10

/** Current policy version from the cached context, if known. */
export function getCurrentPolicyVersion(): string | undefined {
  const context = getGeoContext()
  return context && isContextFresh(context) ? context.policyVersion : undefined
}

function isContextFresh(context: { timestamp?: number; expiresAt?: number }): boolean {
  const expiresAt = context.expiresAt ?? (context.timestamp ?? 0) + 24 * 60 * 60 * 1000
  return Date.now() < expiresAt
}

/**
 * The visitor's per-category choices for the current policy (synchronous). Choices made
 * under a different policy version no longer count: the visitor is asked again (consent
 * covers only the purposes the visitor was told about).
 */
export function getConsentCategories(config?: AnalyticsConfig): CategoryState {
  const local = getLocalConsentStatus()
  if (local.consented === null || local.consented === undefined) return { ...UNDECIDED }

  const policyVersion = getCurrentPolicyVersion()
  if (policyVersion && local.version !== policyVersion) {
    debugLog(
      config || { debug: false },
      '[Consent] Stored decision is for another policy version; asking again',
      { storedVersion: local.version, policyVersion },
    )
    return { ...UNDECIDED }
  }
  // Decisions stored before categories existed apply to every category.
  return local.categories ? { ...local.categories } : allCategories(local.consented === true)
}

/**
 * The overall decision: true when everything was accepted, false when decided otherwise
 * (rejected, or a partial choice), null when undecided.
 */
export function getConsentDecision(config?: AnalyticsConfig): boolean | null {
  const categories = getConsentCategories(config)
  const values = OPTIONAL_CATEGORIES.map(category => categories[category])
  if (values.some(value => value === null)) return null
  return values.every(Boolean)
}

/**
 * What may be sent where consent is required and statistics consent is not given:
 * the collector's per-region policy, else the site setting, else 'limited'.
 */
export function getTrackingWithoutConsent(config?: AnalyticsConfig): 'limited' | 'none' {
  const context = getGeoContext()
  const fromPolicy = context && isContextFresh(context) ? context.trackingWithoutConsent : undefined
  return fromPolicy ?? config?.consent?.trackingWithoutConsent ?? 'limited'
}

/** The visitor's consent decision (see getConsentDecision). */
export async function getConsentStatus(
  config: AnalyticsConfig,
): Promise<{ consented: boolean | null; version: string | null }> {
  return {
    consented: getConsentDecision(config),
    version: getLocalConsentStatus().version,
  }
}

/** Whether the browser sends Global Privacy Control and the site honors it (default). */
export function isGlobalPrivacyControlEnabled(config?: AnalyticsConfig): boolean {
  if (config?.respectGlobalPrivacyControl === false) return false
  return typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true
}

function consentEndpoint(config: AnalyticsConfig): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/v1/consent`
}

async function postConsentRecord(config: AnalyticsConfig, record: ConsentRecord): Promise<boolean> {
  try {
    const response = await fetch(consentEndpoint(config), {
      method: 'POST',
      // text/plain: a CORS "simple request" (no preflight); the collector parses JSON.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(record),
      credentials: 'omit',
      keepalive: true,
    })
    // 4xx other than 408/429 will never succeed; don't keep retrying those.
    if (response.ok) return true
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500
    if (!retryable)
      debugLog(config, '[Consent] Record rejected', {
        status: response.status,
      })
    return !retryable
  } catch {
    return false
  }
}

function getPendingConsentRecords(): ConsentRecord[] {
  const pending = getStorageItem<ConsentRecord[]>(STORAGE_KEYS.CONSENT_PENDING)
  return Array.isArray(pending) ? pending : []
}

function setPendingConsentRecords(records: ConsentRecord[]): void {
  if (records.length === 0) {
    try {
      localStorage.removeItem(STORAGE_KEYS.CONSENT_PENDING)
    } catch {
      // Ignore storage errors
    }
    return
  }
  setStorageItem(STORAGE_KEYS.CONSENT_PENDING, records.slice(-MAX_PENDING_CONSENT_RECORDS))
}

/** Re-send consent records that could not be delivered earlier (called on startup). */
export async function flushPendingConsentRecords(config: AnalyticsConfig): Promise<void> {
  const pending = getPendingConsentRecords()
  if (pending.length === 0) return
  const remaining: ConsentRecord[] = []
  for (const record of pending) {
    if (!(await postConsentRecord(config, record))) remaining.push(record)
  }
  setPendingConsentRecords(remaining)
}

/**
 * Record the visitor's decision. It takes effect locally immediately; the consent record
 * is then sent to the collector, and kept for retry if it cannot be delivered.
 */
export async function setConsent(
  config: AnalyticsConfig,
  value: boolean | Partial<CategoryChoices>,
  source: 'banner' | 'api' = 'banner',
): Promise<void> {
  const previous = getLocalConsentStatus()
  const consentId = previous.consentId ?? generateObjectId()
  const policyVersion = getCurrentPolicyVersion() ?? previous.version ?? 'unknown'
  const categories = typeof value === 'boolean' ? allCategories(value) : completeChoices(value)
  const decision = decisionOf(categories)

  setLocalConsentStatus(decision === 'granted', policyVersion, consentId, categories)

  const record: ConsentRecord = {
    v: 1,
    siteKey: getSiteKey(config),
    consentId,
    decision,
    categories,
    policyVersion,
    decidedAt: new Date().toISOString(),
    source,
  }
  if (!(await postConsentRecord(config, record))) {
    debugLog(config, '[Consent] Could not deliver consent record; will retry on next visit')
    setPendingConsentRecords([...getPendingConsentRecords(), record])
  }
}

// Check if consent is required based on the cached context (GET /v1/context)
export function isConsentRequired(config?: AnalyticsConfig): boolean {
  if (typeof window === 'undefined') {
    debugLog(config || { debug: false }, 'Server-side: defaulting to require consent')
    return true
  }

  try {
    const context = getGeoContext()
    if (context && isContextFresh(context)) {
      return context.requiresConsent === true
    }
    debugLog(config || { debug: false }, 'No current context, defaulting to require consent')
  } catch (error) {
    debugLog(config || { debug: false }, 'Error checking context', { error })
  }

  return true // Default to requiring consent if unknown
}

// Get consent status as boolean
export async function getConsent(config: AnalyticsConfig): Promise<boolean | null> {
  const status = await getConsentStatus(config)
  return status.consented
}

// Determine tracking behavior based on consent and geo requirements
export function getTrackingCategory(
  hasExplicitConsent: boolean,
  consentRequired: boolean,
): 'full' | 'limited' | 'none' {
  // 1. Explicit consent = full tracking
  if (hasExplicitConsent) return 'full'

  // 2. No consent but consent not required (e.g., US users) = full tracking
  if (!consentRequired) return 'full'

  // 3. No consent and consent required (e.g., EU users) = limited tracking
  return 'limited'
}

// Check if event should be tracked
export function shouldTrackEvent(
  eventName: string,
  trackingCategory: 'full' | 'limited' | 'none',
  config?: AnalyticsConfig,
): boolean {
  debugLog(config || { debug: false }, 'Checking if event should be tracked', {
    eventName,
    trackingCategory,
  })

  if (trackingCategory === 'none') {
    debugLog(config || { debug: false }, "Event blocked: tracking category is 'none'", {
      eventName,
    })
    return false
  }

  if (trackingCategory === 'full') {
    debugLog(config || { debug: false }, 'Event allowed: full tracking', {
      eventName,
    })
    return true
  }

  // Limited tracking: only essential or anonymous events
  const isEssential = isEssentialEvent(eventName)
  const isAnonymous = isAnonymousTrackable(eventName)
  const shouldTrack = isEssential || isAnonymous

  debugLog(config || { debug: false }, 'Limited tracking decision', {
    eventName,
    isEssential,
    isAnonymous,
    shouldTrack,
  })

  return shouldTrack
}
