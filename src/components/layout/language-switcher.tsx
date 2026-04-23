"use client";

import { useState } from "react";

export function LanguageSwitcher() {
  const [locale, setLocale] = useState<"es" | "en">("es");
  return (
    <select
      className="h-8 rounded-md border px-2 text-sm"
      value={locale}
      onChange={(event) => {
        const next = event.target.value as "es" | "en";
        setLocale(next);
        document.cookie = `locale=${next}; path=/; max-age=31536000`;
      }}
    >
      <option value="es">ES</option>
      <option value="en">EN</option>
    </select>
  );
}
