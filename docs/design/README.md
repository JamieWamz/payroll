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

The new design includes staged registration, password visibility, browser autofill,
company setup based on saved records, grouped navigation, role-aware page access,
consistent tables/forms and layouts for desktop and mobile. Existing authenticated
session, CSRF and company authorization contracts remain authoritative.
