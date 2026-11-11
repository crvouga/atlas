/** @module Viewer design system
 * The sole Mantine theme and provider for the report viewer and server settings.
 */
import { CodeHighlight, CodeHighlightTabs } from '@mantine/code-highlight';
import { Spotlight } from '@mantine/spotlight';
import {
  Accordion,
  ActionIcon,
  Alert,
  DEFAULT_THEME,
  darken,
  virtualColor,
  type MantineColorsTuple,
  type CSSVariablesResolver,
  Anchor,
  Badge,
  Button,
  Card,
  createTheme,
  Drawer,
  DrawerContent,
  InputWrapper,
  List,
  MantineProvider,
  Menu,
  Modal,
  NativeSelect,
  NavLink,
  Paper,
  Popover,
  Table,
  TableScrollContainer,
  Text,
  Title,
  Tooltip
} from '@mantine/core';
import type { ReactNode } from 'react';
// Retain Mantine's scales while making small outcome labels readable on light surfaces.
const readableScale = (scale: MantineColorsTuple) =>
  scale.map((color, index) => (index >= 6 ? darken(color, 0.25) : color)) as unknown as MantineColorsTuple;
// One neutral family (zinc) for surfaces, rules and the primary action, in both color schemes.
const ink: MantineColorsTuple = ['#fafafa', '#f4f4f5', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#18181b', '#09090b'];
// The same family reversed: the primary action is near-white on dark surfaces.
const snow = [...ink].reverse().map((color, index) => (index === 8 ? '#f4f4f5' : color)) as unknown as MantineColorsTuple;
const gray: MantineColorsTuple = ['#fafafa', '#f4f4f5', '#ececee', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#63636c', '#52525b', '#3f3f46', '#27272a'];
const dark: MantineColorsTuple = ['#ececee', '#d4d4d8', '#a1a1aa', '#71717a', '#2c2c31', '#242428', '#1b1b1e', '#121214', '#0c0c0e', '#09090b'];
/** The page ground behind cards. Cards, menus and dialogs sit on Mantine's body color. */
export const GROUND = 'var(--atlas-ground)';
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--atlas-ground': '#f8f8f9',
    '--mantine-color-dimmed': 'var(--mantine-color-gray-6)',
    '--mantine-color-anchor': 'var(--mantine-color-blue-9)',
    '--mantine-color-primary-light': 'rgba(24, 24, 27, 0.06)',
    '--mantine-color-primary-light-hover': 'rgba(24, 24, 27, 0.1)',
    '--mantine-color-primary-light-color': 'var(--mantine-color-ink-8)',
    '--mantine-color-primary-outline': 'var(--mantine-color-ink-8)',
    '--mantine-color-primary-text': 'var(--mantine-color-ink-8)'
  },
  dark: {
    '--atlas-ground': '#09090b',
    '--mantine-color-anchor': 'var(--mantine-color-blue-4)',
    '--mantine-color-primary-light': 'rgba(255, 255, 255, 0.08)',
    '--mantine-color-primary-light-hover': 'rgba(255, 255, 255, 0.13)',
    '--mantine-color-primary-light-color': 'var(--mantine-color-ink-1)',
    '--mantine-color-primary-outline': 'var(--mantine-color-ink-1)',
    '--mantine-color-primary-text': 'var(--mantine-color-ink-1)'
  }
});
const code = { background: 'var(--mantine-color-body)', attributes: { pre: { tabIndex: 0 } }, withLineNumbers: true, withFirstLineIndentation: true, defaultExpanded: true, withBorder: true, radius: 'md' } as const;

/** Atlas is neutral: zinc surfaces and a near-black primary action. Color is reserved for outcomes and links. */
export const theme = createTheme({
  primaryColor: 'primary',
  primaryShade: 8,
  autoContrast: true,
  colors: {
    ink,
    snow,
    primary: virtualColor({ name: 'primary', light: 'ink', dark: 'snow' }),
    gray,
    dark,
    green: readableScale(DEFAULT_THEME.colors.green),
    red: readableScale(DEFAULT_THEME.colors.red),
    orange: readableScale(DEFAULT_THEME.colors.orange)
  },
  defaultRadius: 'md',
  radius: { xs: '0.25rem', sm: '0.375rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' },
  shadows: { xs: '0 1px 2px rgba(0, 0, 0, 0.05)', sm: '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)' },
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: { fontWeight: '600', sizes: { h1: { fontSize: '1.375rem', lineHeight: '1.3' }, h2: { fontSize: '1.0625rem', lineHeight: '1.4' }, h3: { fontSize: '0.9375rem', lineHeight: '1.45' } } },
  respectReducedMotion: true,
  focusRing: 'auto',
  components: {
    CodeHighlight: CodeHighlight.extend({ defaultProps: code }),
    CodeHighlightTabs: CodeHighlightTabs.extend({ defaultProps: { ...code, withExpandButton: true, maxCollapsedHeight: '70vh' } }),
    // Mantine List wraps labels in inline-flex; report rows need the available width.
    // Keep this single supported Styles API adjustment here, not in each feature.
    List: List.extend({ styles: { itemWrapper: { display: 'flex' }, itemLabel: { flex: 1, minWidth: 0, width: '100%' } } }),
    Button: Button.extend({ defaultProps: { size: 'sm', variant: 'default' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'lg', variant: 'subtle' } }),
    Anchor: Anchor.extend({ defaultProps: { size: 'sm', underline: 'hover' } }),
    Badge: Badge.extend({ defaultProps: { variant: 'light', tt: 'none', radius: 'sm', fw: 500 } }),
    Paper: Paper.extend({ defaultProps: { p: 'md' } }),
    Card: Card.extend({ defaultProps: { withBorder: true, padding: 'lg', radius: 'lg', shadow: 'xs' } }),
    Text: Text.extend({ defaultProps: { size: 'sm' } }),
    Title: Title.extend({ defaultProps: { textWrap: 'pretty' }, styles: { root: { letterSpacing: '-0.015em' } } }),
    InputWrapper: InputWrapper.extend({ defaultProps: { size: 'sm' } }),
    NativeSelect: NativeSelect.extend({ defaultProps: { size: 'sm' } }),
    // Mantine dims active descriptions with opacity; keep their semantic active color fully readable.
    NavLink: NavLink.extend({ styles: { root: { borderRadius: 'var(--mantine-radius-md)' }, description: { opacity: 1 } } }),
    Spotlight: Spotlight.extend({ styles: { actionDescription: { opacity: 1 } } }),
    Modal: Modal.extend({
      defaultProps: { centered: true, size: 'lg', radius: 'lg', closeButtonProps: { 'aria-label': 'Close dialog' }, overlayProps: { backgroundOpacity: 0.45, blur: 2 }, transitionProps: { duration: 120 } }
    }),
    Drawer: Drawer.extend({
      defaultProps: { position: 'right', size: 'lg', padding: 'lg', closeButtonProps: { 'aria-label': 'Close panel' }, overlayProps: { backgroundOpacity: 0.45, blur: 2 }, transitionProps: { duration: 120 } },
      // Drawer has no body-only scrolling prop; keep Paper padding and scrolled evidence out of its header.
      // See the drawer containment exception in docs/ui.md.
      styles: {
        content: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { flexShrink: 0 },
        body: { flex: 1, minHeight: 0, overflow: 'auto' }
      }
    }),
    DrawerContent: DrawerContent.extend({ defaultProps: { p: 0 } }),
    Menu: Menu.extend({ defaultProps: { shadow: 'sm', radius: 'md' } }),
    Popover: Popover.extend({ defaultProps: { shadow: 'sm', radius: 'md' } }),
    Accordion: Accordion.extend({ defaultProps: { variant: 'separated', radius: 'md' } }),
    Alert: Alert.extend({ defaultProps: { radius: 'md' } }),
    TableScrollContainer: TableScrollContainer.extend({ defaultProps: { scrollAreaProps: { viewportProps: { tabIndex: 0 } } } }),
    // Column headers read as quiet labels; Table has no header typography prop.
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'xs', horizontalSpacing: 'sm', highlightOnHover: true, tabularNums: true },
      styles: { th: { fontSize: 'var(--mantine-font-size-xs)', fontWeight: 500, color: 'var(--mantine-color-dimmed)', whiteSpace: 'nowrap' } }
    }),
    Tooltip: Tooltip.extend({ defaultProps: { openDelay: 300, withArrow: true } })
  }
});
/** Use this provider at every UI root. The scheme follows the system until the person chooses one in the header. */
export function AtlasThemeProvider({ children, env, scheme }: { children: ReactNode; env?: 'test'; scheme?: 'light' | 'dark' }) {
  return (
    <MantineProvider env={env} theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto" forceColorScheme={scheme}>
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
