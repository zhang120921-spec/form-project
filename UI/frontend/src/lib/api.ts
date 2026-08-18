// API client — thin fetch wrapper for the FORM server
// When served by Vite dev server, /api is proxied to localhost:3001.
// When opened as a standalone file (file://), use the full URL.
const BASE = typeof window !== "undefined" && window.location.protocol === "file:"
  ? "http://localhost:3001/api"
  : "/api";

function readToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("form_token");
}

export function setToken(t: string | null) {
  if (typeof localStorage === "undefined") return;
  if (t) localStorage.setItem("form_token", t);
  else localStorage.removeItem("form_token");
}

export function getToken(): string | null {
  return readToken();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", res.status, data);
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
