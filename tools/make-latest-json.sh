#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="AsmekYT/ASMacro"

VERSION="${1:-}"
NOTES_FILE="${2:-}"
if [ -z "$VERSION" ]; then
  echo "użycie: $0 <wersja> [plik-z-notatkami]" >&2
  exit 2
fi
TAG="v$VERSION"
OUT_DIR="$ROOT/dist-release"
mkdir -p "$OUT_DIR"

NOTES=""
if [ -n "$NOTES_FILE" ]; then
  if [ ! -f "$NOTES_FILE" ]; then
    echo "make-latest-json.sh: brak pliku notatek '$NOTES_FILE'" >&2
    exit 1
  fi
  NOTES="$(cat "$NOTES_FILE")"
fi

PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

json_escape() {
  python3 - "$1" <<'PY' 2>/dev/null || node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$1"
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

find_one() {
  local dir="$1" glob="$2"
  find "$dir" -maxdepth 1 -type f -name "$glob" 2>/dev/null | sort | tail -n1
}

platforms_json=""
add_platform() {
  local key="$1" file="$2" sig_file="$3" asset_url="$4"
  if [ -z "$file" ] || [ ! -f "$sig_file" ]; then
    echo "make-latest-json.sh: pomijam $key — brak pliku lub podpisu ($file)" >&2
    return
  fi
  local sig
  sig="$(cat "$sig_file")"
  local entry
  entry="\"$key\":{\"signature\":$(json_escape "$sig"),\"url\":$(json_escape "$asset_url")}"
  if [ -z "$platforms_json" ]; then
    platforms_json="$entry"
  else
    platforms_json="$platforms_json,$entry"
  fi
}

NSIS_DIR="$ROOT/src-tauri/target/release/bundle/nsis"
win_exe="$(find_one "$NSIS_DIR" "*_${VERSION}_x64-setup.exe")"
if [ -z "$win_exe" ]; then
  win_exe="$(find_one "$NSIS_DIR" "*-setup.exe")"
fi
add_platform "windows-x86_64" "$win_exe" "${win_exe}.sig" \
  "https://github.com/$REPO/releases/download/$TAG/$(basename "${win_exe:-missing}")"

APPIMAGE_DIR="$ROOT/dist-linux/debian"
linux_appimage="$(find_one "$APPIMAGE_DIR" "*.AppImage")"
add_platform "linux-x86_64" "$linux_appimage" "${linux_appimage}.sig" \
  "https://github.com/$REPO/releases/download/$TAG/$(basename "${linux_appimage:-missing}")"

if [ -z "$platforms_json" ]; then
  echo "make-latest-json.sh: nie znalazłem żadnego podpisanego artefaktu — nic do zrobienia" >&2
  echo "  szukałem w: $NSIS_DIR" >&2
  echo "              $APPIMAGE_DIR" >&2
  exit 1
fi

cat > "$OUT_DIR/latest.json" <<EOF
{"version":$(json_escape "$VERSION"),"notes":$(json_escape "$NOTES"),"pub_date":$(json_escape "$PUB_DATE"),"platforms":{$platforms_json}}
EOF

echo "Zapisano $OUT_DIR/latest.json" >&2
echo >&2
echo "Wrzuć na GitHub Release (tag $TAG) razem z:" >&2
[ -n "$win_exe" ] && echo "  $win_exe" >&2
[ -n "$linux_appimage" ] && echo "  $linux_appimage" >&2
echo "  $OUT_DIR/latest.json" >&2
