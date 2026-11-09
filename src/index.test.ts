import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { captureInitialAttribution } from "./attribution"
import { generateObjectId, extractUtmParameters } from "./core"
import { trackOpenAIAdsEvent } from "./integrations"
import { getLocalConsentStatus, setLocalConsentStatus } from "./storage"
import { STORAGE_KEYS, type AnalyticsConfig } from "./types"

// Mock browser environment for Node.js
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

// Mock localStorage globally
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
})

// Mock sessionStorage globally
Object.defineProperty(global, "sessionStorage", {
  value: sessionStorageMock,
  writable: true,
})

// Mock window and navigator for Node.js environment
Object.defineProperty(global, "window", {
  value: {
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
    location: {
      href: "https://example.com",
      hostname: "example.com",
      pathname: "/",
      search: "",
    },
    navigator: {
      userAgent: "test-user-agent",
      language: "en-US",
    },
    crypto: {
      getRandomValues: (array: any) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256)
        }
        return array
      },
    },
  },
  writable: true,
})

// Mock document
Object.defineProperty(global, "document", {
  value: {
    cookie: "",
    referrer: "",
    createElement: vi.fn(() => ({
      style: {},
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
    })),
    head: {
      appendChild: vi.fn(),
    },
    body: {
      appendChild: vi.fn(),
    },
    getElementById: vi.fn(() => null),
    querySelector: vi.fn(() => null),
  },
  writable: true,
})

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as any)
)

describe("Analytics Core", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("generateObjectId", () => {
    it("should generate a valid ObjectId-like string", () => {
      const id = generateObjectId()

      expect(typeof id).toBe("string")
      expect(id.length).toBe(24)
      expect(/^[0-9a-f]{24}$/.test(id)).toBe(true)
    })

    it("should generate unique IDs", () => {
      const id1 = generateObjectId()
      const id2 = generateObjectId()

      expect(id1).not.toBe(id2)
    })
  })

  describe("extractUtmParameters", () => {
    it("should extract UTM parameters from URL", () => {
      const url =
        "https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer"
      const params = extractUtmParameters(url)

      expect(params).toEqual({
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "summer",
      })
    })

    it("should extract internal ci campaign parameters from URL", () => {
      const url =
        "https://example.com?ci_source=clearideas&ci_medium=website&ci_campaign=sign_up&ci_term=header"
      const params = extractUtmParameters(url)

      expect(params).toEqual({
        ci_source: "clearideas",
        ci_medium: "website",
        ci_campaign: "sign_up",
        ci_term: "header",
      })
    })

    it("should return empty object for URL without UTM params", () => {
      const url = "https://example.com/path"
      const params = extractUtmParameters(url)

      expect(params).toEqual({})
    })
  })
})

describe("Attribution", () => {
  const config = {
    apiBaseUrl: "https://api.example.com/",
    eventSiteName: "test",
    flushInterval: 60000,
    consentCheckInterval: 86400000,
    sessionCheckInterval: 1800000,
    batchSize: 10,
    maxRetries: 2,
    autoTrackScrollDepth: false,
    autoTrackTimeSpent: false,
    autoTrackOutboundLinks: false,
  } satisfies AnalyticsConfig

  function useStorageMap() {
    const storage = new Map<string, string>()

    localStorageMock.getItem.mockImplementation((key: string) => storage.get(key) ?? null)
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      storage.set(key, value)
    })
    localStorageMock.removeItem.mockImplementation((key: string) => {
      storage.delete(key)
    })

    return storage
  }

  function setWindowUrl(url: string) {
    const parsed = new URL(url)
    window.location.href = url
    window.location.hostname = parsed.hostname
    window.location.pathname = parsed.pathname
    window.location.search = parsed.search
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, "referrer", {
      value: "",
      configurable: true,
    })
    setWindowUrl("https://example.com/")
  })

  it("captures attribution from the current URL", () => {
    const storage = useStorageMap()
    setWindowUrl(
      "https://example.com/landing/ai-governance?utm_source=google&utm_medium=cpc&utm_campaign=governance"
    )

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "governance",
      landingPath: "/landing/ai-governance",
    })
    expect(storage.has(STORAGE_KEYS.ATTRIBUTION_CONTEXT)).toBe(true)
  })

  it("preserves stored first-touch attribution when the current URL has new attribution", () => {
    const storage = useStorageMap()
    storage.set(
      STORAGE_KEYS.ATTRIBUTION_CONTEXT,
      JSON.stringify({
        utm_source: "old-source",
        utm_medium: "old-medium",
        utm_campaign: "old-campaign",
        firstSeen: "2026-01-01T00:00:00.000Z",
      })
    )
    setWindowUrl(
      "https://example.com/landing/ai-governance?utm_source=linkedin&utm_medium=paid&utm_campaign=ai-governance"
    )

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: "old-source",
      utm_medium: "old-medium",
      utm_campaign: "old-campaign",
      firstSeen: "2026-01-01T00:00:00.000Z",
    })
    expect(attribution?.utm_source).not.toBe("linkedin")
  })

  it("falls back to stored attribution when the current URL has none", () => {
    useStorageMap().set(
      STORAGE_KEYS.ATTRIBUTION_CONTEXT,
      JSON.stringify({
        utm_source: "stored-source",
        utm_medium: "stored-medium",
        firstSeen: "2026-01-01T00:00:00.000Z",
      })
    )
    setWindowUrl("https://example.com/landing/ai-governance")

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: "stored-source",
      utm_medium: "stored-medium",
    })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

describe("OpenAI Ads integration", () => {
  const config = {
    apiBaseUrl: "https://api.example.com/",
    eventSiteName: "test",
    openAIAdsPixelId: "px_test",
    flushInterval: 60000,
    consentCheckInterval: 86400000,
    sessionCheckInterval: 1800000,
    batchSize: 10,
    maxRetries: 2,
    autoTrackScrollDepth: false,
    autoTrackTimeSpent: false,
    autoTrackOutboundLinks: false,
  } satisfies AnalyticsConfig

  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as any).oaiq
  })

  it("does not initialize or send events without consent", () => {
    trackOpenAIAdsEvent(config, "trial_started", { plan_id: "demo_trial" }, false)

    expect((window as any).oaiq).toBeUndefined()
    expect(document.head.appendChild).not.toHaveBeenCalled()
  })

  it("initializes and queues events with consent", () => {
    trackOpenAIAdsEvent(config, "trial_started", { plan_id: "demo_trial" }, true)

    expect(typeof (window as any).oaiq).toBe("function")
    expect(((window as any).oaiq as any).q).toEqual([
      [
        "init",
        {
          pixelId: "px_test",
          debug: false,
        },
      ],
      [
        "measure",
        "trial_started",
        {
          type: "plan_enrollment",
          plan_id: "free_trial",
        },
      ],
    ])
    expect(document.head.appendChild).toHaveBeenCalledTimes(1)
  })
})

describe("Storage Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getLocalConsentStatus", () => {
    it("should return null when no consent is stored", () => {
      localStorageMock.getItem.mockReturnValue(null)

      const status = getLocalConsentStatus()

      expect(status.consented).toBeNull()
      expect(status.version).toBeNull()
    })

    it("should return parsed consent status", () => {
      const storedData = {
        consented: true,
        version: "1.0.0",
        timestamp: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(storedData))

      const status = getLocalConsentStatus()

      expect(status.consented).toBe(true)
      expect(status.version).toBe("1.0.0")
    })
  })

  describe("setLocalConsentStatus", () => {
    it("should store consent status with timestamp", () => {
      setLocalConsentStatus(true, "1.0.0")

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "ci_consent_status",
        expect.stringContaining('"consented":true')
      )
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "ci_consent_status",
        expect.stringContaining('"version":"1.0.0"')
      )
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
    })
  })
})

// Integration test example
describe("Analytics Integration", () => {
  it("should handle end-to-end event tracking flow", async () => {
    // This would be an integration test that mocks the entire flow
    // including API calls, storage, and third-party integrations

    expect(true).toBe(true) // Placeholder
  })
})
