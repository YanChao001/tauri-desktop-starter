import { Navigate, useLocation } from "react-router-dom";

/** 保留旧工作区与原生深链；桌面偏好统一位于设置。 */
export default function Desktop() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("section", "desktop");
  return <Navigate to={`/settings?${params.toString()}`} replace />;
}
