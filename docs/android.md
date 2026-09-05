# Android app (Capacitor)

The Android app is the existing React frontend bundled into a native shell with
[Capacitor](https://capacitorjs.com). There is no separate mobile codebase: the
web bundle built with `vite build --mode android` ships inside the APK and
talks to the production API directly.

## How it fits together

| Piece | Purpose |
| --- | --- |
| `frontend/capacitor.config.ts` | App id `asia.dongtran.chia`, web dir, native HTTP, edge-to-edge |
| `frontend/.env.android` | `VITE_API_URL` baked into the Android bundle (production API) |
| `frontend/src/native.ts` | `isNative` flag and Android back-button handling |
| `frontend/android/` | Generated Gradle project (committed, like any Capacitor app) |
| `frontend/assets/` | Source icon/splash images for `@capacitor/assets` |
| `scripts/build-android.sh` | One-shot build (debug or signed release) |
| `scripts/android-keystore.sh` | One-time release keystore creation |

Behaviour that differs from the web build when `isNative` is true:

- The service worker is not registered (the bundle is local, nothing to cache).
- The "install app" banner is hidden.
- Google sign-in uses the native Android account sheet
  (`@capgo/capacitor-social-login`, Credential Manager) instead of the web
  button: Google Identity Services refuses to run inside a WebView
  (`disallowed_useragent`). The plugin returns a Google ID token whose
  audience is the *web* client id, so the backend's `/auth/google` endpoint
  verifies it unchanged. The client id is fetched from `/auth/config` at
  runtime, nothing is hard-coded in the app.
- Copy-to-clipboard goes through the native clipboard plugin.
- Links to `https://chia.dongtran.asia/...` open inside the app (Android App
  Links). This needs `/.well-known/assetlinks.json` served by the website
  (`frontend/public/.well-known/assetlinks.json`) listing the SHA-256 of every
  signing certificate; the debug certificate is in there already.
- All HTTP goes through Capacitor's native HTTP layer (`CapacitorHttp`), so the
  API does not need a CORS entry for the app's `https://localhost` origin. If
  you ever disable that plugin, add `https://localhost` to `CHIA_CORS_ORIGINS`.

## Google sign-in setup (Google Cloud project `chia-ab0bf`)

Everything lives in the same Google Cloud project as Firebase. Google requires
the Android client and the web client to be in one project.

| Client | Id | Used by |
| --- | --- | --- |
| Chia Web | `384755803003-a1cosqaeq5btj5alkq38r0o5ejld8nct.apps.googleusercontent.com` | backend `CHIA_GOOGLE_CLIENT_ID`, website button, `webClientId` on Android |
| Chia Android | package `asia.dongtran.chia` + signing SHA-1 | lets Google issue tokens to the app |

The Android client is registered with the **debug** certificate. When you
build a release APK, add its SHA-1 (`keytool -list -v -keystore <jks>`) as a
second Android client in Google Auth Platform → Clients, and its SHA-256 to
`assetlinks.json`, otherwise Google sign-in fails with error 10 in release
builds.

## Toolchain

Everything lives under the home directory, no system packages:

```bash
# JDK 21 (Temurin)
mkdir -p ~/.local/jdk
curl -L "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk" \
  | tar -xz -C ~/.local/jdk --strip-components=1

# Android SDK command-line tools + the packages Capacitor 7 needs
mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk
curl -LO https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q commandlinetools-linux-*.zip -d cmdline-tools && mv cmdline-tools/cmdline-tools cmdline-tools/latest
export JAVA_HOME=~/.local/jdk ANDROID_HOME=~/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

Gradle itself is fetched by the wrapper on first build. The project compiles
against API 36 with Android Gradle plugin 8.9.1 (the sign-in plugin's
`androidx.browser` dependency needs both); `targetSdk` stays at 35.

## Build

```bash
scripts/build-android.sh            # → frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Or step by step from `frontend/`:

```bash
npm run build:android     # tsc + vite build --mode android
npx cap sync android      # copy dist/ into the Android project, update plugins
cd android && ./gradlew assembleDebug
```

Install on a phone with USB debugging: `adb install -r app-debug.apk`, or copy
the APK over and open it (allow "install from unknown sources").

## Release build

1. Create a keystore once and keep it out of the repo:

   ```bash
   CHIA_ANDROID_KEYSTORE_PASSWORD='...' scripts/android-keystore.sh   # writes ~/.chia/chia-release.jks
   ```

2. Bump `versionCode` / `versionName` in `frontend/android/app/build.gradle`.
3. Build:

   ```bash
   export CHIA_ANDROID_KEYSTORE=~/.chia/chia-release.jks
   export CHIA_ANDROID_KEYSTORE_PASSWORD='...'
   scripts/build-android.sh release   # → .../apk/release/app-release.apk
   ```

For Play Store uploads build a bundle instead: `cd frontend/android && ./gradlew bundleRelease`.

## Changing things

- **API URL**: edit `frontend/.env.android`, rebuild.
- **Icons / splash**: replace files in `frontend/assets/`, then
  `npx capacitor-assets generate --android`.
- **App name / id**: `capacitor.config.ts`, then `android/app/build.gradle`
  (`applicationId`, `namespace`) and the Java package under `android/app/src/main/java`.
- **Any frontend change**: rebuild the bundle and run `npx cap sync android`
  before building the APK, otherwise the APK ships the previous bundle.

## Distributing to testers (Firebase App Distribution)

Firebase project: `chia-ab0bf`, Android app id `1:384755803003:android:d85187e648de278cc6d3de`
(already the script default). One-time setup: `firebase login`. Testers are
managed in the console under App Distribution → Testers & Groups; the script
targets a group named `testers` unless `CHIA_FIREBASE_TESTERS` lists emails.

```bash
scripts/distribute-android.sh "What changed in this build"
```

Testers receive an email and install through the Firebase App Tester app,
which also notifies them of every later upload.

Public invite link (joins the `testers` group, then serves the latest
distributed release): https://appdistribution.firebase.dev/i/5e6cb4d910ee0c2e

The OAuth consent screen (Google Auth Platform → Branding) points at
`https://chia.dongtran.asia/privacy`, served by `frontend/src/pages/Privacy.tsx`.
The app is published ("In production"), so any Google account can sign in;
it requests only basic profile scopes, which need no Google verification.
