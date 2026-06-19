# Building the Private Proxy Client — Release APK

## Prerequisites

- Node.js 18+  →  https://nodejs.org
- (Option A only) EAS CLI: `npm install -g eas-cli` + free account at expo.dev
- (Option B only) Android Studio + JDK 17 (bundled with Android Studio)

---

## Option A — EAS Cloud Build (recommended, no Android SDK needed)

### 1. Install deps
```bash
cd proxy-client          # the folder you extracted
npm install
```

### 2. Login to EAS
```bash
eas login                # creates a free account at expo.dev if needed
```

### 3. Build a direct-install APK (preview profile)
```bash
eas build -p android --profile preview
```
- EAS asks if you want to auto-generate a keystore → say **Yes**
- Build runs in the cloud (~5–10 min)
- You get a **download link** for the signed `.apk`

### 4. Build a Play Store bundle (production profile)
```bash
eas build -p android --profile production
```
Produces a signed `.aab` ready for Google Play.

---

## Option B — Local Android Studio Build

### 1. Install deps + generate native Android project
```bash
cd proxy-client
npm install
npx expo prebuild --platform android --clean
```
The `withProxyVpn` plugin runs automatically and:
- Copies `ProxyVpnPackage.kt`, `ProxyVpnModule.kt`, `ProxyVpnService.kt`
- Patches `MainApplication.kt` to register `ProxyVpnPackage`
- Adds VPN permissions and `<service>` to `AndroidManifest.xml`

### 2. Create a release keystore (one time only)
```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias proxy-vpn \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```
**Keep `release.keystore` safe — losing it means you can never update the app on the Play Store.**

### 3. Open in Android Studio
- Android Studio → Open → select `proxy-client/android/`
- Wait for Gradle sync

### 4a. Build debug APK (for testing on device)
```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### 4b. Build signed release APK
```bash
cd android
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=../release.keystore \
  -Pandroid.injected.signing.store.password=YOUR_STORE_PASS \
  -Pandroid.injected.signing.key.alias=proxy-vpn \
  -Pandroid.injected.signing.key.password=YOUR_KEY_PASS
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### 4c. Build signed release AAB (for Play Store)
```bash
cd android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file=../release.keystore \
  -Pandroid.injected.signing.store.password=YOUR_STORE_PASS \
  -Pandroid.injected.signing.key.alias=proxy-vpn \
  -Pandroid.injected.signing.key.password=YOUR_KEY_PASS
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

### 5. Install on device (debug or release)
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
# or
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## Play Store Submission Checklist

- [ ] Signed release AAB built with Option A (production) or Option B (4c)
- [ ] App icon: `assets/images/icon.png` (1024×1024 PNG)
- [ ] Short description: "Private proxy VPN client for Android"
- [ ] Package name: `com.privateproxyclient`
- [ ] Version: `1.0.0` (versionCode: 1) — both in `app.json`
- [ ] Privacy policy URL required (VPN apps always require one)
- [ ] Content rating questionnaire — VPN category
- [ ] Target audience: 18+ recommended for network tools

---

## How the VPN works on device

1. User taps **Connect** → `ProxyVpnModule.kt` calls `VpnService.prepare()`
2. Android shows the system VPN permission dialog
3. On approval, `ProxyVpnService.kt`:
   - Tests TCP connectivity to the proxy endpoint (3s timeout)
   - Calls `VpnService.Builder` to establish a TUN interface at `10.10.0.2`
   - On Android 10+: sets `ProxyInfo.buildDirectProxy(serverIp, port)` as the HTTP proxy
   - Starts a foreground service with a persistent notification
4. Status broadcasts back to React Native via `BroadcastReceiver` → `NativeEventEmitter`
5. Disconnect: sends `ACTION_STOP` → service tears down TUN and stops itself

> **Note:** Full packet-level forwarding for all apps (including those that ignore Android's
> proxy setting) requires a `tun2socks` engine integrated into `ProxyVpnService.kt`.
> The current implementation covers the HTTP proxy path, which works for browsers
> and most apps.
