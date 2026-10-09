import { describe, expect, it } from "vitest";

import { WEBHOOK_EVENTS } from "@/features/webhooks/catalog";
import {
  describeWebhookPing,
  WEBHOOK_DELIVERY_STATUSES,
  webhookDeliveryStatusLabel,
  webhookDeliveryStatusTone,
  webhookEventsSummary,
  webhookHost,
} from "@/features/webhooks/lib/webhook-display";

describe("webhookHost", () => {
  it("devolve o host (com porta) e, se a URL não abre, ela mesma", () => {
    expect(webhookHost("https://erp.exemplo.com:8443/hook?x=1")).toBe("erp.exemplo.com:8443");
    expect(webhookHost("não é url")).toBe("não é url");
  });
});

describe("webhookEventsSummary", () => {
  it("todos, um só pelo nome, ou a contagem", () => {
    expect(webhookEventsSummary([...WEBHOOK_EVENTS])).toBe("Todos os eventos");
    expect(webhookEventsSummary(["ticket.reopened"])).toBe("Ticket reaberto");
    expect(webhookEventsSummary(["ticket.created", "ticket.reopened"])).toBe("2 eventos");
  });
});

describe("describeWebhookPing", () => {
  const host = "erp.exemplo.com";

  it("2xx: entregue, com o HTTP e o tempo", () => {
    expect(describeWebhookPing(host, { error: null, httpStatus: 204, latencyMs: 85 })).toEqual({
      delivered: true,
      message: "erp.exemplo.com respondeu HTTP 204 em 85 ms.",
    });
  });

  it("3xx diz que o CRM não segue redirecionamento; 401/403 aponta o segredo", () => {
    expect(describeWebhookPing(host, { error: "x", httpStatus: 302, latencyMs: 9 }).message).toBe(
      "erp.exemplo.com respondeu HTTP 302. O CRM não segue redirecionamento: salve o endereço final."
    );
    expect(describeWebhookPing(host, { error: "x", httpStatus: 401, latencyMs: 9 }).message).toBe(
      "erp.exemplo.com respondeu HTTP 401. Confira se o destino usa o segredo atual."
    );
    expect(describeWebhookPing(host, { error: "x", httpStatus: 500, latencyMs: 9 })).toEqual({
      delivered: false,
      message: "erp.exemplo.com respondeu HTTP 500.",
    });
  });

  it("sem HTTP (rede, prazo, nada saiu): o host e o motivo do servidor", () => {
    expect(describeWebhookPing(host, { error: "O destino não respondeu em 10 s.", latencyMs: 10_000 })).toEqual({
      delivered: false,
      message: "erp.exemplo.com: O destino não respondeu em 10 s.",
    });
  });
});

describe("status das entregas", () => {
  it("todo status tem rótulo e cor", () => {
    for (const status of WEBHOOK_DELIVERY_STATUSES) {
      expect(webhookDeliveryStatusLabel[status]).toBeTruthy();
      expect(webhookDeliveryStatusTone[status]).toBeTruthy();
    }
  });
});
