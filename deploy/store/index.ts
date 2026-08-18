// Store factory — selects LocalStore or ServerStore based on environment

import type { FormStore } from "./interface.js";
import { LocalStore } from "./LocalStore.js";
import { ServerStore } from "./ServerStore.js";

export type { FormStore } from "./interface.js";
export { LocalStore } from "./LocalStore.js";
export { ServerStore } from "./ServerStore.js";
export type {
  UserProfile,
  FriendRequest,
  FriendInfo,
  Attestation,
  Course,
  Tee,
  RoundInput,
  AIAnalysis,
  RoundRecord,
  ForecastResult,
  MatchSuggestion,
} from "./interface.js";

export type StoreMode = "local" | "server";

/**
 * Determine the store mode from environment.
 * Defaults to "server" when a backend is available; opt into "local" for offline-first PWA usage.
 */
function getStoreMode(): StoreMode {
  // Check environment variable (Node)
  if (typeof process !== "undefined" && process.env?.FORM_STORE_MODE) {
    return process.env.FORM_STORE_MODE === "local" ? "local" : "server";
  }
  // Check localStorage (browser)
  if (typeof localStorage !== "undefined") {
    const mode = localStorage.getItem("form_store_mode");
    if (mode === "local") return "local";
  }
  return "server";
}

/**
 * Create a new FormStore instance.
 * In local mode, returns a LocalStore (IndexedDB).
 * In server mode, returns a ServerStore (REST client).
 */
export function createStore(options?: {
  mode?: StoreMode;
  dbName?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}): FormStore {
  const mode = options?.mode ?? getStoreMode();

  if (mode === "server") {
    return new ServerStore({
      baseUrl: options?.baseUrl,
      fetchFn: options?.fetchFn,
    });
  }

  return new LocalStore(options?.dbName);
}

// Singleton instance (lazily created)
let _store: FormStore | null = null;

/**
 * Get the singleton store instance.
 * Creates one on first call.
 */
export function getStore(): FormStore {
  if (!_store) {
    _store = createStore();
  }
  return _store;
}

/**
 * Set the store instance explicitly (useful for testing or SSR).
 */
export function setStore(store: FormStore): void {
  _store = store;
}
