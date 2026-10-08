import { describe, expect, it } from 'vitest';

import { parseKnownIssues, parseOpenQuestions } from './markdown';

const QUESTIONS = `# Open questions

Intro text that is not a question.

## Paying

6. **Saved cards after a refund.** Nothing removes the saved card.
   When the customer orders again, the saved card is offered first.
   - S: Refund issued, Told the card was saved.
   - T: Waiting for the payment → Refund is issued; Refund issued → Orders again.
7. **An order in progress when the shop closes.** Nothing cancels it.
   - T: Drink being made → Shop closes; Drink ready for pickup → Barista finishes the drink after closing.
   - Spec today: the drink is made with **no pickup window**.
8. **Guest customers.** What can they do?
   - S: Paid, waiting for the barista (assumed).
   - T: Asks for a receipt.

## Pickup

12. **Curbside pickup.** S: and T: on one line.
    - S: \`Order placed\`, Drink ready for pickup. T: every pickup path.

## Not modeled

27. These are outside this spec today:
    - tips and split bills
    - **gift** and promo codes
`;

const KNOWN = new Set(['Refund issued', 'Told the card was saved', 'Paid, waiting for the barista', 'Order placed', 'Drink ready for pickup']);

describe('parseOpenQuestions', () => {
  const { questions, excluded } = parseOpenQuestions('open-questions.md', QUESTIONS, KNOWN);
  const byNumber = (n: number) => questions.find((q) => q.number === n)!;

  it('reads every numbered question under its section', () => {
    expect(questions.map((q) => [q.number, q.section])).toEqual([
      [6, 'Paying'],
      [7, 'Paying'],
      [8, 'Paying'],
      [12, 'Pickup']
    ]);
    expect(byNumber(6)).toMatchObject({
      file: 'open-questions.md',
      title: 'Saved cards after a refund.',
      body: 'Nothing removes the saved card. When the customer orders again, the saved card is offered first.'
    });
  });

  it.each<[number, string[], { source: string; event: string }[]]>([
    [6, ['Refund issued', 'Told the card was saved'], [
      { source: 'Waiting for the payment', event: 'Refund is issued' },
      { source: 'Refund issued', event: 'Orders again' }
    ]],
    [7, [], [
      { source: 'Drink being made', event: 'Shop closes' },
      { source: 'Drink ready for pickup', event: 'Barista finishes the drink after closing' }
    ]],
    [8, ['Paid, waiting for the barista'], [{ source: '', event: 'Asks for a receipt' }]],
    [12, ['Order placed', 'Drink ready for pickup'], []]
  ])('question %i names its states and transitions', (number, states, transitions) => {
    expect(byNumber(number).states).toEqual(states);
    expect(byNumber(number).transitions).toEqual(transitions);
  });

  it('keeps "Spec today" apart from the references', () => {
    expect(byNumber(7).specToday).toBe('the drink is made with no pickup window.');
    expect(byNumber(6).specToday).toBeNull();
  });

  it('lists the "Not modeled" bullets as excluded, not as a question', () => {
    expect(excluded).toEqual(['tips and split bills', 'gift and promo codes']);
    expect(questions.some((q) => q.number === 27)).toBe(false);
  });

  it('splits on commas when no state names are known', () => {
    const plain = parseOpenQuestions('q.md', QUESTIONS);
    expect(plain.questions.find((q) => q.number === 8)!.states).toEqual(['Paid', 'waiting for the barista']);
  });
});

describe('parseKnownIssues', () => {
  const TEXT = `# Known issues

## Refund issued

- The banner flickers on first load.
- It also shows twice.

## Refund issued → Orders again

* The menu opens scrolled to the bottom.

## Something that is not a state

- \`Order placed\` uses the wrong icon.
- Nothing named here.
`;

  it.each<[number, string, string[], { source: string; event: string }[]]>([
    [0, 'The banner flickers on first load.', ['Refund issued'], []],
    [1, 'It also shows twice.', ['Refund issued'], []],
    [2, 'The menu opens scrolled to the bottom.', [], [{ source: 'Refund issued', event: 'Orders again' }]],
    [3, 'Order placed uses the wrong icon.', ['Order placed'], []]
  ])('note %i: %s', (index, title, states, transitions) => {
    const notes = parseKnownIssues('known-issues.md', TEXT, KNOWN);
    expect(notes).toHaveLength(4);
    expect(notes[index]).toMatchObject({ file: 'known-issues.md', title, states, transitions });
  });

  it('takes the first sentence as the title', () => {
    const [note] = parseKnownIssues('k.md', '## Refund issued\n\n- First sentence. Second sentence.\n', KNOWN);
    expect(note).toMatchObject({ title: 'First sentence.', body: 'First sentence. Second sentence.' });
  });
});
