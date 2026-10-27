import { createContext, useContext, type ReactNode } from "react";

const Context = createContext(true);

/** 缓存的扩展页面保留文档与会话，活动状态决定是否允许新的界面操作。 */
export function ExtensionActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return <Context.Provider value={active}>{children}</Context.Provider>;
}

export function useExtensionActivity() {
  return useContext(Context);
}
