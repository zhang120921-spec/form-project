import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useStore } from "@/hooks/useStore";
import type { UserProfile } from "@store/interface.js";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
    homeClub?: string,
    sgaHandicap?: number,
    consent?: boolean
  ) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  requestPasswordReset: (email: string) => Promise<{ token?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  updateProfile: (data: Partial<Pick<UserProfile, "displayName" | "homeClub" | "region" | "sgaHandicap" | "isPublic">>) => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  // Check existing session on mount
  useEffect(() => {
    store
      .getSession()
      .then((user) => setState({ user, loading: false, error: null }))
      .catch(() => setState({ user: null, loading: false, error: null }));
  }, [store]);

  const login = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { user } = await store.login(email, password);
        setState({ user, loading: false, error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Login failed";
        setState((s) => ({ ...s, loading: false, error: msg }));
        throw e;
      }
    },
    [store]
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      homeClub?: string,
      sgaHandicap?: number,
      consent = true
    ) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const user = await store.register(email, password, displayName, homeClub, sgaHandicap, consent);
        setState({ user, loading: false, error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Registration failed";
        setState((s) => ({ ...s, loading: false, error: msg }));
        throw e;
      }
    },
    [store]
  );

  const logout = useCallback(() => {
    store.logout().catch(() => {});
    setState({ user: null, loading: false, error: null });
  }, [store]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const requestPasswordReset = useCallback(
    async (email: string) => {
      return store.requestPasswordReset(email);
    },
    [store]
  );

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      await store.resetPassword(token, newPassword);
    },
    [store]
  );

  const updateProfile = useCallback(
    async (data: Partial<Pick<UserProfile, "displayName" | "homeClub" | "region" | "sgaHandicap" | "isPublic">>) => {
      const updated = await store.updateProfile(data);
      setState((s) => ({ ...s, user: updated }));
      return updated;
    },
    [store]
  );

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, clearError, requestPasswordReset, resetPassword, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
