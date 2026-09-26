import { describe, expect, it } from "vitest";

import {
  authorLabel,
  canDeleteComment,
  canEditComment,
} from "@/features/tickets/lib/comment-actions";
import type { TicketComment } from "@/features/tickets/types";

type CommentLike = Pick<TicketComment, "author_user_id" | "author_token_id" | "deleted_at">;

function comment(overrides: Partial<CommentLike> = {}): CommentLike {
  return { author_user_id: "u1", author_token_id: null, deleted_at: null, ...overrides };
}

describe("canEditComment / canDeleteComment", () => {
  it("o autor edita e apaga o próprio comentário", () => {
    expect(canEditComment(comment(), "u1")).toBe(true);
    expect(canDeleteComment(comment(), "u1")).toBe(true);
  });

  // Registro de equipe: ninguém reescreve o que o colega anotou.
  it("colega NÃO mexe no comentário de outra pessoa", () => {
    expect(canEditComment(comment(), "u2")).toBe(false);
    expect(canDeleteComment(comment(), "u2")).toBe(false);
  });

  it("sem sessão resolvida, ninguém mexe", () => {
    expect(canEditComment(comment(), null)).toBe(false);
    expect(canEditComment(comment(), undefined)).toBe(false);
    expect(canEditComment(comment(), "")).toBe(false);
  });

  it("comentário de integração ou de usuário removido não é de ninguém da equipe", () => {
    expect(canEditComment(comment({ author_user_id: null, author_token_id: "t1" }), "u1")).toBe(false);
    expect(canEditComment(comment({ author_user_id: null }), "u1")).toBe(false);
  });

  // O trigger responde COMMENT_DELETED: o menu não pode oferecer o que falha.
  it("comentário apagado não volta a ser editável nem apagável", () => {
    const deleted = comment({ deleted_at: "2026-09-26T03:20:00.194405+00:00" });

    expect(canEditComment(deleted, "u1")).toBe(false);
    expect(canDeleteComment(deleted, "u1")).toBe(false);
  });
});

describe("authorLabel", () => {
  const names = new Map([
    ["u1", "Ana"],
    ["u2", "Bruno"],
  ]);

  it("o próprio autor lê 'Você'", () => {
    expect(authorLabel(comment(), names, "u1")).toBe("Você");
  });

  it("outra pessoa aparece pelo nome", () => {
    expect(authorLabel(comment({ author_user_id: "u2" }), names, "u1")).toBe("Bruno");
    expect(authorLabel(comment({ author_user_id: "u2" }), names, null)).toBe("Bruno");
  });

  it("comentário de integração", () => {
    expect(authorLabel(comment({ author_user_id: null, author_token_id: "t1" }), names, "u1")).toBe(
      "Integração"
    );
  });

  // Os dois nulos só saem da FK `on delete set null`: o INSERT exige um autor.
  it("sem autor nenhum é usuário removido", () => {
    expect(authorLabel(comment({ author_user_id: null }), names, "u1")).toBe("Usuário removido");
  });

  // Sem o nome (a lista de usuários não carregou), sem assinatura inventada.
  it("autor que não está na lista não vira assinatura", () => {
    expect(authorLabel(comment({ author_user_id: "u9" }), names, "u1")).toBeNull();
    expect(authorLabel(comment({ author_user_id: "u9" }), new Map(), "u1")).toBeNull();
  });
});
