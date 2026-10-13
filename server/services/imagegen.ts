// Image generation for the builder: the AI asks for a picture (`<yasa-image … />`) and the server creates it and
// stores it in the project. Providers are tried in order: Gemini's image model (needs a key with image quota),
// FLUX on NVIDIA NIM (works with the free NIM key), then a keyless public service that only manages about one
// picture every half minute.
import { getConfig } from '../env';
import { logger } from '../lib/logger';

export type ImageAspect = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
export const IMAGE_ASPECTS: readonly ImageAspect[] = ['16:9', '4:3', '1:1', '3:4', '9:16'];

export interface GeneratedImage {
  data: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  provider: string;
}

export interface ImageRequest {
  prompt: string;
  aspect: ImageAspect;
  signal?: AbortSignal;
}

type Generator = (request: ImageRequest) => Promise<GeneratedImage>;

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PROMPT_MAX = 600;
const SIZES: Record<ImageAspect, [number, number]> = {
  '16:9': [1280, 720],
  '4:3': [1024, 768],
  '1:1': [1024, 1024],
  '3:4': [768, 1024],
  '9:16': [720, 1280],
};
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const NVIDIA_IMAGE_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev';
/** FLUX only accepts these dimensions. */
const FLUX_SIZES: Record<ImageAspect, [number, number]> = {
  '16:9': [1344, 768],
  '4:3': [1152, 896],
  '1:1': [1024, 1024],
  '3:4': [896, 1152],
  '9:16': [768, 1344],
};
/** After Gemini reports no quota, skip it for a while instead of failing every request first. */
const GEMINI_COOLDOWN_MS = 10 * 60_000;
let geminiBlockedUntil = 0;

function sniff(data: Buffer): GeneratedImage['mime'] | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x89 && data.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function viaGemini(request: ImageRequest, apiKey: string): Promise<GeneratedImage> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    signal: timeoutSignal(request.signal, 60_000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: request.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: request.aspect } },
    }),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 403) geminiBlockedUntil = Date.now() + GEMINI_COOLDOWN_MS;
    throw new Error(`Gemini image request failed (${res.status})`);
  }
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string } }> } }> };
  const encoded = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData?.data;
  if (!encoded) throw new Error('Gemini returned no image');
  const data = Buffer.from(encoded, 'base64');
  const mime = sniff(data);
  if (!mime || data.length > MAX_IMAGE_BYTES) throw new Error('Gemini returned an unusable image');
  return { data, mime, provider: 'gemini' };
}

async function viaNvidia(request: ImageRequest, apiKey: string): Promise<GeneratedImage> {
  const [width, height] = FLUX_SIZES[request.aspect];
  const res = await fetch(NVIDIA_IMAGE_URL, {
    method: 'POST',
    signal: timeoutSignal(request.signal, 90_000),
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: request.prompt, width, height, steps: 20, seed: Math.floor(Math.random() * 2 ** 31) }),
  });
  if (!res.ok) throw new Error(`NVIDIA image request failed (${res.status})`);
  const body = (await res.json()) as { artifacts?: Array<{ base64?: string; finishReason?: string }> };
  const artifact = body.artifacts?.[0];
  if (!artifact?.base64 || artifact.finishReason === 'CONTENT_FILTERED') throw new Error('NVIDIA returned no image');
  const data = Buffer.from(artifact.base64, 'base64');
  const mime = sniff(data);
  if (!mime || data.length > MAX_IMAGE_BYTES) throw new Error('NVIDIA returned an unusable image');
  return { data, mime, provider: 'nvidia' };
}

// The keyless service serves one request at a time per caller and answers 402/429 to anything sent in
// parallel, so its requests run through a queue and are retried with a growing pause.
let pollinationsQueue: Promise<unknown> = Promise.resolve();
const POLLINATIONS_RETRIES = 3;

function inPollinationsQueue<T>(work: () => Promise<T>): Promise<T> {
  const run = pollinationsQueue.then(work, work);
  pollinationsQueue = run.catch(() => undefined);
  return run;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function viaPollinations(request: ImageRequest): Promise<GeneratedImage> {
  return inPollinationsQueue(async () => {
    const [width, height] = SIZES[request.aspect];
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(request.prompt)}?width=${width}&height=${height}&nologo=true&model=flux`;
    let failure = "Image service did not answer";
    for (let attempt = 0; attempt < POLLINATIONS_RETRIES; attempt++) {
      if (request.signal?.aborted) break;
      if (attempt > 0) await pause(3000 * attempt);
      const res = await fetch(url, { signal: timeoutSignal(request.signal, 60_000), redirect: "follow" });
      if (!res.ok) {
        failure = `Image service answered ${res.status}`;
        await res.arrayBuffer().catch(() => undefined);
        // Busy or throttled: worth another try. Anything else will not change by asking again.
        if (res.status === 402 || res.status === 429 || res.status >= 500) continue;
        break;
      }
      const data = Buffer.from(await res.arrayBuffer());
      const mime = sniff(data);
      if (!mime || data.length > MAX_IMAGE_BYTES) throw new Error("Image service returned an unusable file");
      return { data, mime, provider: "pollinations" };
    }
    throw new Error(failure);
  });
}

const defaultGenerator: Generator = async (request) => {
  const config = getConfig();
  const attempts: Array<() => Promise<GeneratedImage>> = [];
  const mode = config.imageProvider;
  if ((mode === 'auto' || mode === 'gemini') && config.geminiApiKey && Date.now() >= geminiBlockedUntil) {
    const key = config.geminiApiKey;
    attempts.push(() => viaGemini(request, key));
  }
  if ((mode === 'auto' || mode === 'nvidia') && config.nvidiaApiKey) {
    const key = config.nvidiaApiKey;
    attempts.push(() => viaNvidia(request, key));
  }
  if (mode === 'auto' || mode === 'pollinations') attempts.push(() => viaPollinations(request));
  let last: unknown = new Error('Image generation is not available');
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      if (request.signal?.aborted) break;
      logger.warn('Image provider failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw last;
};

let generator: Generator = defaultGenerator;

/** Test helper: replaces the generator (pass null to restore the real providers). */
export function setImageGeneratorForTests(fake: Generator | null): void {
  generator = fake ?? defaultGenerator;
}

export function imageGenerationEnabled(): boolean {
  return getConfig().imageProvider !== 'off';
}

export function normalizeAspect(value: string | undefined): ImageAspect {
  const cleaned = (value ?? '').replace(/\s+/g, '').replace('x', ':').replace('/', ':');
  return (IMAGE_ASPECTS as readonly string[]).includes(cleaned) ? (cleaned as ImageAspect) : '16:9';
}

/** Creates one image. The prompt is trimmed and steered away from rendered text, which image models garble. */
export function generateImage(request: ImageRequest): Promise<GeneratedImage> {
  const prompt = request.prompt.replace(/\s+/g, ' ').trim().slice(0, PROMPT_MAX);
  if (prompt.length < 3) return Promise.reject(new Error('The image needs a description'));
  return generator({ ...request, prompt: `${prompt}. No text, letters, logos or watermarks.` });
}
