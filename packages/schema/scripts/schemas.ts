import { z } from 'zod/v4';

import {
  AtlasFileSchema,
  CloudEventSchema,
  JourneysFileSchema,
  LayerDocumentSchema,
  SpecSetSchema,
  LiveRunStartSchema, LiveRunUpdateSchema, LiveRunSchema,
  ProjectSlugSchema, ProjectSchema, ProjectsSchema,
  ServerConfigSchema, ServerEditableSettingsSchema, ServerSettingsSnapshotSchema, UserStateSchema, GcPolicySchema, GcSnapshotSchema, GcRunResultSchema,
  CLI_RESULTS,
  UiCatalogDefinitionSchema, UiClaimRequestSchema, UiClaimSchema, UiQueueSummarySchema,
  CritiqueSchema, CritiqueMarkSchema,
  ProblemSchema, ServerInfoSchema, ReadySchema, EffectiveEvidenceSchema, EffectiveDeltaSchema, OutlineSchema, EvidencePageSchema, LayerRowsSchema, CheckDetailSchema, StoreListingSchema, StoreWriteResultSchema, ChecksResultSchema, HelloEventSchema, ReportEventSchema, TestCatalogSchema, CatalogHealthSchema, TestHistorySchema, TestReliabilitySchema, RunListSchema, RunDetailSchema,
  ReviewCollectionSchema, ReviewManifestSchema,
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
  'project-slug': ProjectSlugSchema,
  project: ProjectSchema,
  projects: ProjectsSchema,
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
  critique: CritiqueSchema,
  'critique-mark': CritiqueMarkSchema,
  'publish-checks': PublishChecksSchema,
  'spec-set': SpecSetSchema,
  'ui-catalog-definition': UiCatalogDefinitionSchema, 'ui-claim-request': UiClaimRequestSchema, 'ui-claim': UiClaimSchema, 'ui-queue-summary': UiQueueSummarySchema,
  'live-run-start': LiveRunStartSchema, 'live-run-update': LiveRunUpdateSchema, 'live-run': LiveRunSchema,
  'server-config': ServerConfigSchema,
  'server-editable-settings': ServerEditableSettingsSchema,
  'server-settings-snapshot': ServerSettingsSnapshotSchema,
  'user-state': UserStateSchema,
  'gc-policy': GcPolicySchema,
  'gc-snapshot': GcSnapshotSchema,
  'gc-run-result': GcRunResultSchema,
  // What the server answers (docs/server.md); the OpenAPI document refers to the same schemas.
  problem: ProblemSchema,
  'server-info': ServerInfoSchema,
  ready: ReadySchema,
  'effective-evidence': EffectiveEvidenceSchema,
  'effective-delta': EffectiveDeltaSchema,
  outline: OutlineSchema,
  'evidence-page': EvidencePageSchema,
  'layer-rows': LayerRowsSchema,
  'check-detail': CheckDetailSchema,
  'store-listing': StoreListingSchema,
  'store-write-result': StoreWriteResultSchema,
  'checks-result': ChecksResultSchema,
  'hello-event': HelloEventSchema,
  'report-event': ReportEventSchema,
  'test-catalog': TestCatalogSchema,
  'catalog-health': CatalogHealthSchema,
  'test-history': TestHistorySchema,
  'test-reliability': TestReliabilitySchema,
  'report-runs': RunListSchema,
  'report-run': RunDetailSchema,
  'review-collection': ReviewCollectionSchema,
  'review-manifest': ReviewManifestSchema,
  // What `atlas report … --format json` prints (docs/agents.md).
  ...Object.fromEntries(Object.values(CLI_RESULTS).map(result => [result.schemaName, result.schema]))
};


export function renderSchemas(): Record<string, string> {
  return Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => {
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });
    const document = { $id: `https://github.com/crvouga/atlas/schemas/${name}.schema.json`, ...json };
    return [`${name}.schema.json`, `${JSON.stringify(document, null, 2)}\n`];
  }));
}
