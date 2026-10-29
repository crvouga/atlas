/**
 * @module Search query language
 *
 * One reading of a search box, shared by the finder, the test list, the runs list and the results of one run, so a
 * sentence means the same thing wherever it is typed:
 *
 * - plain words are matched by meaning, spelling and word form (see `rank.ts`), and every distinctive word must be found;
 * - `"a quoted phrase"` and identifiers that contain `/`, `_` or `.` (`checkout/save.feature`) are matched literally and
 *   are reported as exact matches;
 * - `field:value` narrows by structure instead of matching words: `status:failed`, `env:ios` (or `platform:`,
 *   `environment:`, `device:`), `producer:`, `domain:`, `spec:`, `tag:`, `branch:` and `has:video`. A value with spaces is
 *   quoted (`domain:"user account"`). Several values of one field (`status:failed,flaky`, or the field twice) match any of
 *   them; different fields must all hold.
 *
 * Nothing here is ever dropped silently: a word it cannot use as a filter (`colour:red`, `status:great`, `has:smell`) is
 * returned as an {@link SearchIssue} for the interface to show, and it filters nothing.
 */

/** The filters a search can carry. Each list matches any of its values; the lists combine with AND. */
export type SearchFilters = {
  readonly status: readonly string[];
  readonly env: readonly string[];
  readonly producer: readonly string[];
  readonly domain: readonly string[];
  readonly spec: readonly string[];
  readonly tag: readonly string[];
  readonly branch: readonly string[];
  /** `has:video`: only what has a playable video recording. */
  readonly video: boolean;
};

/** One of the filters a search can carry, by the name a person types before the colon. */
export type FilterKey = Exclude<keyof SearchFilters, 'video'> | 'video';

/** One filter as typed, for showing as a removable chip. */
export type FilterToken = {
  readonly key: FilterKey;
  /** The value (`failed`), or `video` for `has:video`. */
  readonly value: string;
  /** The text to remove from the query to remove this filter. */
  readonly text: string;
};

/** Something in the query that could not be used, and what to type instead. */
export type SearchIssue = {
  /** The text as typed. */
  readonly token: string;
  /** A sentence for the person, naming what is supported. */
  readonly message: string;
};

/** A query read into what it asks for. */
export type ParsedSearch = {
  /** The query as typed. */
  readonly raw: string;
  /** The loose words to match by meaning and spelling (quoted phrases, identifiers and filters removed). */
  readonly words: string;
  /** Quoted phrases, each of which must appear literally. */
  readonly phrases: readonly string[];
  /** Identifier-like words (`lists/add`, `save_answer`, `a.feature`), each of which must appear literally. */
  readonly identifiers: readonly string[];
  readonly filters: SearchFilters;
  /** The filters in the order typed. */
  readonly tokens: readonly FilterToken[];
  readonly issues: readonly SearchIssue[];
};

/** The statuses a `status:` filter accepts. */
export const STATUS_VALUES = ['passed', 'failed', 'flaky', 'not-run', 'running'] as const;

/** The `has:` values a search accepts. */
export const HAS_VALUES = ['video'] as const;

const FIELD_ALIASES: Readonly<Record<string, Exclude<FilterKey, 'video'>>> = {
  status: 'status',
  env: 'env',
  environment: 'env',
  platform: 'env',
  device: 'env',
  producer: 'producer',
  domain: 'domain',
  spec: 'spec',
  tag: 'tag',
  branch: 'branch'
};

/** The operator names a search understands, for guidance. */
export const OPERATOR_NAMES: readonly string[] = [...Object.keys(FIELD_ALIASES), 'has'];

/** A sentence that lists what can be typed, shown with every issue. */
export const SYNTAX_HELP = 'Filters: status:failed, env:ios, producer:, domain:, spec:, tag:, branch: and has:video. Quote phrases: "saved answer".';

/** A search with nothing in it. */
export const NO_FILTERS: SearchFilters = { status: [], env: [], producer: [], domain: [], spec: [], tag: [], branch: [], video: false };

const OPERATOR = /^([A-Za-z][A-Za-z-]*):(.*)$/;
const IDENTIFIER = /[A-Za-z0-9][/_.][A-Za-z0-9]/;

/** The pieces of a query: quoted strings (optionally after `name:`) and runs of non-space characters. */
function pieces(query: string): { readonly text: string; readonly quoted: boolean; readonly name?: string }[] {
  const out: { text: string; quoted: boolean; name?: string }[] = [];
  const pattern = /(?:([A-Za-z][A-Za-z-]*):)?"([^"]*)"|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    if (match[3] !== undefined) out.push({ text: match[3], quoted: false });
    else out.push({ text: match[2] ?? '', quoted: true, ...(match[1] ? { name: match[1] } : {}) });
  }
  return out;
}

/** Reads a query: see the module comment. Never throws; whatever it cannot use is in `issues`. */
export function parseSearch(query: string): ParsedSearch {
  const words: string[] = [];
  const phrases: string[] = [];
  const identifiers: string[] = [];
  const issues: SearchIssue[] = [];
  const tokens: FilterToken[] = [];
  const lists: Record<Exclude<FilterKey, 'video'>, string[]> = { status: [], env: [], producer: [], domain: [], spec: [], tag: [], branch: [] };
  let video = false;
  const issue = (token: string, message: string) => issues.push({ token, message: `${message} ${SYNTAX_HELP}` });

  for (const piece of pieces(query)) {
    const operator = piece.name !== undefined ? ([piece.name, piece.text] as const) : !piece.quoted ? OPERATOR.exec(piece.text)?.slice(1, 3) : undefined;
    if (piece.quoted && piece.name === undefined) {
      const phrase = piece.text.trim().toLowerCase();
      if (phrase) phrases.push(phrase);
      else issue('""', 'is an empty phrase, which matches nothing.');
      continue;
    }
    if (operator) {
      const name = operator[0].toLowerCase();
      const original = piece.quoted ? `${operator[0]}:"${operator[1]}"` : piece.text;
      const rawValues = piece.quoted ? [operator[1]!] : operator[1]!.split(',');
      const values = rawValues.map((value) => value.trim().replace(/^"|"$/g, '')).filter(Boolean);
      if (name === 'has') {
        if (!values.length) issue(original, 'needs a value after the colon (has:video).');
        for (const value of values) {
          if (value.toLowerCase() === 'video') {
            video = true;
            tokens.push({ key: 'video', value: 'video', text: original });
          } else issue(original, 'is not supported (only has:video).');
        }
        continue;
      }
      const key = FIELD_ALIASES[name];
      if (!key && !piece.quoted && !values.length) {
        // Prose such as "Done:" is not a filter.
        words.push(piece.text.replace(/:$/, ''));
        continue;
      }
      if (!key) {
        issue(original, 'is not a filter.');
        continue;
      }
      if (!values.length) {
        issue(original, 'needs a value after the colon.');
        continue;
      }
      for (const raw of values) {
        const value = key === 'tag' ? raw.replace(/^#/, '').toLowerCase() : raw.toLowerCase();
        if (key === 'status' && !(STATUS_VALUES as readonly string[]).includes(value)) {
          issue(original, `is not a status (use ${STATUS_VALUES.join(', ')}).`);
          continue;
        }
        if (!lists[key].includes(value)) lists[key].push(value);
        tokens.push({ key, value, text: original });
      }
      continue;
    }
    if (piece.text.startsWith('"')) {
      issue(piece.text, 'has a quote that is never closed, so its words are matched as ordinary words.');
      words.push(piece.text.replace(/"/g, ' '));
      continue;
    }
    const bare = piece.text.replace(/^[("']+|[)"',;!?]+$/g, '').replace(/\.+$/, '');
    if (IDENTIFIER.test(bare)) identifiers.push(bare.toLowerCase());
    else words.push(piece.text);
  }
  return {
    raw: query,
    words: words.join(' ').trim(),
    phrases,
    identifiers,
    filters: { ...lists, video },
    tokens,
    issues
  };
}

/** True when the query narrows by structure (any filter, phrase or identifier) rather than only by loose words. */
export function isStructured(parsed: ParsedSearch): boolean {
  return parsed.tokens.length > 0 || parsed.phrases.length > 0 || parsed.identifiers.length > 0;
}

/** True when the query has nothing to match at all (no words, phrases, identifiers or filters). */
export function isBlank(parsed: ParsedSearch): boolean {
  return parsed.words.length === 0 && !isStructured(parsed);
}

/** The query with one filter's text removed, other text left as typed. */
export function withoutToken(query: string, token: FilterToken): string {
  const at = query.indexOf(token.text);
  if (at < 0) return query;
  return `${query.slice(0, at)}${query.slice(at + token.text.length)}`.replace(/\s{2,}/g, ' ').trim();
}

/**
 * What a document says about itself, to be filtered by structure. Lowercased on use. A document without facets (a
 * flow, a spec) can satisfy no filter.
 */
export type DocFacets = {
  readonly status: readonly string[];
  readonly env: readonly string[];
  readonly producer: readonly string[];
  readonly domain: readonly string[];
  readonly spec: readonly string[];
  readonly tag: readonly string[];
  readonly branch: readonly string[];
  readonly video: boolean;
};

/** The filter groups a count can leave out (status and environment buttons count what the other filters leave). */
export type FilterOmit = ReadonlySet<FilterKey>;

/**
 * Whether facets satisfy the filters: every filter that is set must match at least one of the document's values.
 * `omit` skips some filters (to count what a button would add).
 */
export function passesFilters(facets: DocFacets | undefined, filters: SearchFilters, omit?: FilterOmit): boolean {
  const wanted = (key: FilterKey) => !omit?.has(key);
  const lists: (Exclude<FilterKey, 'video'>)[] = ['status', 'env', 'producer', 'domain', 'spec', 'tag', 'branch'];
  const active = lists.filter((key) => filters[key].length > 0 && wanted(key));
  const needsVideo = filters.video && wanted('video');
  if (!active.length && !needsVideo) return true;
  if (!facets) return false;
  if (needsVideo && !facets.video) return false;
  for (const key of active) {
    const have = facets[key].map((value) => value.toLowerCase());
    const ok = filters[key].some((value) => (key === 'spec' ? have.some((path) => path === value || path.endsWith(`/${value}`) || path.includes(value)) : have.includes(value)));
    if (!ok) return false;
  }
  return true;
}

/** True when a search carries a filter (as opposed to words), counting only those not in `omit`. */
export function hasFilters(filters: SearchFilters): boolean {
  return filters.video || filters.status.length + filters.env.length + filters.producer.length + filters.domain.length + filters.spec.length + filters.tag.length + filters.branch.length > 0;
}
