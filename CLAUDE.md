# Niro customer app

Loyalty cards for partner cafes. Customers collect stamps; a popup shows when they pass a partner cafe (max 2 a day).
Stack: Next.js (App Router, TypeScript), Cloudflare Worker + D1 + R2 in `worker/`.

## The design is approved. Do not change how it looks.
`docs/customer-mock.html` is the reference. Open it in a browser to see the flow.
Today `app/globals.css`, `app/markup.ts` and `public/legacy/app.js` are that mock moved over unchanged.

## Rules for the Next.js move
- Convert one screen at a time (Home, Wallet, Map, Profile, sheets, sign-up). After each, compare screenshots at 390x844
  against the mock. Spacing, colours, fonts and animations must match.
- Keep the CSS class names and CSS variables. Cafe-branded cards use `--b-bg`, `--b-ink`, `--b-acc` and the `pt-*` pattern classes.
- Keep the `[hidden]{display:none!important}` rule in `app/globals.css`.
- Screens: Home | Map | Wallet, with Profile opened from the avatar. Signed-out users see a greeting by time of day and can sign up
  with name, mobile number and OTP.
- Nearby alerts: max 2 popups a day in total (India time), enforced by `POST /api/geo-alerts`.

## API
`worker/` has the endpoints, D1 migrations and tests (`cd worker && npm run test:api`). It is not wired to the app yet.
Replace the sample data in the mock with API calls screen by screen.
