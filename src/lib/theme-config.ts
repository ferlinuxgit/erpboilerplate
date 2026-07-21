export const THEME_STORAGE_KEY = "erp-suite-theme";

export const themes = [
  {
    id: "classic-light",
    label: "Windows clásico",
    shortLabel: "Clásico",
    mode: "light",
  },
  {
    id: "paper-light",
    label: "DOS papel",
    shortLabel: "Papel",
    mode: "light",
  },
  {
    id: "os2-light",
    label: "OS/2 hielo",
    shortLabel: "Hielo",
    mode: "light",
  },
  {
    id: "midnight-dark",
    label: "Windows nocturno",
    shortLabel: "Nocturno",
    mode: "dark",
  },
  {
    id: "dos-green",
    label: "CRT verde",
    shortLabel: "CRT verde",
    mode: "dark",
  },
  {
    id: "amber-dark",
    label: "Terminal ámbar",
    shortLabel: "Ámbar",
    mode: "dark",
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export type ThemeMode = (typeof themes)[number]["mode"];

export const DEFAULT_THEME: ThemeId = "classic-light";
export const themeIds = themes.map((theme) => theme.id) as ThemeId[];
export const darkThemeIds = themes.filter((theme) => theme.mode === "dark").map((theme) => theme.id) as ThemeId[];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.includes(value as ThemeId);
}

export function getThemeMode(themeId: ThemeId): ThemeMode {
  return darkThemeIds.includes(themeId) ? "dark" : "light";
}

export const themeInitializationScript = `
  (function () {
    try {
      var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
      var validThemes = ${JSON.stringify(themeIds)};
      var darkThemes = ${JSON.stringify(darkThemeIds)};
      var storedTheme = window.localStorage.getItem(storageKey);
      var theme = validThemes.indexOf(storedTheme) >= 0 ? storedTheme : ${JSON.stringify(DEFAULT_THEME)};
      var root = document.documentElement;
      var isDark = darkThemes.indexOf(theme) >= 0;
      root.dataset.theme = theme;
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    } catch (_) {}
  })();
`;
