// Core event tracking functionality
import {
  getConsentStatus,
  getTrackingCategory,
  isConsentRequired,
  shouldTrackEvent,
} from './consent'
import {
  createAnonymousEventData,
  generateObjectId,
  getConnectionType,
  getDeviceBucket,
  getSafeLocationContext,
  getViewportBucket,
  isEssentialEvent,
} from './core'
import {
  getOrCreateAnonymousSessionId,
  getOrCreateSessionId,
  loadEventQueue,
  saveEventQueue,
} from './storage'
import type { AnalyticsConfig, AnalyticsEvent, TrackingContext } from './types'
import { debugLog } from './types'

// Event queue and batching
let eventQueue: AnalyticsEvent[] = []
let flushTimerId: number | null = null
const retryQueue: Map<string, { payload: string; attempts: number; id: string }> = new Map()

// Initialize queue from storage
export function initializeEventQueue(config?: AnalyticsConfig): void {
  eventQueue = loadEventQueue()
  debugLog(config || { debug: false }, 'Event queue initialized', {
    eventCount: eventQueue.length,
  })
}

// Send events in batches
export async function sendBatch(config: AnalyticsConfig): Promise<void> {
  if (!eventQueue.length) {
    debugLog(config, 'No events in queue to send')
    return
  }

  const TRACK_URL = `${config.apiBaseUrl.replace(/\/$/, '')}/event`
  debugLog(config, 'Sending batch to server', {
    url: TRACK_URL,
    eventCount: eventQueue.length,
  })

  // Get events to send
  const eventsToSend = eventQueue.splice(0)
  saveEventQueue(eventQueue)

  // Create unique ID for this batch
  const batchId = generateObjectId()
  const payload = JSON.stringify(eventsToSend)

  debugLog(config, 'Batch prepared', { batchId, payloadSize: payload.length })

  // Try to use sendBeacon first
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    debugLog(config, 'Using sendBeacon for batch send')
    const blob = new Blob([payload], { type: 'application/json' })
    const sent = navigator.sendBeacon(TRACK_URL, blob)

    if (sent) {
      debugLog(config, 'Batch sent successfully via sendBeacon', { batchId })
    } else {
      debugLog(config, 'sendBeacon failed, queuing for retry', { batchId })
      retryQueue.set(batchId, { payload, attempts: 0, id: batchId })
      await retryFailedEvents(config)
    }
  } else {
    debugLog(config, 'sendBeacon not available, using fetch')
    // If sendBeacon is not available, use fetch with retry
    retryQueue.set(batchId, { payload, attempts: 0, id: batchId })
    await retryFailedEvents(config)
  }
}

// Retry failed events
export async function retryFailedEvents(config: AnalyticsConfig): Promise<void> {
  const TRACK_URL = `${config.apiBaseUrl.replace(/\/$/, '')}/event`

  for (const [id, item] of retryQueue.entries()) {
    if (item.attempts >= config.maxRetries) {
      retryQueue.delete(id)
      continue
    }

    try {
      const response = await fetch(TRACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: item.payload,
        credentials: 'include',
      })

      if (response.ok) {
        retryQueue.delete(id)
      } else {
        item.attempts++
      }
    } catch {
      item.attempts++
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

  if (typeof screen !== 'undefined') {
    context.screenResolution = `${screen.width}x${screen.height}`
  }

  if (typeof window !== 'undefined') {
    context.viewport = `${window.innerWidth}x${window.innerHeight}`
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
  debugLog(config, 'Event tracking started', { eventName, eventProps })

  // Get consent status - use provided status if available to avoid duplicate calls
  const consentStatus = providedConsentStatus || (await getConsentStatus(config))
  const hasExplicitConsent = consentStatus.consented === true
  const consentRequired = isConsentRequired(config)
  const trackingCategory = getTrackingCategory(hasExplicitConsent, consentRequired)

  debugLog(config, 'Consent and tracking info', {
    hasExplicitConsent,
    consentRequired,
    trackingCategory,
    consentStatus,
  })

  // Check if we should track this event
  if (!shouldTrackEvent(eventName, trackingCategory, config)) {
    debugLog(config, 'Event not tracked due to tracking rules', {
      eventName,
      trackingCategory,
    })
    // For non-essential events without consent in consent-required geos, check server consent
    if (!hasExplicitConsent && consentRequired) {
      // Reuse the consent status we already have instead of making another API call
      const serverConsent = consentStatus.consented
      if (!serverConsent) {
        debugLog(config, 'Event blocked: no server consent', { eventName })
        return
      }
      debugLog(config, 'Server consent granted, proceeding with event', {
        eventName,
      })
    } else {
      debugLog(config, 'Event blocked: no explicit consent and consent not required', { eventName })
      return
    }
  }

  // Create tracking context if not provided
  const context =
    trackingContext ||
    (trackingCategory === 'none'
      ? { sessionId: getOrCreateSessionId() }
      : createTrackingContext(trackingCategory, hasExplicitConsent))

  // Generate session ID based on tracking type
  let sessionId = context.sessionId
  if (trackingCategory === 'limited' && context.anonymousSessionId) {
    sessionId = context.anonymousSessionId
  }

  const payload: AnalyticsEvent = {
    name: config.eventSiteName,
    sessionId,
    timestamp: new Date().toISOString(),
    attributes: {
      event: eventName,
      eventData: { ...eventProps },
      hasConsent: hasExplicitConsent,
      consentRequired,
      trackingCategory: trackingCategory as 'full' | 'limited',
    },
  }

  // Generate pageViewId for page_view events, reuse for related events
  if (eventName === 'page_view') {
    const pageViewId = generatePageViewId()
    setCurrentPageViewId(pageViewId)
    payload.attributes.pageViewId = pageViewId
  } else {
    // Include pageViewId in related events if available
    const pageViewId = getCurrentPageViewId()
    if (pageViewId) {
      payload.attributes.pageViewId = pageViewId
    }
  }

  if (trackingCategory === 'full') {
    // Full tracking: include all metadata
    if (context.userAgent) {
      payload.attributes.eventData.userAgent = context.userAgent
    }
    if (context.referrer) {
      payload.attributes.eventData.referrer = context.referrer
    }
    if (context.screenResolution) {
      payload.attributes.eventData.screenResolution = context.screenResolution
    }
    if (context.viewport) {
      payload.attributes.eventData.viewport = context.viewport
    }
    if (context.viewportBucket) {
      payload.attributes.eventData.viewportBucket = context.viewportBucket
    }
    if (context.deviceBucket) {
      payload.attributes.eventData.deviceBucket = context.deviceBucket
    }
    if (context.pageTitle) {
      payload.attributes.eventData.pageTitle = context.pageTitle
      payload.attributes.eventData.title = payload.attributes.eventData.title || context.pageTitle
    }
    if (context.connectionType) {
      payload.attributes.eventData.connectionType = context.connectionType
    }
    if (context.locationContext) {
      Object.assign(payload.attributes.eventData, context.locationContext)
    }
  } else {
    // Limited tracking: only collect anonymous data
    payload.attributes.eventData = createAnonymousEventData(payload.attributes.eventData)
    payload.attributes.isAnonymous = true
  }

  eventQueue.push(payload)
  saveEventQueue(eventQueue)

  debugLog(config, 'Event queued', {
    eventName,
    eventId: payload.attributes.pageViewId,
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
