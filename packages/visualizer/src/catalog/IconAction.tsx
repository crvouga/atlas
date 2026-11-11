/**
 * @module Catalog icon action
 *
 * A quiet icon button for the catalog's toolbars and cards. Its name is never the picture alone: it is the control's
 * accessible name, its text for assistive technology and the command palette, and a tooltip for everyone else.
 */
import { ActionIcon, Tooltip, VisuallyHidden, type ActionIconProps } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** An icon button named by `label`. `tip` replaces the tooltip's words when the name carries more context than a pointer needs. */
export function IconAction({ label, tip, children, ...rest }: { label: string; tip?: string; children: ReactNode } & ActionIconProps & Omit<ComponentPropsWithoutRef<'button'>, 'color' | 'children'>) {
  return (
    <Tooltip label={tip ?? label}>
      <ActionIcon variant="subtle" color="gray" aria-label={label} {...rest}>
        {children}
        <VisuallyHidden>{label}</VisuallyHidden>
      </ActionIcon>
    </Tooltip>
  );
}
