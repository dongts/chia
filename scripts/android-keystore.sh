#!/usr/bin/env bash
# One-time: create the release signing keystore for the Chia Android app.
# Keep the resulting file and password safe — Play Store updates must be signed
# with the same key. Nothing here is written into the repo.
#
#   CHIA_ANDROID_KEYSTORE_PASSWORD=... scripts/android-keystore.sh [path]
set -euo pipefail
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdk}"
KEYSTORE="${1:-$HOME/.chia/chia-release.jks}"
: "${CHIA_ANDROID_KEYSTORE_PASSWORD:?Set CHIA_ANDROID_KEYSTORE_PASSWORD}"
mkdir -p "$(dirname "$KEYSTORE")"
"$JAVA_HOME/bin/keytool" -genkeypair -v \
  -keystore "$KEYSTORE" -alias "${CHIA_ANDROID_KEY_ALIAS:-chia}" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$CHIA_ANDROID_KEYSTORE_PASSWORD" -keypass "$CHIA_ANDROID_KEYSTORE_PASSWORD" \
  -dname "CN=Chia, O=Chia, C=VN"
echo "Keystore written to $KEYSTORE"
echo "export CHIA_ANDROID_KEYSTORE=$KEYSTORE"
