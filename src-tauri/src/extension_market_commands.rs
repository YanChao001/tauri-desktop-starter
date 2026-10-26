use crate::{
    error::NativeResult,
    extension_market::{ExtensionMarket, MarketDownload, MarketSnapshot},
};
use tauri::Manager;

#[tauri::command]
#[specta::specta]
pub async fn extension_market_snapshot(
    app: tauri::AppHandle,
    refresh: bool,
) -> NativeResult<MarketSnapshot> {
    app.state::<ExtensionMarket>().snapshot(refresh).await
}
#[tauri::command]
#[specta::specta]
pub async fn download_market_extension(
    app: tauri::AppHandle,
    id: String,
    expected_package_sha256: String,
) -> NativeResult<MarketDownload> {
    app.state::<ExtensionMarket>()
        .download(&id, &expected_package_sha256)
        .await
}
