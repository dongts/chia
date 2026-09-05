#!/usr/bin/env bash
# Build the Chia Android APK.
#
#   scripts/build-android.sh            # debug APK (installable, unsigned-for-store)
#   scripts/build-android.sh release    # signed release APK (needs CHIA_ANDROID_* env)
#
# Toolchain defaults match docs/android.md: JDK 21 in ~/.local/jdk and the
# Android SDK in ~/android-sdk. Override with JAVA_HOME / ANDROID_HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdk}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

VARIANT="${1:-debug}"
case "$VARIANT" in
  debug)   TASK=assembleDebug ;;
  release)
    TASK=assembleRelease
    : "${CHIA_ANDROID_KEYSTORE:?Set CHIA_ANDROID_KEYSTORE (path to .jks) for release builds}"
    : "${CHIA_ANDROID_KEYSTORE_PASSWORD:?Set CHIA_ANDROID_KEYSTORE_PASSWORD for release builds}"
    ;;
  *) echo "usage: $0 [debug|release]" >&2; exit 2 ;;
esac

cd "$ROOT/frontend"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
npm run android:sync
(cd android && ./gradlew "$TASK" -q)

APK="$ROOT/frontend/android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
echo
echo "APK: $APK"
