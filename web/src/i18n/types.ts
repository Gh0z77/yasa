// Type machinery for the dictionaries. Runtime lives in ./index.tsx.

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * Removes a trailing plural suffix: "files_one" → "files", "a_b_other" → "a_b".
 * Keys without a plural suffix are returned unchanged ("bad_request" → "bad_request").
 */
export type StripPlural<K extends string> = K extends `${infer Head}_${infer Rest}`
  ? Rest extends PluralCategory
    ? Head
    : StripPlural<Rest> extends infer S extends string
      ? S extends Rest
        ? K
        : `${Head}_${S}`
      : K
  : K;

/** Base name of a plural key, `never` for ordinary keys. */
type PluralBase<K extends string> = StripPlural<K> extends K ? never : StripPlural<K>;

/**
 * Shape every translation of a namespace must satisfy: exactly the keys of the English dictionary, all strings.
 * For plural keys (`x_one`, `x_other`) a translation may add the categories its language needs
 * (`x_few`, `x_many` in Russian) even when English does not define them.
 *
 * Usage in `locales/uz/<ns>.ts` and `locales/ru/<ns>.ts`:
 *   export const home = { ... } as const satisfies DictShape<typeof en>;
 */
export type DictShape<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : DictShape<T[K]>;
} & {
  -readonly [K in keyof T & string as PluralBase<K> extends never ? never : `${PluralBase<K>}_${PluralCategory}`]?: string;
};

/** Widens a `const` dictionary to plain strings (same nesting). */
export type DeepStringify<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/**
 * Every key accepted by `t()` for a dictionary: dotted leaf paths, plus plural base names
 * (`t('items', { count })` resolves `items_one` / `items_other` …).
 */
export type TKey<T> = LeafPaths<T> | StripPlural<LeafPaths<T>>;

/** Interpolation values for `{name}` placeholders; `count` also selects the plural form. */
export type TVars = Record<string, string | number | null | undefined>;

/** Loose runtime view of a dictionary. */
export interface DictNode {
  readonly [key: string]: string | DictNode;
}
