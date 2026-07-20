"use client";

import { useEffect } from "react";

const warningMessage = "Hay cambios sin guardar. Si sales ahora, se perderán.";

function isEditableForm(form: HTMLFormElement) {
  if (form.dataset.ignoreDirtyGuard === "true") return false;
  if (form.getAttribute("method")?.toLocaleLowerCase() === "get") return false;
  return (
    form.querySelector("input:not([type='hidden']), textarea, select") !== null
  );
}

export function FormNavigationGuard() {
  useEffect(() => {
    const dirtyForms = new Set<HTMLFormElement>();
    const hasDirtyForm = () => {
      for (const form of dirtyForms)
        if (!form.isConnected) dirtyForms.delete(form);
      return dirtyForms.size > 0;
    };

    const markDirty = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const form = target.closest("form");
      if (form && isEditableForm(form)) dirtyForms.add(form);
    };

    const markClean = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLFormElement) dirtyForms.delete(target);
    };

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyForm()) return;
      event.preventDefault();
      event.returnValue = warningMessage;
    };

    const beforeNavigate = (event: MouseEvent) => {
      if (
        !hasDirtyForm() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      )
        return;
      if (window.confirm(warningMessage)) {
        dirtyForms.clear();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("submit", markClean, true);
    document.addEventListener("click", beforeNavigate, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("submit", markClean, true);
      document.removeEventListener("click", beforeNavigate, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  return null;
}
