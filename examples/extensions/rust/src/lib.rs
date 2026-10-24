use extism_pdk::*;
mod sdk;
use sdk::{FileSummary, HostData, ResponseSummary, Summary};

#[plugin_fn]
pub fn uppercase(input: String) -> FnResult<String> {
    Ok(input.to_uppercase())
}

#[plugin_fn]
pub fn lowercase(input: String) -> FnResult<String> {
    Ok(input.to_lowercase())
}

#[plugin_fn]
pub fn summarize(Json(input): Json<HostData>) -> FnResult<Json<Summary>> {
    if input.api_version != 2 {
        return Err(Error::msg("Expected host data API 2").into());
    }
    Ok(Json(Summary {
        characters: input.input_text.chars().count(),
        words: input.input_text.split_whitespace().count(),
        files: input
            .files
            .into_iter()
            .map(|file| FileSummary {
                name: file.name,
                characters: (file.encoding == "utf8").then(|| file.content.chars().count()),
                encoding: file.encoding,
                media_type: file.media_type,
            })
            .collect(),
        responses: input
            .network
            .into_iter()
            .map(|response| ResponseSummary {
                url: response.url,
                status: response.status,
                body_bytes: response.body.len(),
            })
            .collect(),
    }))
}
