import assert from "node:assert/strict";
import { invoke, ready } from "../helpers.mjs";
import { captureReadmePreviews } from "../readme-previews.mjs";

describe("README 原生截图", () => {
  it("captures the light and dark showroom and the skin gallery", async () => {
    await ready();
    const geometry = await invoke("get_window_geometry");
    assert.equal(geometry.ok, true);
    await captureReadmePreviews(geometry.value);
  });
});
