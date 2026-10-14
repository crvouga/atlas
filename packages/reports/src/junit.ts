/**
 * Overlay test-runner outcomes (JUnit XML) onto a report bundle. A harness run
 * only sees failures raised inside its own steps; assertions in the test body
 * surface through the runner's report instead.
 */

import type { HtmlReportBundle, HtmlReportTest } from './recording-bundle';

export type JunitCase = {
  readonly file: string;
  /** The `classname` attribute, which many runners use for the suite or the file. */
  readonly classname: string;
  /** The `name` of the `<testsuite>` the case is in. */
  readonly suite: string;
  /** Seconds, when the runner emits it. */
  readonly time: number | null;
  readonly name: string;
  /** 1-based line of the test declaration, when the runner emits it. */
  readonly line: number | null;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly failure: string | null;
  /** The case's `<system-out>`, when it has one. */
  readonly stdout?: string;
  /** The case's `<system-err>`, when it has one. */
  readonly stderr?: string;
  /** The case's `<properties>`, then its suite's: names a runner chose to record. */
  readonly properties?: Readonly<Record<string, string>>;
};

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m] ?? m);
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decodeXml(m[1] ?? '');
}

function failureText(body: string): string | null {
  const m = /<failure\b([^>]*)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body);
  if (m === null) return null;
  const message = attr(m[1] ?? '', 'message');
  const inner = (m[2] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const text = decodeXml(inner).trim();
  return text.length > 0 ? text : (message ?? 'failed');
}

function streamText(body: string, name: 'system-out' | 'system-err'): string | undefined {
  const found = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  if (!found) return undefined;
  const text = decodeXml((found[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
  return text.length ? text : undefined;
}

function propertiesOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/<property\b([^>]*?)\/?>/g)) {
    const name = attr(match[1] ?? '', 'name');
    const value = attr(match[1] ?? '', 'value');
    if (name) out[name] = value ?? '';
  }
  return out;
}

function parseCase(tag: string, inner: string, suiteFile: string, suiteName: string, suiteProperties: Record<string, string> = {}): JunitCase {
  const lineRaw = attr(tag, 'line');
  const line = lineRaw === null ? null : Number(lineRaw);
  const failure = failureText(inner);
  const time = Number(attr(tag, 'time'));
  return {
    file: attr(tag, 'file') ?? suiteFile,
    classname: attr(tag, 'classname') ?? '',
    suite: suiteName,
    time: attr(tag, 'time') !== null && Number.isFinite(time) ? time : null,
    name: attr(tag, 'name') ?? '',
    line: line !== null && Number.isFinite(line) ? line : null,
    status: caseStatus(failure, inner),
    failure,
    ...(streamText(inner, 'system-out') ? { stdout: streamText(inner, 'system-out')! } : {}),
    ...(streamText(inner, 'system-err') ? { stderr: streamText(inner, 'system-err')! } : {}),
    ...(Object.keys({ ...suiteProperties, ...propertiesOf(inner) }).length ? { properties: { ...suiteProperties, ...propertiesOf(inner) } } : {}),
  };
}

function caseStatus(
  failure: string | null,
  inner: string
): JunitCase['status'] {
  if (failure !== null) return 'failed';
  if (/<skipped\b/.test(inner)) return 'skipped';
  return 'passed';
}

/**
 * Every `<testcase>` of the document, whatever the nesting of its suites: a suite inside a suite, a case after
 * an inner suite, an empty self-closing suite. Each case is read with the suite it is in, and that suite's own
 * `<properties>`. A case is never skipped silently, because a result that goes missing reads as a pass.
 */
function allCases(xml: string): JunitCase[] {
  const cases: JunitCase[] = [];
  const stack: { file: string; name: string; properties: Record<string, string> }[] = [];
  const tags = /<(\/?)(testsuite|testcase|properties)\b([^>]*?)(\/?)>/g;
  for (let tag = tags.exec(xml); tag; tag = tags.exec(xml)) {
    const [, closing, name, attributes = '', selfClosing] = tag;
    if (name === 'testsuite') {
      if (closing) { stack.pop(); continue; }
      const suite = { file: attr(attributes, 'file') ?? '', name: attr(attributes, 'name') ?? '', properties: {} as Record<string, string> };
      if (!selfClosing) stack.push(suite);
    } else if (name === 'testcase' && !closing) {
      let inner = '';
      if (!selfClosing) {
        const end = xml.indexOf('</testcase>', tags.lastIndex);
        if (end < 0) continue;
        inner = xml.slice(tags.lastIndex, end);
        tags.lastIndex = end + '</testcase>'.length;
      }
      const suite = stack.at(-1);
      cases.push(parseCase(attributes, inner, suite?.file ?? '', suite?.name ?? '', Object.assign({}, ...stack.map(item => item.properties))));
    } else if (name === 'properties' && !closing && !selfClosing && stack.length) {
      const end = xml.indexOf('</properties>', tags.lastIndex);
      if (end < 0) continue;
      Object.assign(stack.at(-1)!.properties, propertiesOf(xml.slice(tags.lastIndex, end)));
      tags.lastIndex = end + '</properties>'.length;
    }
  }
  return cases;
}

/** Parse the `<testcase>` elements of a JUnit XML document. */
export function parseJunit(xml: string): JunitCase[] {
  return allCases(xml);
}

function sameFile(a: string, b: string): boolean {
  const na = a.replace(/\\/g, '/');
  const nb = b.replace(/\\/g, '/');
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

/**
 * The test case whose declaration precedes `sourceLine` in the same file and
 * is the nearest one (bodies follow declarations).
 */
export function matchJunitCase(
  cases: readonly JunitCase[],
  sourceFile: string,
  sourceLine: number | undefined
): JunitCase | null {
  const inFile = cases.filter((c) => sameFile(c.file, sourceFile));
  if (inFile.length === 0) return null;
  if (inFile.length === 1 || sourceLine === undefined) return inFile[0]!;
  let best: JunitCase | null = null;
  for (const c of inFile) {
    if (c.line === null || c.line > sourceLine) continue;
    if (best === null || (best.line ?? 0) < c.line) best = c;
  }
  return best;
}

function overlayTest(test: HtmlReportTest, c: JunitCase): HtmlReportTest {
  const failed = c.status === 'failed' || test.report.meta.status === 'failed';
  const status = failed ? 'failed' : c.status;
  const error =
    test.report.meta.error ?? (c.failure !== null ? c.failure : undefined);
  return {
    ...test,
    report: {
      ...test.report,
      meta: {
        ...test.report.meta,
        title: c.name.length > 0 ? c.name : test.report.meta.title,
        status,
        ...(error !== undefined ? { error } : {}),
      },
    },
  };
}

/** Apply runner outcomes / titles to every test with a known source file. */
export function applyJunitOutcomes(
  bundle: HtmlReportBundle,
  cases: readonly JunitCase[]
): HtmlReportBundle {
  const tests = bundle.tests.map((test) => {
    const { sourceFile, sourceLine } = test.report.meta;
    if (sourceFile === undefined) return test;
    const c = matchJunitCase(cases, sourceFile, sourceLine);
    return c === null ? test : overlayTest(test, c);
  });
  const failed = tests.some((t) => t.report.meta.status === 'failed');
  return { ...bundle, tests, status: failed ? 'failed' : bundle.status };
}
