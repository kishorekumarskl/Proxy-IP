# tun2socks Integration Guide

## Why tun2socks?

`ProxyInfo.buildDirectProxy()` (Mode B — what the app ships with out of the box) works for
apps that query Android's system proxy setting — browsers, OkHttp-based apps, WebViews.
Apps that open raw sockets (games, some VoIP clients, apps with custom networking stacks)
bypass the system proxy entirely.

**tun2socks** solves this by operating at the packet level:

```
All apps → Android TCP/IP stack → TUN interface (raw IP packets)
    → tun2socks reads each packet
    → Looks up destination IP:port
    → Opens a SOCKS5 CONNECT to the proxy server on behalf of that flow
    → Forwards data bidirectionally
    → Returns the proxy response as crafted TCP/IP packets back to the TUN fd
```

Every app's traffic is captured — no cooperation from the app is needed.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Android Device                                                │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │  App A   │  │  App B   │  │  App C   │                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       │              │              │                           │
│       └──────────────┴──────────────┘                          │
│                       │                                        │
│              Android TCP/IP Stack                              │
│                       │                                        │
│              TUN interface (10.10.0.2/32)                      │
│                       │  raw IPv4 packets                      │
│              ┌────────▼────────┐                               │
│              │   tun2socks     │  (subprocess in filesDir)     │
│              │   (userspace    │                               │
│              │  TCP/IP stack)  │                               │
│              └────────┬────────┘                               │
│                       │  SOCKS5 CONNECT per flow               │
│              ┌────────▼────────┐                               │
│              │ ProxyVpnService │  (our Android VPN service)    │
│              │  (routes only   │                               │
│              │  proxy traffic  │                               │
│              │  outside VPN)   │                               │
│              └────────┬────────┘                               │
│                       │                                        │
└───────────────────────┼────────────────────────────────────────┘
                        │  TCP connection to proxy server
                 ┌──────▼──────┐
                 │ SOCKS5/HTTP │
                 │ Proxy Server│
                 └─────────────┘
```

---

## Step 1 — Build the tun2socks binary

We use **github.com/xjasonlyu/tun2socks** — production-grade, actively maintained,
supports `--tun-fd` to inherit an existing TUN file descriptor.

### Requirements
- Go 1.21+  →  https://go.dev/dl/
- Android NDK 26+  →  install via Android Studio → SDK Manager → NDK (Side by side)

### Run the build script
```bash
# From the proxy-client directory
chmod +x scripts/build-tun2socks.sh

# (Adjust ANDROID_NDK_HOME if needed)
ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/26.1.10909125 \
  ./scripts/build-tun2socks.sh
```

This builds four binaries and places them into
`android/app/src/main/assets/`:

```
assets/
  tun2socks-arm64-v8a      ← most modern Android phones
  tun2socks-armeabi-v7a    ← older 32-bit ARM phones
  tun2socks-x86_64         ← emulators / some Chromebooks
  tun2socks-x86            ← old emulators
```

**Run this BEFORE `expo prebuild`** so the assets are present in the project when
Gradle bundles the APK.

---

## Step 2 — Generate the native Android project

```bash
npx expo prebuild --platform android --clean
```

The `withProxyVpn` config plugin:
- Copies `ProxyVpnService.kt`, `ProxyVpnModule.kt`, `ProxyVpnPackage.kt`,
  and `Tun2SocksProcess.kt` into `android/app/src/main/java/com/privateproxyclient/`
- Patches `MainApplication.kt` to register `ProxyVpnPackage`
- Injects VPN permissions and `<service>` into `AndroidManifest.xml`

---

## Step 3 — Build the release APK

```bash
cd android

# Debug APK (for testing on device)
./gradlew assembleDebug

# Signed release APK
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=../release.keystore \
  -Pandroid.injected.signing.store.password=STORE_PASS \
  -Pandroid.injected.signing.key.alias=proxy-vpn \
  -Pandroid.injected.signing.key.password=KEY_PASS
```

---

## How the runtime binary selection works

`Tun2SocksProcess.installBinary()` is called in `ProxyVpnService.onCreate()`.
It reads `android.os.Build.SUPPORTED_ABIS[0]` (e.g. `arm64-v8a`) and extracts
the matching asset (`tun2socks-arm64-v8a`) to `filesDir/tun2socks`, then `chmod +x`.

`ProxyVpnService` then checks `Tun2SocksProcess.isBinaryAvailable(filesDir)`:
- **Binary present** → Mode A (full packet forwarding via tun2socks subprocess)
- **Binary absent**  → Mode B (Android HTTP proxy via `ProxyInfo`, fallback)

---

## How FD inheritance works

Android sets `FD_CLOEXEC` on most file descriptors by default, which means the fd
is closed before `exec()` runs in the child process.

`Tun2SocksProcess.makeFdInheritable()` calls:
```kotlin
Os.fcntl(fileDescriptor, OsConstants.F_SETFD, 0)
```
This clears `FD_CLOEXEC`, allowing the child process to inherit the TUN fd.
The tun2socks binary is then launched with `--tun-fd <fd>`, and Linux guarantees
the same fd number is present in the child's file descriptor table.

---

## Proxy type support

| Proxy type | tun2socks arg         | Notes                              |
|------------|----------------------|------------------------------------|
| SOCKS5     | `socks5://host:port` | Full TCP + UDP support             |
| SOCKS5 + auth | `socks5://user:pass@host:port` | URL-encoded credentials |
| HTTP CONNECT | `http://host:port` | TCP only (no UDP); widely supported |
| Shadowsocks | `ss://...`         | Requires tun2socks v2.5+ with ss plugin |

The `proxyType` field passed to `ProxyVpnModule` from JS selects between
`socks5` and `http`. Shadowsocks requires additional configuration not covered here.

---

## DNS handling

By default, tun2socks uses **direct DNS** (queries go to the DNS servers configured
on the VPN builder — `1.1.1.1` and `8.8.8.8` in our setup). These are routed through
the TUN interface and forwarded as UDP flows through the proxy.

For proxies that don't support UDP, enable **Fake DNS** in `Tun2SocksConfig`:
```kotlin
dnsMode = "fake",
fakeIpRange = "198.18.0.0/15",
```
Fake DNS returns synthetic IPs from the fake range for all DNS queries. tun2socks
intercepts TCP connections to those IPs, looks up the original domain, and does a
SOCKS5 CONNECT with the hostname instead of the IP. This works with HTTP-only proxies.

---

## Testing on device

```bash
# Install debug APK
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Watch VPN logs live
adb logcat -s ProxyVpnService Tun2SocksProcess

# Verify all traffic routes through proxy
adb shell curl -s https://api.ipify.org   # should return proxy server's IP
```

---

## Alternative: tun2proxy (Rust-based)

If you prefer a Rust-based alternative with native Android library support:

- **Project**: https://github.com/blechschmidt/tun2proxy
- Provides `libtun2proxy.so` for direct JNI integration (no subprocess needed)
- Supports SOCKS5, HTTP CONNECT, Shadowsocks
- Android library integration: follow the README's Kotlin example

To integrate `tun2proxy` instead:
1. Add `tun2proxy` as a Gradle dependency or build `.so` with Android NDK
2. Replace `Tun2SocksProcess` calls with JNI calls to `libtun2proxy.so`
3. Pass the TUN fd directly via JNI (no fd inheritance needed)

---

## Alternative: Outline SDK (Google-maintained)

The **Outline SDK** (`github.com/Jigsaw-Code/outline-sdk`) provides a high-level
Android VPN tunnel with SOCKS5 support, maintained by Google's Jigsaw team.
It's the same stack that powers the Outline VPN client.

- Integrates as an Android AAR library
- Manages the TUN interface internally
- Kotlin-friendly API

---

## Production checklist

- [ ] tun2socks binaries built for all 4 ABIs and placed in `assets/`
- [ ] Release keystore created and stored safely (never commit to git)
- [ ] APK signed with release keystore
- [ ] `adb logcat` confirms tun2socks mode activates on device
- [ ] `curl https://api.ipify.org` returns proxy server's IP
- [ ] Privacy policy URL added to Play Store listing (required for VPN apps)
- [ ] Content rating set to appropriate category
- [ ] `versionCode` incremented in `app.json` for each Play Store upload
