import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSchemas } from './schemas';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
mkdirSync(out, { recursive: true });

const files = renderSchemas();
for (const [file, text] of Object.entries(files)) writeFileSync(path.join(out, file), text);
process.stdout.write(`Wrote ${Object.keys(files).length} JSON Schemas to ${out}\n`);
