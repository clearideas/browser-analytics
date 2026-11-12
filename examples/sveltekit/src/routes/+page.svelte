<script>
  import { getBrowserAnalytics } from '@clearideas/consent-analytics/browser'

  const track = () => getBrowserAnalytics()?.trackEvent('cta_click', { framework: 'sveltekit' })
</script>

<main>
  <h1>Home</h1>
  <a id="nav-pricing" href="/pricing">Pricing</a>
  <button id="cta" onclick={track}>Track CTA</button>
</main>
