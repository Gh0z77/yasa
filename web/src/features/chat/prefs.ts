// Per-browser chat preferences shared by the composer and by requests sent from elsewhere (retry, Fix with AI).
import type { ChatMode, ModelId } from '@shared/types';

const MODEL_KEY = 'yasa:model';
const MODE_KEY = 'yasa:chat-mode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export function storedModel(): ModelId | null {
  const value = read(MODEL_KEY);
  return value && /^(anthropic|gemini|openai|mock):.+/.test(value) ? (value as ModelId) : null;
}

export function storeModel(id: ModelId): void {
  write(MODEL_KEY, id);
}

export function storedMode(): ChatMode {
  return read(MODE_KEY) === 'chat' ? 'chat' : 'build';
}

export function storeMode(mode: ChatMode): void {
  write(MODE_KEY, mode);
}
