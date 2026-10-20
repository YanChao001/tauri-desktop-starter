# Tauri Desktop Starter

[中文](./README.md) · [Live demo](https://yanchao001.github.io/tauri-desktop-starter/) · [Documentation](./docs/README.md) · [Releases](https://github.com/YanChao001/tauri-desktop-starter/releases)

An open source Tauri 2, React 19 and TypeScript desktop starter with a complete, interactive demo. Keep the examples while exploring, then remove modules your product does not need. **Minimal mode changes visibility; it does not remove code, dependencies or permissions.**

The desktop app includes SQLite pagination, drafts, backups and recovery; a file workbench; real Rust scan / SHA-256 jobs; window lifecycle coordination; system integration; network examples; and data table, form and media labs. Browser previews share the React source and clearly distinguish local fixtures, external services and desktop-only capabilities.

## Quick start

Use the versions in [`.nvmrc`](./.nvmrc), [`package.json`](./package.json) and [`rust-toolchain.toml`](./rust-toolchain.toml). Install your platform prerequisites from the [development guide](./docs/development.md#环境要求).

```sh
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

For a browser preview, run `pnpm dev`. To test the deployed browser build:

```sh
pnpm build:web
pnpm exec playwright install --only-shell chromium
pnpm test:browser
```

`pnpm verify` checks frontend and scripts. Rust, generated bindings, browser smoke tests and desktop E2E have separate commands in the [testing guide](./docs/testing.md). `pnpm app:build` produces installers; `pnpm app:portable` produces a Windows executable distribution under `artifacts/<version>/<target>/`. Portable builds still use the current user's data directories and require WebView2.

## Make it yours

Use `pnpm init:project --config ../my-app.json --dry-run`, review the changes, then repeat without `--dry-run`. Configure your own icons, security contact, signing and update keys. Also replace the `tdemo` URL scheme and `.tdemo` file association in configuration, native parsing and examples.

The [module guide](./docs/demo-modules.md) includes hands-on workflows, a complete page → Rust IPC → test example, and concrete database / updater removal recipes. Changes span routes, commands, generated bindings, dependencies, permissions, translations and tests.

The local session demo is not remote OAuth. Signing configuration and CI support are not proof of signed releases or installation tests on every platform. Platform results and remaining limits belong in release evidence. The Chinese documentation remains the detailed engineering reference.
