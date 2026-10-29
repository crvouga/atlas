# @crvouga/atlas/critics

Automated reviewers of the UI catalog that mark which UIs need polish. A critic judges one captured UI through one small
contract; the runner owns caching, retries, rate limits, timeouts and budgets; opinions are stored as ordinary layers of
parts of kind `critique` and never change whether a report passes.

Read [the critics guide](../../docs/critics.md). The function-level reference is generated from the code:
[critics](../../docs/reference/critics.md).

| Module | |
| --- | --- |
| `contract` | `defineCritic`, the `Critic` type, `CriticError`, `RateLimitedError`, `InvalidOutputError` |
| `runner` | `runCritic`: skip what was judged, bounded concurrency, timeout, backoff, budgets, dry run |
| `critique` | build, read and key critiques; `critiqueLayer`, `readCritique`, `critiqueCurrency` |
| `publish` | `publishCritiques` |
| `marks` | `markLayer`, `publishMarks`: a reviewer's accept or dismiss of an opinion, as a layer |
| `judging` | `relativeVerdict`, `calibrate`, `gateDecision` (report, warn, gate) |
| `credentials` | references (`env:NAME`), literal-credential refusal, redaction |
| `scope` | the rule a critic-role token is held to |
