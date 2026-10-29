/**
 * @module Critics (`@crvouga/atlas/critics`)
 *
 * Automated reviewers of the UI catalog that mark which UIs need polish. A critic is a producer: it judges one captured
 * UI at a time through one small contract (`defineCritic`), the runner (`runCritic`) owns concurrency, retries, rate
 * limits, budgets and caching, and the opinions are stored as ordinary layers of parts of kind `critique` with the
 * `atlas.critique` evidence (`critiqueLayer`, `readCritique`). A critique never changes whether a report passes: it is
 * not a test result, is not counted, and only a project that opts in to `gate` mode can fail a command on a score, and
 * only from calibrated, held-out evidence. Model-based, LLM-based and heuristic critics are the same on every
 * path. Nothing here needs a model, a provider SDK or a network; critics bring their own.
 *
 * @see docs/critics.md
 */
export * from './catalog-client';
export * from './contract';
export * from './credentials';
export * from './critique';
export * from './judging';
export * from './publish';
export * from './registry';
export * from './runner';
export * from './scope';
export * from './spool';
export {
  CRITIC_PRODUCER_PREFIX, CRITIQUE_EXTENSION, CRITIQUE_PART_KIND, CRITIQUE_SCHEMA_VERSION, CritiqueSchema,
  type Critique, type CritiqueFinding
} from '../../schema/src/critique';
