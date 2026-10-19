import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/App";
import { ErrorBoundary } from "@/components/error-boundary";
import { applySettings, loadSettings } from "@/providers/settings";

import "./index.css";

// 在首帧之前把外观设置写到 <html>，避免主题色/字体闪一下默认值
applySettings(loadSettings());

const container = document.getElementById("root");
if (!container) {
  // 此时 ErrorBoundary 还没挂载，只能用最原始的方式把错误留在屏幕上
  document.body.textContent =
    "应用初始化失败：找不到 #root 挂载点，请检查 index.html";
  throw new Error("找不到 #root 挂载点，检查 index.html");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
