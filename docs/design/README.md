# Workspace redesign — September 2026

The editable [Canva login concept](https://www.canva.com/d/CCoad3gJ3QUt2kU)
was created by importing the original responsive [HTML design](login-concept.html).
The production login is implemented with semantic React forms in `AuthScreen.tsx`;
it does not embed an image of a form or depend on Canva at runtime.

Reference study:

- [Modern Fintech Login UI — Khambra Creatives](https://dribbble.com/shots/26308228-Modern-Fintech-Login-UI-Clean-Secure-Design): split composition, isolated sign-in form and discoverable account creation.
- [Smart Payroll Dashboard — Produx Design Studio](https://dribbble.com/shots/25244763-Smart-Payroll-Dashboard-Design): payroll status hierarchy and readable financial records.

The implementation uses ink navy, warm white and a restrained copper accent.
The references informed hierarchy and layout; their artwork, names, sample
financial data and identity providers are not included in the application.

The new design includes self-service workspace creation, optional invitation
activation, password visibility, browser autofill, profile editing, a persistent
light/dark preference, company setup based on saved records, grouped navigation,
role-aware page access, and consistent tables/forms for desktop and mobile.
Existing authenticated session, CSRF and company authorization contracts remain
authoritative.

The [Wamz Technologies identity](wamz-identity.md) provides the minimal parent-brand
endorsement beneath ZamPayroll, with an editable Canva design and locally served SVG.

## CDN photography — 9 September 2026

Login and company setup now use complementary workplace photographs served from
`images.unsplash.com`. These are decorative stock interiors, not photographs of
ZamPayroll customers or claims about a Zambian location. The existing Canva
concept remains the editable reference for colour and layout; this enhancement
is implemented in responsive React/CSS.

| Placement     | Fixed CDN source                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Login         | [Office corridor](https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=960&q=75) |
| Company setup | [Meeting space](https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=960&q=75)   |

The [Unsplash license](https://unsplash.com/license) was reviewed on 9 September 2026. Photography is credited on the login composition. The fixed URLs avoid
random image endpoints or API credentials. `WorkspaceImage.tsx` owns the two
sources, responsive widths and quality. Images have reserved dimensions,
decorative empty alternative text, asynchronous decoding and a CSS fallback;
setup imagery loads lazily. Login imagery receives priority. Failure never blocks
a form or replaces essential instructions.

Requests use anonymous CORS and no referrer; URLs contain only fixed artwork and
size/quality parameters. The CDN receives ordinary network request metadata, but
no company names, employee records, account numbers or application credentials
are sent in image URLs. Nginx permits only this additional image origin, with
scripts and connections still restricted to the application. Vite's built
preview reads the same CSP from the Nginx configuration so browser verification
exercises the deployed policy. The development server retains Vite's normal
style-injection support. No Canva runtime dependency is introduced.

Browser verification includes an intentionally blocked CDN check, plus setup and
bank reconciliation at desktop/mobile widths. Run with `E2E_LIVE_CDN=1` to enable
the separate live photography check, which requires network access to
`images.unsplash.com`. CI uses the fallback path so external image availability
does not block payroll releases.
