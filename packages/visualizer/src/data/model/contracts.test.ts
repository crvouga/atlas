import { describe, expect, it } from 'vitest';
import { machineToScxml, type MachineConfig } from '@crvouga/atlas/spec';
import { parseSpec } from '../parse/spec';
import { createIssueSink } from '../parse/issues';
import { buildAtlasView } from './build';
import { contractCatalog, contractsForState, contractText } from './contracts';

const rule = { id: 'sign-in-rule', name: 'Outside accounts need verified addresses', source: 'specs/auth/sign-in.feature:5', steps: [
  { keyword: 'Given', text: 'a person with a verified address', table: [['person', 'address'], ['A', 'a@example.com']] },
  { keyword: 'When', text: 'they sign in', docString: 'The account belongs to that person.' },
  { keyword: 'Then', text: 'their account opens' }
] };

function view() {
  const sink = createIssueSink();
  const doc = parseSpec({ ref: null, files: [{ path: 'product.machine.json', text: JSON.stringify({ id: 'Product', initial: 'App', meta: { contracts: [rule] }, states: {
    App: { initial: 'Signing in', meta: { contracts: [rule] }, states: { 'Signing in': { initial: 'Account', states: { Account: {} } } } }
  } }) }] }, sink);
  return buildAtlasView({ spec: doc, specIssues: sink.issues, runs: [], run: null, runIssues: [], resolveMedia: () => '' });
}

describe('inline business contracts', () => {
  it('inherits the nearest capability catalog without assigning its rules to every screen', () => {
    const v = view();
    expect(v.states.get('Account')?.contracts).toEqual([]);
    expect(contractsForState(v, 'Account')).toEqual({ owner: 'App', contracts: [rule] });
    expect(contractCatalog(v, 'Product')).toEqual([{ state: 'App', contract: rule }]);
    expect(contractText(rule)).toContain('a@example.com');
    expect(contractText(rule)).toContain('The account belongs');
  });

  it('normalizes JSON contract metadata in SCXML', () => {
    const doc = parseSpec({ ref: null, files: [{ path: 'product.scxml', text: `<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:atlas="https://github.com/crvouga/atlas/ns/1" name="Product" initial="home"><state id="home" atlas:name="Home"><atlas:meta><atlas:contracts><![CDATA[${JSON.stringify([rule])}]]></atlas:contracts></atlas:meta></state></scxml>` }] });
    expect(doc.states.get('Home')?.meta.contracts).toEqual([rule]);
  });

  it('preserves structured contracts through the public Atlas SCXML exporter and reader', () => {
    const machine: MachineConfig = { id: 'Product', initial: 'Home', meta: { contracts: [rule] }, states: { Home: { meta: { contracts: [rule], description: 'A & B < C' } } } };
    const doc = parseSpec({ ref: null, files: [{ path: 'product.scxml', text: machineToScxml(machine) }] });
    expect(doc.charts[0]?.meta.contracts).toEqual([rule]);
    expect(doc.states.get('Home')?.meta.contracts).toEqual([rule]);
    expect(doc.states.get('Home')?.meta.description).toBe('A & B < C');
  });
});
