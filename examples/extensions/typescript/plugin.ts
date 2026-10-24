function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarize() {
  const request: unknown = JSON.parse(Host.inputString());
  if (
    !record(request) ||
    request.apiVersion !== 1 ||
    typeof request.inputText !== "string" ||
    !Array.isArray(request.files) ||
    !Array.isArray(request.network)
  ) {
    throw new Error("Expected host input API 1");
  }
  const files = request.files.map((file: unknown) => {
    if (
      !record(file) ||
      typeof file.name !== "string" ||
      typeof file.content !== "string"
    )
      throw new Error("Invalid file");
    return { name: file.name, characters: Array.from(file.content).length };
  });
  Host.outputString(
    JSON.stringify({
      text: request.inputText.toUpperCase(),
      characters: Array.from(request.inputText).length,
      words: request.inputText.trim().split(/\s+/u).filter(Boolean).length,
      files,
      networkResponses: request.network.length,
    }),
  );
}
