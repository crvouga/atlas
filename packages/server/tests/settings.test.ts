/**
 * @module Server settings table tests
 *
 * Hold the documented table of settings (`SERVER_SETTINGS`, rendered into docs/server.md) to the loader: each
 * example, given through its flag and through its environment variable, changes the configuration as the row says.
 */
import { describe, expect, test } from 'bun:test';

import { loadServerConfig, SERVER_FLAGS, SERVER_SETTINGS } from '../src/config';

const cwd = '/work/project';
/** Any configuration file the setting `--config` names is empty. */
const read = () => '{}';

describe('every documented setting does what its row says', () => {
  for (const setting of SERVER_SETTINGS) {
    // Listening beyond this machine needs a token or --insecure; give one so the row is judged on its own setting.
    const safe = setting.key === 'host' ? ['--insecure'] : [];
    for (const variable of setting.env) {
      test(`${setting.key}: ${variable}`, () => {
        const env = { [variable]: setting.example.value };
        const config = loadServerConfig(setting.key === 'host' ? ['--insecure'] : [], env, cwd, read);
        expect(setting.example.read(config), `${variable}=${setting.example.value}`).toEqual(setting.example.expected);
      });
    }
    if (setting.flag) {
      test(`${setting.key}: ${setting.flag.split(/[ `]/)[0]}`, () => {
        const flag = setting.flag!.split(/[ `]/)[0]!;
        const argv = setting.flag!.includes('<') ? [flag, setting.example.value] : [flag];
        const config = loadServerConfig([...safe, ...argv], {}, cwd, read);
        expect(setting.example.read(config), `${argv.join(' ')}`).toEqual(setting.example.expected);
      });
    }
  }

  test('every flag the loader accepts is a row', () => {
    const documented = new Set(SERVER_SETTINGS.map(setting => setting.flag?.split(/[ `]/)[0]));
    expect(SERVER_FLAGS.filter(flag => !documented.has(flag))).toEqual([]);
  });
});
