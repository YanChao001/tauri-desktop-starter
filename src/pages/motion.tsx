import { Navigate, useLocation } from "react-router-dom";

export default function Motion() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("stage", "motion");
  return (
    <Navigate
      to={{ pathname: "/components", search: `?${params.toString()}`, hash }}
      replace
    />
  );
}
