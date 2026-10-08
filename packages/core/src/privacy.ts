import type { PrivacyRules } from './run/types';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Defaults that fit any product: no real-looking emails, SSNs or card numbers in media or manifests. */
export const DEFAULT_PRIVACY: Required<PrivacyRules> = {
  deny: [
    { name: 'a US Social Security number', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    {
      name: 'a payment card number',
      pattern: /\b(?!4242[ -]?4242[ -]?4242[ -]?4242\b|4000[ -]?0000[ -]?0000[ -]?0002\b|5555[ -]?5555[ -]?5555[ -]?4444\b)(?:4\d{3}|5[1-5]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/
    }
  ],
  allowEmails: [/@example\.(com|org|net)$/i, /\.(test|example|invalid|localhost|local)$/i],
  allowHosts: ['127.0.0.1', 'localhost', '::1', '[::1]']
};

export function mergePrivacy(rules: PrivacyRules = {}): Required<PrivacyRules> {
  return {
    deny: [...DEFAULT_PRIVACY.deny, ...(rules.deny ?? [])],
    allowEmails: [...DEFAULT_PRIVACY.allowEmails, ...(rules.allowEmails ?? [])],
    allowHosts: rules.allowHosts ?? DEFAULT_PRIVACY.allowHosts
  };
}

/** What in `text` looks like real personal data, described without repeating it. */
export function privacyFindings(text: string, where: string, rules: Required<PrivacyRules>) {
  const findings: string[] = [];
  for (const email of text.match(EMAIL) ?? []) {
    const lower = email.toLowerCase();
    if (rules.allowEmails.some((p) => p.test(lower))) continue;
    findings.push(`${where}: an email address outside the allowed domains (${lower.replace(/^(.).*@/, '$1…@')})`);
  }
  for (const { name, pattern } of rules.deny) if (pattern.test(text)) findings.push(`${where}: something shaped like ${name}`);
  return findings;
}

/** Refuse to run against anything but the allowed hosts (loopback by default). */
export function assertAllowedTarget(urls: string[], rules: Required<PrivacyRules>) {
  for (const url of urls) {
    const host = new URL(url).hostname;
    if (!rules.allowHosts.includes(host)) throw new Error(`Refusing to run against ${host}: allowed hosts are ${rules.allowHosts.join(', ')}`);
  }
}
