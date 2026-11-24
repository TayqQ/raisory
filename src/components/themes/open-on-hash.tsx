"use client";

import { useEffect } from "react";

function openTarget(id: string): void {
  if (!id) return;
  const target = document.getElementById(decodeURIComponent(id));
  if (target instanceof HTMLDetailsElement && !target.open) {
    target.open = true;
  }
}

/**
 * Opens a folded sector group when a link points at it (`#sector-...`). The
 * groups are native `<details>`, which a fragment link scrolls to but does
 * not open. Next.js links change the hash without a `hashchange` event, so
 * clicks on in-page links are handled too. Without JavaScript the groups
 * start open, so nothing is lost.
 */
export function OpenOnHash(): null {
  useEffect(() => {
    const onHash = () => openTarget(window.location.hash.slice(1));
    // Capture phase, so the group is open before the browser scrolls to it.
    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href") ?? "";
      if (href.startsWith("#")) openTarget(href.slice(1));
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
