// OpenRouter (openrouter.ai): one key for many models through an OpenAI-compatible endpoint. Free models
// (ids ending in ":free") work without credits; the others need a balance on the account.
import { openaiProvider } from './openai';
import type { Provider } from './types';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Free, fast model used for key checks and as a fallback. */
export const OPENROUTER_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

export const openrouterProvider: Provider = {
  id: 'openrouter',
  stream: (req) => openaiProvider.stream({ ...req, baseUrl: OPENROUTER_BASE_URL }),
  test: (key) => openaiProvider.test({ ...key, baseUrl: OPENROUTER_BASE_URL, model: key.model || OPENROUTER_DEFAULT_MODEL }),
};
