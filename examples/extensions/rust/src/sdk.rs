//! 插件只接收宿主明确交付的数据，不读取宿主目录或环境变量。
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostData {
    pub api_version: u32,
    pub input_text: String,
    pub files: Vec<HostFile>,
    pub network: Vec<NetworkResponse>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFile {
    pub name: String,
    pub content: String,
    pub encoding: String,
    pub media_type: String,
}

#[derive(Deserialize)]
pub struct NetworkResponse {
    pub url: String,
    pub status: u16,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub characters: usize,
    pub words: usize,
    pub files: Vec<FileSummary>,
    pub responses: Vec<ResponseSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub name: String,
    pub encoding: String,
    pub media_type: String,
    pub characters: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSummary {
    pub url: String,
    pub status: u16,
    pub body_bytes: usize,
}
