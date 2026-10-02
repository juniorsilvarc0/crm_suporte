import { describe, expect, it } from "vitest";

import {
  automatedSenderLabel,
  isAutomatedMessage,
  replyTargetLabel,
  startsBubbleGroup,
} from "@/features/chat/lib/message-sender";
import type { ChatMessage } from "@/features/chat/types";

type Sample = Pick<ChatMessage, "sender_type" | "sent_by_token_id" | "direction" | "type">;

const sample = (overrides: Partial<Sample> = {}): Sample => ({
  sender_type: "agent",
  sent_by_token_id: null,
  direction: "outbound",
  type: "text",
  ...overrides,
});
const ai = sample({ sender_type: "ai", sent_by_token_id: "tok-1" });
const integration = sample({ sender_type: "system", sent_by_token_id: "tok-2" });
const analyst = sample();
const contact = sample({ sender_type: "contact", direction: "inbound" });

describe("automatedSenderLabel", () => {
  it("a mensagem da IA e a de uma integração dizem o que são, com os nomes da trilha do ticket", () => {
    expect(automatedSenderLabel(ai)).toBe("IA");
    expect(automatedSenderLabel(integration)).toBe("Integração");
  });

  // "Automático" é o próprio sistema; com token, é uma integração.
  it("mensagem do sistema sem token é Automático", () => {
    expect(automatedSenderLabel(sample({ sender_type: "system" }))).toBe("Automático");
  });

  it("a IA é IA com ou sem o token gravado", () => {
    expect(automatedSenderLabel(sample({ sender_type: "ai" }))).toBe("IA");
  });

  // Cliente, analista e celular da empresa já se explicam pela bolha.
  it.each(["contact", "agent", "device"] as const)("%s não ganha rótulo", (sender_type) => {
    expect(automatedSenderLabel(sample({ sender_type }))).toBeNull();
  });
});

describe("isAutomatedMessage", () => {
  it("vale pelo remetente ou pelo token", () => {
    expect(isAutomatedMessage(ai)).toBe(true);
    expect(isAutomatedMessage(integration)).toBe(true);
    expect(isAutomatedMessage(sample({ sender_type: "ai" }))).toBe(true);
    expect(isAutomatedMessage(sample({ sender_type: "system" }))).toBe(true);
    // Defensivo: o banco não grava token com remetente de pessoa, mas se gravasse
    // a linha continuaria sendo de um token.
    expect(isAutomatedMessage(sample({ sent_by_token_id: "tok-1" }))).toBe(true);
  });

  it.each(["contact", "agent", "device"] as const)("%s, sem token, é de uma pessoa", (sender_type) => {
    expect(isAutomatedMessage(sample({ sender_type }))).toBe(false);
  });
});

describe("replyTargetLabel", () => {
  it("diz a quem a mensagem citada pertence", () => {
    expect(replyTargetLabel(ai)).toBe("a IA");
    expect(replyTargetLabel(integration)).toBe("a integração");
    expect(replyTargetLabel(sample({ sender_type: "system" }))).toBe("a mensagem automática");
    expect(replyTargetLabel(analyst)).toBe("você mesmo");
    expect(replyTargetLabel(sample({ sender_type: "device" }))).toBe("você mesmo");
    expect(replyTargetLabel(contact)).toBe("o contato");
  });
});

describe("startsBubbleGroup", () => {
  it("a primeira bolha do dia abre o grupo", () => {
    expect(startsBubbleGroup(undefined, analyst)).toBe(true);
  });

  it("mudou de lado: grupo novo", () => {
    expect(startsBubbleGroup(contact, analyst)).toBe(true);
    expect(startsBubbleGroup(analyst, contact)).toBe(true);
  });

  it("mesmo lado e mesmo remetente: a bolha cola na anterior", () => {
    expect(startsBubbleGroup(analyst, analyst)).toBe(false);
    expect(startsBubbleGroup(contact, contact)).toBe(false);
    expect(startsBubbleGroup(ai, ai)).toBe(false);
    // O celular da empresa e o analista seguem colando, como sempre.
    expect(startsBubbleGroup(analyst, sample({ sender_type: "device" }))).toBe(false);
  });

  // A da IA e a do analista saem do mesmo lado: coladas, pareceriam de um só.
  it("mesmo lado, mas a IA e o analista: grupo novo", () => {
    expect(startsBubbleGroup(ai, analyst)).toBe(true);
    expect(startsBubbleGroup(analyst, ai)).toBe(true);
    expect(startsBubbleGroup(ai, integration)).toBe(true);
    // O nome decide, não o remetente cru: integração e sistema gravam `system`.
    expect(startsBubbleGroup(integration, sample({ sender_type: "system" }))).toBe(true);
  });

  it("nota nunca cola em nada", () => {
    const note = sample({ type: "note" });
    expect(startsBubbleGroup(note, analyst)).toBe(true);
    expect(startsBubbleGroup(analyst, note)).toBe(true);
    expect(startsBubbleGroup(note, note)).toBe(true);
  });
});
