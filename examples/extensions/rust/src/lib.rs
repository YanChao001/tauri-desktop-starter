use extism_pdk::*;

#[plugin_fn]
pub fn uppercase(input: String) -> FnResult<String> {
    Ok(input.to_uppercase())
}

#[plugin_fn]
pub fn lowercase(input: String) -> FnResult<String> {
    Ok(input.to_lowercase())
}
