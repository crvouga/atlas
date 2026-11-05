declare module 'virtual:atlas-stories' {
  const fixture: {
    selection: { critique: string; failedCritique: string; olderCritique: string; test: string; failedTest: string; run: string; behavior: string; behaviors: Record<string, string> };
    specs: Record<string, string>;
    stores: Record<string, Record<string, { base64: string; contentType: string }>>;
  };
  export default fixture;
}
