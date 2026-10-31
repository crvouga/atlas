/** @module Available application commands
 * Navigation is supplied by the host; page commands reuse enabled semantic controls and their own handlers.
 * Capture before opening Spotlight so modal focus management cannot hide the page being inspected.
 */
import { matchText } from './rank';
import { parseSearch } from './query';

export type AppCommand = {
  id: string;
  title: string;
  description: string;
  /** Object links remain available in command mode; content search already indexes their destinations. */
  contentLink?: boolean;
  run: () => boolean | void;
};
let captured: AppCommand[] = [];
let parent: HTMLElement | undefined;
let sequence = 0;
const ids = new WeakMap<Element, number>();

function nameOf(element: HTMLElement): string {
  const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
  const labels = (element as HTMLInputElement).labels;
  return (element.getAttribute('aria-label') || labelled || (labels ? [...labels].map(label => label.textContent).join(' ') : '') || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim();
}
function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled,[aria-disabled="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
/** Snapshot only currently available actions. Input values (including passwords/tokens) are never read. */
export function capturePageCommands() {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="menu"]')].filter(dialog => !dialog.closest('[data-atlas-command-palette]') && available(dialog));
  parent = dialogs.at(-1);
  const root = parent ?? document;
  captured = [...root.querySelectorAll<HTMLElement>('button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],input,textarea,select,[contenteditable="true"],[role="slider"]')]
    .filter(element => !element.closest('[data-atlas-command-palette]') && !element.matches('input[type="hidden"]') && available(element))
    .flatMap(element => {
      const name = nameOf(element);
      if (!name || name === 'Search and commands') return [];
      if (!ids.has(element)) ids.set(element, ++sequence);
      const field = element.matches('input,textarea,select,[contenteditable="true"],[role="slider"]');
      const toggle = element.matches('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"]');
      const scope = element.closest('section[aria-label],nav[aria-label],[role="listitem"],tr');
      const context = scope?.getAttribute('aria-label') || scope?.querySelector('h2,h3,a')?.textContent || '';
      return [{
        id: `command:page:${ids.get(element)}`,
        contentLink: element.matches('a[href]') && !element.closest('header,nav,[role="menu"]') && !element.hasAttribute('download') && element.getAttribute('target') !== '_blank',
        title: `${toggle ? 'Toggle' : field ? 'Focus' : ''}${field ? ' ' : ''}${name}`,
        description: [field && !toggle ? 'Focus to edit or choose with the keyboard' : 'Current page', context].filter(Boolean).join(' · '),
        run: () => {
          if (!available(element)) return false;
          element.focus();
          if (!field || toggle) element.click();
          return true;
        }
      }];
    });
}
/** Commands captured from the page before the palette opened. */
export const pageCommands = () => captured;
/** Nest Spotlight inside an active dialog/menu so its focus trap yields to the palette. */
export const commandPortalTarget = () => parent?.isConnected ? parent : undefined;

/** The same weighted matcher as content search can rank commands without executing them. */
export function commandDocuments(commands: readonly AppCommand[]): import('./rank').FindDoc[] {
  return commands.map(command => ({ id: command.id, title: command.title, subtitle: command.description,
    group: 'Commands', kind: 'action', status: null, related: [], recording: null,
    fields: [{ name: 'title', text: command.title }, { name: 'description', text: command.description },
      { name: 'metadata', text: `${command.title.startsWith('Focus ') ? 'change edit select choose switch set' : 'open activate execute run'} ${/download/i.test(command.title) ? 'export save file' : ''}` }],
    target: { to: '/', search: {} }
  }));
}

/** Command names are text, including notation names such as Gherkin; they are not report type filters. */
export function searchCommands(index: import('./rank').FindIndex, query: string): import('./rank').Ranked[] {
  if (!query.trim()) return index.docs.map(doc => ({ doc, score: 0, snippet: '' }));
  return matchText(index, parseSearch(query), { partial: false }) ?? [];
}
