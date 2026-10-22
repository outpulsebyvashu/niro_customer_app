# Niro (Flutter)

One Android app that contains all four Niro apps, sharing the same server and database as the web apps:

| Part | Who sees it | Web equivalent |
|---|---|---|
| Customer | everyone | niro.cards |
| Client | cafe owners / managers (and anyone who wants to add a cafe) | partner.niro.cards |
| Workforce | people added as staff to a cafe | workforce.niro.cards |
| Admin | phone numbers listed in `ADMIN_PHONES` | admin.niro.cards |

Sign in with your mobile number (SMS code). The bottom bar shows only the parts your account can use.

## Get the APK (no computer needed)
1. Push this repo to GitHub. The workflow in `.github/workflows/build-apk.yml` runs by itself.
2. When it finishes (about 5 minutes), open the repo on your phone, go to **Releases → Niro (latest build)** and download `app-release.apk`.
3. Open it and allow "install unknown apps" if Android asks.

The same file is also under **Actions → the latest run → Artifacts → niro-apk**.

## Server address
The app talks to `https://niro.cards`. To point it elsewhere, change `API_BASE` in the workflow (`--dart-define=API_BASE=...`).

## Run locally (if you ever have a computer)
```
flutter create --platforms=android .
dart run tool/configure_android.dart
flutter run
```

## Notes
- Android only for now. iOS needs a Mac and an Apple developer account.
- Live updates use the same `/api/live` stream as the web app, so stamps appear on the customer's card instantly while the app is open.
- The release APK is signed with the debug key. Before publishing on Play Store, add your own signing key.
