import { z } from "zod";

const metaMediaSchema = z
  .object({
    id: z.string().min(1),
    caption: z.string().optional(),
    filename: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();

export const metaReferralSchema = z
  .object({
    source_url: z.string().optional(),
    source_type: z.string().optional(),
    source_id: z.string().optional(),
    headline: z.string().optional(),
    body: z.string().optional(),
    media_type: z.string().optional(),
    image_url: z.string().optional(),
    video_url: z.string().optional(),
    thumbnail_url: z.string().optional(),
    ctwa_clid: z.string().optional(),
  })
  .passthrough();

const metaMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).passthrough().optional(),
    image: metaMediaSchema.optional(),
    audio: metaMediaSchema.optional(),
    video: metaMediaSchema.optional(),
    document: metaMediaSchema.optional(),
    sticker: metaMediaSchema.optional(),
    ctwa_clid: z.string().optional(),
    referral: metaReferralSchema.optional(),
  })
  .passthrough();

const metaStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    recipient_id: z.string().optional(),
  })
  .passthrough();

const metaContactSchema = z
  .object({
    wa_id: z.string().optional(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const metaChangeSchema = z
  .object({
    field: z.string().optional(),
    value: z
      .object({
        messaging_product: z.string().optional(),
        metadata: z
          .object({
            display_phone_number: z.string().optional(),
            phone_number_id: z.string().optional(),
          })
          .passthrough()
          .optional(),
        contacts: z.array(metaContactSchema).optional(),
        messages: z.array(metaMessageSchema).optional(),
        statuses: z.array(metaStatusSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const metaWebhookEnvelopeSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          id: z.string().min(1),
          changes: z.array(metaChangeSchema).default([]),
        })
        .passthrough()
    ),
  })
  .passthrough();

export const metaGraphAdSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    account_id: z.string().optional(),
    campaign: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    adset: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  })
  .passthrough();

export const metaGraphBatchSchema = z.record(
  z.string(),
  z.union([
    metaGraphAdSchema,
    z.object({ error: z.unknown() }).passthrough(),
  ])
);

// events_received é opcional de propósito: a referência da CAPI para business
// messaging documenta o request, mas não o corpo da resposta. Um 2xx sem o campo
// é tratado como sucesso — com um evento por request não existe reconhecimento
// parcial para desambiguar.
export const metaCapiResponseSchema = z
  .object({
    events_received: z.number().int().nonnegative().optional(),
    fbtrace_id: z.string().optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type MetaWebhookEnvelope = z.infer<typeof metaWebhookEnvelopeSchema>;
