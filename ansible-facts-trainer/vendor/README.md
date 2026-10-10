# Vendored dependencies

## js-yaml 4.3.2

- **File:** `js-yaml.mjs` (the package's `dist/js-yaml.mjs`, ES module build)
- **Source:** https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz
- **Licence:** MIT (see `LICENSE-js-yaml`)
- **SHA-256 of the upstream file:** `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`
- **Local change:** the trailing `//# sourceMappingURL=` comment is removed. Nothing else.

Why vendored: the hub's Content-Security-Policy is `script-src 'self'`, so nothing
may load from a content delivery network.

To upgrade: `npm pack js-yaml@<version>`, extract `package/dist/js-yaml.mjs`, record
the new checksum here, remove the source-map comment, and run
`node --test 'ansible-facts-trainer/tests/*.test.mjs'`.
