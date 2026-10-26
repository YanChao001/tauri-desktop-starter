//! Complete application logic lives in Wasm; the host only renders the view protocol.
#![cfg(any(target_arch = "wasm32", test))]

mod app;
mod data;
mod tasks;
mod text;
mod view;

#[cfg(target_arch = "wasm32")]
use extism_pdk::*;

#[cfg(target_arch = "wasm32")]
#[plugin_fn]
pub fn lab(input: String) -> FnResult<String> {
    app::handle(&input).map_err(|error| Error::msg(error).into())
}
