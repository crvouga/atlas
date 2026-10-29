/**
 * @module UI catalog single-file export
 *
 * The UI catalog as one HTML file that needs no server, no network and no build: open it from a disk, attach it to a ticket,
 * host it anywhere that serves a file. Pictures are embedded as `data:` addresses, the manifest is embedded as JSON
 * (`<script type="application/json" id="ui-catalog">`), and a few lines of script filter the states; with scripts off, every
 * state is simply shown. It shows what the viewer's catalog shows, but it does not stream: it is the catalog at the moment it
 * was made, and says when.
 *
 * Hosting platforms cap the size of one file, which is the reason a catalog is also a store and a viewer. The export keeps to a
 * budget ({@link gatherUiPictures}): pictures past it are listed as left out with the reason, never silently dropped, and the
 * manifest stays complete.
 *
 * Everything in the page is data from a test run. Text is escaped; only PNG, JPEG, GIF and WebP bytes whose first bytes say so
 * are embedded (never SVG, never what a layer merely claims); a page address is linked only when it is `http` or `https`; the
 * page carries a Content-Security-Policy that allows no network request at all.
 *
 * @see docs/ui-catalog.md
 */
import { UI_COVERAGE, type UiCapture, type UiCatalog, type UiCatalogState, type UiCell, type UiCoverage } from './ui-catalog';

/** A picture ready to embed. */
export type UiExportPicture = { readonly contentType: string; readonly data: Uint8Array };

/** What {@link uiCatalogHtml} may be given besides the catalog. */
export type UiExportOptions = {
  /** The page's title. Default `UI catalog`. */
  readonly title?: string;
  /** The pictures to embed, by {@link uiPictureKey}. A cell whose key is not here shows why it has no picture. */
  readonly pictures?: ReadonlyMap<string, UiExportPicture>;
  /** Why a picture that could not be embedded is not here, by {@link uiPictureKey}: shown in its place. */
  readonly left?: ReadonlyMap<string, string>;
  /** When the export was made, epoch milliseconds. It is stated on the page so nobody mistakes it for a live view. Default: now. */
  readonly generatedAtMs?: number;
};

/** The key of a capture's picture in {@link UiExportOptions.pictures}: its layer and its bundle key, or `null` when the picture is not stored in a layer. */
export function uiPictureKey(capture: Pick<UiCapture, 'origin' | 'image'> | null | undefined): string | null {
  const key = capture?.image?.bundleKey;
  return capture && key ? `${capture.origin.layer}/${key}` : null;
}

/** One picture an export may embed. */
export type UiPictureWant = { readonly key: string; readonly layer: string; readonly backend: string; readonly bundleKey: string; readonly bytes?: number };

/**
 * The pictures of a catalog an export would embed, once each, in the order the page shows them. Only a cell that was captured, or
 * that failed (a picture of what the page showed), and whose picture is stored in a layer, has one.
 */
export function uiPicturesWanted(catalog: UiCatalog): UiPictureWant[] {
  const seen = new Set<string>();
  const wanted: UiPictureWant[] = [];
  for (const state of catalog.states) for (const cell of state.cells) {
    if (cell.coverage !== 'captured' && cell.coverage !== 'failed') continue;
    const key = uiPictureKey(cell.capture);
    if (!key || seen.has(key) || !cell.capture?.image?.bundleKey) continue;
    seen.add(key);
    wanted.push({ key, layer: cell.capture.origin.layer, backend: cell.capture.origin.backend, bundleKey: cell.capture.image.bundleKey, ...(cell.capture.image.bytes !== undefined ? { bytes: cell.capture.image.bytes } : {}) });
  }
  return wanted;
}

/** The media type a picture's first bytes say it has (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), or `null` for anything else, SVG included. */
export function sniffImage(data: Uint8Array): string | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((byte, i) => data[offset + i] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** What {@link gatherUiPictures} found. */
export type UiPicturesGathered = {
  readonly pictures: ReadonlyMap<string, UiExportPicture>;
  /** Why each picture that is not in `pictures` is not. */
  readonly left: ReadonlyMap<string, string>;
  /** Bytes embedded. */
  readonly bytes: number;
};

/**
 * Reads the pictures an export wants through `read` (which returns the stored bytes of a picture, or `null` when the store
 * no longer holds it) and keeps those that fit in `maxBytes` in total. A picture that is not stored, is not a PNG, JPEG, GIF or
 * WebP, cannot be read, or would pass the budget is recorded in `left` with the reason; the pictures are taken in the page's
 * order, so which are left out is deterministic. A `read` that throws is a picture left out, never a failed export.
 */
export async function gatherUiPictures(wanted: readonly UiPictureWant[], read: (want: UiPictureWant) => Promise<Uint8Array | null>, options: { readonly maxBytes: number }): Promise<UiPicturesGathered> {
  const pictures = new Map<string, UiExportPicture>();
  const left = new Map<string, string>();
  let bytes = 0;
  for (const want of wanted) {
    let data: Uint8Array | null;
    try { data = await read(want); } catch (error) { left.set(want.key, `could not be read (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`); continue; }
    if (!data) { left.set(want.key, 'is not stored in its layer'); continue; }
    const contentType = sniffImage(data);
    if (!contentType) { left.set(want.key, 'is not a PNG, JPEG, GIF or WebP image'); continue; }
    if (bytes + data.length > options.maxBytes) { left.set(want.key, `would pass the export's size limit of ${(options.maxBytes / 1024 / 1024).toFixed(0)} MiB`); continue; }
    bytes += data.length;
    pictures.set(want.key, { contentType, data });
  }
  return { pictures, left, bytes };
}

const WORDS: Readonly<Record<UiCoverage, string>> = { captured: 'Captured', failed: 'Capture failed', capturing: 'Capturing', skipped: 'Skipped', missing: 'Not captured yet' };

const escapes: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (text: string | number) => String(text).replace(/[&<>"']/g, character => escapes[character]!);

function base64(data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(text);
}

/** JSON that is safe inside a `<script>`: nothing in it can close the element or start a comment. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const webAddress = (uri: string | undefined) => (uri && /^https?:\/\//i.test(uri) ? uri : null);

const STYLE = `
:root{color-scheme:light dark;--line:#8886;--soft:#8882;--good:#1a7f37;--bad:#cf222e;--wait:#0969da}
body{margin:0 auto;max-width:96rem;padding:1.5rem;font:16px/1.5 system-ui,sans-serif}
h1{margin:0 0 .25rem}h2{margin:0;font-size:1.1rem}h3{margin:1.5rem 0 .5rem}
.muted{opacity:.75}.small{font-size:.85rem}
.bar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin:1rem 0}
.bar input,.bar select{font:inherit;padding:.35rem .5rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit}
.bar input{min-width:18rem}
ul.states{list-style:none;margin:0;padding:0;display:grid;gap:1rem}
li.state{border:1px solid var(--line);border-radius:8px;padding:1rem}
li.state[hidden],figure[hidden]{display:none}
.cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:1rem;margin-top:.75rem}
figure{margin:0;border:1px solid var(--soft);border-radius:6px;padding:.5rem}
figure img{display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid var(--soft)}
.nopic{padding:1.5rem .5rem;text-align:center;opacity:.8;border:1px dashed var(--line)}
figcaption{margin-top:.5rem}
.tag{display:inline-block;padding:0 .5rem;border:1px solid currentColor;border-radius:999px;font-size:.8rem}
[data-coverage=captured] .tag{color:var(--good)}[data-coverage=failed] .tag{color:var(--bad)}[data-coverage=capturing] .tag{color:var(--wait)}
.note{border-left:4px solid var(--line);padding:.25rem .75rem;margin:.5rem 0}
table{border-collapse:collapse}th,td{text-align:left;padding:.25rem .75rem;border-bottom:1px solid var(--soft)}
code{font-family:ui-monospace,monospace;font-size:.9em}
`;

const SCRIPT = `
(function(){
  var q=document.getElementById('q'),c=document.getElementById('coverage'),n=document.getElementById('shown');
  if(!q||!c)return;
  var items=[].slice.call(document.querySelectorAll('li.state'));
  function run(){
    var terms=q.value.toLowerCase().split(/\\s+/).filter(Boolean),want=c.value,shown=0;
    items.forEach(function(item){
      var text=item.getAttribute('data-text')||'',ok=terms.every(function(t){return text.indexOf(t)>=0});
      var cells=[].slice.call(item.querySelectorAll('figure')),any=false;
      cells.forEach(function(cell){var on=!want||cell.getAttribute('data-coverage')===want;cell.hidden=!on;any=any||on});
      var show=ok&&any;item.hidden=!show;if(show)shown++;
    });
    if(n)n.textContent=shown+' of '+items.length+' states shown';
  }
  q.addEventListener('input',run);c.addEventListener('change',run);run();
})();
`;

function cellHtml(state: UiCatalogState, cell: UiCell, options: UiExportOptions): string {
  const capture = cell.capture;
  const key = uiPictureKey(capture);
  const picture = key ? options.pictures?.get(key) : undefined;
  const address = webAddress(capture?.image?.uri);
  const shows = cell.coverage === 'captured' || cell.coverage === 'failed';
  let figure: string;
  if (shows && picture) {
    const { width, height } = capture!.image!;
    figure = `<img alt="${esc(`${state.title}, ${cell.profile.label}`)}" loading="lazy" src="data:${picture.contentType};base64,${base64(picture.data)}"${width && height ? ` width="${esc(width)}" height="${esc(height)}"` : ''}>`;
  } else if (shows && capture?.image?.omitted) figure = `<div class="nopic">Picture left out by its producer (${esc(capture.image.omitted)})</div>`;
  else if (shows && key && options.left?.get(key)) figure = `<div class="nopic">The picture ${esc(options.left.get(key)!)}</div>`;
  else if (shows && address) figure = `<div class="nopic"><a href="${esc(address)}" rel="noopener noreferrer">Open the picture at its address</a></div>`;
  else figure = `<div class="nopic">${cell.coverage === 'captured' ? 'Captured without a picture' : esc(WORDS[cell.coverage])}</div>`;
  const origin = capture?.origin;
  const where = origin ? [
    `layer <code>${esc(origin.layer.slice(0, 12))}</code> in backend <code>${esc(origin.backend)}</code>`, `producer ${esc(origin.producer)}`,
    capture!.labels.shard ? `shard ${esc(capture!.labels.shard)}` : '', origin.branch ? esc(origin.branch) : '', origin.sha ? `<code>${esc(origin.sha.slice(0, 12))}</code>` : '',
    `<time datetime="${esc(new Date(origin.recordedAtMs).toISOString())}">${esc(new Date(origin.recordedAtMs).toISOString().slice(0, 19).replace('T', ' '))} UTC</time>`,
    origin.freshness === 'modified' ? 'recorded with local changes' : origin.freshness === 'unknown' ? 'origin not captured' : ''
  ].filter(Boolean).join(', ') : cell.planned ? `expected by plan layer <code>${esc(cell.planned.layer.slice(0, 12))}</code>; nothing has been captured` : '';
  return `<figure data-coverage="${esc(cell.coverage)}" data-profile="${esc(cell.profile.key)}">${figure}<figcaption><strong>${esc(cell.profile.label)}</strong> <span class="tag">${esc(WORDS[cell.coverage])}</span>${cell.expected === 'undeclared' ? ' <span class="small muted">not in the expected set</span>' : ''}${capture?.detail ? `<div class="small">${esc(capture.detail)}</div>` : ''}${where ? `<div class="small muted">${where}</div>` : ''}</figcaption></figure>`;
}

function stateHtml(state: UiCatalogState, index: number, options: UiExportOptions): string {
  const facts = [['Route', state.route], ['Fixture', state.fixture], ['Cohort', state.cohort], ['Area', state.area], ['Feature flags', state.flags.join(', ')], ['Surfaces covered', state.covers.join(', ')], ['Producers', state.producers.join(', ')]]
    .filter(([, value]) => value).map(([name, value]) => `${esc(name!)}: ${esc(value!)}`).join(' · ');
  const text = [state.id, state.title, state.route, state.fixture, state.cohort, state.area, ...state.flags, ...state.covers, ...state.producers].filter(Boolean).join(' ').toLowerCase();
  return `<li class="state" id="state-${index}" data-text="${esc(text)}"><h2>${esc(state.title)}</h2><div class="small muted"><code>${esc(state.id)}</code>${facts ? ` · ${facts}` : ''}</div><div class="cells">${state.cells.map(cell => cellHtml(state, cell, options)).join('')}</div></li>`;
}

/**
 * The whole catalog as one self-contained HTML document. See the module description for what it contains and how it treats
 * the data in it. Deterministic for the same catalog, pictures and `generatedAtMs`.
 *
 * @example
 * ```ts
 * const wanted = uiPicturesWanted(catalog);
 * const { pictures, left } = await gatherUiPictures(wanted, want => readPicture(want), { maxBytes: 32 * 1024 * 1024 });
 * await writeFile('catalog.html', uiCatalogHtml(catalog, { pictures, left }));
 * ```
 */
export function uiCatalogHtml(catalog: UiCatalog, options: UiExportOptions = {}): string {
  const { summary } = catalog;
  const title = options.title ?? 'UI catalog';
  const made = new Date(options.generatedAtMs ?? Date.now()).toISOString();
  const open = catalog.surfaces.filter(surface => surface.status !== 'covered');
  const unavailable = catalog.sources.backends.filter(backend => !backend.available);
  const notices = [...catalog.sources.notices, ...unavailable.map(backend => `${backend.label} is not available: captures held there are not shown, and nothing that depends on them is shown as captured.`)];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><h1>${esc(title)}</h1>
<p class="muted">Made ${esc(made.slice(0, 19).replace('T', ' '))} UTC from ${esc(catalog.sources.layers)} layer${catalog.sources.layers === 1 ? '' : 's'}. This is a copy as of that moment; it does not update.</p>
<p role="status">${esc(summary.states)} state${summary.states === 1 ? '' : 's'} in ${esc(summary.profiles)} profile${summary.profiles === 1 ? '' : 's'}: ${UI_COVERAGE.map(value => `${esc(summary.coverage[value])} ${esc(WORDS[value].toLowerCase())}`).join(', ')}.${summary.planned ? (summary.undeclared ? ` ${esc(summary.undeclared)} captured cells are not in the expected set.` : '') : ' No expected set was published, so what should exist is unknown and nothing is listed as not captured yet.'}</p>
${notices.map(notice => `<p class="note" role="status">${esc(notice)}</p>`).join('\n')}
</header>
<form class="bar" role="search" onsubmit="return false"><label>Search <input id="q" type="search" placeholder="Words in a state, route, area, surface…"></label>
<label>Show <select id="coverage"><option value="">every coverage</option>${UI_COVERAGE.map(value => `<option value="${value}">${esc(WORDS[value])}</option>`).join('')}</select></label>
<span id="shown" class="muted small" role="status"></span></form>
${open.length ? `<section aria-label="Surfaces without a captured state"><h3>Surfaces without a captured state</h3><table><thead><tr><th scope="col">Surface</th><th scope="col">Coverage</th></tr></thead><tbody>${open.map(surface => `<tr><td>${esc(surface.id)}</td><td>${surface.status === 'uncovered' ? 'No state covers it' : 'States cover it, none captured yet'}</td></tr>`).join('')}</tbody></table></section>` : ''}
<main><ul class="states" aria-label="States">
${catalog.states.map((state, index) => stateHtml(state, index, options)).join('\n')}
</ul>${catalog.states.length ? '' : '<p class="muted">No UI states have been recorded.</p>'}</main>
<script type="application/json" id="ui-catalog">${scriptJson(catalog)}</script>
<script>${SCRIPT}</script>
</body></html>
`;
}
