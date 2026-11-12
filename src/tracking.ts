// Core event tracking functionality
import {
  getConsentCategories,
  getTrackingWithoutConsent,
  isConsentRequired,
  shouldTrackEvent,
} from './consent'
import {
  createAnonymousEventData,
  fitPropsToContract,
  generateObjectId,
  getConnectionType,
  getDeviceBucket,
  getSafeLocationContext,
  getViewportBucket,
  isEssentialEvent,
  normalizeEventName,
  sanitizeEventUrls,
  sanitizeUrl,
} from './core'
import {
  getOrCreateAnonymousSessionId,
  getOrCreateSessionId,
  loadEventQueue,
  saveEventQueue,
} from './storage'
import type { AnalyticsConfig, AnalyticsEvent, TrackingContext } from './types'
import { debugLog, getSiteKey } from './types'

// Event queue and batching
let eventQueue: AnalyticsEvent[] = []
let flushTimerId: number | null = null
// Batches awaiting (re)delivery via fetch. `inFlight` ensures concurrent callers
// (sendBatch, the flush timer, flush()) never POST the same batch twice at once.
const retryQueue: Map<
  string,
  { payload: string; attempts: number; id: string; inFlight: boolean }
> = new Map()

// Limits from spec/openapi.yaml. Batches stay below the 64 KiB limit shared by
// sendBeacon, keepalive fetch and the collector.
const MAX_EVENTS_PER_BATCH = 50
const MAX_BATCH_BYTES = 60_000
const MAX_EVENT_BYTES = 32_000
// text/plain keeps requests "simple" for CORS: no preflight, and sendBeacon works
// cross-origin. The collector parses the body as JSON.
const BODY_CONTENT_TYPE = 'text/plain;charset=UTF-8'

const utf8Length = (text: string) => new TextEncoder().encode(text).length

function eventsEndpoint(config: AnalyticsConfig): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/v1/events`
}

function isV1Event(value: unknown): value is AnalyticsEvent {
  const event = value as AnalyticsEvent
  return (
    !!event &&
    typeof event.eventId === 'string' &&
    typeof event.name === 'string' &&
    !!event.props &&
    typeof event.props === 'object'
  )
}

// Initialize queue from storage (events queued by pre-v1 versions are discarded)
export function initializeEventQueue(config?: AnalyticsConfig): void {
  eventQueue = loadEventQueue().filter(isV1Event)
  debugLog(config || { debug: false }, 'Event queue initialized', {
    eventCount: eventQueue.length,
  })
}

/** Split events into EventBatch payloads of at most 50 events and 60 KB each. */
export function buildBatchPayloads(config: AnalyticsConfig, events: AnalyticsEvent[]): string[] {
  const envelope = (batch: AnalyticsEvent[]) =>
    JSON.stringify({
      v: 1,
      siteKey: getSiteKey(config),
      sentAt: new Date().toISOString(),
      events: batch,
    })
  const overhead = utf8Length(envelope([]))

  const payloads: string[] = []
  let batch: AnalyticsEvent[] = []
  let size = overhead
  for (const event of events) {
    const eventSize = utf8Length(JSON.stringify(event)) + 1
    if (
      batch.length > 0 &&
      (batch.length >= MAX_EVENTS_PER_BATCH || size + eventSize > MAX_BATCH_BYTES)
    ) {
      payloads.push(envelope(batch))
      batch = []
      size = overhead
    }
    batch.push(event)
    size += eventSize
  }
  if (batch.length > 0) payloads.push(envelope(batch))
  return payloads
}

// Send all queued events (POST /v1/events), preferring sendBeacon
export async function sendBatch(config: AnalyticsConfig): Promise<void> {
  if (!eventQueue.length) {
    debugLog(config, 'No events in queue to send')
    return
  }

  const url = eventsEndpoint(config)
  const eventsToSend = eventQueue.splice(0)
  saveEventQueue(eventQueue)

  let queuedForFetch = false
  for (const payload of buildBatchPayloads(config, eventsToSend)) {
    const batchId = generateObjectId()
    const beaconSent =
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(url, new Blob([payload], { type: BODY_CONTENT_TYPE }))

    if (beaconSent) {
      debugLog(config, 'Batch sent via sendBeacon', { batchId, bytes: payload.length })
    } else {
      // sendBeacon unavailable or refused (e.g. quota): deliver with fetch and retries.
      retryQueue.set(batchId, { payload, attempts: 0, id: batchId, inFlight: false })
      queuedForFetch = true
    }
  }

  if (queuedForFetch) await retryFailedEvents(config)
}

// Retry failed events. Network errors, 408, 429 and 5xx are retried (up to maxRetries);
// other 4xx responses are final. Retries are safe: the collector de-duplicates eventIds.
export async function retryFailedEvents(config: AnalyticsConfig): Promise<void> {
  const url = eventsEndpoint(config)

  for (const [id, item] of retryQueue.entries()) {
    if (item.inFlight) continue
    if (item.attempts >= config.maxRetries) {
      retryQueue.delete(id)
      continue
    }

    item.inFlight = true
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': BODY_CONTENT_TYPE },
        body: item.payload,
        credentials: 'omit',
        keepalive: true,
      })

      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (response.ok || !retryable) {
        if (!response.ok) {
          debugLog(config, 'Batch rejected by collector; not retrying', { status: response.status })
        }
        retryQueue.delete(id)
      } else {
        item.attempts++
      }
    } catch {
      item.attempts++
    } finally {
      item.inFlight = false
    }
  }
}

// Start flush timer
export function startFlushTimer(config: AnalyticsConfig): () => void {
  if (typeof window === 'undefined') return () => {}

  if (flushTimerId === null) {
    flushTimerId = window.setInterval(() => {
      // Only send if we have events in the queue
      if (eventQueue.length > 0) {
        sendBatch(config)
      }
      // Always retry failed events
      retryFailedEvents(config)
    }, config.flushInterval)
  }

  return () => stopFlushTimer()
}

// Stop flush timer
export function stopFlushTimer(): void {
  if (typeof window !== 'undefined' && flushTimerId !== null) {
    window.clearInterval(flushTimerId)
    flushTimerId = null
  }
}

// Generate page view ID
let currentPageViewId: string | null = null

export function generatePageViewId(): string {
  return generateObjectId()
}

export function getCurrentPageViewId(): string | null {
  return currentPageViewId
}

export function setCurrentPageViewId(id: string): void {
  currentPageViewId = id
}

export function resetPageViewId(): void {
  currentPageViewId = null
}

// Create tracking context
export function createTrackingContext(
  trackingCategory: 'full' | 'limited',
  _hasExplicitConsent: boolean,
): TrackingContext {
  const context: TrackingContext = {
    sessionId: getOrCreateSessionId(),
  }

  if (trackingCategory === 'limited') {
    context.anonymousSessionId = getOrCreateAnonymousSessionId()
  }

  if (typeof navigator !== 'undefined') {
    context.userAgent = navigator.userAgent
  }

  if (typeof document !== 'undefined') {
    context.referrer = document.referrer
  }

  // Coarse buckets only: exact screen/viewport sizes add fingerprinting surface.
  if (typeof window !== 'undefined') {
    context.viewportBucket = getViewportBucket(window.innerWidth)
  }

  context.pageTitle = typeof document !== 'undefined' ? document.title || undefined : undefined
  context.connectionType = getConnectionType()
  context.deviceBucket = getDeviceBucket(
    context.userAgent || '',
    typeof window !== 'undefined' ? window.innerWidth : undefined,
  )

  // Add location context for full tracking
  if (trackingCategory === 'full') {
    context.locationContext = getSafeLocationContext()
  }

  return context
}

// Track event
export async function trackEvent(
  config: AnalyticsConfig,
  eventName: string,
  eventProps: Record<string, any> = {},
  trackingContext?: TrackingContext,
  providedConsentStatus?: { consented: boolean | null; version: string | null },
): Promise<void> {
  const requestedName = eventName
  eventName = normalizeEventName(eventName)
  if (eventName !== requestedName) {
    debugLog(config, 'Event name normalized to match the contract', { requestedName, eventName })
  }
  debugLog(config, 'Event tracking started', { eventName, eventProps })

  // Full first-party analytics needs the statistics category: allowed explicitly, or
  // undecided where consent is not required. An explicit refusal is respected everywhere.
  // (Callers may pass a decision, which then stands for statistics.)
  const consentRequired = isConsentRequired(config)
  const statistics =
    providedConsentStatus !== undefined
      ? providedConsentStatus.consented
      : getConsentCategories(config).statistics
  const hasExplicitConsent = statistics === true
  const trackingCategory: 'full' | 'limited' =
    hasExplicitConsent || (statistics === null && !consentRequired) ? 'full' : 'limited'

  debugLog(config, 'Consent and tracking info', { statistics, consentRequired, trackingCategory })

  // Some regions allow nothing at all without consent (policy trackingWithoutConsent).
  if (
    trackingCategory === 'limited' &&
    consentRequired &&
    getTrackingWithoutConsent(config) === 'none'
  ) {
    debugLog(config, 'Event not sent: nothing is tracked without consent here', { eventName })
    return
  }

  // Without statistics consent only essential and anonymous events are sent.
  if (!shouldTrackEvent(eventName, trackingCategory, config)) {
    debugLog(config, 'Event not tracked due to tracking rules', { eventName, trackingCategory })
    return
  }

  // Create tracking context if not provided
  const context = trackingContext || createTrackingContext(trackingCategory, hasExplicitConsent)

  // Generate session ID based on tracking type
  let sessionId = context.sessionId
  if (trackingCategory === 'limited' && context.anonymousSessionId) {
    sessionId = context.anonymousSessionId
  }

  const payload: AnalyticsEvent = {
    eventId: generateObjectId(),
    name: eventName,
    occurredAt: new Date().toISOString(),
    sessionId,
    trackingCategory: trackingCategory as 'full' | 'limited',
    consent: { required: consentRequired, granted: hasExplicitConsent },
    props: sanitizeEventUrls({ ...eventProps }, config.urlQueryAllowlist),
  }

  // Generate pageViewId for page_view events, reuse for related events
  if (eventName === 'page_view') {
    const pageViewId = generatePageViewId()
    setCurrentPageViewId(pageViewId)
    payload.pageViewId = pageViewId
  } else {
    // Include pageViewId in related events if available
    const pageViewId = getCurrentPageViewId()
    if (pageViewId) {
      payload.pageViewId = pageViewId
    }
  }

  if (trackingCategory === 'full') {
    // Full tracking: include all metadata
    if (context.userAgent) {
      payload.props.userAgent = context.userAgent
    }
    if (context.referrer) {
      payload.props.referrer = sanitizeUrl(context.referrer, {
        allowQueryParams: [],
      })
    }
    if (context.viewportBucket) {
      payload.props.viewportBucket = context.viewportBucket
    }
    if (context.deviceBucket) {
      payload.props.deviceBucket = context.deviceBucket
    }
    if (context.pageTitle) {
      payload.props.pageTitle = context.pageTitle
      payload.props.title = payload.props.title || context.pageTitle
    }
    if (context.connectionType) {
      payload.props.connectionType = context.connectionType
    }
    if (context.locationContext) {
      Object.assign(payload.props, context.locationContext)
    }
  } else {
    // Limited tracking: only collect anonymous data
    payload.props = createAnonymousEventData(payload.props)
  }

  // Fit the event to the contract's limits so the collector does not reject it.
  payload.props = fitPropsToContract(payload.props)
  if (utf8Length(JSON.stringify(payload)) > MAX_EVENT_BYTES) {
    debugLog(config, 'Event props too large; sending without props', { eventName })
    payload.props = { propsTruncated: true }
  }

  eventQueue.push(payload)
  saveEventQueue(eventQueue)

  debugLog(config, 'Event queued', {
    eventName,
    eventId: payload.pageViewId,
    queueLength: eventQueue.length,
  })

  // Start the flush timer if it's not already running
  if (!flushTimerId) {
    debugLog(config, 'Starting flush timer')
    startFlushTimer(config)
  }

  // Send essential events immediately
  if (isEssentialEvent(eventName) || eventQueue.length >= config.batchSize) {
    debugLog(config, 'Sending event immediately', {
      reason: isEssentialEvent(eventName) ? 'essential event' : 'batch size reached',
      eventName,
    })
    await sendBatch(config)
  } else {
    debugLog(config, 'Event queued for batch send', {
      eventName,
      currentQueueLength: eventQueue.length,
    })
  }
}

// Flush all pending events
export async function flushEvents(config: AnalyticsConfig): Promise<void> {
  await sendBatch(config)
  await retryFailedEvents(config)
}
