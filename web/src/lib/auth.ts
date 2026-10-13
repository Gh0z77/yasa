// Which account system the app talks to. With a Clerk publishable key in the build, Clerk signs people in and
// every API request carries its session token; without one, the server's own email + password sessions are used.

export const CLERK_PUBLISHABLE_KEY: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || undefined;
export const clerkEnabled = Boolean(CLERK_PUBLISHABLE_KEY);

/** What the rest of the app needs from Clerk; registered by `<AuthProvider>` once Clerk has loaded. */
export interface ClerkHandle {
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  openAccount: () => void;
}

let handle: ClerkHandle | null = null;
let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

export function registerClerk(next: ClerkHandle): void {
  handle = next;
  markReady();
}

/** Waits for Clerk to load, but never forever: if its script cannot be fetched the app continues signed out. */
function whenReady(): Promise<void> {
  return Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
}

/** Headers that authenticate an API request (empty with the built-in cookie session). */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!clerkEnabled) return {};
  await whenReady();
  const token = handle ? await handle.getToken().catch(() => null) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function signOutOfClerk(): Promise<void> {
  await whenReady();
  await handle?.signOut();
}

/** Opens Clerk's account screen (profile, password, connected accounts, devices). */
export function openClerkAccount(): void {
  handle?.openAccount();
}
