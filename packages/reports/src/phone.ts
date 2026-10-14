/**
 * @module Phone frame geometry
 *
 * The fixed size of the phone-shaped frame snapshots are shown in, how to scale it to a box, and cleaning of
 * recorded page HTML before it is shown.
 */

/** Width of the phone frame snapshots render in, in CSS pixels. */
export const PHONE_W = 390;
/** Height of the phone frame snapshots render in, in CSS pixels. */
export const PHONE_H = 844;

const SHELL_LINK_RE =
  /<link\b[^>]*href=["'][^"']*snapshot-shell\.css["'][^>]*>\s*/gi;
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;

/**
 * The scale to draw the phone frame at: a fixed `0.5`, `0.75` or `1` for modes `'50'`, `'75'`, `'100'`; for any other
 * mode, the largest scale up to 1 that fits a wrapper of `wrapW` by `wrapH` pixels (leaving 8 px), or `0.4` when
 * that is not a positive finite number.
 */
export function zoomScale(mode: string, wrapW: number, wrapH: number): number {
  if (mode === '50') return 0.5;
  if (mode === '75') return 0.75;
  if (mode === '100') return 1;
  const s = Math.min(1, (wrapW - 8) / PHONE_W, (wrapH - 8) / PHONE_H);
  return !Number.isFinite(s) || s <= 0 ? 0.4 : s;
}

/**
 * Removes every `<script>` element and the `<link>` to `snapshot-shell.css` from recorded page HTML. The stylesheet is
 * replaced by the layer's `frame.css`. This is a regex rewrite, not a sanitiser: inline event handlers and everything
 * else stay, so it is not a security boundary (render snapshots in a sandbox).
 */
export function cleanSnapshotHtml(html: string): string {
  return html.replace(SCRIPT_RE, '').replace(SHELL_LINK_RE, '');
}
