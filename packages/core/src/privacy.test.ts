import { describe, expect, it } from 'vitest';

import { assertAllowedTarget, DEFAULT_PRIVACY, mergePrivacy, privacyFindings } from './privacy';

const scan = (text: string, rules = DEFAULT_PRIVACY) => privacyFindings(text, 'screen', rules);

describe('privacy defaults', () => {
  it('allows synthetic email domains and flags real-looking ones without repeating them', () => {
    expect(scan('Signed in as sam@example.com, cc ops@shop.test and qa@example.org')).toEqual([]);
    const findings = scan('Contact jane.doe@realmail.com');
    expect(findings).toEqual(['screen: an email address outside the allowed domains (j…@realmail.com)']);
    expect(findings.join()).not.toContain('jane.doe');
  });

  it('flags anything shaped like a Social Security number', () => {
    expect(scan('SSN 123-45-6789')).toEqual(['screen: something shaped like a US Social Security number']);
    expect(scan('Order 2026-01-02 at 12:30')).toEqual([]);
  });

  it('flags card numbers but allows the well-known test cards, spaced or not', () => {
    expect(scan('Card 4111 1111 1111 1111')).toEqual(['screen: something shaped like a payment card number']);
    expect(scan('Card 5105-1051-0510-5100')).toEqual(['screen: something shaped like a payment card number']);
    for (const test of ['4242424242424242', '4242 4242 4242 4242', '4000-0000-0000-0002', '5555 5555 5555 4444']) {
      expect(scan(`Card ${test}`), test).toEqual([]);
    }
  });

  it('allows only loopback targets by default', () => {
    expect(() => assertAllowedTarget(['http://127.0.0.1:3000', 'http://localhost:8080/app', 'http://[::1]:5173'], DEFAULT_PRIVACY)).not.toThrow();
    expect(() => assertAllowedTarget(['https://shop.example.com'], DEFAULT_PRIVACY)).toThrow(/Refusing to run against shop\.example\.com/);
  });
});

describe('mergePrivacy', () => {
  it('adds deny patterns and allowed emails to the defaults, and replaces allowed hosts', () => {
    const rules = mergePrivacy({
      deny: [{ name: 'an internal account number', pattern: /\bACCT-\d{6}\b/ }],
      allowEmails: [/@support\.shop\.io$/],
      allowHosts: ['staging.shop.io']
    });
    expect(scan('ACCT-123456 and 123-45-6789', rules)).toEqual([
      'screen: something shaped like a US Social Security number',
      'screen: something shaped like an internal account number'
    ]);
    expect(scan('help@support.shop.io', rules)).toEqual([]);
    expect(() => assertAllowedTarget(['https://staging.shop.io'], rules)).not.toThrow();
    expect(() => assertAllowedTarget(['http://127.0.0.1'], rules)).toThrow();
  });

  it('keeps the defaults when given nothing', () => {
    expect(mergePrivacy()).toEqual(DEFAULT_PRIVACY);
  });
});
