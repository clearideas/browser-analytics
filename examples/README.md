# Example apps

Minimal apps in the frameworks people use most, each using the integration the library README recommends. The end-to-end tests (`e2e/examples.spec.ts`) run the same scenarios against every one:
- page views on load and on client-side navigation (exactly one per page), with exit events for the page left;
- a custom event delivered by `sendBeacon` when leaving the site;
- the consent banner staying visible across navigations until the visitor decides;
- a consent record sent from the app's own origin;
- a footer "Cookie settings" link (`href="#ci-consent-settings"`) reopening the banner after a client-side navigation, so the visitor can withdraw (the router must not take over the link).

| App | Framework | Integration | Navigation |
| --- | --- | --- | --- |
| `next/` | Next.js 16 (App Router, static export) | `@clearideas/consent-analytics/next` | `usePathname`/`useSearchParams` |
| `react-router/` | React 19 + React Router 8 (Vite) | `@clearideas/consent-analytics/react` | History API |
| `vue/` | Vue 3 + Vue Router (Vite) | `@clearideas/consent-analytics/vite` | Vue Router |
| `nuxt/` | Nuxt 4 (SPA, `nuxt generate`) | `@clearideas/consent-analytics/nuxt.client` | Nuxt hooks |
| `sveltekit/` | SvelteKit 3 (adapter-static) | `@clearideas/consent-analytics/browser` | `afterNavigate` (manual) |
| `angular/` | Angular 22 (standalone, zoneless) | `@clearideas/consent-analytics/browser` | Router `NavigationEnd` (manual) |
| `astro/` | Astro 7 (view transitions) | `@clearideas/consent-analytics/browser` | `astro:page-load` (manual) |

```sh
npm run examples:build      # pack the library, install it into each app, build (Node >= 22.22.3 for Angular)
npm run test:examples       # Playwright; EXAMPLES=next,vue to run some
```

Each app has its own lockfile; the library is installed from the packed tarball, exactly as users get it. Dependencies are installed with `--ignore-scripts`.
