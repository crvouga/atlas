import { IconListDetails, IconPhoto, IconPlayerPlay, IconRoute, IconVideo } from '@tabler/icons-react';
import { Anchor, Badge, Box, Flex, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { statusColor } from '../ui/theme';
/**
 * @module Explorer parts
 *
 * Small pieces the explorer's list, its test detail and its runs view share: the project's title, a run's short name,
 * the chips that say where a test ran and how it went there, and the badges for what its results carry.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { TestSummary } from '@crvouga/atlas/reports/test-catalog';
import { plural } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { currentProject } from '../runtime';
import { kindOfFile, specFile } from '../spec-kind';
import { Link } from '@tanstack/react-router';
import { environmentStatuses } from './groups';
/** The project's name for its title: `?project=geviti-app` reads "Geviti App". */
export function projectTitle(): string {
  return (
    currentProject()
      ?.split('-')
      .map((word) => (word[0]?.toUpperCase() ?? '') + word.slice(1))
      .join(' ') || 'Project reports'
  );
}
/** A run key for a person: the execution id a producer named, its CI run number, or `branch@sha` shortened. */
export function runName(key: string): string {
  if (key.startsWith('run:')) return key.slice(4);
  const actions = /\/actions\/runs\/(\d+)/.exec(key);
  if (actions) return `#${actions[1]}`;
  if (/^https?:/.test(key)) return key.replace(/^https?:\/\//, '').slice(0, 40);
  const [branch, sha] = key.split('@');
  return [branch, sha?.slice(0, 7)].filter(Boolean).join(' @ ') || key;
}
/** Small badges for what a test's results carry: flaky, video, screenshots, a trace, steps. */
export function Badges({ test }: { test: TestSummary }) {
  const roles = test.evidence.roles;
  const badges = [
    test.stats.flaky ? { id: 'flaky', label: 'Flaky', title: test.stats.flakyReason } : null,
    roles.includes('video') ? { id: 'video', label: 'Video', title: 'Has a video' } : null,
    roles.includes('image') || roles.includes('screenshot') ? { id: 'image', label: 'Screenshots', title: 'Has screenshots' } : null,
    roles.includes('trace') ? { id: 'trace', label: 'Trace', title: 'Has a trace' } : null,
    test.evidence.steps > 0 ? { id: 'steps', label: plural(test.evidence.steps, 'step', 'steps'), title: 'Recorded steps' } : null,
    test.live ? { id: 'live', label: 'Running now', title: 'A run is in progress' } : null
  ].filter(
    (
      badge
    ): badge is {
      id: string;
      label: string;
      title: string;
    } => badge !== null
  );
  if (!badges.length) return null;
  const icon: Record<string, ReactNode> = {
    video: <IconVideo size={12} aria-hidden="true" />,
    image: <IconPhoto size={12} aria-hidden="true" />,
    trace: <IconRoute size={12} aria-hidden="true" />,
    steps: <IconListDetails size={12} aria-hidden="true" />,
    live: <IconPlayerPlay size={12} aria-hidden="true" />
  };
  return (
    <Flex component="span" display="inline-flex" gap={6} align="center" wrap="wrap">
      {badges.map((badge) => (
        <Badge
          key={badge.id}
          size="sm"
          component="span"
          variant={badge.id === 'flaky' || badge.id === 'live' ? 'light' : 'default'}
          color={badge.id === 'flaky' ? 'orange' : badge.id === 'live' ? 'blue' : 'gray'}
          leftSection={icon[badge.id]}
          data-badge={badge.id}
          title={badge.title}
        >
          {badge.label}
        </Badge>
      ))}
    </Flex>
  );
}
/** Where a test ran and how it went there: one chip per environment. */
export function EnvironmentChips({ test }: { test: TestSummary }) {
  const environments = environmentStatuses(test);
  if (!environments.length) return null;
  return (
    <Flex component="span" display="inline-flex" gap={6} align="center" wrap="wrap">
      {environments.map(({ environment, status }) => (
        <Badge
          key={environment ?? 'none'}
          size="sm"
          component="span"
          variant="default"
          color={statusColor(status)}
          data-status={status}
          title={`${environmentLabel(environment)}: ${status}`}
          leftSection={<StatusMark status={status} size={10} />}
        >
          {environmentLabel(environment)}
        </Badge>
      ))}
    </Flex>
  );
}

/**
 * One fact of a description list: a quiet label over its value, so a grid of them aligns. Render inside a
 * `SimpleGrid component="dl"`.
 */
export function Fact({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <Stack gap={2} miw={0}>
      <Text component="dt" size="xs" c="dimmed" fw={500}>
        {label}
      </Text>
      <Box component="dd" m={0} fz="sm" fw={600} title={title}>
        {children}
      </Box>
    </Stack>
  );
}

/**
 * "Read the promise": the written spec of a result, opened on that exact check (its scenario and examples) in the spec's own page,
 * where Read, Watch and Inspect sit together. It names the check and no run, so it shows the promise as written now; the run a
 * recording came from stays one click away in the test detail. Nothing is rendered for a result without a spec of a known kind.
 */
export function ReadPromise({ specPath, check }: { specPath: string | null; check: string }) {
  const file = specPath ? specFile(specPath) : null;
  const kind = file ? kindOfFile(file) : null;
  if (!file || !kind) return null;
  return (
    <Anchor renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: file, check }} />}>
      Read the promise
    </Anchor>
  );
}
