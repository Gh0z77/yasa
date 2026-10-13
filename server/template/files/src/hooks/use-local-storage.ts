import { useCallback, useEffect, useRef, useState } from "react";

type SetValue<T> = (value: T | ((previous: T) => T)) => void;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * useState that persists to localStorage (JSON) and stays in sync across
 * components and browser tabs using the same key.
 *
 * const [todos, setTodos, resetTodos] = useLocalStorage<Todo[]>("todos", []);
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, SetValue<T>, () => void] {
  const initialRef = useRef(initialValue);
  const keyRef = useRef(key);
  const [value, setValue] = useState<T>(() => read(key, initialValue));

  // Re-read when the key changes or another tab/component writes to it.
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(read(key, initialRef.current));
    }

    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === key || event.key === null)) {
        setValue(read(key, initialRef.current));
      }
    };
    const onLocal = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setValue(read(key, initialRef.current));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("local-storage", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("local-storage", onLocal);
    };
  }, [key]);

  const set = useCallback<SetValue<T>>(
    (next) => {
      const previous = read(key, initialRef.current);
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Storage is full or unavailable: keep the value in memory only.
      }
      setValue(resolved);
      window.dispatchEvent(new CustomEvent("local-storage", { detail: key }));
    },
    [key],
  );

  const remove = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore: nothing to remove when storage is unavailable.
    }
    setValue(initialRef.current);
    window.dispatchEvent(new CustomEvent("local-storage", { detail: key }));
  }, [key]);

  return [value, set, remove];
}
