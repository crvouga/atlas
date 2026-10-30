/** @module Rich catalog search
 * One keyboard-operated chip input for product terms, recorded facets and sorting, backed by the URL.
 */
import { ActionIcon, Badge, Combobox, Group, Pill, PillsInput, NativeSelect, SimpleGrid, ScrollArea, Stack, Text, useCombobox } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useMemo, useRef } from 'react';
import type { UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { addCatalogTokens, catalogChipLabel, catalogTokens, catalogToken, CATALOG_SORTS, CLEAR_CATALOG_SEARCH, suggestCatalog } from './query';
import { useCatalogNavigate } from './search';

/** Rich search with live previews; Enter/Tab commits terms and Backspace reopens the last chip for editing. */
export function UiCatalogFilters({ catalog, expression, draft, onDraft, issues }: { catalog: UiCatalog; expression: string; draft: string; onDraft: (value: string, base?: string) => void; issues: readonly string[] }) {
  const go = useCatalogNavigate();
  const field = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const selected = useMemo(() => catalogTokens(expression), [expression]);
  const suggestions = useMemo(() => suggestCatalog(catalog, draft, selected), [catalog, draft, selected]);
  const set = (next: string) => go({ ...CLEAR_CATALOG_SEARCH, find: next || undefined });
  const add = (value: string) => {
    set(addCatalogTokens(selected, value));
    onDraft('');
    combobox.resetSelectedOption();
    field.current?.focus();
  };
  const choose = (name: string, value: string) => {
    const rest = selected.filter(token => token.field !== name);
    set(value ? addCatalogTokens(rest, catalogToken(name, value)) : rest.map(token => token.raw).join(' '));
  };
  const chosen = (name: string) => selected.find(token => token.field === name)?.value ?? '';
  const remove = (index: number) => set(selected.filter((_, at) => at !== index).map(token => token.raw).join(' '));
  return (
    <Stack gap="xs" component="section" aria-label="Catalog search">
      <Combobox store={combobox} onOptionSubmit={add} withinPortal={false} keepMounted={false}>
        <Combobox.DropdownTarget>
          <PillsInput
            label="Search catalog"
            description="Combine terms, filters and sorting. Every search term must match. Close spellings and common related terms work too."
            error={issues.length ? issues.join(' ') : undefined}
            leftSection={<IconSearch size={16} aria-hidden="true" />}
            rightSection={(expression || draft) ? <ActionIcon variant="subtle" aria-label="Clear catalog search" onClick={() => { set(''); onDraft(''); field.current?.focus(); }}><IconX size={16} aria-hidden="true" /></ActionIcon> : undefined}
            onClick={() => { field.current?.focus(); combobox.openDropdown(); }}
          >
            <Pill.Group>
              {selected.map((token, index) => (
                <Pill key={`${index}:${token.raw}`} withRemoveButton onRemove={() => { remove(index); field.current?.focus(); }} removeButtonProps={{ 'aria-label': `Remove ${catalogChipLabel(catalog, token)}`, 'aria-hidden': false, tabIndex: 0 }}>
                  {catalogChipLabel(catalog, token)}
                </Pill>
              ))}
              <Combobox.EventsTarget withExpandedAttribute>
                <PillsInput.Field
                  ref={field}
                  aria-label="Search catalog"
                  aria-autocomplete="list"
                  value={draft}
                  placeholder={selected.length ? 'Add another term or filter…' : 'Try appointment error, area:checkout or sort:recent…'}
                  onFocus={() => combobox.openDropdown()}
                  onBlur={() => combobox.closeDropdown()}
                  onChange={event => { onDraft(event.currentTarget.value); combobox.openDropdown(); combobox.resetSelectedOption(); }}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || (event.key === 'Tab' && event.shiftKey)) return;
                    if ((event.key === 'Enter' || event.key === 'Tab') && draft.trim() && combobox.getSelectedOptionIndex() < 0) {
                      event.preventDefault(); add(draft);
                    } else if (event.key === 'Tab' && combobox.getSelectedOptionIndex() >= 0 && combobox.dropdownOpened) {
                      event.preventDefault(); combobox.clickSelectedOption();
                    } else if (event.key === 'Backspace' && !draft && selected.length) {
                      event.preventDefault();
                      const next = selected.slice(0, -1).map(token => token.raw).join(' ');
                      onDraft(selected.at(-1)!.raw, next); set(next); combobox.openDropdown();
                    }
                  }}
                />
              </Combobox.EventsTarget>
            </Pill.Group>
          </PillsInput>
        </Combobox.DropdownTarget>
        <Combobox.Dropdown>
          <ScrollArea.Autosize mah="40vh" type="auto">
            <Combobox.Options aria-label="Search suggestions">
              {draft.trim() && <Combobox.Option value={draft.trim()}><Text>Search for “{draft.trim()}”</Text><Text size="xs" c="dimmed">Add your own words or a complete filter expression</Text></Combobox.Option>}
              {suggestions.map(suggestion => (
                <Combobox.Option key={suggestion.value} value={suggestion.value}>
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={0} miw={0}>
                      <Text truncate>{suggestion.label}</Text>
                      <Text size="xs" c="dimmed" truncate>{suggestion.detail}</Text>
                    </Stack>
                    {suggestion.count !== undefined && <Badge color="gray">{suggestion.count}</Badge>}
                  </Group>
                </Combobox.Option>
              ))}
              {!draft.trim() && !suggestions.length && <Combobox.Empty>Type any words to search recorded UI states.</Combobox.Empty>}
            </Combobox.Options>
          </ScrollArea.Autosize>
          <Combobox.Footer><Text size="xs" c="dimmed">Up/Down to choose · Enter or Tab to add · Backspace to edit the last chip · Escape to close</Text></Combobox.Footer>
        </Combobox.Dropdown>
      </Combobox>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <NativeSelect label="Area" value={chosen('area')} onChange={event => choose('area', event.currentTarget.value)} data={[{ value: '', label: 'All areas' }, ...catalog.facets.areas.map(facet => ({ value: facet.value, label: `${facet.label ?? facet.value} (${facet.count})` }))]} />
        <NativeSelect label="Profile" value={chosen('profile')} onChange={event => choose('profile', event.currentTarget.value)} data={[{ value: '', label: 'All profiles' }, ...catalog.profiles.map(profile => ({ value: profile.key, label: profile.label }))]} />
        <NativeSelect label="Sort by" value={chosen('sort') || 'relevance'} onChange={event => choose('sort', event.currentTarget.value)} data={Object.entries(CATALOG_SORTS).map(([value, label]) => ({ value, label }))} />
      </SimpleGrid>
      <Text size="xs" c="dimmed">Search recorded names and facts. Try kind:error for product error screens; coverage:failed for failed captures. Type sort: to choose an order.</Text>
    </Stack>
  );
}
