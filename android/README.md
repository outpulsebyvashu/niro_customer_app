# Niro customer app (Android, Kotlin)

A native Kotlin shell around the live web app at https://niro.cards. The screens are the web app's own, so the design
is identical and updates do not need a new APK.

Native parts: location permission for the map and nearby alerts, photo picker for the profile picture, share sheet for
invites, save-to-file for "Download my data", back button that closes sheets first, offline screen, status bar colour that
follows the app's light and dark theme. Business links (Admin, Staff, Client) and Google Wallet open outside the app.

## Get the APK
Every push that changes `android/` builds a signed APK in GitHub Actions and publishes it as a release.
Latest: https://github.com/outpulsebyvashu/niro_customer_app/releases/latest/download/Niro-beta.apk

## Signing
`niro-sideload.jks` is a sideload key kept in the repo so every build can update the previous one. Before publishing to
Google Play, make a new private upload key and keep it out of the repo (use GitHub Actions secrets).
