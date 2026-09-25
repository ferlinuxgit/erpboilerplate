"use client";

import { useSyncExternalStore } from "react";

/**
 * Preferencias de teclado por usuario y navegador (localStorage):
 * - `keyboardMode`: muestra los códigos numéricos de los módulos (para `G + código`).
 * - `singleKeyShortcuts`: atajos de una sola tecla ("/", "?", "g"). Se pueden desactivar
 *   para cumplir WCAG 2.1.4 (usuarios de voz o de conmutadores).
 */
export type KeyboardPreferences = {
  keyboardMode: boolean;
  singleKeyShortcuts: boolean;
};

export const KEYBOARD_MODE_STORAGE_KEY = "erp-keyboard-mode";
export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = "erp-single-key-shortcuts";
const CHANGE_EVENT = "erp:keyboard-preferences";

const DEFAULT_SNAPSHOT = "0|1";

function readSnapshot() {
  try {
    const keyboardMode = window.localStorage.getItem(KEYBOARD_MODE_STORAGE_KEY) === "on";
    const singleKey = window.localStorage.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY) !== "off";
    return `${keyboardMode ? 1 : 0}|${singleKey ? 1 : 0}`;
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

export function parseKeyboardPreferences(snapshot: string): KeyboardPreferences {
  const [keyboardMode, singleKey] = snapshot.split("|");
  return { keyboardMode: keyboardMode === "1", singleKeyShortcuts: singleKey !== "0" };
}

/** Lectura puntual (para manejadores de eventos). */
export function readKeyboardPreferences(): KeyboardPreferences {
  return parseKeyboardPreferences(readSnapshot());
}

export function setKeyboardPreference(key: keyof KeyboardPreferences, value: boolean) {
  try {
    if (key === "keyboardMode") window.localStorage.setItem(KEYBOARD_MODE_STORAGE_KEY, value ? "on" : "off");
    else window.localStorage.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, value ? "on" : "off");
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura hasta recargar.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEYBOARD_MODE_STORAGE_KEY || event.key === SINGLE_KEY_SHORTCUTS_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useKeyboardPreferences(): KeyboardPreferences {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => DEFAULT_SNAPSHOT);
  return parseKeyboardPreferences(snapshot);
}
