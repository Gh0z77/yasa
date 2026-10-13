// NVIDIA NIM (build.nvidia.com): an OpenAI-compatible endpoint with a fixed base URL.
import { openaiProvider } from './openai';
import type { Provider } from './types';

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
/** Model used for key checks and as the fallback when another provider is unavailable. */
export const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

export const nvidiaProvider: Provider = {
  id: 'nvidia',
  stream: (req) => openaiProvider.stream({ ...req, baseUrl: NVIDIA_BASE_URL }),
  test: (key) => openaiProvider.test({ ...key, baseUrl: NVIDIA_BASE_URL, model: key.model || NVIDIA_DEFAULT_MODEL }),
};
