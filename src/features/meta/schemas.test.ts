import { describe, expect, it } from "vitest";
import { normalizeMetaWebhook } from "@/features/chat/lib/normalizers/meta";
import { metaWebhookEnvelopeSchema } from "@/features/meta/schemas";

describe("Meta webhook envelope", () => {
  it("processa todas as entries e mensagens, com referral completo ou parcial", () => {
    const payload = metaWebhookEnvelopeSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-1" },
                contacts: [{ wa_id: "5511999990001", profile: { name: "Contato 1" } }],
                messages: [
                  {
                    id: "wamid-1",
                    from: "5511999990001",
                    timestamp: "1780000000",
                    type: "text",
                    text: { body: "Olá" },
                    referral: { source_id: "ad-1", source_type: "ad", ctwa_clid: "click-1" },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "waba-2",
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid-2",
                    from: "5511999990002",
                    timestamp: "1780000001",
                    type: "image",
                    image: { id: "media-1", caption: "Imagem" },
                    referral: { source_id: "ad-2", source_type: "ad" },
                  },
                  {
                    id: "wamid-3",
                    from: "5511999990003",
                    timestamp: "1780000002",
                    type: "text",
                    text: { body: "Orgânico" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const messages = normalizeMetaWebhook(payload);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      external_id: "wamid-1",
      contact_name: "Contato 1",
      source_id: "ad-1",
      ctwa_clid: "click-1",
    });
    expect(messages[1]).toMatchObject({
      external_id: "wamid-2",
      media_url: "meta://media/media-1",
      source_id: "ad-2",
      ctwa_clid: null,
    });
    expect(messages[2]).toMatchObject({ source_id: null, ctwa_clid: null });
  });
});

