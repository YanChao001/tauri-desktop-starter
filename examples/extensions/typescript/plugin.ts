import {
  action,
  field,
  group,
  markdown,
  readHostData,
  readViewRequest,
  storage,
  textArtifact,
  view,
} from "../sdk";

export function summarize() {
  const request = readHostData(Host.inputString());
  Host.outputString(
    JSON.stringify({
      text: request.inputText.toUpperCase(),
      characters: Array.from(request.inputText).length,
      words: request.inputText.trim().split(/\s+/u).filter(Boolean).length,
      files: request.files.map((file) => ({
        name: file.name,
        encoding: file.encoding,
        mediaType: file.mediaType,
        characters:
          file.encoding === "utf8" ? Array.from(file.content).length : null,
      })),
      networkResponses: request.network.length,
    }),
  );
}

/** 一个可保存的便笺：网络和私有存储都是声明式 host effect，不直接调用系统 API。 */
export function notebook() {
  const request = readViewRequest(Host.inputString());
  const saved = request.host?.storage?.values.note;
  const draft =
    request.fields.draft ?? (typeof saved === "string" ? saved : "");
  const result = request.results?.find((result) => result.id === "save-note");
  const message = result
    ? result.error
      ? result.error.message
      : "Saved"
    : "Private storage and export example";
  const canSave = request.host?.permissions.includes("storage") ?? false;
  Host.outputString(
    JSON.stringify(
      view(null, {
        display: "Notebook",
        description: message,
        fields: [
          field("draft", "Note", draft, { kind: "textarea", maxBytes: 65536 }),
        ],
        groups: [
          group(
            action("save", "Save", { primary: true, disabled: !canSave }),
            action("export", "Export note"),
          ),
        ],
        blocks: [
          markdown(
            "Your note stays in this extension's private storage. Grant optional storage permission to save it.",
          ),
        ],
        effects:
          request.action === "save" && canSave
            ? [
                storage("save-note", request.host?.storage?.revision ?? 0, {
                  note: draft,
                }),
              ]
            : [],
        artifacts:
          request.action === "export"
            ? [textArtifact("note.md", draft, "text/markdown")]
            : [],
      }),
    ),
  );
}
