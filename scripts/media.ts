/** @module Example media prerequisites
 * Install cached, checkout-local recording and browser binaries for the development workflow.
 */
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
for (const args of [[path.join(root, 'node_modules/ffmpeg-static/install.js')], [path.join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium']]) {
  const child = Bun.spawn([process.execPath, ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
