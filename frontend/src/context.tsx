import { createContext, useContext } from "react";
import type { Bootstrap } from "./types";

export interface ShellContextValue {
  namespace: string;
  setNamespace: (value: string) => void;
  bootstrap: Bootstrap;
  dark: boolean;
  setDark: (value: boolean) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell() {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("ShellContext is not available");
  }
  return value;
}
