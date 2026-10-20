#!/usr/bin/env bash
# Build the LOGHUNT guest root filesystem for v86.
#   Needs: podman (with linux/386 support), python3.14+ (stdlib compression.zstd).
#   Writes: build/fs.json + build/flat/ (full tree, gitignored, used by tools/make-snapshot.mjs).
#   Then run: node tools/make-snapshot.mjs   (boots once, saves image/state.bin.zst, publishes image/)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
build="$root/build"
work=$(mktemp -d)
trap 'rm -rf "$work"; podman rm -f loghunt-guest >/dev/null 2>&1 || true' EXIT

python=${PYTHON:-python3.14}

podman build --platform linux/386 --tag localhost/loghunt-guest:latest "$here/image"
podman rm -f loghunt-guest >/dev/null 2>&1 || true
podman create --platform linux/386 --name loghunt-guest localhost/loghunt-guest:latest >/dev/null
podman export loghunt-guest -o "$work/rootfs.tar"

rm -rf "$build"
mkdir -p "$build/flat"
"$python" "$here/v86/fs2json.py" --zstd --out "$build/fs.json" "$work/rootfs.tar"
"$python" "$here/v86/copy-to-sha256.py" --zstd "$work/rootfs.tar" "$build/flat" > /dev/null

echo "build/flat: $(find "$build/flat" -type f | wc -l | tr -d ' ') files, $(du -sh "$build/flat" | cut -f1)"
