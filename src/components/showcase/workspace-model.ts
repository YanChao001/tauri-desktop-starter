export type SampleAsset = {
  id: string;
  name: string;
  content: string;
  kind: "document" | "source" | "data";
  folder: "design" | "code";
};

export function reorderAssets(
  assets: readonly SampleAsset[],
  id: string,
  target: string,
): readonly SampleAsset[] {
  const item = assets.find((asset) => asset.id === id);
  const destination = assets.find((asset) => asset.id === target);
  if (!item || !destination || id === target) return assets;
  const next = assets.filter((asset) => asset.id !== id);
  next.splice(
    next.findIndex((asset) => asset.id === target),
    0,
    { ...item, folder: destination.folder },
  );
  return next;
}

type WorkspaceState = {
  assets: readonly SampleAsset[];
  previous: readonly SampleAsset[] | null;
};
type WorkspaceAction =
  | { type: "change"; assets: readonly SampleAsset[] }
  | { type: "undo" }
  | { type: "reset"; assets: readonly SampleAsset[] };
export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "undo")
    return state.previous ? { assets: state.previous, previous: null } : state;
  if (action.type === "reset")
    return { assets: action.assets, previous: state.assets };
  return action.assets === state.assets
    ? state
    : { assets: action.assets, previous: state.assets };
}
