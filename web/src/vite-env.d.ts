/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fallback UI locale when nothing is stored and the browser languages do not match (en | uz | ru). */
  readonly VITE_DEFAULT_LOCALE?: string;
  /** Clerk publishable key; when set, Clerk handles sign-in instead of the built-in accounts. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
