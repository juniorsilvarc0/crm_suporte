import { describe, expect, it } from "vitest";

import { webhookCreateSchema, webhookUpdateSchema } from "@/features/webhooks/schemas/webhook";

const valid = { name: "ERP", url: "https://erp.exemplo.com/hook", events: ["ticket.created"] };

describe("webhookCreateSchema", () => {
  it("aceita nome, URL e eventos do catálogo, sem espaços nas pontas", () => {
    const parsed = webhookCreateSchema.parse({ ...valid, name: "  ERP  ", url: " https://erp.exemplo.com/hook " });
    expect(parsed).toEqual(valid);
  });

  it("deduplica eventos repetidos", () => {
    const parsed = webhookCreateSchema.parse({ ...valid, events: ["ticket.created", "ticket.created", "ticket.reopened"] });
    expect(parsed.events).toEqual(["ticket.created", "ticket.reopened"]);
  });

  it("recusa evento fora do catálogo, lista vazia, nome vazio e campo a mais", () => {
    expect(webhookCreateSchema.safeParse({ ...valid, events: ["ticket.deleted"] }).success).toBe(false);
    expect(webhookCreateSchema.safeParse({ ...valid, events: ["webhook.ping"] }).success).toBe(false);
    expect(webhookCreateSchema.safeParse({ ...valid, events: [] }).success).toBe(false);
    expect(webhookCreateSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    // O segredo nunca vem de fora: o CRM o gera.
    expect(webhookCreateSchema.safeParse({ ...valid, secret: "x".repeat(64) }).success).toBe(false);
  });
});

describe("webhookUpdateSchema", () => {
  it("aceita só o que muda, inclusive pausar", () => {
    expect(webhookUpdateSchema.parse({ is_active: false })).toEqual({ is_active: false });
    expect(webhookUpdateSchema.parse({ name: "Novo" })).toEqual({ name: "Novo" });
  });

  it("recusa corpo vazio e campo desconhecido", () => {
    expect(webhookUpdateSchema.safeParse({}).success).toBe(false);
    expect(webhookUpdateSchema.safeParse({ secret: "x" }).success).toBe(false);
  });
});
