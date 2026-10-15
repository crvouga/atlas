/** @module CodeceptJS reporter
 * CodeceptJS's Mocha reporter interface carries scenario outcomes and steps to the singleton Atlas server.
 */
import AtlasMochaReporter from './mocha';
/**
 * Use `codeceptjs run --reporter @crvouga/atlas/codecept` with ATLAS_SERVER_URL and ATLAS_PUBLISH_TOKEN.
 * Upload failures fail the run; skipped scenarios remain not-run.
 * @example
 * // codecept.conf.js
 * export const config = { tests: './tests/*_test.js', reporter: '@crvouga/atlas/codecept' };
 */
export default class AtlasCodeceptReporter extends AtlasMochaReporter {
  constructor(...args: [ConstructorParameters<typeof AtlasMochaReporter>[0], ConstructorParameters<typeof AtlasMochaReporter>[1]?]) {
    super(args[0], args[1], 'codeceptjs');
  }
}
