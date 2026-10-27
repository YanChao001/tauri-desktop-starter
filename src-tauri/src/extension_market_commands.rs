use crate::{
    error::NativeResult,
    extension_market::{ExtensionMarket, MarketDownload, MarketDownloadProgress, MarketSnapshot},
    storage::SettingsStore,
};
use tauri::{Manager, ipc::Channel};

#[tauri::command]
#[specta::specta]
pub async fn extension_market_snapshot(
    app: tauri::AppHandle,
    refresh: bool,
) -> NativeResult<MarketSnapshot> {
    let network_mode = app.state::<SettingsStore>().network_mode()?;
    app.state::<ExtensionMarket>()
        .snapshot(refresh, network_mode)
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn download_market_extension(
    app: tauri::AppHandle,
    id: String,
    expected_package_sha256: String,
    on_progress: Channel<MarketDownloadProgress>,
) -> NativeResult<MarketDownload> {
    let network_mode = app.state::<SettingsStore>().network_mode()?;
    app.state::<ExtensionMarket>()
        .download(&id, &expected_package_sha256, network_mode, |progress| {
            // 界面停止监听只结束反馈，不取消原生下载或跳过校验。
            let _ = on_progress.send(progress);
        })
        .await
}
