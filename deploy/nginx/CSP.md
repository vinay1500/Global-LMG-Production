# Content Security Policy domains

The production Nginx samples set CSP at the static frontend edge. API responses keep their existing Express/route headers so JSON, PDF, blob previews, and file downloads are not accidentally constrained by a blanket proxy CSP.

## Public frontend

- `script-src 'self'`: built Vite application assets.
- `script-src https://checkout.razorpay.com`: Razorpay Checkout script loaded by the client dashboard payment flow.
- `script-src https://accounts.google.com https://apis.google.com`: Google Identity sign-in script dependencies.
- `script-src https://maps.googleapis.com https://maps.gstatic.com`: Google Places/Maps script loader dependencies when address autocomplete is enabled.
- `connect-src https://api.globallmg.org`: client API.
- `connect-src https://*.razorpay.com`: Razorpay Checkout network calls.
- `connect-src https://accounts.google.com https://www.googleapis.com https://maps.googleapis.com`: Google Identity and Places API calls.
- `connect-src https://*.ingest.sentry.io https://*.sentry.io`: browser error telemetry when Sentry is configured.
- `frame-src https://*.razorpay.com`: Razorpay Checkout iframe.
- `frame-src https://accounts.google.com`: Google Identity iframe.
- `form-action https://docs.google.com https://forms.gle`: approved Google Forms CTAs.

Resend and Twilio are server-side integrations in this codebase and are not allowed as browser script sources.

## Admin frontend

- `script-src 'self'`: built admin SPA only.
- `connect-src https://admin-api.globallmg.org`: admin API.
- `connect-src https://*.ingest.sentry.io https://*.sentry.io`: browser error telemetry when Sentry is configured.
- `frame-src blob:`: generated invoice PDF blob previews.

The admin frontend does not load Razorpay, Resend, Twilio, Google Identity, or Google Maps scripts.
