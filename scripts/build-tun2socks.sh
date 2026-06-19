#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-tun2socks.sh
#
# Builds the tun2socks binary for Android from github.com/xjasonlyu/tun2socks.
# Outputs one binary per ABI into artifacts/proxy-client/android/app/src/main/assets/
#
# Prerequisites:
#   - Go 1.21+     https://go.dev/dl/
#   - Android NDK  (download via Android Studio → SDK Manager → NDK)
#   - Set ANDROID_NDK_HOME below
#
# Usage:
#   chmod +x scripts/build-tun2socks.sh
#   ./scripts/build-tun2socks.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

TUN2SOCKS_VERSION="v2.5.2"
TUN2SOCKS_PKG="github.com/xjasonlyu/tun2socks/v2"
MIN_API=26

# Adjust this to your NDK location
ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/26.1.10909125}"

# Output directory (inside the Android project assets folder)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$REPO_ROOT/android/app/src/main/assets"

# ── Validate environment ──────────────────────────────────────────────────────

if ! command -v go &>/dev/null; then
    echo "❌  Go not found. Install from https://go.dev/dl/"
    exit 1
fi

if [[ ! -d "$ANDROID_NDK_HOME" ]]; then
    echo "❌  Android NDK not found at: $ANDROID_NDK_HOME"
    echo "    Set ANDROID_NDK_HOME or install NDK via Android Studio SDK Manager."
    exit 1
fi

echo "✅  Go:  $(go version)"
echo "✅  NDK: $ANDROID_NDK_HOME"

# ── Detect NDK toolchain host ─────────────────────────────────────────────────

if [[ "$OSTYPE" == "darwin"* ]]; then
    NDK_HOST="darwin-x86_64"
    [[ "$(uname -m)" == "arm64" ]] && NDK_HOST="darwin-x86_64"  # NDK ships x86_64 only
elif [[ "$OSTYPE" == "linux"* ]]; then
    NDK_HOST="linux-x86_64"
else
    echo "❌  Unsupported host OS: $OSTYPE (use macOS or Linux)"
    exit 1
fi

TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$NDK_HOST/bin"

# ── Fetch tun2socks source ────────────────────────────────────────────────────

TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo ""
echo "📦  Fetching tun2socks $TUN2SOCKS_VERSION …"
cd "$TMP_DIR"
go mod init build_tun2socks
go get "$TUN2SOCKS_PKG@$TUN2SOCKS_VERSION"

mkdir -p "$ASSETS_DIR"

# ── Build function ────────────────────────────────────────────────────────────

build_abi() {
    local GOARCH=$1
    local ABI=$2
    local CC_BINARY=$3

    echo ""
    echo "🔨  Building tun2socks-$ABI (GOARCH=$GOARCH) …"

    CGO_ENABLED=1 \
    GOOS=android \
    GOARCH="$GOARCH" \
    CC="$TOOLCHAIN/$CC_BINARY" \
    go build \
        -ldflags="-s -w" \
        -trimpath \
        -o "$ASSETS_DIR/tun2socks-$ABI" \
        "$TUN2SOCKS_PKG"

    local size
    size=$(du -sh "$ASSETS_DIR/tun2socks-$ABI" | cut -f1)
    echo "   ✅  $ASSETS_DIR/tun2socks-$ABI  ($size)"
}

# ── Build for each ABI ───────────────────────────────────────────────────────
#
# Map:  Android ABI          GOARCH    NDK clang binary
# ─────────────────────────────────────────────────────

build_abi "arm64"   "arm64-v8a"    "aarch64-linux-android${MIN_API}-clang"
build_abi "arm"     "armeabi-v7a"  "armv7a-linux-androideabi${MIN_API}-clang"
build_abi "amd64"   "x86_64"       "x86_64-linux-android${MIN_API}-clang"
build_abi "386"     "x86"          "i686-linux-android${MIN_API}-clang"

echo ""
echo "🎉  Done! Binaries written to:"
ls -lh "$ASSETS_DIR"/tun2socks-*
echo ""
echo "Next steps:"
echo "  1.  npx expo prebuild --platform android --clean"
echo "  2.  cd android && ./gradlew assembleRelease"
echo ""
echo "The withProxyVpn config plugin will copy these assets into the APK."
echo "ProxyVpnService will select the correct ABI binary at runtime."
