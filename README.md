# Niro customer app

Digital loyalty cards for partner cafes. Customers sign up, collect stamps, and get a popup when they pass a partner cafe (max 2 a day).

- **App:** Next.js (App Router, TypeScript). Deploys to Vercel with no setup.
- **API:** `worker/`, a Cloudflare Worker with **D1** (database) and **R2** (photos).
- **Design reference:** `docs/customer-mock.html`, the approved single-file mock.

## Run the app
```
npm install
npm run dev        # http://localhost:3000
```

## How the move to Next.js was done
The approved design runs exactly as it did. Its CSS, HTML and JavaScript were moved over unchanged:

| Mock | Now |
|---|---|
| `<style>` | `app/globals.css` |
| page markup | `app/markup.ts` |
| `<script>` | `public/legacy/app.js` |

`app/page.tsx` renders the markup and loads the script. I checked that the pages look pixel-for-pixel the same
in a mobile browser for signed-out Home, sign-up, OTP, signed-in Home, Wallet, Map and Profile.
`npm run build` itself was not run before this commit, so run it once and fix anything it reports.

**Next step:** turn each screen into a React component one at a time (Home, Wallet, Map, Profile, sheets),
comparing it with `docs/customer-mock.html` after each, then delete the matching part of `public/legacy/app.js`.

## Deploy the app
- **Vercel:** Add New > Project > pick this repo. No settings needed.
- **Cloudflare:** Next.js runs there through the OpenNext adapter (`@opennextjs/cloudflare`). Set it up after the app is
  built out; Vercel is the quickest for now.

## Deploy the API (Cloudflare)
See `worker/README.md`. Database name `niro-customer`. R2 (photos) is optional and switched off for now.
The app is not yet connected to the API; it still uses sample data.

## Install on a phone
The app is a PWA (`public/manifest.webmanifest`, `public/sw.js`). Android Chrome: menu > Install app.
iPhone Safari: Share > Add to Home Screen. After changing files, bump `VERSION` in `public/sw.js`.

## Deploy without GitHub or a terminal (phone friendly)
Build the Pages bundle (static app + `_worker.js`, the compiled `worker/src/index.ts`) and drag it into
Cloudflare Pages > Upload assets. Then add the bindings in the Pages project settings:
D1 database `DB` = `niro-customer` and the variable `DEV_OTP` = `1` while testing. The tables are created automatically on the first API call.
