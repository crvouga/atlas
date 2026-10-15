/** @module Project identity
 * Project slugs partition every report, spec, recording and live run on an Atlas node.
 */
import { z } from 'zod/v4';

/** A portable project namespace: 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit. */
export const ProjectSlugSchema = z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
/** One project advertised by a node. The default project contains uploads from older clients. */
export const ProjectSchema = z.object({ slug: ProjectSlugSchema, name: z.string().min(1).max(200) });
/** Project discovery response. */
export const ProjectsSchema = z.object({ projects: z.array(ProjectSchema) });
/** A project's public identity. */
export type Project = z.output<typeof ProjectSchema>;
