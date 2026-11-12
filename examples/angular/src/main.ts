import { Component, provideZonelessChangeDetection } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { NavigationEnd, provideRouter, Router, RouterLink, RouterOutlet } from '@angular/router'
import { getBrowserAnalytics, initBrowserAnalytics } from '@clearideas/consent-analytics/browser'
import { filter } from 'rxjs'

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <main>
      <h1>Home</h1>
      <a id="nav-pricing" routerLink="/pricing">Pricing</a>
      <button id="cta" (click)="track()">Track CTA</button>
    </main>
  `,
})
class HomeComponent {
  track() {
    getBrowserAnalytics()?.trackEvent('cta_click', { framework: 'angular' })
  }
}

@Component({
  selector: 'app-pricing',
  imports: [RouterLink],
  template: `
    <main>
      <h1>Pricing</h1>
      <a id="nav-home" routerLink="/">Home</a>
    </main>
  `,
})
class PricingComponent {}

// The footer link reopens the consent banner, so visitors can change their decision.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    <footer><a id="cookie-settings" href="#ci-consent-settings">Cookie settings</a></footer>
  `,
})
class AppComponent {}

const appRef = await bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter([
      { path: '', component: HomeComponent },
      { path: 'pricing', component: PricingComponent },
    ]),
  ],
})

// The recipe from the library README: report Angular Router navigations.
const analytics = initBrowserAnalytics(
  { apiBaseUrl: 'http://localhost:18787/', siteKey: 'demo-site' },
  { routeChanges: 'manual' },
)
appRef.injector
  .get(Router)
  .events.pipe(filter(event => event instanceof NavigationEnd))
  .subscribe(() => analytics.notifyRouteChange())
