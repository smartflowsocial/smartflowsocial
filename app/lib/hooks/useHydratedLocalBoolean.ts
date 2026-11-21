import { useLayoutEffect, useState, type SetStateAction } from "react";

/**
 * Boolean stored in localStorage.
 *
 * The first render always uses `defaultValue` so server HTML matches hydration.
 * Reading storage in a `useState` initializer throws React hydration error #418
 * whenever the saved value differs. The stored value is applied in
 * `useLayoutEffect`, after hydration and before paint.
 */
export function useHydratedLocalBoolean(
  storageKey: string,
  defaultValue: boolean
): [boolean, (next: SetStateAction<boolean>) => void] {
  const [value, setValue] = useState(defaultValue);

  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "true") setValue(true);
      else if (raw === "false") setValue(false);
    } catch {
      // Ignore storage access errors (private mode, blocked storage).
    }
  }, [storageKey]);

  return [value, setValue];
}
