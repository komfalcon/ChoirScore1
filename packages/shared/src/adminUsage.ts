import { z } from 'zod';
import { isoUtcTimestampSchema } from './timestamps.js';

const usageCountSchema = z.number().int().nonnegative().safe();
const utcDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const adminAiUsageUserDaySchema = z
  .object({
    date: utcDateSchema,
    requests: usageCountSchema,
  })
  .strict();
export type AdminAiUsageUserDay = z.infer<typeof adminAiUsageUserDaySchema>;

export const adminAiUsageDaySchema = z
  .object({
    date: utcDateSchema,
    requests: usageCountSchema,
    succeededRequests: usageCountSchema,
    failedRequests: usageCountSchema,
    pendingRequests: usageCountSchema,
    tokensIn: usageCountSchema,
    tokensOut: usageCountSchema,
    totalTokens: usageCountSchema,
  })
  .strict();
export type AdminAiUsageDay = z.infer<typeof adminAiUsageDaySchema>;

export const adminAiUsageUserSchema = z
  .object({
    userId: z.string().min(1),
    username: z.string().min(1),
    displayName: z.string().min(1),
    requestsToday: usageCountSchema,
    requestsInWindow: usageCountSchema,
    succeededRequests: usageCountSchema,
    failedRequests: usageCountSchema,
    pendingRequests: usageCountSchema,
    tokensIn: usageCountSchema,
    tokensOut: usageCountSchema,
    totalTokens: usageCountSchema,
    daily: z.array(adminAiUsageUserDaySchema).length(30),
  })
  .strict();
export type AdminAiUsageUser = z.infer<typeof adminAiUsageUserSchema>;

export const getAdminAiUsageResponseSchema = z
  .object({
    asOf: isoUtcTimestampSchema,
    windowStart: isoUtcTimestampSchema,
    windowEndExclusive: isoUtcTimestampSchema,
    days: z.literal(30),
    users: z.array(adminAiUsageUserSchema),
    daily: z.array(adminAiUsageDaySchema).length(30),
  })
  .strict();
export type GetAdminAiUsageResponse = z.infer<
  typeof getAdminAiUsageResponseSchema
>;
