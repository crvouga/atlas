declare module 'virtual:atlas-stories' {
  const fixture: {
    selection: {
      runs: { baseline: string; middle: string; candidate: string };
      review: { test: string; flaky: string; regressed: string; layer: string; steadyLayer: string; clip: string; pair: string; watchClip: string };
      collection: string; commits: { previous: string; current: string }; profiles: { desktop: string; mobile: string };
      critique: string; failedCritique: string; olderCritique: string; test: string; failedTest: string; run: string; behavior: string; behaviors: Record<string, string> };
    specs: Record<string, string>;
    stores: Record<string, Record<string, { base64: string; contentType: string }>>;
  };
  export default fixture;
}
