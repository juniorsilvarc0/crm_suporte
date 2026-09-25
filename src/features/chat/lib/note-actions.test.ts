import { describe, expect, it } from "vitest";

import {
  canDeleteNote,
  canEditNote,
  isNoteMessage,
  noteAuthorLabel,
} from "@/features/chat/lib/note-actions";
import type { ChatMessage } from "@/features/chat/types";

type NoteLike = Pick<ChatMessage, "type" | "is_deleted" | "sent_by_user_id">;

function note(overrides: Partial<NoteLike> = {}): NoteLike {
  return { type: "note", is_deleted: false, sent_by_user_id: "u1", ...overrides };
}

describe("isNoteMessage", () => {
  it("separa nota de mensagem", () => {
    expect(isNoteMessage({ type: "note" })).toBe(true);
    expect(isNoteMessage({ type: "text" })).toBe(false);
    expect(isNoteMessage({ type: "image" })).toBe(false);
  });
});

describe("canEditNote / canDeleteNote", () => {
  it("o autor edita e apaga a própria nota", () => {
    expect(canEditNote(note(), "u1")).toBe(true);
    expect(canDeleteNote(note(), "u1")).toBe(true);
  });

  // A decisão de produto: nota é registro de equipe.
  it("colega NÃO mexe na nota de outra pessoa", () => {
    expect(canEditNote(note(), "u2")).toBe(false);
    expect(canDeleteNote(note(), "u2")).toBe(false);
  });

  it("sem sessão resolvida, ninguém mexe", () => {
    expect(canEditNote(note(), null)).toBe(false);
    expect(canEditNote(note(), undefined)).toBe(false);
    expect(canEditNote(note(), "")).toBe(false);
  });

  it("nota sem autor gravado não é de ninguém", () => {
    expect(canEditNote(note({ sent_by_user_id: null }), "u1")).toBe(false);
  });

  it("nota já apagada não volta a ser editável", () => {
    expect(canEditNote(note({ is_deleted: true }), "u1")).toBe(false);
    expect(canDeleteNote(note({ is_deleted: true }), "u1")).toBe(false);
  });

  // Mensagem de WhatsApp segue a regra de `message-actions.ts`, não esta.
  it("não vale para mensagem que não é nota", () => {
    expect(canEditNote(note({ type: "text" }), "u1")).toBe(false);
  });

  // Sem janela de tempo: a nota nunca saiu do nosso banco.
  it("não depende de quando foi escrita", () => {
    expect(canEditNote(note(), "u1")).toBe(true);
  });
});

describe("noteAuthorLabel", () => {
  const names = new Map([
    ["u1", "Vinícius"],
    ["u2", "Carla"],
  ]);

  it("o próprio autor lê 'Você'", () => {
    expect(noteAuthorLabel({ sent_by_user_id: "u1" }, names, "u1")).toBe("Você");
  });

  it("outra pessoa aparece pelo nome", () => {
    expect(noteAuthorLabel({ sent_by_user_id: "u2" }, names, "u1")).toBe("Carla");
  });

  // Honestidade: sem o nome, sem assinatura. Nada é inventado.
  it("autor desconhecido não vira assinatura", () => {
    expect(noteAuthorLabel({ sent_by_user_id: "u9" }, names, "u1")).toBeNull();
    expect(noteAuthorLabel({ sent_by_user_id: null }, names, "u1")).toBeNull();
  });
});
