#!/usr/bin/env bash
# Build the debug APK and push it to Firebase App Distribution testers.
#
#   scripts/distribute-android.sh ["release notes"]
#
# Requires a one-time `firebase login` (or GOOGLE_APPLICATION_CREDENTIALS /
# FIREBASE_TOKEN in CI) and the Firebase Android app id:
#   CHIA_FIREBASE_APP_ID   e.g. 1:384755803003:android:xxxxxxxxxxxx
#   CHIA_FIREBASE_TESTERS  comma-separated emails (optional; defaults to the
#                          "testers" group in the console)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${CHIA_FIREBASE_PROJECT:-chia-ab0bf}"
APP_ID="${CHIA_FIREBASE_APP_ID:-1:384755803003:android:d85187e648de278cc6d3de}"

NOTES="${1:-$(git -C "$ROOT" log -1 --pretty='%h %s')}"

"$ROOT/scripts/build-android.sh" debug
APK="$ROOT/frontend/android/app/build/outputs/apk/debug/app-debug.apk"

ARGS=(--app "$APP_ID" --project "$PROJECT" --release-notes "$NOTES")
if [[ -n "${CHIA_FIREBASE_TESTERS:-}" ]]; then
  ARGS+=(--testers "$CHIA_FIREBASE_TESTERS")
else
  ARGS+=(--groups testers)
fi

firebase appdistribution:distribute "$APK" "${ARGS[@]}"
