import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { Alert, Code, Flex, List, Stack, Text } from '@mantine/core';
import { StatusMark } from '../evidence/marks';
import { useLiveTests, type LiveTest } from './live-runs';
import { testsForSlot } from './report-progress';
export function useTestProgress(slot: CheckSlot | null) {
  const { index, error } = useLiveTests();
  return { tests: slot ? testsForSlot(index, slot) : [], error };
}
/** A test's own progress log. Historical evidence stays available below it. */
export function TestProgress({ tests, error }: { tests: readonly LiveTest[]; error?: string | null }) {
  if (!tests.length) return null;
  return (
    <Stack aria-label="Test progress" gap="sm">
      {tests.map(({ run, check }) => {
        const running = run.status === 'running' && check.status === 'running';
        const interrupted = run.status === 'interrupted' && check.status === 'not-run';
        const status = running ? 'running' : interrupted ? 'not-run' : check.status === 'running' ? 'not-run' : check.status;
        return (
          <Stack key={`${run.id}:${check.id}`} gap="sm">
            <Flex role="status" gap="xs" align="center" wrap="wrap" c="dimmed">
              <StatusMark status={status} />
              <Text span inherit fw={600}>
                {running
                  ? 'Running'
                  : interrupted
                    ? 'Interrupted'
                    : status === 'passed'
                      ? 'Passed'
                      : status === 'failed'
                        ? 'Failed'
                        : 'Not run'}
              </Text>
              <Text span inherit>
                {run.producer}
                {run.environment ? ` · ${run.environment}` : ''}
              </Text>
            </Flex>
            {check.detail && check.detail !== run.reason && <Code block>{check.detail}</Code>}
            {!!check.steps?.length && (
              <List aria-label="Progress log" spacing="xs" listStyleType="none" type="ordered">
                {check.steps.map((step, index) => (
                  <List.Item key={index}>
                    <Flex gap="xs" align="center" wrap="wrap">
                      <StatusMark
                        status={step.status === 'passed' || step.status === 'failed' || step.status === 'running' ? step.status : 'none'}
                        size={14}
                      />
                      <Text span inherit>
                        {step.name}
                      </Text>
                    </Flex>
                  </List.Item>
                ))}
              </List>
            )}
            {interrupted && (
              <Alert role="status" color={'blue'} my="sm">
                {run.reason ?? 'The test run was interrupted.'} No completed outcome was received for this test.
              </Alert>
            )}
          </Stack>
        );
      })}
      {error && (
        <Alert role="alert" color={'red'} my="sm">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
