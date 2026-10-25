# Spec syntax grammars

Shiki supplies Gherkin, YAML, JSON and XML. These two TextMate grammars cover the formal languages
not bundled by Shiki. They contain syntax definitions, not UI components or a second theme.

- `quint.json`: [Quint editor grammar](https://github.com/quint-co/quint/blob/main/vscode/quint-vscode/syntaxes/quint.tmLanguage.json),
  Apache-2.0. Only the language registration name is normalized to lowercase. See QUINT-APACHE-2.0.txt.
- `alloy.json`: [FM Playground's Alloy grammar](https://github.com/fm4se/fm-playground/blob/main/frontend/tools/alloy/langium/syntaxes/alloy.tmLanguage.json),
  MIT, Copyright (c) 2023 Software Engineering @ Bauhaus-Universität Weimar. See ALLOY-MIT.txt.
  The generated grammar over-escapes regular expressions; match/begin/end escapes are decoded once so
  keywords and block comments match correctly. This is the Alloy formal language, not Grafana Alloy.

Retrieved 2026-10-25. Keep licenses and sources with updates. Language/color tests exercise the actual
Shiki pipeline, including safe HTML escaping. Mantine owns code layout, line numbers, scrolling and copying.
