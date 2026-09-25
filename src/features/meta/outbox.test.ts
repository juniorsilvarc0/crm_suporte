import { describe, expect, it } from "vitest";
import {
  buildCapiPayloadForTest,
  classifyCapiResponse,
  retryAt,
} from "@/features/meta/outbox";

const event = {
  id: "outbox-1",
  event_id: "crm:meta:LeadSubmitted:attribution:1",
  event_name: "LeadSubmitted" as const,
  event_time: "2026-07-11T12:00:00.000Z",
  attempt_count: 1,
  created_at: "2026-07-11T12:00:00.000Z",
  lease_token: "lease-1",
  ctwa_clid: "click-sensitive",
  whatsapp_business_id: "waba-1",
};

describe("Meta CAPI outbox", () => {
  it("gera somente a allowlist de business messaging", () => {
    expect(buildCapiPayloadForTest(event)).toMatchInlineSnapshot(`
      {
        "data": [
          {
            "action_source": "business_messaging",
            "event_id": "crm:meta:LeadSubmitted:attribution:1",
            "event_name": "LeadSubmitted",
            "event_time": 1783771200,
            "messaging_channel": "whatsapp",
            "user_data": {
              "ctwa_clid": "click-sensitive",
              "whatsapp_business_account_id": "waba-1",
            },
          },
        ],
      }
    `);
    const serialized = JSON.stringify(buildCapiPayloadForTest(event));
    for (const forbidden of ["phone", "email", "name", "diagnosis", "message", "tags"]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it("envia exatamente um evento por request", () => {
    expect(buildCapiPayloadForTest(event).data).toHaveLength(1);
  });

  it("mantém a WABA do toque mesmo quando a env aponta para outra", () => {
    const payload = buildCapiPayloadForTest(event, undefined, "waba-da-env");
    expect(payload.data[0].user_data.whatsapp_business_account_id).toBe("waba-1");
  });

  it("usa a WABA da env apenas como fallback", () => {
    const payload = buildCapiPayloadForTest(
      { ...event, whatsapp_business_id: "" },
      undefined,
      "waba-da-env"
    );
    expect(payload.data[0].user_data.whatsapp_business_account_id).toBe("waba-da-env");
  });

  it("inclui o test_event_code somente quando ele é fornecido", () => {
    expect(buildCapiPayloadForTest(event)).not.toHaveProperty("test_event_code");
    expect(buildCapiPayloadForTest(event, "TEST123")).toHaveProperty(
      "test_event_code",
      "TEST123"
    );
  });

  it("aceita 2xx sem events_received como sucesso", () => {
    expect(classifyCapiResponse(200, { fbtrace_id: "abc" }, 1)).toMatchObject({
      status: "sent",
      summary: { events_received: null, fbtrace_id: "abc" },
    });
  });

  it("aceita 2xx com o evento reconhecido", () => {
    expect(classifyCapiResponse(200, { events_received: 1 }, 1).status).toBe("sent");
  });

  it("repete quando a Meta não reconhece o evento", () => {
    expect(classifyCapiResponse(200, { events_received: 0 }, 1)).toMatchObject({
      status: "retry",
      category: "partial_response",
    });
  });

  it("repete quando a resposta não é um objeto válido", () => {
    expect(classifyCapiResponse(200, null, 1)).toMatchObject({
      status: "retry",
      category: "partial_response",
      summary: { invalid_response: true },
    });
  });

  it("distingue falhas permanentes e transitórias", () => {
    expect(classifyCapiResponse(400, { error: { code: 100 } }, 1).status).toBe(
      "dead_letter"
    );
    expect(classifyCapiResponse(429, { error: { code: 4 } }, 1).status).toBe("retry");
    expect(classifyCapiResponse(500, null, 1).status).toBe("retry");
  });

  it("aplica a matriz de backoff com jitter de ±20%", () => {
    const now = new Date("2026-07-11T00:00:00.000Z").getTime();
    expect(retryAt(1, now, () => 0)).toBe("2026-07-11T00:00:24.000Z");
    expect(retryAt(1, now, () => 1)).toBe("2026-07-11T00:00:36.000Z");
    expect(retryAt(8, now, () => 0.5)).toBe("2026-07-12T00:00:00.000Z");
  });
});

