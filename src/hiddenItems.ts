import { useState } from "react";

/** Library items hidden in this browser, kept under `key`. Hiding is a
 * per-browser convenience; without storage it lasts the session. */
export function useHiddenItems(key: string) {
  const [hidden, setHidden] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set<string>(Array.isArray(value) ? value : []);
    } catch {
      return new Set<string>();
    }
  });
  const toggle = (ids: string[], hide: boolean) => {
    const next = new Set(hidden);
    for (const id of ids) {
      if (hide) next.add(id);
      else next.delete(id);
    }
    setHidden(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Storage may be blocked; the change still applies until reload.
    }
  };
  return [hidden, toggle] as const;
}
