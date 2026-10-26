import { createContext } from "react";
import type { AppCommand, CommandInvocation } from "@/commands/types";

export type CommandsContextValue = {
  commands: AppCommand[];
  execute: (id: string, invocation?: CommandInvocation) => Promise<boolean>;
  register: (commands: readonly AppCommand[]) => () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  fullscreen: boolean;
};

export const CommandsContext = createContext<CommandsContextValue | null>(null);
