import { z } from 'zod/v4';

export const SpecsSearch = z.record(z.string(), z.union([z.string(), z.number().transform(String)]));
