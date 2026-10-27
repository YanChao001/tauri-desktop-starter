// 此文件由 scripts/generate-extension-sdk-types.mjs 从 Rust IPC 绑定生成，请勿手改。

export type ExtensionArtifact = {
  name: string;
  mediaType: string;
  content: string;
  encoding: ExtensionArtifactEncoding;
};

export type ExtensionArtifactEncoding = "utf8" | "base64";

export type ExtensionChartSeries = {
  label: string;
  values: (number | null)[];
};

export type ExtensionChartType = "bar" | "line";

export type ExtensionEffect_Deserialize =
  | ({
      kind: "http";
      id: string;
      request: ExtensionHttpRequest_Deserialize;
    } & {
      changes?: never;
      expectedRevision?: never;
    })
  | ({
      kind: "storage";
      id: string;
      expectedRevision: number;
      changes: {
        [key in string]: JsonValue | null;
      };
    } & {
      request?: never;
    });

export type ExtensionEffect_Serialize =
  | ({
      kind: "http";
      id: string;
      request: ExtensionHttpRequest_Serialize;
    } & {
      changes?: never;
      expectedRevision?: never;
    })
  | ({
      kind: "storage";
      id: string;
      expectedRevision: number;
      changes: {
        [key in string]: JsonValue | null;
      };
    } & {
      request?: never;
    });

export type ExtensionFieldKind =
  "text" | "textarea" | "number" | "select" | "checkbox" | "date";

export type ExtensionHttpRequest_Deserialize = {
  url: string;
  method: string;
  headers?: {
    [key in string]: string;
  };
  body?: string | null;
  credential?: string | null;
  networkMode?: ExtensionNetworkMode | null;
};

export type ExtensionHttpRequest_Serialize = {
  url: string;
  method: string;
  headers: {
    [key in string]: string;
  };
  body: string | null;
  credential: string | null;
  networkMode?: ExtensionNetworkMode | null;
};

export type ExtensionNetworkMode = "direct" | "system";

export type ExtensionPermission =
  | "text:read"
  | "files:read"
  | "network:https"
  | "network:local"
  | "network:images"
  | "network:system-proxy"
  | "links:open"
  | "window:control"
  | "storage"
  | "messaging:lan"
  | "wallpapers:manage";

export type ExtensionView = ExtensionView_Serialize | ExtensionView_Deserialize;

export type ExtensionViewAction = {
  id: string;
  label: string;
  disabled: boolean;
  primary: boolean;
  ariaLabel?: string | null;
};

export type ExtensionViewBlock =
  | {
      kind: "markdown";
      text: string;
    }
  | {
      kind: "metrics";
      items: ExtensionViewMetric[];
    }
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
    }
  | {
      kind: "chart";
      chartType: ExtensionChartType;
      label: string;
      labels: string[];
      series: ExtensionChartSeries[];
    }
  | {
      kind: "progress";
      label: string;
      value: number | null;
      max: number | null;
    }
  | {
      kind: "image";
      src: string;
      alt: string;
    };

export type ExtensionViewField = {
  id: string;
  label: string;
  value: string;
  kind?: ExtensionFieldKind | null;
  options?: ExtensionViewOption[];
  maxBytes?: number | null;
};

export type ExtensionViewGroup = {
  columns: number;
  actions: ExtensionViewAction[];
  board?: boolean;
};

export type ExtensionViewMetric = {
  label: string;
  value: string;
};

export type ExtensionViewOption = {
  value: string;
  label: string;
};

export type ExtensionViewTab = {
  id: string;
  label: string;
  active: boolean;
};

export type ExtensionView_Deserialize = {
  version: number;
  state: string;
  display: string;
  description: string;
  fields: ExtensionViewField[];
  groups: ExtensionViewGroup[];
  tabs?: ExtensionViewTab[];
  blocks?: ExtensionViewBlock[];
  errors?: {
    [key in string]: string;
  };
  effects?: ExtensionEffect_Deserialize[];
  artifacts?: ExtensionArtifact[];
};

export type ExtensionView_Serialize = {
  version: number;
  state: string;
  display: string;
  description: string;
  fields: ExtensionViewField[];
  groups: ExtensionViewGroup[];
  tabs: ExtensionViewTab[];
  blocks: ExtensionViewBlock[];
  errors: {
    [key in string]: string;
  };
  effects: ExtensionEffect_Serialize[];
  artifacts: ExtensionArtifact[];
};

export type ExtensionWindowRequest =
  | {
      action: "get-state";
    }
  | {
      action: "set-always-on-top";
      enabled: boolean;
    };

export type ExtensionWindowState = {
  alwaysOnTop: boolean;
};

/**
 *  具名递归类型使 Rust 与 TypeScript 的 JSON 契约保持有限定义。
 *  serde_json::Number 保留传输过程中的整数值。
 */
export type JsonValue =
  | null
  | boolean
  | number
  | null
  | string
  | JsonValue[]
  | {
      [key in string]: JsonValue;
    };
