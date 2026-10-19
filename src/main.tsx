import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/App";
import { ErrorBoundary } from "@/components/error-boundary";

import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点，检查 index.html");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
