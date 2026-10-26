import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Placement = "navigation" | "titlebar";
type Target = {
  owner: symbol;
  scope: string;
  node: HTMLDivElement;
  placement: Placement;
};
type ChromeSlot = {
  scope: string;
  target: Target | null;
  attach: (
    owner: symbol,
    scope: string,
    placement: Placement,
    node: HTMLDivElement | null,
  ) => void;
};
const Context = createContext<ChromeSlot | null>(null);

/** Only the DOM destination crosses the layout boundary; actions stay owned by the session. */
export function ExtensionChromeProvider({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const attach = useCallback<ChromeSlot["attach"]>(
    (owner, destinationScope, placement, node) => {
      setTarget((current) => {
        if (!node)
          return current?.owner === owner &&
            current.scope === destinationScope &&
            current.placement === placement
            ? null
            : current;
        if (
          current?.owner === owner &&
          current.node === node &&
          current.scope === destinationScope &&
          current.placement === placement
        )
          return current;
        return { owner, scope: destinationScope, placement, node };
      });
    },
    [],
  );
  const value = useMemo(
    () => ({ scope, attach, target: target?.scope === scope ? target : null }),
    [scope, attach, target],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function ExtensionChromeSlot({
  placement,
  className,
}: {
  placement: Placement;
  className?: string;
}) {
  const ref = useExtensionChromeRef(placement);
  return (
    <div ref={ref} data-extension-chrome={placement} className={className} />
  );
}

export function useExtensionChromeRef(placement: Placement) {
  const context = useContext(Context);
  const owner = useRef(Symbol("extension-chrome-slot"));
  const attach = context?.attach;
  const scope = context?.scope ?? "";
  return useCallback(
    (node: HTMLDivElement | null) =>
      attach?.(owner.current, scope, placement, node),
    [attach, scope, placement],
  );
}

export function useExtensionChromeTarget() {
  return useContext(Context)?.target ?? null;
}
