import { createShikiAdapter } from '@mantine/code-highlight';
import type { HighlighterCore, LanguageInput, LanguageRegistration } from 'shiki/core';

const grammars: Record<string, () => Promise<LanguageInput>> = {
  gherkin: () => import('shiki/langs/gherkin.mjs').then((module) => module.default),
  yaml: () => import('shiki/langs/yaml.mjs').then((module) => module.default),
  xml: () => import('shiki/langs/xml.mjs').then((module) => module.default),
  json: () => import('shiki/langs/json.mjs').then((module) => module.default),
  quint: () => import('./grammars/quint.json').then((module) => module.default as unknown as LanguageRegistration),
  alloy: () => import('./grammars/alloy.json').then((module) => module.default as unknown as LanguageRegistration)
};

async function createContext() {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript')
  ]);
  const highlighter = await createHighlighterCore({ langs: [], themes: [], engine: createJavaScriptRegexEngine() });
  return {
    getLoadedLanguages: () => highlighter.getLoadedLanguages(),
    loadLanguage: (...languages: Parameters<HighlighterCore['loadLanguage']>) => highlighter.loadLanguage(...languages),
    codeToHtml: (code: string, options: Parameters<HighlighterCore['codeToHtml']>[1]) =>
      highlighter.codeToHtml(code, {
        ...options,
        transformers: [
          {
            line(node, line) {
              node.properties.id = `line-${line}`;
            }
          }
        ]
      })
  };
}
let context: ReturnType<typeof createContext> | undefined;
/** One lazy, cached syntax engine; only a viewed file's grammar is downloaded. */
export const specHighlightAdapter = createShikiAdapter(() => (context ??= createContext()), {
  resolveLanguage: (language) => grammars[language]
});

/** Choose the actual notation, never a visually similar language. */
export function specLanguage(file: string): string {
  if (/\.feature$/i.test(file)) return 'gherkin';
  if (/\.qnt$/i.test(file)) return 'quint';
  if (/\.als$/i.test(file)) return 'alloy';
  if (/\.(dmn|scxml|xml)$/i.test(file)) return 'xml';
  if (/\.ya?ml$/i.test(file)) return 'yaml';
  if (/\.json$/i.test(file)) return 'json';
  return 'text';
}
