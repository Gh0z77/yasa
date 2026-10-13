// A guest's first prompt survives the signup redirect in sessionStorage (text only, never attachments).
export const PENDING_PROMPT_KEY = 'yasa:pendingPrompt';

export function savePendingPrompt(prompt: string): void {
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
  } catch {
    /* storage blocked: the user simply retypes the prompt after signing up */
  }
}

export function hasPendingPrompt(): boolean {
  try {
    return !!sessionStorage.getItem(PENDING_PROMPT_KEY)?.trim();
  } catch {
    return false;
  }
}

/** Reads and removes the pending prompt, so it can be consumed only once. */
export function takePendingPrompt(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (value !== null) sessionStorage.removeItem(PENDING_PROMPT_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
