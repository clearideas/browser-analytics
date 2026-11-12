# Clear Ideas Chat widget: CDN usage

The chat widget can be embedded on any page from the CDN. With `@clearideas/consent-analytics`, configure it as an integration instead (`integrations.clearIdeasChat`): it then loads and follows the visitor's consent state automatically. Pin a versioned URL and set `integrity` (Subresource Integrity) in production:

```json
{
  "clearIdeasChat": {
    "accessKey": "your-access-key-here",
    "widgetUrl": "https://updates.clearideas.com/v0.1.0/chat.js",
    "cssUrl": "https://updates.clearideas.com/v0.1.0/chat.css",
    "integrity": "sha384-…",
    "cssIntegrity": "sha384-…"
  }
}
```

The rest of this page describes embedding the widget directly.

## CDN URLs

### Latest Version (Recommended)
Always points to the latest release:
- JavaScript: `https://updates.clearideas.com/chat.js`
- CSS: `https://updates.clearideas.com/chat.css`

### Versioned (For Production)
Use specific versions for stability:
- JavaScript: `https://updates.clearideas.com/v{version}/chat.js`
- CSS: `https://updates.clearideas.com/v{version}/chat.css`

Example for version 0.1.0:
- JavaScript: `https://updates.clearideas.com/v0.1.0/chat.js`
- CSS: `https://updates.clearideas.com/v0.1.0/chat.css`

## Minimal Setup

The simplest way to initialize the widget:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
</head>
<body>
  <!-- Widget will auto-initialize from this element -->
  <div
    data-clearideas-widget
    data-access-key="your-access-key-here"
  ></div>

  <script src="https://updates.clearideas.com/chat.js"></script>
</body>
</html>
```

That's it! The widget will automatically initialize when the page loads.

## Full Configuration (All Options)

Here's the complete setup with all available options:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
</head>
<body>
  <!-- Widget container with all configuration options -->
  <div
    data-clearideas-widget
    data-access-key="your-access-key-here"
    data-api-base-url="https://api.clearideas.com"
    data-open-on-load="false"
    data-position="bottom-right"
    data-width="380"
    data-height="540"
    data-has-consent="hasConsent"
    data-dark-mode="true"
  ></div>

  <!-- Alternative: Use absolute positioning instead of position -->
  <!-- <div
    data-clearideas-widget
    data-access-key="your-access-key-here"
    data-top="100"
    data-right="50"
  ></div> -->

  <!-- Note: placeholder and voiceEnabled are controlled by server init settings -->
  <!-- darkMode can be set via data-dark-mode to communicate parent page dark mode state -->

  <script>
    // Example: Set up consent flag (optional)
    window.hasConsent = false;

    // Grant consent when user accepts
    function grantConsent() {
      window.hasConsent = true;
      // Or dispatch event for immediate initialization
      document.dispatchEvent(new CustomEvent('clearideas-consent-granted-your-access-key-here'));
    }
  </script>

  <script src="https://updates.clearideas.com/chat.js"></script>
</body>
</html>
```

## Programmatic Initialization

You can also initialize the widget programmatically:

### Minimal Programmatic Setup

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
</head>
<body>
  <script src="https://updates.clearideas.com/chat.js"></script>
  <script>
    const widget = window.ClearIdeasWidget.init({
      accessKey: 'your-access-key-here'
    });
  </script>
</body>
</html>
```

### Full Programmatic Setup (All Options)

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
</head>
<body>
  <script src="https://updates.clearideas.com/chat.js"></script>
  <script>
    // Wait for consent before initializing
    function checkConsent() {
      return window.hasConsent === true;
    }

    // Initialize widget when consent is granted
    if (checkConsent()) {
      const widget = window.ClearIdeasWidget.init({
        // Required
        accessKey: 'your-access-key-here',

        // Optional API configuration
        apiBaseUrl: 'https://api.clearideas.com',

        // Widget positioning and styling
        openOnLoad: false,
        position: 'bottom-right', // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
        width: 380,
        height: 540,

        // Absolute positioning (alternative to position)
        // Use top/right/bottom/left for custom positioning instead of position
        // top: 20,
        // right: 20,
        // bottom: 20,
        // left: 20,

        // User information
        userName: 'John Doe',
        userEmail: 'john@example.com',
        userId: 'user-123',

        // Container (defaults to auto-created div)
        // container: '#my-widget-container',

        // Dark mode detection (allows parent page to communicate dark mode state)
        // If not provided, widget detects from server init settings or system preference
        // darkMode: true,

        // Floating action button size (default: 56px)
        // fabSize: 64,

        // Hide floating action button initially (default: false)
        // Allows you to use your own button/menu to control the widget
        // fabHide: true,

        // Consent check (delays initialization until true)
        hasConsent: checkConsent, // Can be: true, false, function, or string (global var name)

        // Note: placeholder and voiceEnabled are controlled by server init settings
      });

      // Use widget instance
      widget.open();
      // widget.close();
      // widget.toggle();
      // widget.sendMessage('Hello!');
      // widget.destroy();
    } else {
      // Set up consent listener
      window.addEventListener('consent-granted', () => {
        // Re-run initialization logic above
      });
    }
  </script>
</body>
</html>
```

## Consent Management

The widget supports delaying initialization until consent is granted, so cookies and `localStorage` are only used once a visitor has agreed to them.

### Using Global Variable

```html
<script>
  // Set initial consent state
  window.hasConsent = false;

  // Grant consent when user accepts
  function acceptConsent() {
    window.hasConsent = true;
  }
</script>

<div
  data-clearideas-widget
  data-access-key="your-access-key"
  data-has-consent="hasConsent"
></div>
```

### Using Function

```html
<script>
  function checkConsent() {
    // Check cookie, localStorage, or other consent mechanism
    return localStorage.getItem('consent') === 'granted';
  }

  const widget = window.ClearIdeasWidget.init({
    accessKey: 'your-access-key',
    hasConsent: checkConsent
  });
</script>
```

### Using Custom Event

For auto-initialization with data attributes, you can dispatch a custom event when consent is granted:

```html
<script>
  // Widget is waiting for consent
  <div
    data-clearideas-widget
    data-access-key="your-access-key"
    data-has-consent="hasConsent"
  ></div>

  // When user grants consent
  function grantConsent() {
    window.hasConsent = true;
    // Dispatch event for immediate initialization (optional, polling also works)
    document.dispatchEvent(new CustomEvent('clearideas-consent-granted-your-access-key'));
  }
</script>
```

## Consent-Aware Storage (GDPR regions)

For visitors where consent is required (for example under GDPR and the ePrivacy Directive in the EU), the widget supports consent-aware storage through the `consentRequired` and `consentGranted` props. When consent is required but not granted, the widget uses `sessionStorage` instead of `localStorage` and does not send cookies to the server. Whether consent is required for your visitors, and what counts as "granted," is determined by your own consent logic (e.g. your cookie banner) — the props below just tell the widget what to do once you've made that call.

### How It Works

- **`consentRequired: false`** (default): Widget uses `localStorage` and cookies normally
- **`consentRequired: true, consentGranted: false`**: Widget uses `sessionStorage` only, no cookies sent
- **`consentRequired: true, consentGranted: true`**: Widget migrates to `localStorage` and cookies

### Storage Behavior

- **When consent not required or granted**: Session ID stored in `localStorage`, cookies sent to server
- **When consent required but not granted**: Session ID stored in `sessionStorage` only, no cookies sent
- **On consent grant**: Session ID automatically migrates from `sessionStorage` to `localStorage`, widget re-initializes to establish cookies

### Server Communication

The widget sends an `x-clearideas-public-chat-consent-status` header to the `/init` endpoint with values:
- `not-required` - Consent not required (non-GDPR geo)
- `granted` - Consent has been granted
- `pending` - Consent required but not yet granted

The server uses this header to determine whether to set cookies. Cookies are only set when the status is `granted` or `not-required`.

### Example Usage

```html
<script>
  // Determine if consent is required based on user's location
  const consentRequired = isGDPRRegion(); // Your geo-detection logic

  // Initialize widget with initial consent state
  const widget = window.ClearIdeasWidget.init({
    accessKey: 'your-access-key',
    consentRequired: consentRequired,
    consentGranted: false, // Initially no consent
  });

  // When user grants consent - use setter methods (no need to destroy/re-init)
  function grantConsent() {
    widget.setConsentGranted(true);
    // Widget automatically migrates from sessionStorage to localStorage
    // and re-initializes to establish cookies
  }

  // When user revokes consent
  function revokeConsent() {
    widget.setConsentGranted(false);
    // Widget will use sessionStorage only
  }
</script>
```

**Note**: Using setter methods (`setConsentGranted()`, `setConsentRequired()`) is more efficient than destroying and re-initializing the widget. The widget automatically handles storage migration and re-initialization when consent status changes.

### Using Data Attributes

```html
<div
  data-clearideas-widget
  data-access-key="your-access-key"
  data-consent-required="true"
  data-consent-granted="false"
></div>

<script>
  // Update consent when user accepts
  function grantConsent() {
    const widgetEl = document.querySelector('[data-clearideas-widget]');
    widgetEl.setAttribute('data-consent-granted', 'true');
    // Widget will automatically detect the change and migrate storage
  }
</script>
```

**Note**: The widget watches for changes to `consentGranted` and automatically handles migration. However, for data attributes, you may need to re-initialize the widget for the change to take effect, or use programmatic initialization with reactive state.

## Configuration Options Reference

### Data Attributes (for auto-initialization)

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `data-clearideas-widget` | - | - | **Required.** Enables auto-initialization |
| `data-access-key` | string | - | **Required.** Your widget access key |
| `data-api-base-url` | string | `https://api.clearideas.com` | API base URL |
| `data-open-on-load` | boolean | `false` | Open widget when page loads |
| `data-position` | string | `bottom-right` | Widget position: `bottom-right`, `bottom-left`, `top-right`, `top-left`. **Only these 4 corner positions are supported.** For custom positioning (e.g., center, left edge, etc.), use programmatic init with `top`, `right`, `bottom`, `left` props instead. |
| `data-width` | number | `380` | Widget width in pixels |
| `data-height` | number | `540` | Widget height in pixels |
| `data-top` | number | - | Absolute positioning: distance from top in pixels. When set, widget uses absolute positioning instead of `position`. |
| `data-right` | number | - | Absolute positioning: distance from right in pixels. When set, widget uses absolute positioning instead of `position`. |
| `data-bottom` | number | - | Absolute positioning: distance from bottom in pixels. When set, widget uses absolute positioning instead of `position`. |
| `data-left` | number | - | Absolute positioning: distance from left in pixels. When set, widget uses absolute positioning instead of `position`. |
| `data-dark-mode` | boolean | - | Allows parent page to communicate dark mode state: `true` or `false`. If not provided, widget detects from server init settings or system preference. |
| `data-fab-size` | number | `56` | Floating action button size in pixels. Controls both button and icon size proportionally. |
| `data-fab-hide` | boolean | `false` | Hide floating action button initially. Widget stays in DOM, but FAB is hidden. Use `hide()`/`show()` methods for dynamic control. |
| `data-has-consent` | boolean/string | `true` | Consent check: `true`, `false`, or global variable name |
| `data-consent-required` | boolean | `false` | If `true`, consent is required before using cookies/localStorage. When `true` and `consentGranted` is `false`, widget uses sessionStorage only. |
| `data-consent-granted` | boolean | `false` | If `true`, consent has been granted. Only relevant when `consentRequired` is `true`. When changed from `false` to `true`, widget migrates from sessionStorage to localStorage. |

**Note:** `placeholder` and `voiceEnabled` are controlled by server init settings and cannot be set via client config.

### Programmatic Config Object

```typescript
interface WidgetConfig {
  // Required
  accessKey: string;

  // Optional API configuration
  apiBaseUrl?: string;

  // Widget positioning and styling
  openOnLoad?: boolean;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  // Note: Only the 4 corner positions above are supported.
  // For custom positioning (e.g., center, left edge, etc.),
  // use top/right/bottom/left props instead and omit position.
  width?: number;
  height?: number;

  // Absolute positioning (use these for custom positioning instead of position)
  // When any of these are set, position is ignored and widget uses absolute positioning
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;

  // User information
  userName?: string;
  userEmail?: string;
  userId?: string;

  // Note: Actions/links come only from server initData response, not from client config
  // The server's /init endpoint returns a "links" array that becomes the widget actions

  // Container
  container?: string | HTMLElement;

  // Dark mode detection (allows parent page to communicate dark mode state)
  // If provided, takes priority over server init settings and system detection
  darkMode?: boolean;

  // Floating action button size in pixels (default: 56)
  // Controls both button and icon size proportionally
  fabSize?: number;

  // Hide floating action button initially (default: false)
  // Widget stays in DOM, but FAB is hidden. Use hide()/show() methods for dynamic control.
  fabHide?: boolean;

  // Consent management
  hasConsent?: boolean | (() => boolean) | string;

  // Consent-aware storage (e.g. GDPR regions)
  // If true, consent is required before using cookies/localStorage
  // When true and consentGranted is false, widget uses sessionStorage only
  consentRequired?: boolean;

  // If true, consent has been granted (only relevant when consentRequired is true)
  // When changed from false to true, widget migrates from sessionStorage to localStorage
  consentGranted?: boolean;
}

// Note: The following are controlled by server init settings:
// - placeholder: Comes from server /init response
// - voiceEnabled: Comes from server /init response (voiceEnabled or voice.enabled)
//
// darkMode prop allows parent page to communicate dark mode state.
// If not provided, widget detects from server init settings (style.mode) or system preference.
```

## Reactive Props

Some props support reactive updates. The widget automatically detects changes when you use Vue refs/computed values, or you can use methods to update them manually.

### Props That Support Reactivity

The following props support reactive function/string values (for Vue.js):
- `darkMode`: `boolean | (() => boolean) | string`
- `consentRequired`: `boolean | (() => boolean) | string`
- `consentGranted`: `boolean | (() => boolean) | string`

**All props** can be updated using setter methods (see [Widget Instance API](#widget-instance-api) section below).

### Native JavaScript (Plain Variables) - Recommended Approach

For native JavaScript implementations, **use the widget setter methods** to update props:

```javascript
const widget = window.ClearIdeasWidget.init({
  accessKey: 'your-access-key',
  darkMode: false, // Initial value
  width: 380,
  position: 'bottom-right',
});

// Update props dynamically using setter methods
document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
  widget.setDarkMode(e.target.checked);
});

// Update other props
widget.setWidth(400);
widget.setPosition('top-left');
widget.setConsentGranted(true);
```

**Why?** Plain JavaScript variables aren't reactive. Vue can't detect when they change, so you need to explicitly call the update method. Setter methods are the recommended approach for native JavaScript.

### Vue.js (Reactive Refs/Computed)

If you're using Vue.js, you can pass reactive refs or computed values for automatic updates:

```javascript
import { ref, computed } from 'vue';

const isDarkMode = ref(false);
const consentGranted = ref(false);

const widget = window.ClearIdeasWidget.init({
  accessKey: 'your-access-key',
  darkMode: () => isDarkMode.value, // Vue tracks this automatically
  consentGranted: () => consentGranted.value, // Vue tracks this automatically
});

// When you update the ref, Vue automatically updates the widget
isDarkMode.value = true; // Widget updates automatically!
consentGranted.value = true; // Widget updates automatically!
```

**Why?** Vue's reactivity system tracks refs and computed values. When you access them inside a function prop, Vue knows to re-run the computed property when they change.

### Function Props with Plain Variables

If you pass a function that accesses plain variables, Vue won't detect changes:

```javascript
let isDarkMode = false; // Plain variable

const widget = window.ClearIdeasWidget.init({
  darkMode: () => isDarkMode, // ❌ Won't update automatically
});

isDarkMode = true; // Widget won't detect this change
```

**Solution:** Use `widget.setDarkMode(true)` instead, or wrap your variable in a Vue ref.

## Widget Instance API

After initialization, you get a widget instance with these methods:

### Control Methods

```javascript
const widget = window.ClearIdeasWidget.init({ accessKey: '...' });

// Open the widget
widget.open();

// Close the widget
widget.close();

// Toggle open/closed state
widget.toggle();

// Send a message programmatically
await widget.sendMessage('Hello!');

// Hide the floating action button (widget stays in DOM)
widget.hide();

// Show the floating action button
widget.show();

// Remove widget from DOM
widget.destroy();
```

### Prop Setter Methods

All props can be updated dynamically using setter methods. These methods override the initial prop values and are the recommended way to update props in native JavaScript implementations.

```javascript
const widget = window.ClearIdeasWidget.init({ accessKey: '...' });

// Dark mode
widget.setDarkMode(true);  // Enable dark mode
widget.setDarkMode(false); // Disable dark mode

// GDPR consent
widget.setConsentRequired(true);  // Require consent
widget.setConsentRequired(false); // Consent not required
widget.setConsentGranted(true);   // Grant consent
widget.setConsentGranted(false);  // Revoke consent

// Positioning
widget.setPosition('bottom-right'); // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
widget.setTop(100);     // Absolute positioning from top (in pixels)
widget.setRight(50);    // Absolute positioning from right (in pixels)
widget.setBottom(100);  // Absolute positioning from bottom (in pixels)
widget.setLeft(50);     // Absolute positioning from left (in pixels)

// Size
widget.setWidth(400);   // Widget width in pixels
widget.setHeight(600);  // Widget height in pixels
widget.setFabSize(64);  // Floating action button size in pixels

// Actions (quick links) - Note: Actions come from server initData by default
// Only use setActions() if you need to override server-provided actions
// widget.setActions([...]); // Advanced: Override server actions (not recommended)

// User information
widget.setUserName('John Doe');
widget.setUserEmail('john@example.com');
widget.setUserId('user-123');
```

**Note**: When using absolute positioning (`setTop`, `setRight`, `setBottom`, `setLeft`), the `position` prop is ignored. To clear absolute positioning and return to corner positioning, set the values to `undefined`:

```javascript
widget.setTop(undefined);
widget.setRight(undefined);
widget.setBottom(undefined);
widget.setLeft(undefined);
// Widget will now use the position prop (default: 'bottom-right')
```

## Examples

### Example 1: Simple Integration
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<div data-clearideas-widget data-access-key="your-key"></div>
<script src="https://updates.clearideas.com/chat.js"></script>
```

### Example 2: With Consent Management
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<script>
  window.hasConsent = false;
  // Show consent banner, then:
  // window.hasConsent = true;
</script>
<div
  data-clearideas-widget
  data-access-key="your-key"
  data-has-consent="hasConsent"
></div>
<script src="https://updates.clearideas.com/chat.js"></script>
```

### Example 3: Custom Container
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<div id="my-chat-widget"></div>
<script src="https://updates.clearideas.com/chat.js"></script>
<script>
  window.ClearIdeasWidget.init({
    accessKey: 'your-key',
    container: '#my-chat-widget'
  });
</script>
```

### Example 4: Absolute Positioning (Custom Position)
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<!-- Use absolute positioning instead of corner positions -->
<div
  data-clearideas-widget
  data-access-key="your-key"
  data-top="100"
  data-right="50"
></div>
<script src="https://updates.clearideas.com/chat.js"></script>
```

Or programmatically:
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<script src="https://updates.clearideas.com/chat.js"></script>
<script>
  window.ClearIdeasWidget.init({
    accessKey: 'your-key',
    top: 100,
    right: 50,
    // position is ignored when top/right/bottom/left are set
  });
</script>
```

### Example 5: Custom FAB Size
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<div
  data-clearideas-widget
  data-access-key="your-key"
  data-fab-size="64"
></div>
<script src="https://updates.clearideas.com/chat.js"></script>
```

Or programmatically:
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<script src="https://updates.clearideas.com/chat.js"></script>
<script>
  window.ClearIdeasWidget.init({
    accessKey: 'your-key',
    fabSize: 64, // Larger FAB button (default: 56)
  });
</script>
```

### Example 6: Hidden FAB with Custom Button
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<!-- Hide FAB and use your own button -->
<div
  data-clearideas-widget
  data-access-key="your-key"
  data-fab-hide="true"
></div>

<!-- Your custom button -->
<button id="my-chat-button" onclick="widget.toggle()">
  Open Chat
</button>

<script src="https://updates.clearideas.com/chat.js"></script>
<script>
  const widget = window.ClearIdeasWidget.init({
    accessKey: 'your-key',
    fabHide: true, // Hide the FAB
  });

  // Or hide/show dynamically
  // widget.hide();
  // widget.show();
</script>
```

### Example 7: Dynamic Prop Updates with Setter Methods
```html
<link rel="stylesheet" href="https://updates.clearideas.com/chat.css">
<script src="https://updates.clearideas.com/chat.js"></script>
<script>
  // Initialize widget with initial values
  const widget = window.ClearIdeasWidget.init({
    accessKey: 'your-access-key',
    darkMode: false,
    width: 380,
    position: 'bottom-right',
  });

  // Update dark mode when user toggles it
  document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    widget.setDarkMode(e.target.checked);
  });

  // Update size when window resizes
  window.addEventListener('resize', () => {
    if (window.innerWidth < 768) {
      widget.setWidth(320);
      widget.setHeight(480);
    } else {
      widget.setWidth(380);
      widget.setHeight(540);
    }
  });

  // Update position based on user preference
  function updatePosition(position) {
    widget.setPosition(position);
  }

  // Update consent when user grants it
  function grantConsent() {
    widget.setConsentGranted(true);
    widget.setConsentRequired(true);
  }

  // Update user info when user logs in
  function onUserLogin(user) {
    widget.setUserName(user.name);
    widget.setUserEmail(user.email);
    widget.setUserId(user.id);
  }
</script>
```

### Example 8: Versioned for Production
```html
<link rel="stylesheet" href="https://updates.clearideas.com/v0.1.0/chat.css">
<div data-clearideas-widget data-access-key="your-key"></div>
<script src="https://updates.clearideas.com/v0.1.0/chat.js"></script>
```
