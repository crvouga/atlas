import { Alert, Button, Group, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
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

/** Recorded results are still arriving. After the loading policy's bound it says so and offers another attempt. */
export function EvidenceWaiting({ label = 'Loading recorded results…', usable }: { label?: string; usable?: string }) {
  const { retry } = useEvidence();
  const stalled = useStalled(true);
  return stalled ? (
    <Alert role="status" color="orange" my="sm" title="Recorded results are taking longer than expected">
      <Group gap="sm">
        <Text span inherit>
          {usable ? `${usable} ` : ''}Results will appear here when they arrive.
        </Text>
        <Button type="button" onClick={retry} variant="subtle">
          Try again
        </Button>
      </Group>
    </Alert>
  ) : (
    <Text role="status" component="div" c="dimmed">
      {label}
    </Text>
  );
}

/** Says when some layers could not be read, so counts and results are not taken for the whole report. */
export function EvidenceIncomplete() {
  const { failed, retry } = useEvidence();
  if (failed.length === 0) return null;
  return (
    <Alert role="status" color="orange" my="sm">
      {plural(failed.length, 'layer', 'layers')} could not be read, so the results shown here may be incomplete.{' '}
      <Button type="button" onClick={retry} variant="subtle">
        Try again
      </Button>
    </Alert>
  );
}
