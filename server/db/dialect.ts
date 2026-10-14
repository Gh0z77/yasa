// The application writes SQL for SQLite. When the database is Postgres (a hosted deployment), every statement is
// rewritten here on its way out. The SQL in use is deliberately plain — these few differences are all there are.

const cache = new Map<string, string>();
const CACHE_MAX = 600;

/** Replaces each `?` outside a string literal with `$1`, `$2`, … */
function numberParams(sql: string): string {
  let out = '';
  let index = 0;
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'") quoted = !quoted;
    if (ch === '?' && !quoted) out += `$${++index}`;
    else out += ch;
  }
  return out;
}

/** A query or data statement written for SQLite, as Postgres wants it. */
export function toPg(sql: string): string {
  const hit = cache.get(sql);
  if (hit !== undefined) return hit;
  let out = numberParams(sql);
  // SQLite's LIKE ignores ASCII case.
  out = out.replace(/\bLIKE\b/g, 'ILIKE');
  if (/\bINSERT\s+OR\s+IGNORE\b/i.test(out)) {
    out = out.replace(/\bINSERT\s+OR\s+IGNORE\b/i, 'INSERT');
    if (!/\bON\s+CONFLICT\b/i.test(out)) out = `${out.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sql, out);
  return out;
}

/**
 * Schema statements (the migrations). Text columns compare byte by byte like SQLite does (so ordering by ISO
 * timestamps and ids is the same on both), blobs become BYTEA. NOCASE is dropped: e-mail addresses and domains,
 * the only columns that use it, are lower-cased by the code before every write and lookup.
 */
export function ddlToPg(sql: string): string {
  return sql
    .replace(/\s+COLLATE\s+NOCASE\b/g, '')
    .replace(/\bTEXT\b/g, 'TEXT COLLATE "C"')
    .replace(/\bBLOB\b/g, 'BYTEA');
}
