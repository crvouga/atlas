import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

import {
  AtlasFileSchema,
  CloudEventSchema,
  JourneysFileSchema,
  ManifestEnvelopeSchema,
  PathRecordSchema,
  RunsIndexSchema,
  RunInfoSchema,
  RunSummarySchema,
  ReportSourcesSchema,
  AtlasChangeSchema,
  StateNodeSchema,
  StateRecordSchema,
  TimelineEntrySchema,
  TransitionRecordSchema
} from '../src/index';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
mkdirSync(out, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  'state-node': StateNodeSchema,
  journeys: JourneysFileSchema,
  atlas: AtlasFileSchema,
  manifest: ManifestEnvelopeSchema,
  'state-record': StateRecordSchema,
  'transition-record': TransitionRecordSchema,
  'path-record': PathRecordSchema,
  'timeline-entry': TimelineEntrySchema,
  'cloud-event': CloudEventSchema,
  'runs-index': RunsIndexSchema,
  'run-info': RunInfoSchema,
  'run-summary': RunSummarySchema,
  'report-sources': ReportSourcesSchema,
  'atlas-change': AtlasChangeSchema
};

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });
  const document = {
    $id: `https://github.com/crvouga/atlas/schemas/${name}.schema.json`,
    ...json
  };
  writeFileSync(path.join(out, `${name}.schema.json`), `${JSON.stringify(document, null, 2)}\n`);
}
process.stdout.write(`Wrote ${Object.keys(schemas).length} JSON Schemas to ${out}\n`);
