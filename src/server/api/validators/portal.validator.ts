import { z } from 'zod'

export const portalAuthSchema = z.object({
  skfId: z.string().trim().min(1).max(40),
  dob: z.string().trim().min(8).max(20),
})

export const videoProgressSchema = z.object({
  videoId: z.string().trim().min(1).max(120),
  progressPercent: z.coerce.number().min(0).max(100),
  seconds: z.coerce.number().int().min(0).max(36000).optional(),
})

export const videoProgressBatchSchema = z.object({
  entries: z.array(videoProgressSchema).min(1).max(20),
})

export type PortalAuthInput = z.infer<typeof portalAuthSchema>
export type VideoProgressInput = z.infer<typeof videoProgressSchema>
export type VideoProgressBatchInput = z.infer<typeof videoProgressBatchSchema>
