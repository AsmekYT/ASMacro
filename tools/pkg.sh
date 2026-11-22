#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist-linux"

host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

targets_all=(fedora debian ubuntu)
bundles_for() {
  case "$1" in
    fedora) echo "rpm" ;;
    debian) echo "deb,appimage" ;;
    ubuntu) echo "deb" ;;
    *) return 1 ;;
  esac
}

targets=("$@")
if [ ${#targets[@]} -eq 0 ] || [ "${targets[0]}" = "all" ]; then
  targets=("${targets_all[@]}")
fi

for t in "${targets[@]}"; do
  if ! bundles_for "$t" >/dev/null; then
    echo "pkg.sh: nieznany cel '$t' (dostępne: ${targets_all[*]})" >&2
    exit 2
  fi
done

if ! docker version >/dev/null 2>&1; then
  echo "pkg.sh: demon Dockera nie odpowiada — uruchom Docker Desktop" >&2
  exit 1
fi

build_image() {
  local target="$1"
  local image="asmacro-build-$target"
  if [ "${PKG_REBUILD:-0}" != "1" ] && docker image inspect "$image" >/dev/null 2>&1; then
    echo "pkg.sh[$target]: obraz gotowy, pomijam" >&2
    return
  fi
  echo "pkg.sh[$target]: buduję obraz $image" >&2
  docker build \
    -f "$(host_path "$ROOT/tools/docker/$target.Dockerfile")" \
    -t "$image" \
    "$(host_path "$ROOT/tools/docker")"
}

source_tar() {
  tar -C "$ROOT" \
      --exclude-vcs \
      --exclude=node_modules \
      --exclude=target \
      --exclude=dist \
      --exclude=dist-linux \
      -cf - .
}

run_target() {
  local target="$1"
  local image="asmacro-build-$target"
  local bundles
  bundles="$(bundles_for "$target")"
  local dest="$OUT_DIR/$target"
  local cid

  build_image "$target"

  docker volume create "asmacro-cargo-$target" >/dev/null
  docker volume create "asmacro-target-$target" >/dev/null

  cid="$(docker create \
    -v "asmacro-cargo-$target:/opt/cargo/registry" \
    -v "asmacro-target-$target:/src/src-tauri/target" \
    "$image" sleep infinity)"
  trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' RETURN

  docker start "$cid" >/dev/null
  echo "pkg.sh[$target]: wysyłam źródła" >&2
  source_tar | docker cp - "$cid:/src"

  echo "pkg.sh[$target]: build ($bundles)" >&2
  docker exec \
    -e "TAURI_SIGNING_PRIVATE_KEY=${TAURI_SIGNING_PRIVATE_KEY:-}" \
    -e "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    "$cid" bash -c "cd /src && npm ci --no-audit --no-fund && npx tauri build --bundles $bundles"

  rm -rf "$dest"
  mkdir -p "$dest"
  echo "pkg.sh[$target]: pobieram artefakty" >&2
  docker exec "$cid" bash -c \
    'mkdir -p /out && find /src/src-tauri/target/release/bundle -type f \
       \( -name "*.rpm" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.sig" \) -exec cp {} /out/ \;'
  docker cp "$cid:/out/." "$(host_path "$dest")"

  docker rm -f "$cid" >/dev/null
  trap - RETURN
}

mkdir -p "$OUT_DIR"
for t in "${targets[@]}"; do
  run_target "$t"
done

echo
echo "Gotowe:"
find "$OUT_DIR" -maxdepth 2 -type f \( -name "*.rpm" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.sig" \) \
  -printf '  %p (%kB)\n' 2>/dev/null || find "$OUT_DIR" -maxdepth 2 -type f
