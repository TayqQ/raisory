"use client";

import { useEffect } from "react";

/** The folded group a fragment names, if there is one. */
function groupFor(hash: string): HTMLDetailsElement | null {
  if (!hash) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash);
  } catch {
    return null;
  }
  const target = document.getElementById(id);
  return target instanceof HTMLDetailsElement ? target : null;
}

/**
 * Opens a group at its full height straight away (no fold animation), so the
 * page is already tall enough for the scroll to land on it.
 */
function openAtOnce(group: HTMLDetailsElement): void {
  if (group.open) return;
  group.dataset.instant = "";
  group.open = true;
  // Read the style once so the open state is settled before the flag goes.
  void getComputedStyle(group, "::details-content").blockSize;
  requestAnimationFrame(() => delete group.dataset.instant);
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Opens a folded sector group when a link points at it (`#sector-...`). The
 * groups are native `<details>` and start folded; a fragment link scrolls to
 * one but does not open it. A click on such a link (the sector bars at the
 * top of the page) opens the group, glides to it (jumps, under reduced
 * motion), puts focus on its heading and records the fragment in the
 * history. Opening the page at a fragment opens that group too. Without
 * JavaScript the links still scroll to the group, which opens with a click.
 */
export function OpenOnHash(): null {
  useEffect(() => {
    const onHash = () => {
      const group = groupFor(window.location.hash.slice(1));
      if (group) openAtOnce(group);
    };
    // Capture phase, so this runs before Next.js handles the link.
    const onClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href") ?? "";
      if (!href.startsWith("#")) return;
      const group = groupFor(href.slice(1));
      if (!group) return;
      event.preventDefault();
      openAtOnce(group);
      group.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "start",
      });
      group.querySelector("summary")?.focus({ preventScroll: true });
      if (window.location.hash !== href) {
        window.history.pushState(window.history.state, "", href);
      }
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
