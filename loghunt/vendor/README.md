# Vendored dependencies

Everything the page runs is served from this repository. The hub's Content-Security-Policy allows
scripts from `'self'` only, and pinning the bytes here means a compromised CDN or registry cannot
change what learners run. `manifest.json` holds the SHA-256 of every file as committed;
`tests/vendor.test.mjs` fails if any of them changes.

## v86 0.5.470 (BSD-2-Clause, `v86/LICENSE`)

- **Files:** `libv86.mjs`, `v86.wasm` (from `build/` in the npm tarball)
- **Source:** https://registry.npmjs.org/v86/-/v86-0.5.470.tgz
- **Tarball integrity (matches the registry):** `sha512-xDQa41SQ0NepVVni1BjZXS/4mf/4G8p4B7etweWGc0NGxYEcyXrBRpRHnMTrSn8UJCRLWLug6R3YNQWVsZDFYQ==`
- **Local change:** none. Upstream SHA-256 equals the manifest value.
- `v86-fallback.wasm` is not vendored. v86 fetches it only when `v86.wasm` fails to instantiate (an engine
  missing a WebAssembly feature the main build uses). Such browsers get the page's load-error message instead.
  Verified working without it: Chrome on macOS, 2026-10-20.

## SeaBIOS + VGA BIOS (from the v86 repository; SeaBIOS is LGPLv3)

- **Files:** `v86/seabios.bin`, `v86/vgabios.bin`
- **Source:** https://github.com/copy/v86/tree/6db8b157974dbaf1b54d2c2ec12dd71ddc1891e9/bios
  (the last commit before the 0.5.470 release on 2026-10-04; the BIOS files themselves last changed 2026-08-27)
- **Local change:** none.

## xterm.js 6.0.0 + addon-fit 0.11.0 (MIT, `xterm/LICENSE-*`)

- **Files:** `xterm.mjs`, `xterm.css`, `addon-fit.mjs`
- **Source:** https://registry.npmjs.org/@xterm/xterm/-/xterm-6.0.0.tgz,
  https://registry.npmjs.org/@xterm/addon-fit/-/addon-fit-0.11.0.tgz
- **Tarball integrity:** xterm `sha512-TQwDdQGtwwDt+2cgKDLn0IRaSxYu1tSUjgKarSDkUM0ZNiSRXFpjxEsvc/Zgc5kq5omJ+V0a8/kIM2WD3sMOYg==`,
  addon-fit `sha512-jYcgT6xtVYhnhgxh3QgYDnnNMYTcf8ElbxxFzX0IZo+vabQqSPAjC3c1wJrKB5E19VwQei89QCiZZP86DCPF7g==`
- **Upstream SHA-256 before the local change:** xterm.mjs `b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59`,
  addon-fit.mjs `2d87e1bddc73be9111de8beee5370c3bb7aac9c94e18e6f245f02ca741ef1769`
- **Local change:** the trailing `//# sourceMappingURL=` comment is removed from both `.mjs` files. Nothing else.

## v86 image tools (BSD-2-Clause, build-time only, never served to learners)

- **Files:** `../tools/v86/fs2json.py`, `../tools/v86/copy-to-sha256.py`
- **Source:** https://github.com/copy/v86/tree/6db8b157974dbaf1b54d2c2ec12dd71ddc1891e9/tools
- **Local change:** none.

## Upgrading

1. `npm pack <pkg>@<version>` and compare `openssl dgst -sha512 -binary <tgz> | base64` with `npm view <pkg>@<version> dist.integrity`.
2. Copy the files, strip source-map comments, update `manifest.json` and this file.
3. A v86 upgrade invalidates `image/state.bin.zst`: rerun `tools/make-snapshot.mjs`, then the selftest.
