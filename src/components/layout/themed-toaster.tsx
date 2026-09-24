"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

// Themes toggle the `dark` class on <html>; mirror it so toasts stay readable.
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

  return <Toaster closeButton position="top-right" richColors theme={theme} />;
}
