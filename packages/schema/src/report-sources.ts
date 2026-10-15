/**
 * @module Report sources and change notices
 *
 * The files and events the viewer uses to find runs. `ReportSourcesSchema` validates the sources file named by
 * `ATLAS_SOURCES_FILE`, which lists extra places to read runs from (a directory, or another host over HTTP).
 * `AtlasChangeSchema` is the payload of the `atlas:change` event that tells a live viewer that specs or runs changed.
 * Both are read by the visualizer; the server sends the change notice.
 *
 * @see docs/report-backends.md
 */
import { z } from 'zod/v4';

const SourceIdentity = {
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(80),
  label: z.string().min(1).max(120)
};

const HttpLocation = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value, 'https://atlas.invalid/');
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an HTTP URL without credentials.');

/**
 * A source reached over HTTP: `type` `http` or `api`, a base URL without credentials, an optional events URL for live
 * updates, a polling interval in milliseconds (1 000 to 3 600 000) and a `live` flag. The id `workspace` is reserved
 * for the local runs directory.
 */
export const RemoteReportSourceSchema = z.object({
  ...SourceIdentity,
  type: z.enum(['http', 'api']),
  baseUrl: HttpLocation,
  eventsUrl: HttpLocation.optional(),
  pollMs: z.number().int().min(1000).max(3_600_000).optional(),
  live: z.boolean().optional()
});

/**
 * A source that is a directory of runs on the machine running the viewer. A relative `runs` path is resolved against
 * the sources file.
 */
export const DirectoryReportSourceSchema = z.object({
  ...SourceIdentity,
  type: z.literal('directory'),
  runs: z.string().min(1)
});

/** One source: a directory or a remote host. */
export const ReportSourceSchema = z.union([DirectoryReportSourceSchema, RemoteReportSourceSchema]);
/** A parsed `ReportSourceSchema` value. */
export type ReportSource = z.infer<typeof ReportSourceSchema>;
/** A parsed `RemoteReportSourceSchema` value. */
export type RemoteReportSource = z.infer<typeof RemoteReportSourceSchema>;

/** The sources file, `{ "schemaVersion": 1, "sources": [...] }`. Source ids must be unique. */
export const ReportSourcesSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.array(ReportSourceSchema)
  })
  .superRefine(({ sources }, ctx) => {
    const ids = new Set<string>();
    sources.forEach((source, index) => {
      if (ids.has(source.id)) ctx.addIssue({ code: 'custom', path: ['sources', index, 'id'], message: 'Each source needs a unique id.' });
      ids.add(source.id);
    });
  });

/**
 * The payload of the `atlas:change` event: which `scope` changed (`specs` or `runs`), the files and run ids concerned
 * (empty lists when not known), and the source that changed. Unknown payloads are ignored by the viewer.
 */
export const AtlasChangeSchema = z.object({
  scope: z.enum(['specs', 'runs']),
  files: z.array(z.string()).default([]),
  runIds: z.array(z.string()).default([]),
  sourceId: z.string().optional(),
  liveRunId: z.string().optional().describe('A live lease changed; its bounded snapshot is also sent as a run event')
});
/** A parsed `AtlasChangeSchema` value. */
export type AtlasChange = z.infer<typeof AtlasChangeSchema>;
