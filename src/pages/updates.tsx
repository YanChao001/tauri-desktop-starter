import { Navigate, useLocation } from "react-router-dom";

/** 兼容旧导航、工作区与深链；更新功能统一位于设置。 */
export default function Updates() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("section", "updates");
  return <Navigate to={`/settings?${params.toString()}`} replace />;
}
