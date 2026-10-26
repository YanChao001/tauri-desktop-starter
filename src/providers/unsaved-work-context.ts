import { createContext } from "react";

export type UnsavedWork = {
  id: string;
  label: string;
  dirty: boolean;
  save: (signal?: AbortSignal) => Promise<void>;
  discard: (signal?: AbortSignal) => void | Promise<void>;
};
type Registry = {
  register: (work: UnsavedWork) => void;
  unregister: (id: string) => void;
};
export const UnsavedWorkContext = createContext<Registry | null>(null);
