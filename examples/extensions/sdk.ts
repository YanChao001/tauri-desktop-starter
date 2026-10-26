export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Permission =
  "text:read" | "files:read" | "network:https" | "network:local" | "storage";
export type HostError = { code: string; message: string; retryable: boolean };
export type HostData = {
  apiVersion: 2;
  inputText: string;
  files: {
    name: string;
    content: string;
    encoding: "utf8" | "base64";
    mediaType: string;
  }[];
  network: { url: string; status: number; body: string }[];
};
export type ViewRequest = {
  version: 2;
  action: string | null;
  state: string;
  fields: Record<string, string>;
  locale: "zh-CN" | "en";
  host?: {
    permissions: Permission[];
    storage?: { revision: number; values: Record<string, JsonValue> };
  };
  results?: { id: string; value: JsonValue; error: HostError | null }[];
  data?: Omit<HostData, "apiVersion">;
};
export type ViewField = {
  id: string;
  label: string;
  value: string;
  kind?: "text" | "textarea" | "number" | "select" | "checkbox" | "date";
  options?: { value: string; label: string }[];
  maxBytes?: number;
};
export type ViewAction = {
  id: string;
  label: string;
  disabled: boolean;
  primary: boolean;
  ariaLabel?: string;
};
export type ViewGroup = {
  columns: number;
  actions: ViewAction[];
  board?: boolean;
};
export type ViewBlock =
  | { kind: "markdown"; text: string }
  | { kind: "metrics"; items: { label: string; value: string }[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | {
      kind: "chart";
      chartType: "bar" | "line";
      label: string;
      labels: string[];
      series: { label: string; values: number[] }[];
    }
  | { kind: "progress"; label: string; value: number; max: number }
  | { kind: "image"; src: string; alt: string };
export type HttpRequest = {
  url: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  credential?: string;
};
export type HostEffect =
  | { kind: "http"; id: string; request: HttpRequest }
  | {
      kind: "storage";
      id: string;
      expectedRevision: number;
      changes: Record<string, JsonValue>;
    };
export type Artifact = {
  name: string;
  mediaType: string;
  content: string;
  encoding: "utf8" | "base64";
};
export type View = {
  version: 2;
  state: string;
  display: string;
  description: string;
  fields: ViewField[];
  groups: ViewGroup[];
  tabs: { id: string; label: string; active: boolean }[];
  blocks: ViewBlock[];
  errors: Record<string, string>;
  effects: HostEffect[];
  artifacts: Artifact[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 宿主负责完整边界校验；这里提前指出常见的开发输入错误。 */
export function readViewRequest(raw: string): ViewRequest {
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    value.version !== 2 ||
    typeof value.state !== "string" ||
    (value.action !== null && typeof value.action !== "string") ||
    !record(value.fields) ||
    !Object.values(value.fields).every((item) => typeof item === "string") ||
    !["zh-CN", "en"].includes(String(value.locale))
  )
    throw new Error("Expected an API 2 view request");
  return value as ViewRequest;
}

export function readHostData(raw: string): HostData {
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    value.apiVersion !== 2 ||
    typeof value.inputText !== "string" ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.network)
  )
    throw new Error("Expected API 2 host data");
  return value as HostData;
}

/** 状态解码由插件定义，初次调用的空状态使用初始值。 */
export function stateOf<T>(
  request: ViewRequest,
  initial: T,
  decode: (value: unknown) => T,
): T {
  return request.state ? decode(JSON.parse(request.state)) : initial;
}

export function view(
  state: JsonValue,
  content: Partial<Omit<View, "version" | "state">> = {},
): View {
  return {
    version: 2,
    state: JSON.stringify(state),
    display: "",
    description: "",
    fields: [],
    groups: [],
    tabs: [],
    blocks: [],
    errors: {},
    effects: [],
    artifacts: [],
    ...content,
  };
}
export function field(
  id: string,
  label: string,
  value: string,
  options: Omit<ViewField, "id" | "label" | "value"> = {},
): ViewField {
  return { id, label, value, ...options };
}
export function action(
  id: string,
  label: string,
  options: Partial<Omit<ViewAction, "id" | "label">> = {},
): ViewAction {
  return { id, label, disabled: false, primary: false, ...options };
}
export function group(...actions: ViewAction[]): ViewGroup {
  return { columns: Math.min(4, Math.max(1, actions.length)), actions };
}
export function markdown(text: string): ViewBlock {
  return { kind: "markdown", text };
}
export function http(id: string, request: HttpRequest): HostEffect {
  return { kind: "http", id, request };
}
/** null 删除该键；revision 冲突通过 host-result 回投，插件决定如何提示或合并。 */
export function storage(
  id: string,
  expectedRevision: number,
  changes: Record<string, JsonValue>,
): HostEffect {
  return { kind: "storage", id, expectedRevision, changes };
}
export function textArtifact(
  name: string,
  content: string,
  mediaType = "text/plain",
): Artifact {
  return { name, content, mediaType, encoding: "utf8" };
}
