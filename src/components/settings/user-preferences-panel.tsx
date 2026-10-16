"use client";

import { setKeyboardPreference, useKeyboardPreferences } from "@/components/layout/keyboard-preferences";
import { PreferenceToggle } from "@/components/layout/keyboard-shortcuts";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";

/** Preferencias de este navegador: paleta de la interfaz y comportamiento del teclado. */
export function UserPreferencesPanel({ part }: { part: "appearance" | "keyboard" }) {
  const preferences = useKeyboardPreferences();

  if (part === "appearance") {
    return (
      <div className="max-w-md space-y-1">
        <ThemeSwitcher />
        <p className="text-xs text-muted-foreground">Se guarda en este navegador. También puedes cambiarla desde la barra superior.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <PreferenceToggle
        checked={preferences.keyboardMode}
        description="Muestra en el menú y en la búsqueda el código de cada módulo para abrirlo con G + código."
        id="preferences-keyboard-mode"
        label="Modo teclado: mostrar códigos"
        onChange={(value) => setKeyboardPreference("keyboardMode", value)}
      />
      <PreferenceToggle
        checked={preferences.singleKeyShortcuts}
        description="Desactívalo si usas control por voz o te saltan acciones sin querer. F1, Ctrl K y los atajos con Alt siguen funcionando."
        id="preferences-single-key"
        label="Atajos de una sola tecla (/, ?, G)"
        onChange={(value) => setKeyboardPreference("singleKeyShortcuts", value)}
      />
      <p className="text-xs text-muted-foreground md:col-span-2">Pulsa F1 en cualquier pantalla para ver todos los atajos de teclado.</p>
    </div>
  );
}
