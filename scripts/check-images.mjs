// Verifies that every image id in server/ai/images.ts still resolves. Run: node scripts/check-images.mjs
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server/ai/images.ts', import.meta.url), 'utf8');
const ids = [...source.matchAll(/id: '(photo-[\w-]+)'/g)].map((m) => m[1]);

let failed = 0;
await Promise.all(
  ids.map(async (id) => {
    const url = `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&q=60`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) {
        failed++;
        console.log(`FAIL ${res.status} ${id}`);
      }
    } catch (err) {
      failed++;
      console.log(`FAIL network ${id} ${err.message}`);
    }
  }),
);
console.log(`${ids.length - failed}/${ids.length} images OK`);
process.exit(failed ? 1 : 0);
