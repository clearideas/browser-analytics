<script>
  // The recipe from the library README: report SvelteKit's own navigations.
  import { browser } from '$app/environment'
  import { afterNavigate } from '$app/navigation'
  import { initBrowserAnalytics } from '@clearideas/consent-analytics/browser'

  let { children } = $props()

  if (browser) {
    const analytics = initBrowserAnalytics(
      { apiBaseUrl: 'http://localhost:18787/', siteKey: 'demo-site' },
      { routeChanges: 'manual' },
    )
    afterNavigate(() => analytics.notifyRouteChange())
  }
</script>

{@render children()}

<!-- Reopens the consent banner, so visitors can change their decision. -->
<footer><a id="cookie-settings" href="#ci-consent-settings">Cookie settings</a></footer>
