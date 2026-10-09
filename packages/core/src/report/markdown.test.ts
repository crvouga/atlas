import { describe, expect, it } from 'vitest';

import type { Journey, MachineConfig } from '../spec/types';
import { toMarkdown } from './markdown';

const MACHINE: MachineConfig = {
  id: 'Shop',
  initial: 'Browsing',
  meta: { description: 'A small shop.' },
  states: {
    Browsing: {
      id: 'Browsing',
      meta: { description: 'Looks at products.', snapshot: 'A grid of products' },
      on: { 'Adds to cart': { target: '#Cart' } }
    },
    Member: {
      id: 'Member',
      type: 'parallel',
      states: {
        Cart: {
          id: 'Cart',
          initial: 'Empty',
          states: {
            Empty: { id: 'Empty', meta: { snapshot: 'empty-cart' }, on: { 'Adds to cart': { target: '#Full' } } },
            Full: {
              id: 'Full',
              meta: { confidence: 'assumed', events: ['Cart saved'] },
              on: { 'Pays | twice': { target: '#Browsing' } }
            }
          }
        },
        Account: { id: 'Account', initial: 'Signed in', states: { 'Signed in': { id: 'Signed in', type: 'final' } } }
      }
    }
  }
};

const JOURNEYS: Journey[] = [{ name: 'Buys a thing', description: 'Adds and pays.', events: ['Adds to cart', 'Pays | twice'], endsIn: ['Browsing'] }];

describe('toMarkdown', () => {
  const md = toMarkdown(MACHINE, JOURNEYS);

  it('splits parallel states into one area per region, with a contents list', () => {
    expect(md).toContain(
      '## Areas\n\n- [Browsing](#browsing)\n- [Member](#member)\n- [Member › Cart](#member--cart)\n- [Member › Account](#member--account)\n- [Journeys](#journeys)'
    );
    expect(md).toContain('## Member\n\n**Runs side by side:** [Cart](#member--cart) (Member › Cart), [Account](#member--account) (Member › Account).');
    expect(md).toContain('## Member › Cart');
    expect(md).toContain('3 areas, 7 states, 3 transitions, 1 journeys.');
  });

  it('describes each state and links every transition to its target, naming other areas', () => {
    expect(md).toContain('Looks at products.\n\n**On screen:** A grid of products');
    expect(md).toContain('| Adds to cart | [Cart](#member--cart) (Member › Cart) |');
    expect(md).toContain('| Adds to cart | [Full](#full) |');
    expect(md).toContain('| Pays \\| twice | [Browsing](#browsing) (Browsing) |');
    expect(md).toContain('**Starts at:** [Empty](#empty).');
  });

  it('leaves out snapshots written as identifiers rather than words', () => {
    expect(md).not.toContain('empty-cart');
  });

  it('flags assumed states, recorded events and final states', () => {
    expect(md).toContain('### Full\n\n_Assumed: not yet confirmed by the product owner._');
    expect(md).toContain('**Records:** Cart saved.');
    expect(md).toContain('### Signed in\n\n**Final:** the flow ends here.');
  });

  it('lists the journeys with what they must end in and their steps folded away', () => {
    expect(md).toContain('### Buys a thing\n\nAdds and pays.\n\n**Ends in:** [Browsing](#browsing) (Browsing).');
    expect(md).toContain('<details><summary>Steps</summary>\n\n1. Adds to cart\n2. Pays | twice\n\n</details>');
  });

  it('numbers repeated anchors in document order, as code hosts do', () => {
    const md2 = toMarkdown({ id: 'Areas', states: { Areas: { id: 'Areas', initial: 'X', states: { X: { id: 'X', type: 'final' } } } } });
    expect(md2).toContain('- [Areas](#areas-2)');
  });
});
