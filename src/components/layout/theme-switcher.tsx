"use client";

import { Palette } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { Select } from "@/components/ui/select";
import {
  DEFAULT_THEME,
  getThemeMode,
  isThemeId,
  themes,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "@/lib/theme-config";
import { cn } from "@/lib/utils";

const THEME_CHANGE_EVENT = "erp-suite-theme-change";

function updateDocumentTheme(themeId: ThemeId) {
  const isDark = getThemeMode(themeId) === "dark";
  const root = document.documentElement;

  root.dataset.theme = themeId;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

function applyTheme(themeId: ThemeId) {
  updateDocumentTheme(themeId);
  window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: themeId }));
}

function subscribeToTheme(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY || !isThemeId(event.newValue)) return;
    updateDocumentTheme(event.newValue);
    onStoreChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function getActiveTheme(): ThemeId {
  const activeTheme = document.documentElement.dataset.theme;
  return isThemeId(activeTheme) ? activeTheme : DEFAULT_THEME;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const themeId = useSyncExternalStore(subscribeToTheme, getActiveTheme, () => DEFAULT_THEME);

  return (
    <div className={cn("flex items-center gap-1", !compact && "w-full")}>
      <span
        aria-hidden="true"
        className="theme-preview grid size-7 shrink-0 place-items-center border border-window-dark-shadow text-chrome-active-foreground shadow-[inset_1px_1px_0_var(--window-highlight)]"
      >
        <Palette className="size-3.5" weight="bold" />
      </span>
      <Select
        aria-label="Paleta de interfaz"
        className={cn(
          "h-7 min-w-0 border-window-dark-shadow bg-window-highlight px-1.5 text-[0.65rem]",
          compact ? "w-28 xl:w-36" : "flex-1",
        )}
        data-testid="theme-switcher"
        onChange={(event) => {
          if (!isThemeId(event.target.value)) return;
          applyTheme(event.target.value);
        }}
        title="Cambiar paleta de interfaz"
        value={themeId}
      >
        <optgroup label="Paletas claras">
          {themes.filter((theme) => theme.mode === "light").map((theme) => (
            <option key={theme.id} value={theme.id}>{compact ? theme.shortLabel : theme.label}</option>
          ))}
        </optgroup>
        <optgroup label="Paletas oscuras">
          {themes.filter((theme) => theme.mode === "dark").map((theme) => (
            <option key={theme.id} value={theme.id}>{compact ? theme.shortLabel : theme.label}</option>
          ))}
        </optgroup>
      </Select>
    </div>
  );
}
