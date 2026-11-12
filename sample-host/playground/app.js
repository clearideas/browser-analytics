// Playground: the real library (built to /lib) against the sample collector.
import { initAnalytics } from '/lib/index.mjs'

const { apiBaseUrl, siteKey } = window.PLAYGROUND
const api = path => `${apiBaseUrl.replace(/\/$/, '')}${path}`
const $ = selector => document.querySelector(selector)

// --- Simulated Global Privacy Control (toggle in the Visitor section) --------------
if (localStorage.getItem('playground_gpc') === '1') {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })
}

// --- Google tag stub: records what Google would receive ---------------------------
const gtagCalls = []
window.dataLayer = window.dataLayer || []
window.gtag = function gtag(...args) {
  window.dataLayer.push(args)
  gtagCalls.push({ at: new Date(), args })
  renderGtag()
}
window.gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
})

// --- Tiny single-page router -------------------------------------------------------
const PAGES = {
  '/': ['Home', 'Welcome to the demo site. Use the links above to navigate without reloading.'],
  '/pricing': ['Pricing', 'Pro plan: $99/month. Navigating here records a page_exit for the previous page and a page_view for this one.'],
  '/docs': ['Docs', 'Documentation would live here.'],
  '/reset-password': ['Reset password', 'The link that brought you here contained a token and an email address. Check the events: neither left the browser.'],
}
const routeListeners = new Set()

function renderPage() {
  const [title, body] = PAGES[location.pathname] ?? ['Not found', 'Unknown page.']
  document.title = `${title} · Analytics Playground`
  const page = $('#page')
  page.replaceChildren()
  const h = document.createElement('h2')
  h.textContent = title
  const p = document.createElement('p')
  p.textContent = body
  page.append(h, p)
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.classList.toggle('active', link.getAttribute('href') === location.pathname)
  }
}

function navigate(path) {
  history.pushState(history.state, '', path)
  renderPage()
  for (const listener of routeListeners) listener(location.pathname)
}

document.addEventListener('click', event => {
  const link = event.target.closest?.('a[data-nav]')
  if (!link) return
  event.preventDefault()
  navigate(link.getAttribute('href'))
})
window.addEventListener('popstate', () => {
  renderPage()
  for (const listener of routeListeners) listener(location.pathname)
})

// --- The library -------------------------------------------------------------------
const config = {
  apiBaseUrl,
  siteKey,
  // Integrations are plugins, enabled by configuration and run under the consent rules.
  // loadScript: false uses the stub above instead of downloading gtag.js.
  integrations: {
    googleAnalytics: {
      measurementId: 'G-PLAYGROUND',
      adsConversions: { sign_up: 'AW-PLAYGROUND/signup' },
      loadScript: false,
    },
  },
  // Production-like batching: essential events (page_view, error) are sent at once,
  // others every 3 s, when 10 are queued, when the page is hidden, or on "Flush queue".
  flushInterval: 3000,
  batchSize: 10,
  maxRetries: 2,
  autoTrackScrollDepth: true,
  autoTrackTimeSpent: true,
  autoTrackOutboundLinks: true,
  exposeGlobals: true,
  websiteBaseUrl: `${location.origin}/`,
  consent: {
    choices: localStorage.getItem('playground_categories') === '1' ? 'categories' : 'simple',
  },
}

const adapter = {
  getConfig: () => config,
  getCurrentPath: () => location.pathname,
  getCurrentUrl: () => location.href,
  getReferrer: () => document.referrer,
  onRouteChange: callback => {
    routeListeners.add(callback)
    return () => routeListeners.delete(callback)
  },
  onAppReady: callback => callback(),
  onAppDestroy: () => {},
  showConsentBanner: () => {},
  getRouter: () => null,
}

renderPage()
const analytics = initAnalytics(config, adapter)
window.playgroundAnalytics = analytics

// --- Controls ----------------------------------------------------------------------
const clearVisitor = () => {
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) if (key.startsWith('ci_')) storage.removeItem(key)
  }
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}
const forgetContext = () => sessionStorage.removeItem('ci_geo_context')
const post = (path, body) =>
  fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

for (const button of document.querySelectorAll('[data-region]')) {
  button.addEventListener('click', async () => {
    const country = button.dataset.region || null
    await post('/_dev/geo', { country, continent: button.dataset.continent })
    forgetContext()
    location.reload()
  })
}
// Reset controls
const CONSENT_KEYS = ['ci_consent_status', 'ci_consent_pending']
// "Reset visitor" also turns the simulated GPC signal off.
const clearPlaygroundFlags = () => {
  localStorage.removeItem('playground_gpc')
  localStorage.removeItem('playground_categories')
}
$('#reset-consent').addEventListener('click', () => {
  for (const key of CONSENT_KEYS) localStorage.removeItem(key)
  sessionStorage.setItem('playground_note', 'Consent reset: the visitor has not decided yet.')
  location.reload()
})
$('#reset-visitor').addEventListener('click', () => {
  clearVisitor()
  clearPlaygroundFlags()
  sessionStorage.setItem('playground_note', 'Visitor reset: all ci_* storage and cookies cleared.')
  location.assign('/')
})
$('#reset-all').addEventListener('click', async () => {
  await post('/_dev/reset') // server data, region override and site policy
  clearVisitor()
  clearPlaygroundFlags()
  sessionStorage.setItem('playground_note', 'Everything reset: visitor, server data and region.')
  location.assign('/')
})
const note = sessionStorage.getItem('playground_note')
if (note) {
  sessionStorage.removeItem('playground_note')
  $('#reset-note').textContent = note
}
$('#from-ads').addEventListener('click', () => {
  clearVisitor()
  location.assign('/pricing?gclid=PLAYGROUND-GCLID-123&utm_source=google&utm_medium=cpc&utm_campaign=playground')
})
$('#from-reset-link').addEventListener('click', () => {
  location.assign('/reset-password?token=SECRET-RESET-TOKEN&email=jane%40example.com#access_token=SECRET-FRAGMENT')
})
$('#ev-signup').addEventListener('click', () => analytics.trackEvent('sign_up', { plan: 'pro', method: 'email' }))
$('#ev-purchase').addEventListener('click', () => analytics.trackEvent('purchase', { value: 99, currency: 'USD' }))
$('#ev-custom').addEventListener('click', () => analytics.trackEvent('Newsletter Signup', { list: 'weekly' }))
$('#ev-error').addEventListener('click', () => analytics.trackError('Demo error: something failed', { code: 'E_DEMO' }))
$('#manage-cookies').addEventListener('click', () => analytics.consent.showBanner())
$('#categories-mode').checked = localStorage.getItem('playground_categories') === '1'
$('#categories-mode').addEventListener('change', () => {
  if ($('#categories-mode').checked) localStorage.setItem('playground_categories', '1')
  else localStorage.removeItem('playground_categories')
  location.reload()
})
fetch(api('/_dev/state'))
  .then(r => r.json())
  .then(state => {
    const site = state.sites.find(s => s.siteKey === siteKey)
    $('#no-tracking-without-consent').checked = site?.trackingWithoutConsent === 'none'
  })
$('#no-tracking-without-consent').addEventListener('change', async () => {
  await post('/_dev/policy', {
    siteKey,
    trackingWithoutConsent: $('#no-tracking-without-consent').checked ? 'none' : 'limited',
  })
  forgetContext()
  location.reload()
})
$('#gpc').checked = localStorage.getItem('playground_gpc') === '1'
$('#gpc').addEventListener('change', () => {
  if ($('#gpc').checked) localStorage.setItem('playground_gpc', '1')
  else localStorage.removeItem('playground_gpc')
  location.reload()
})
$('#flush').addEventListener('click', () => analytics.flush())
$('#leave-page').addEventListener('click', () => {
  // Same signal the browser sends when the tab is hidden or closed.
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  delete document.visibilityState
})
$('#new-policy').addEventListener('click', async () => {
  await post('/_dev/policy', { siteKey, policyVersion: new Date().toISOString().slice(0, 19) })
  forgetContext()
  location.reload()
})
$('#reset-server').addEventListener('click', () => post('/_dev/reset'))

// --- Tabs --------------------------------------------------------------------------
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-tab]')) {
      const selected = other === tab
      other.setAttribute('aria-selected', String(selected))
      $(`#tab-${other.dataset.tab}`).hidden = !selected
    }
    $('.filter').hidden = tab.dataset.tab !== 'events'
  })
}

// --- Feeds (server data rendered with textContent only) ----------------------------
const events = []
const consents = []
const NOISE = new Set(['web_vital', 'auto_metrics'])

function badge(text, kind) {
  const span = document.createElement('span')
  span.className = `badge ${kind ?? ''}`
  span.textContent = text
  return span
}

function entry(title, badges, detail, time) {
  const li = document.createElement('li')
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  const name = document.createElement('strong')
  name.textContent = title
  const when = document.createElement('time')
  when.textContent = new Date(time).toLocaleTimeString()
  summary.append(name, ...badges, when)
  const pre = document.createElement('pre')
  pre.textContent = JSON.stringify(detail, null, 2)
  details.append(summary, pre)
  li.append(details)
  return li
}

function renderEvents() {
  const hideNoise = $('#hide-noise').checked
  const list = $('#tab-events')
  const shown = events.filter(e => !hideNoise || !NOISE.has(e.name))
  list.replaceChildren(
    ...shown
      .slice()
      .reverse()
      .map(e =>
        entry(
          e.name,
          [
            badge(e.trackingCategory, e.trackingCategory),
            badge(e.consentRequired ? (e.consentGranted ? 'consented' : 'no consent') : 'consent not required'),
          ],
          { props: e.props, sessionId: e.sessionId, pageViewId: e.pageViewId, eventId: e.eventId },
          e.receivedAt,
        ),
      ),
  )
  $('#count-events').textContent = String(events.length)
}

function renderConsents() {
  $('#tab-consents').replaceChildren(
    ...consents
      .slice()
      .reverse()
      .map(c => entry(c.decision, [badge(`policy ${c.policyVersion}`), badge(c.source)], c, c.recordedAt)),
  )
  $('#count-consents').textContent = String(consents.length)
}

function renderGtag() {
  const list = $('#tab-gtag')
  if (!list) return
  list.replaceChildren(
    ...gtagCalls
      .slice()
      .reverse()
      .map(call => entry(call.args.slice(0, 2).join(' · '), [], call.args[2] ?? null, call.at)),
  )
  $('#count-gtag').textContent = String(gtagCalls.length)
}

function renderStorage() {
  const rows = []
  const add = (where, key, value) => rows.push({ where, key, value })
  add('location', 'href', location.href)
  for (const [where, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
    for (const key of Object.keys(storage).sort()) {
      if (!key.startsWith('ci_')) continue
      let value = storage.getItem(key)
      try {
        value = JSON.stringify(JSON.parse(value), null, 2)
      } catch {}
      add(where, key, value)
    }
  }
  add('cookies', 'document.cookie', document.cookie || '(none)')
  const container = $('#tab-storage')
  container.replaceChildren(
    ...rows.map(row => {
      const block = document.createElement('div')
      const label = document.createElement('div')
      label.className = 'storage-key'
      label.textContent = `${row.where} · ${row.key}`
      const pre = document.createElement('pre')
      pre.textContent = row.value
      block.append(label, pre)
      return block
    }),
  )
}

function renderStatus() {
  const context = JSON.parse(sessionStorage.getItem('ci_geo_context') || 'null')
  const consent = JSON.parse(localStorage.getItem('ci_consent_status') || 'null')
  const required = context ? context.requiresConsent : true
  const decision = consent?.consented === true ? 'accepted' : consent?.consented === false ? 'rejected' : 'undecided'
  const stale = consent && context?.policyVersion && consent.version !== context.policyVersion
  const full = !required || (consent?.consented === true && !stale)
  const state = analytics.consent.get()
  // Marketing (advertising) tags: an explicit choice, else allowed only where consent is
  // not required and the browser sends no Global Privacy Control signal.
  const marketingTags =
    state.categories.marketing ?? (!state.required && !state.gpc)
  const status = $('#status')
  status.replaceChildren(
    badge(`Region: ${context?.country ?? 'unknown'}`),
    badge(`Consent required: ${required ? 'yes' : 'no'}`),
    badge(`Decision: ${decision}${stale ? ' (old policy)' : ''}`),
    badge(`Policy: ${context?.policyVersion ?? '?'}`),
    badge(`GPC: ${state.gpc ? 'on' : 'off'}`),
    ...(config.consent.choices === 'categories'
      ? ['preferences', 'statistics', 'marketing'].map(category =>
          badge(`${category}: ${state.categories[category] ?? '?'}`),
        )
      : []),
    badge(`Tracking: ${full ? 'full' : 'limited'}`, full ? 'full' : 'limited'),
    badge(`Marketing tags: ${marketingTags ? 'on' : 'off'}`, marketingTags ? 'full' : 'limited'),
  )
}

$('#hide-noise').addEventListener('change', renderEvents)
setInterval(() => {
  renderStatus()
  if (!$('#tab-storage').hidden) renderStorage()
}, 500)
renderStatus()
renderGtag()

// Add items not seen yet (by id), keeping server receive order. History and the live
// stream overlap: an item can arrive on the stream while the history request is in
// flight, so the two are merged rather than one replacing the other.
function merge(list, incoming, idKey, timeKey) {
  const seen = new Set(list.map(item => item[idKey]))
  for (const item of incoming) {
    if (!seen.has(item[idKey])) {
      seen.add(item[idKey])
      list.push(item)
    }
  }
  list.sort((a, b) => (a[timeKey] < b[timeKey] ? -1 : a[timeKey] > b[timeKey] ? 1 : 0))
}

async function loadHistory() {
  const [storedEvents, storedConsents] = await Promise.all([
    fetch(api(`/_dev/events?siteKey=${siteKey}`)).then(r => r.json()),
    fetch(api(`/_dev/consents?siteKey=${siteKey}`)).then(r => r.json()),
  ])
  merge(events, storedEvents, 'eventId', 'receivedAt')
  merge(consents, storedConsents, 'recordId', 'recordedAt')
  renderEvents()
  renderConsents()
}

const stream = new EventSource(api('/_dev/stream'))
stream.addEventListener('ready', loadHistory)
stream.addEventListener('event', message => {
  const event = JSON.parse(message.data)
  if (event.siteKey !== siteKey) return
  merge(events, [event], 'eventId', 'receivedAt')
  renderEvents()
})
stream.addEventListener('consent', message => {
  merge(consents, [JSON.parse(message.data)], 'recordId', 'recordedAt')
  renderConsents()
})
stream.addEventListener('reset', () => {
  events.length = 0
  consents.length = 0
  renderEvents()
  renderConsents()
})
