import { initViteAnalytics, useAnalytics } from '@clearideas/consent-analytics/vite'
import { createApp, h } from 'vue'
import { createRouter, createWebHistory, RouterLink, RouterView } from 'vue-router'

const Home = {
  setup() {
    const track = () => useAnalytics().trackEvent('cta_click', { framework: 'vue' })
    return () =>
      h('main', [
        h('h1', 'Home'),
        h(RouterLink, { id: 'nav-pricing', to: '/pricing' }, () => 'Pricing'),
        h('button', { id: 'cta', onClick: track }, 'Track CTA'),
      ])
  },
}
const Pricing = {
  setup: () => () => h('main', [h('h1', 'Pricing'), h(RouterLink, { id: 'nav-home', to: '/' }, () => 'Home')]),
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/pricing', component: Pricing },
  ],
})

// Configuration comes from VITE_* variables (.env).
initViteAnalytics(router)

// The footer link reopens the consent banner, so visitors can change their decision.
const Footer = () =>
  h('footer', [h('a', { id: 'cookie-settings', href: '#ci-consent-settings' }, 'Cookie settings')])

createApp({ render: () => [h(RouterView), h(Footer)] }).use(router).mount('#app')
