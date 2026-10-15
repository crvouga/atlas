import { serveMain } from '../packages/server/src/main.ts';

// Repository convenience command; no project specs, reports or example modules are loaded here.
const args = process.argv.slice(2);
if (!args.includes('--port') && !process.env.ATLAS_PORT && !process.env.PORT) args.push('--port', '5180');
process.exitCode = await serveMain(args, { out: text => process.stdout.write(text) });
