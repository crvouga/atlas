/** @module Viewer design system
 * The sole Mantine theme and provider for the report viewer and server settings.
 */
import { CodeHighlight, CodeHighlightTabs } from '@mantine/code-highlight';
import {
  ActionIcon,
  DEFAULT_THEME,
  darken,
  type MantineColorsTuple,
  type CSSVariablesResolver,
  Anchor,
  Badge,
  Button,
  Card,
  createTheme,
  Drawer,
  InputWrapper,
  List,
  MantineProvider,
  Modal,
  NativeSelect,
  Paper,
  Table,
  Text,
  Title,
  Tooltip
} from '@mantine/core';
import type { ReactNode } from 'react';
// Retain Mantine's scales while making small outcome labels readable on light surfaces.
const readableScale = (scale: MantineColorsTuple) =>
  scale.map((color, index) => (index >= 6 ? darken(color, 0.25) : color)) as unknown as MantineColorsTuple;
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-dimmed': 'var(--mantine-color-gray-7)' },
  dark: {}
});

/** Atlas uses Mantine's blue scale for navigation and standard outcome colors for evidence. */
export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 8,
  autoContrast: true,
  colors: {
    green: readableScale(DEFAULT_THEME.colors.green),
    red: readableScale(DEFAULT_THEME.colors.red),
    orange: readableScale(DEFAULT_THEME.colors.orange)
  },
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: { fontWeight: '650', sizes: { h1: { fontSize: '1.75rem' }, h2: { fontSize: '1.25rem' }, h3: { fontSize: '1rem' } } },
  respectReducedMotion: true,
  focusRing: 'auto',
  components: {
    CodeHighlight: CodeHighlight.extend({
      defaultProps: { withLineNumbers: true, withFirstLineIndentation: true, defaultExpanded: true, withBorder: true, radius: 'md' }
    }),
    CodeHighlightTabs: CodeHighlightTabs.extend({
      defaultProps: {
        withLineNumbers: true,
        withFirstLineIndentation: true,
        defaultExpanded: true,
        withBorder: true,
        radius: 'md',
        withExpandButton: true,
        maxCollapsedHeight: '70vh'
      }
    }),
    // Mantine List wraps labels in inline-flex; report rows need the available width.
    // Keep this single supported Styles API adjustment here, not in each feature.
    List: List.extend({ styles: { itemWrapper: { display: 'flex' }, itemLabel: { flex: 1, minWidth: 0, width: '100%' } } }),
    Button: Button.extend({ defaultProps: { size: 'sm', variant: 'light' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'lg', variant: 'subtle' } }),
    Anchor: Anchor.extend({ defaultProps: { size: 'sm', underline: 'hover' } }),
    Badge: Badge.extend({ defaultProps: { variant: 'light', tt: 'none' } }),
    Paper: Paper.extend({ defaultProps: { p: 'md' } }),
    Card: Card.extend({ defaultProps: { withBorder: true, padding: 'md' } }),
    Text: Text.extend({ defaultProps: { size: 'sm' } }),
    Title: Title.extend({ defaultProps: { textWrap: 'pretty' } }),
    InputWrapper: InputWrapper.extend({ defaultProps: { size: 'sm' } }),
    NativeSelect: NativeSelect.extend({ defaultProps: { size: 'sm' } }),
    Modal: Modal.extend({
      defaultProps: { centered: true, size: 'lg', overlayProps: { backgroundOpacity: 0.35 }, transitionProps: { duration: 120 } }
    }),
    Drawer: Drawer.extend({ defaultProps: { position: 'right', size: 'lg', padding: 'lg', transitionProps: { duration: 120 } } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'sm', highlightOnHover: true, tabularNums: true } }),
    Tooltip: Tooltip.extend({ defaultProps: { openDelay: 300, withArrow: true } })
  }
});
/** Use this provider at every UI root; the viewer currently has a light visual identity. */
export function AtlasThemeProvider({ children, env }: { children: ReactNode; env?: 'test' }) {
  return (
    <MantineProvider env={env} theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
      {children}
    </MantineProvider>
  );
}
/** Outcome colors shared by report badges, progress bars, and the graph. Unknown outcomes stay gray. */
export function statusColor(status: string): string {
  return status === 'passed'
    ? 'green'
    : status === 'failed'
      ? 'red'
      : status === 'flaky'
        ? 'orange'
        : status === 'running'
          ? 'blue'
          : 'gray';
}
