import { z } from 'zod';

/** ISO-8601 date-time serialized in UTC with a Z suffix. */
export const isoUtcTimestampSchema = z.iso.datetime({ offset: false });
export type IsoUtcTimestamp = z.infer<typeof isoUtcTimestampSchema>;
