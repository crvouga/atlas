/** @module Screen handoff links
 * Portable links retain project, index scope and selected profile without copying browser credentials.
 */
import type { UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { uiScreenMarkdown } from '@crvouga/atlas/reports/ui-catalog';
import { reportsBase, staticEvidence } from '../evidence/api';
import { runtimeConfig } from '../runtime';
import { imageSource } from './Picture';
import { CatalogSearchFields, type CatalogSearch } from './search';

/** Build a browser link from known catalog fields, preserving only the outer project selector. */
export function screenViewerLink(base: string, search: CatalogSearch, state: string, profile?: string): string {
  const url = new URL(base);
  const project = url.searchParams.get('project');
  url.username = ''; url.password = ''; url.search = '';
  if (project) url.searchParams.set('project', project);
  const params = new URLSearchParams();
  for (const name of Object.keys(CatalogSearchFields) as (keyof CatalogSearch)[]) {
    const value = search[name];
    if (value && name !== 'panel') params.set(name, value);
  }
  params.set('state', state);
  if (profile) params.set('image', profile); else params.delete('image');
  url.hash = `/catalog?${params}`;
  return url.href;
}

/** Resolve an agent-readable screen document on live servers; static exports have no HTTP report API. */
export function screenDocumentLink(state: string, profile?: string): string | null {
  if (staticEvidence) return null;
  const url = new URL(`${(runtimeConfig()?.reportsUrl ?? reportsBase).replace(/\/$/, '')}/ui-catalog/detail`, window.location.href);
  url.username = ''; url.password = ''; url.search = '';
  url.searchParams.set('state', state); url.searchParams.set('format', 'markdown');
  if (profile) url.searchParams.set('image', profile);
  return url.href;
}

/** A complete screen handoff assembled from evidence already held by the viewer; it never fetches images or tokens. */
export function screenHandoff(state: UiCatalogState, cell: UiCell | undefined, search: CatalogSearch, version?: string, notices?: readonly string[]) {
  const viewerUrl = screenViewerLink(window.location.href, search, state.id, cell?.profile.key);
  const documentUrl = screenDocumentLink(state.id, cell?.profile.key);
  const imageUrls = Object.fromEntries(state.cells.flatMap(cell => {
    const source = imageSource(cell.capture?.image);
    return source ? [[cell.profile.key, new URL(source, window.location.href).href]] : [];
  }));
  return { viewerUrl, documentUrl, markdown: uiScreenMarkdown(state, { viewerUrl, documentUrl: documentUrl ?? undefined, profile: cell?.profile.key, version, imageUrls, notices }) };
}
