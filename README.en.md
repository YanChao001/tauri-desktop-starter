# Tauri Desktop Starter

[中文](./README.md) · [Live demo](https://yanchao001.github.io/tauri-desktop-starter/) · [Documentation](./docs/README.md) · [Releases](https://github.com/YanChao001/tauri-desktop-starter/releases) · [Code signing policy](./docs/code-signing-policy.md)

An open source Tauri 2, React 19 and TypeScript desktop starter with a complete example application, including a Wasm extension host and marketplace. **Minimal mode changes visibility; it does not remove code, dependencies or permissions.** Derived projects must manually remove modules outside their product scope; see the [module removal guide](./docs/demo-modules.md#实际裁剪模块).

Explore SQLite, drafts and recovery; file editing and Rust scan / SHA-256 jobs; desktop integration; Wasm extensions; and data, form and media labs. Browser previews share the React source; native storage and system features require the desktop app.

## Desktop windows

Captured from an isolated Windows desktop build; see the [screenshot workflow](./docs/testing.md#readme-原生截图更新).

| Light                                                    | Dark                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| ![Light desktop window](./docs/assets/preview-light.png) | ![Dark desktop window](./docs/assets/preview-dark.png) |

[View the Windows skin gallery](./docs/assets/skins-dark.png).

## Quick start

Use the versions in [`.nvmrc`](./.nvmrc), [`package.json`](./package.json) and [`rust-toolchain.toml`](./rust-toolchain.toml). Install your platform prerequisites from the [development guide](./docs/development.md#环境要求).

```sh
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

For a browser preview, run `pnpm dev` and open `http://localhost:1420`. To check the production browser build:

```sh
pnpm exec playwright install --only-shell chromium
pnpm test:ui
```

`pnpm verify` checks the frontend and scripts. Generated bindings, Rust, browser and native desktop checks are covered separately in the [testing guide](./docs/testing.md). `pnpm app:build` produces installers and `pnpm app:portable` a Windows executable distribution under `artifacts/<version>/<target-triple>/`. Portable builds use the current user's data directories and require WebView2; see [build and release](./docs/build-release.md).

## Make it yours

Use `pnpm init:project --config ../my-app.json --dry-run`, review the changes, then repeat without `--dry-run`. Initialization synchronizes branding, URL schemes, file associations and browser storage isolation. Run `pnpm config:check` to detect configuration drift. Configure your own icons, security contact, signing and update keys; see the [initialization guide](./docs/development.md#项目初始化).

The [module guide](./docs/demo-modules.md) covers workflows, adding a page and Rust IPC, and removing modules. Extension installation, host compatibility and plugin development are covered in the [extension guide](./docs/extensions.md).

Check the [signing policy](./docs/code-signing-policy.md) for distribution trust and verification. The Chinese documentation is the detailed engineering reference.
