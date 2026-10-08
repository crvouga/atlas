import { describe, expect, it } from 'vitest';

import type { MachineConfig } from './types';
import { composeCharts } from './compose';
import { bundleOf } from './load';
import { parseChart } from './parse';
import { ATLAS_NS, machineToScxml, scxmlToken, scxmlToMachine } from './scxml';

const SHOP = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:atlas="${ATLAS_NS}" version="1.0" name="Shop" initial="browsing">
  <atlas:meta><atlas:description>A small shop.</atlas:description></atlas:meta>
  <state id="browsing" atlas:name="Browsing products">
    <atlas:meta>
      <atlas:description>Looking around.</atlas:description>
      <atlas:event>Catalog viewed</atlas:event>
      <atlas:event>Recommendations shown</atlas:event>
      <atlas:check>Shows the catalog</atlas:check>
      <atlas:source>docs/shop.md</atlas:source>
      <atlas:confidence>confirmed</atlas:confidence>
    </atlas:meta>
    <transition event="adds-to-cart" atlas:name="Adds to cart" target="cart"/>
  </state>
  <state id="cart" atlas:name="Cart with items">
    <atlas:meta><atlas:description>Items wait in the cart.</atlas:description></atlas:meta>
    <transition event="checks-out" atlas:name="Checks out" target="checking-out"/>
  </state>
  <state id="checking-out" atlas:name="Checking out">
    <atlas:meta><atlas:description>The checkout chart runs here.</atlas:description></atlas:meta>
    <invoke id="pay" src="checkout.machine.yaml" atlas:name="Checkout"/>
    <transition event="done.invoke.pay" target="placed"/>
  </state>
  <parallel id="placed" atlas:name="Order placed">
    <atlas:meta><atlas:description>The order exists.</atlas:description></atlas:meta>
    <state id="shipping" atlas:name="Shipping" initial="packing">
      <atlas:meta><atlas:description>Getting it out the door.</atlas:description></atlas:meta>
      <state id="packing" atlas:name="Packing"><atlas:meta><atlas:description>In the warehouse.</atlas:description></atlas:meta></state>
    </state>
    <state id="billing" atlas:name="Billing">
      <atlas:meta><atlas:description>Money side.</atlas:description></atlas:meta>
      <final id="paid" atlas:name="Paid in full" atlas:done-event="Order settled">
        <atlas:meta>
          <atlas:description>Settled.</atlas:description>
          <atlas:dead-end>Nothing left to do.</atlas:dead-end>
        </atlas:meta>
      </final>
    </state>
  </parallel>
</scxml>`;

describe('scxmlToMachine', () => {
  const machine = scxmlToMachine(SHOP);

  it('names the machine from the scxml name and the initial state from atlas:name', () => {
    expect(machine.id).toBe('Shop');
    expect(machine.initial).toBe('Browsing products');
    expect(machine.meta?.description).toBe('A small shop.');
  });

  it('keeps business names with spaces for states, events and targets', () => {
    expect(Object.keys(machine.states ?? {})).toEqual(['Browsing products', 'Cart with items', 'Checking out', 'Order placed']);
    expect(machine.states?.['Browsing products']?.on).toEqual({ 'Adds to cart': { target: '#Cart with items' } });
    expect(machine.states?.['Cart with items']?.on).toEqual({ 'Checks out': { target: '#Checking out' } });
  });

  it('reads atlas meta, collecting repeated elements into lists', () => {
    const meta = machine.states?.['Browsing products']?.meta;
    expect(meta).toEqual({
      description: 'Looking around.',
      events: ['Catalog viewed', 'Recommendations shown'],
      checks: ['Shows the catalog'],
      source: ['docs/shop.md'],
      confidence: 'confirmed'
    });
  });

  it('turns <invoke> plus a done.invoke.<id> transition into an invoke with onDone', () => {
    const host = machine.states?.['Checking out'];
    expect(host?.invoke).toEqual({ src: 'Checkout', id: 'pay', onDone: { target: '#Order placed' } });
    expect(host?.on).toBeUndefined();
  });

  it('reads parallel, final, nested initial states, done events and dead ends', () => {
    const placed = machine.states?.['Order placed'];
    expect(placed?.type).toBe('parallel');
    expect(placed?.initial).toBeUndefined();
    expect(placed?.states?.Shipping?.initial).toBe('Packing');
    const paid = placed?.states?.Billing?.states?.['Paid in full'];
    expect(paid?.type).toBe('final');
    expect(paid?.meta?.doneEvent).toBe('Order settled');
    expect(paid?.meta?.deadEnd).toBe('Nothing left to do.');
    expect(placed?.states?.Billing?.initial).toBe('Paid in full');
  });

  it('accepts a done.invoke transition written before its <invoke>', () => {
    const xml = `<scxml xmlns="http://www.w3.org/2005/07/scxml" name="Late" initial="a">
      <state id="a"><transition event="done.invoke.child" target="b"/><invoke id="child" src="child.scxml"/></state>
      <state id="b"/>
    </scxml>`;
    expect(scxmlToMachine(xml).states?.a?.invoke).toEqual({ src: 'child', id: 'child', onDone: { target: '#b' } });
  });

  it('rejects a document without an <scxml> root', () => {
    expect(() => scxmlToMachine('<statechart/>')).toThrow(/no <scxml> root/);
  });

  it('falls back to the file name when the document has no name', () => {
    const chart = parseChart('charts/door.scxml', '<scxml xmlns="http://www.w3.org/2005/07/scxml"><state id="open"/></scxml>');
    expect(chart).toMatchObject({ file: 'charts/door.scxml', format: 'scxml', machine: { id: 'door', initial: 'open' } });
  });
});

describe('scxmlToken', () => {
  it('makes XML-safe tokens and never starts with a digit', () => {
    expect(scxmlToken('Adds to cart')).toBe('adds-to-cart');
    expect(scxmlToken('  Café: paid!  ')).toBe('cafe-paid');
    expect(scxmlToken('3-D Secure')).toBe('s-3-d-secure');
  });
});

describe('machineToScxml round trip', () => {
  const original: MachineConfig = {
    id: 'Shop',
    initial: 'Browsing products',
    meta: { description: 'A small shop.' },
    states: {
      'Browsing products': {
        meta: { description: 'Looking around.', events: ['Catalog viewed'], checks: ['Shows the catalog'], confidence: 'assumed' },
        on: { 'Adds to cart': { target: '#Cart with items' } }
      },
      'Cart with items': {
        meta: { description: 'Items wait.' },
        on: { 'Checks out': '#Checking out', "Empties the cart (all of it)": '#Browsing products' }
      },
      'Checking out': {
        meta: { description: 'Checkout runs here.', childFinalEvents: { Paid: 'Payment accepted' } },
        invoke: { src: 'Checkout flow', id: 'pay step', onDone: '#Order placed' }
      },
      'Order placed': {
        type: 'parallel',
        meta: { description: 'Done.' },
        states: {
          Shipping: { initial: 'Packing', meta: { description: 'Ship.' }, states: { Packing: { meta: { description: 'Pack.' } } } },
          Billing: { meta: { description: 'Bill.' }, states: { 'Paid in full': { type: 'final', meta: { description: 'Paid.', doneEvent: 'Order settled', deadEnd: 'Final.' } } } }
        }
      }
    }
  };

  const xml = machineToScxml(original);
  const back = scxmlToMachine(xml);

  it('writes standard SCXML with the atlas namespace and token ids', () => {
    expect(xml).toContain('<scxml xmlns="http://www.w3.org/2005/07/scxml"');
    expect(xml).toContain(`xmlns:atlas="${ATLAS_NS}"`);
    expect(xml).toContain('id="browsing-products" atlas:name="Browsing products"');
    expect(xml).toContain('event="adds-to-cart"');
    expect(xml).toContain('<parallel');
    expect(xml).toContain('<final');
  });

  it('keeps every name with spaces and punctuation', () => {
    expect(Object.keys(back.states ?? {})).toEqual(Object.keys(original.states ?? {}));
    expect(back.initial).toBe('Browsing products');
    expect(back.states?.['Cart with items']?.on).toEqual({
      'Checks out': { target: '#Checking out' },
      'Empties the cart (all of it)': { target: '#Browsing products' }
    });
  });

  it('keeps invoke src, id and onDone', () => {
    expect(back.states?.['Checking out']?.invoke).toEqual({ src: 'Checkout flow', id: 'pay-step', onDone: { target: '#Order placed' } });
  });

  it('keeps meta, including lists, done events, dead ends and structured values', () => {
    expect(back.states?.['Browsing products']?.meta).toEqual(original.states?.['Browsing products']?.meta);
    expect(back.states?.['Checking out']?.meta).toEqual(original.states?.['Checking out']?.meta);
    const paid = back.states?.['Order placed']?.states?.Billing?.states?.['Paid in full'];
    expect(paid).toMatchObject({ type: 'final', meta: { description: 'Paid.', doneEvent: 'Order settled', deadEnd: 'Final.' } });
  });

  it('keeps parallel regions and nested initial states', () => {
    const placed = back.states?.['Order placed'];
    expect(placed?.type).toBe('parallel');
    expect(Object.keys(placed?.states ?? {})).toEqual(['Shipping', 'Billing']);
    expect(placed?.states?.Shipping?.initial).toBe('Packing');
  });

  it('round-trips a whole composed product unchanged', () => {
    const parent = parseChart('shop.scxml', SHOP);
    const child = parseChart(
      'checkout.machine.yaml',
      `id: Checkout
initial: Entering details
states:
  Entering details:
    meta: { description: Card details. }
    on: { Pays: Paid }
  Paid:
    type: final
    meta: { description: Paid. }
`
    );
    const composed = composeCharts(bundleOf('.', [parent, child], [])).machine;
    const again = scxmlToMachine(machineToScxml(composed));
    expect(machineToScxml(again)).toBe(machineToScxml(composed));
  });
});
