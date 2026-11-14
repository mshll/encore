import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "encore-theme";
const DARK_BG = "#0b0b0b";
const LIGHT_BG = "#ffffff";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch (error) {
    console.warn("Theme preference unavailable", error);
    return "system";
  }
}

let current = readPref();

function apply() {
  const dark = current === "dark" || (current === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = current === "system" ? (meta.media.includes("dark") ? DARK_BG : LIGHT_BG) : dark ? DARK_BG : LIGHT_BG;
  });
}

media.addEventListener("change", () => {
  if (current === "system") apply();
});

export function setTheme(pref: ThemePref) {
  current = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch (error) {
    console.warn("Theme preference not saved", error);
  }
  apply();
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = () => [useSyncExternalStore(subscribe, () => current), setTheme] as const;
