import { describe, expect, it } from 'vitest';

import { TransitionTargetSchema } from './spec.js';

describe('TransitionTargetSchema', () => {
  it('keeps declarative transition metadata', () => {
    const transition = {
      target: 'Opening checkout',
      meta: { source: ['specs/billing/subscribe.feature'] }
    };

    expect(TransitionTargetSchema.parse(transition)).toEqual(transition);
  });
});
