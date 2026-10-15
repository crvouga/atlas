import { describe, expect, it } from 'bun:test';

import { TransitionTargetSchema } from './spec.js';

describe('TransitionTargetSchema', () => {
  it('keeps declarative transition metadata', () => {
    const transition = {
      target: 'Opening checkout',
      meta: { source: ['specs/billing/subscribe.feature'] }
    };

    expect(TransitionTargetSchema.parse(transition)).toEqual(transition);
  });

  it('still accepts string targets and objects without metadata', () => {
    expect(TransitionTargetSchema.parse('Open')).toBe('Open');
    expect(TransitionTargetSchema.parse({ target: '#Open' })).toEqual({ target: '#Open' });
  });

  it('requires metadata to be an object and a nonempty target', () => {
    for (const meta of [null, 'source', ['source']]) {
      expect(TransitionTargetSchema.safeParse({ target: 'Open', meta }).success).toBe(false);
    }
    expect(TransitionTargetSchema.safeParse({ target: '', meta: {} }).success).toBe(false);
  });
});
