import { z } from 'zod/v4';

import {
  AtlasFileSchema,
  CloudEventSchema,
  JourneysFileSchema,
  LayerDocumentSchema,
  ReportStatusSchema,
  SpecSetSchema,
  ServerConfigSchema,
  PublishChecksSchema,
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

/** The contract, one JSON Schema (draft 2020-12) document per Zod schema, as the text of its file. */
export const SCHEMAS: Record<string, z.ZodType> = {
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
  'atlas-change': AtlasChangeSchema,
  layer: LayerDocumentSchema,
  'publish-checks': PublishChecksSchema,
  'report-status': ReportStatusSchema,
  'spec-set': SpecSetSchema,
  'server-config': ServerConfigSchema
};


export function renderSchemas(): Record<string, string> {
  return Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => {
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });
    const document = { $id: `https://github.com/crvouga/atlas/schemas/${name}.schema.json`, ...json };
    return [`${name}.schema.json`, `${JSON.stringify(document, null, 2)}\n`];
  }));
}
