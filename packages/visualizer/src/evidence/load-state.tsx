import { Alert, Button, Group, Loader, Stack, Text, ThemeIcon } from '@mantine/core';
import { useEffect, useState, type ReactNode } from 'react';
import { LoadError } from '../data/adapters';
import { useEvidence } from './evidence-context';
import { plural } from './format';
import { ReportsError } from './api';

/**
 * How long a read may take before the page says so. Waiting is never silent past this: the page names what is
 * affected, keeps whatever else is readable, and offers another attempt. A test shortens it.
 */
export const loadingPolicy = { stallMs: 10_000 };

/** True once `active` has stayed true for the loading policy's bound. It starts over when `active` or `scope` changes. */
export function useStalled(active: boolean, scope = ''): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!active) return;
    const timer = setTimeout(() => setStalled(true), loadingPolicy.stallMs);
    return () => clearTimeout(timer);
  }, [active, scope]);
  return active && stalled;
}

/** Is this error the server saying the thing is not there, as opposed to it failing to answer? */
export function isMissing(error: unknown): boolean {
  return (error instanceof LoadError || error instanceof ReportsError) && error.status === 404;
}

/**
 * A calm block for a place that has nothing to show yet: an icon, what is the case, one sentence and the ways on,
 * centered in its panel. `role` announces it (`status` for waiting or empty, `alert` for a failure).
 */
export function StateBlock({ icon, title, children, actions, role }: { icon?: ReactNode; title?: ReactNode; children?: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <Stack align="center" gap="xs" py="xl" px="md" ta="center" role={role}>
      {icon && (
        <ThemeIcon variant="light" color="gray" size={44} radius="xl" aria-hidden="true">
          {icon}
        </ThemeIcon>
      )}
      {title && (typeof title === 'string' ? <Text size="md" fw={600}>{title}</Text> : title)}
      {children && (
        <Text component="div" c="dimmed" maw={560}>
          {children}
        </Text>
      )}
      {actions && (
        <Group gap="xs" justify="center" mt="xs">
          {actions}
        </Group>
      )}
    </Stack>
  );
}

/** Recorded results are still arriving. After the loading policy's bound it says so and offers another attempt. */
export function EvidenceWaiting({ label = 'Loading recorded results…', usable }: { label?: string; usable?: string }) {
  const { retry } = useEvidence();
  const stalled = useStalled(true);
  return stalled ? (
    <Alert role="status" color="orange" w="100%" title="Recorded results are taking longer than expected">
      <Group gap="sm">
        <Text span>
          {usable ? `${usable} ` : ''}Results will appear here when they arrive.
        </Text>
        <Button type="button" size="compact-sm" onClick={retry}>
          Try again
        </Button>
      </Group>
    </Alert>
  ) : (
    <Group role="status" gap="xs" wrap="nowrap">
      <Loader size={14} color="gray" aria-hidden="true" />
      <Text span c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

/** Says when some layers could not be read, so counts and results are not taken for the whole report. */
export function EvidenceIncomplete() {
  const { failed, retry } = useEvidence();
  if (failed.length === 0) return null;
  return (
    <Alert role="status" color="orange" w="100%">
      <Group gap="sm" justify="space-between">
        <Text span>
          {plural(failed.length, 'layer', 'layers')} could not be read, so the results shown here may be incomplete.{' '}
        </Text>
        <Button type="button" size="compact-sm" onClick={retry}>
          Try again
        </Button>
      </Group>
    </Alert>
  );
}
