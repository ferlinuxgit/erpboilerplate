"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Toaster } from "sonner";

/*
 * Los avisos usan los colores de ventana del tema activo (8 paletas) en lugar de los
 * claro/oscuro de sonner: superficie de ventana, borde oscuro, relieve con sombra sólida,
 * título monoespaciado e icono de estado con los colores de texto de estado del tema.
 * Las variables `--normal-*` de sonner se sobrescriben en el propio <ol> del toaster.
 */
const toasterStyle = {
  "--normal-bg": "var(--window-surface)",
  "--normal-bg-hover": "var(--window-highlight)",
  "--normal-border": "var(--window-dark-shadow)",
  "--normal-border-hover": "var(--window-dark-shadow)",
  "--normal-text": "var(--window-text)",
  "--border-radius": "var(--radius-surface)",
} as CSSProperties;

// sonner inyecta su CSS sin capa: gana a las utilidades de Tailwind (en @layer), por eso
// las propiedades que sonner también fija llevan `!`.
const toastClassNames = {
  toast: "gap-2! px-3! py-2.5! font-sans shadow-window! focus-visible:outline-2! focus-visible:outline-focus!",
  title: "font-mono text-xs leading-4! font-bold!",
  description: "text-xs leading-4! text-window-muted!",
  icon: "self-start mt-px",
  success: "[&_[data-icon]]:text-success-text",
  error: "[&_[data-icon]]:text-danger-text",
  warning: "[&_[data-icon]]:text-warning-text",
  info: "[&_[data-icon]]:text-info-text",
  closeButton: "rounded-control! border-window-dark-shadow! bg-window-surface! text-window-text! shadow-raised hover:bg-window-highlight!",
  actionButton: "rounded-surface! border! border-window-dark-shadow! bg-primary! font-mono text-xs font-bold! text-primary-foreground! shadow-raised-tinted",
  cancelButton: "rounded-surface! border! border-window-dark-shadow! bg-window-surface! font-mono text-xs text-window-text! shadow-raised",
};

// Themes toggle the `dark` class on <html>; sonner still needs it for its own contrast rules.
export function ThemedToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      closeButton
      position="top-right"
      style={toasterStyle}
      theme={theme}
      toastOptions={{ classNames: toastClassNames }}
    />
  );
}
