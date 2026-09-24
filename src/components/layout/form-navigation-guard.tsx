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

    // A submit is optimistic: the form stops guarding navigation, but if the
    // save fails (inline alert or error toast) the form becomes dirty again so
    // the user's input is still protected.
    const failureWatchers = new Map<HTMLFormElement, { observer: MutationObserver; timer: number }>();
    const stopWatching = (form: HTMLFormElement) => {
      const watcher = failureWatchers.get(form);
      if (!watcher) return;
      watcher.observer.disconnect();
      window.clearTimeout(watcher.timer);
      failureWatchers.delete(form);
    };
    const isFailureSignal = (node: Node, form: HTMLFormElement) => {
      if (!(node instanceof Element)) return false;
      const errorToast = node.matches("[data-sonner-toast][data-type='error']") || node.querySelector("[data-sonner-toast][data-type='error']");
      const inlineAlert = form.contains(node) && (node.matches("[role='alert']") || node.querySelector("[role='alert']"));
      return Boolean(errorToast || inlineAlert);
    };

    const markClean = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const wasDirty = dirtyForms.delete(form);
      if (!wasDirty) return;
      stopWatching(form);
      const observer = new MutationObserver((mutations) => {
        const failed = mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some((node) => isFailureSignal(node, form)),
        );
        if (!failed) return;
        if (form.isConnected) dirtyForms.add(form);
        stopWatching(form);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = window.setTimeout(() => stopWatching(form), 15_000);
      failureWatchers.set(form, { observer, timer });
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
      for (const form of Array.from(failureWatchers.keys())) stopWatching(form);
    };
  }, []);

  return null;
}
