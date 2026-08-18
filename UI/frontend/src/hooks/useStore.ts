import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { FormStore } from "@store/interface.js";
import { createStore } from "@store/index.js";

const StoreContext = createContext<FormStore | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createStore(), []);
  return createElement(StoreContext.Provider, { value: store }, children);
}

export function useStore(): FormStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within StoreProvider");
  return store;
}
