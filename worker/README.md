# Niro API (Cloudflare Worker, D1, R2)

```
cd worker
npm install
npx wrangler login

npx wrangler d1 create niro-customer          # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create niro-customer-media

npm run db:migrate                           # creates the tables
npm run db:seed                              # optional: five sample Mysuru cafes (replace the placeholder coordinates)
npm run deploy
```
Local: `npm run db:migrate:local && npm run db:seed:local && npm run dev`.

Tables: `users, otp_codes, otp_requests, sessions, special_dates, cafes, offers, saved_offers, staff, shifts,
memberships, stamp_events, geo_alerts, device_tokens`. R2 folders: `avatars/<user id>/` (private), `cafe-media/<cafe id>/` (public).
Add database changes as new files in `migrations/` (`0002_...sql`), never by editing `0001`.

## SMS
`wrangler.jsonc` has `DEV_OTP = "1"`: no SMS is sent and every code is `123456`. For production remove it and run
`npx wrangler secret put TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`. To use an Indian provider (MSG91, Textlocal), replace `sendOtp()`.
India requires DLT registration of the sender ID and message template.

## API
Sign in returns a token. Send it as `Authorization: Bearer <token>`.

| Who | Endpoint |
|---|---|
| Anyone | `POST /api/auth/request-otp` `{phone, name}`, `POST /api/auth/verify` `{phone, code}` |
| Anyone | `GET /api/cafes/nearby?lat&lng&limit`, `GET /api/cafes/:id`, `GET /api/offers` |
| Customer | `GET/PATCH/DELETE /api/me`, `PUT /api/me/special-dates`, `PUT/DELETE /api/me/photo` (raw image, up to 2 MB) |
| Customer | `POST /api/cafes/:id/join`, `GET /api/memberships`, `PATCH/DELETE /api/memberships/:id` |
| Customer | `POST /api/geo-alerts` `{cafe_id}` returns `allowed`, `POST /api/devices`, `POST/DELETE /api/saved-offers/:id` |
| Staff | `POST /api/staff/stamp` `{code, qty}`, `/redeem` `{code}`, `/clock-in`, `/clock-out`, `GET /api/staff/me` |
| Owner | `POST /api/cafes`, `PATCH /api/cafes/:id`, `POST /api/cafes/:id/photos`, `/offers`, `/staff` |
| Owner | `GET /api/cafes/:id/stats`, `GET /api/cafes/:id/payroll?from&to` |

D1 has no row-level security, so each rule is checked in `src/index.ts`. Customers cannot change their own stamps.
`npm run test:api` runs about 35 checks against SQLite and an in-memory R2 (Node 22.7+, no installs).
