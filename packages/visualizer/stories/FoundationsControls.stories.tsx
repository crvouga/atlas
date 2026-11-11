import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionIcon, Button, Checkbox, Chip, Group, Menu, NativeSelect, NumberInput, PasswordInput, Popover, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconDownload, IconPlayerPlay, IconSearch, IconShare, IconTrash } from '@tabler/icons-react';
import { Panel } from '../src/components/Page';
import { Sheet } from './foundations';
import { press } from './support';
const meta = { title: 'Foundations/Controls', component: Sheet } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const VARIANTS = [['default', 'Default'], ['filled', 'Primary'], ['light', 'Selected'], ['subtle', 'Quiet']] as const;
export const Buttons: Story = { args: { title: 'Buttons', description: 'Default is outlined. Filled is the one primary action of a screen, light a selected chip, subtle a quiet action.', children: (
  <Stack gap="md">
    <Panel title="Variants">
      <Group>{VARIANTS.map(([variant, label]) => <Button key={variant} variant={variant}>{label}</Button>)}</Group>
      <Group>
        <Button color="red" variant="filled" leftSection={<IconTrash size={16} aria-hidden="true" />}>Delete layers</Button>
        <Button color="red" variant="light">Remove</Button>
        <Button color="red" variant="subtle">Discard</Button>
      </Group>
    </Panel>
    <Panel title="Sizes">
      <Group align="center">{(['xs', 'compact-sm', 'sm', 'md'] as const).map((size) => <Button key={size} size={size}>Size {size}</Button>)}</Group>
    </Panel>
    <Panel title="States">
      <Group>{VARIANTS.map(([variant, label]) => <Button key={variant} variant={variant} disabled>{label} disabled</Button>)}</Group>
      <Group>{VARIANTS.map(([variant, label]) => <Button key={variant} variant={variant} loading>{label}</Button>)}</Group>
    </Panel>
    <Panel title="With icons">
      <Group>
        <Button variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />}>Watch 4 recordings</Button>
        <Button leftSection={<IconDownload size={16} aria-hidden="true" />}>Download</Button>
        <Button variant="subtle" leftSection={<IconShare size={16} aria-hidden="true" />}>Share screen</Button>
        <Tooltip label="View options"><ActionIcon aria-label="View options"><IconAdjustmentsHorizontal size={18} aria-hidden="true" /></ActionIcon></Tooltip>
        <ActionIcon variant="default" aria-label="Search"><IconSearch size={18} aria-hidden="true" /></ActionIcon>
        <ActionIcon variant="filled" aria-label="Play"><IconPlayerPlay size={18} aria-hidden="true" /></ActionIcon>
        <ActionIcon aria-label="Share, unavailable" disabled><IconShare size={18} aria-hidden="true" /></ActionIcon>
      </Group>
    </Panel>
  </Stack>
) } };
export const Inputs: Story = { args: { title: 'Inputs', description: 'Every field has a visible label. Help sits under the label and an error replaces nothing.', children: (
  <Stack gap="md">
    <Panel title="Text">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Search tests" type="search" placeholder="pays by card" leftSection={<IconSearch size={16} aria-hidden="true" />} />
        <TextInput label="Title" description="What reviewers will see" defaultValue="Checkout review, week 42" required />
        <TextInput label="Paths under" defaultValue="checkout//" error="A path has one slash between folders." />
        <TextInput label="Commit" defaultValue="c0ffee1" disabled />
        <PasswordInput label="Token" description="Kept only in this tab." defaultValue="storybook" />
        <NumberInput label="Delete layers older than (days)" defaultValue={90} min={1} />
        <NativeSelect label="Run" data={['Latest · Oct 14, 9:04 AM', 'Oct 13, 9:05 AM · with videos', 'Oct 12, 9:04 AM · quick check']} />
        <Textarea label="Purpose" description="Why this review exists" defaultValue="Decide whether the counter payment is ready to ship." autosize minRows={2} />
      </SimpleGrid>
    </Panel>
    <Panel title="Choices">
      <Group gap="xl" align="center">
        <Switch label="Delete eligible layers on a schedule" defaultChecked />
        <Checkbox label="Also tags inherited from the check and run" defaultChecked />
        <SegmentedControl aria-label="Group by" data={['Folder', 'Domain']} defaultValue="Folder" />
      </Group>
      <Chip.Group multiple defaultValue={['failed']}>
        <Group gap="xs" role="group" aria-label="Status">
          {['passed', 'failed', 'running', 'not-run'].map((status) => <Chip key={status} value={status} variant="light">{status}</Chip>)}
        </Group>
      </Chip.Group>
    </Panel>
  </Stack>
) } };
const overlays = (
  <Panel title="Menus and popovers" description="Menus list destinations or actions. A popover holds a few related settings.">
    <Group>
      <Menu position="bottom-start">
        <Menu.Target><Button variant="subtle">Explore</Button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Specs</Menu.Label>
          <Menu.Item leftSection={<IconSearch size={16} aria-hidden="true" />} aria-current="page">Gherkin</Menu.Item>
          <Menu.Item leftSection={<IconSearch size={16} aria-hidden="true" />}>Quint</Menu.Item>
          <Menu.Divider />
          <Menu.Item disabled>Statecharts</Menu.Item>
          <Menu.Item color="red" leftSection={<IconTrash size={16} aria-hidden="true" />}>Remove filter</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Popover position="bottom-start" width={280}>
        <Popover.Target><Button>Filters</Button></Popover.Target>
        <Popover.Dropdown><Stack gap="sm"><Text fw={600}>Filters</Text><Switch label="Has video" defaultChecked /><NativeSelect label="Environment" data={['Every environment', 'Desktop web', 'Mobile web']} /></Stack></Popover.Dropdown>
      </Popover>
    </Group>
  </Panel>
);
export const Menus: Story = { args: { title: 'Menus', description: 'Closed, as they sit in a toolbar.', children: overlays } };
export const MenuOpen: Story = { args: { title: 'Menu, open', children: overlays }, play: async () => { await press('button', 'Explore'); } };
export const PopoverOpen: Story = { args: { title: 'Popover, open', children: overlays }, play: async () => { await press('button', 'Filters'); } };
