import { z } from 'zod/v4';

const SourceIdentity = {
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),
  label: z.string().min(1).max(120)
};

const HttpLocation = z.string().min(1).refine((value) => {
  try {
    const url = new URL(value, 'https://atlas.invalid/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Use an HTTP URL without credentials.');

export const RemoteReportSourceSchema = z.object({
  ...SourceIdentity,
  type: z.enum(['http', 'api']),
  baseUrl: HttpLocation,
  eventsUrl: HttpLocation.optional(),
  pollMs: z.number().int().min(1000).max(3_600_000).optional(),
  live: z.boolean().optional()
});

export const DirectoryReportSourceSchema = z.object({
  ...SourceIdentity,
  type: z.literal('directory'),
  runs: z.string().min(1)
});

export const ReportSourceSchema = z.union([DirectoryReportSourceSchema, RemoteReportSourceSchema]);
export type ReportSource = z.infer<typeof ReportSourceSchema>;
export type RemoteReportSource = z.infer<typeof RemoteReportSourceSchema>;

export const ReportSourcesSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(ReportSourceSchema)
}).superRefine(({ sources }, ctx) => {
  const ids = new Set<string>();
  sources.forEach((source, index) => {
    if (ids.has(source.id)) ctx.addIssue({ code: 'custom', path: ['sources', index, 'id'], message: 'Each source needs a unique id.' });
    ids.add(source.id);
  });
});

export const AtlasChangeSchema = z.object({
  scope: z.enum(['specs', 'runs']),
  files: z.array(z.string()).default([]),
  runIds: z.array(z.string()).default([]),
  sourceId: z.string().optional()
});
export type AtlasChange = z.infer<typeof AtlasChangeSchema>;
