// Theme management — light (default) / dark toggle
export type Theme = "light" | "dark";

const KEY = "form_theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "light";
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function toggleTheme(): Theme {
  const next = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}

// Initialize on load
applyTheme(getTheme());
