import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ticketCommentSchema } from "@/features/tickets/schemas/comment";

const AUTHOR_ID = "34f544d9-b6ee-4119-9905-23d4e63e7611";
const UNSAFE_MESSAGE = "Remova os caracteres inválidos.";
// Um par de surrogates válido (emoji): passa inteiro.
const EMOJI = "😅";

function bodyErrors(input: unknown): string[] | undefined {
  const result = ticketCommentSchema.safeParse(input);
  return result.error ? z.flattenError(result.error).fieldErrors.body : undefined;
}

describe("ticketCommentSchema", () => {
  it("apara o texto e mantém as quebras de linha do meio", () => {
    expect(ticketCommentSchema.parse({ body: "  Cliente pediu retorno.\nLigar às 15h.  " })).toEqual({
      body: "Cliente pediu retorno.\nLigar às 15h.",
    });
  });

  it("aceita de 1 a 5.000 caracteres depois do trim", () => {
    expect(ticketCommentSchema.safeParse({ body: "k" }).success).toBe(true);
    expect(ticketCommentSchema.safeParse({ body: ` ${"a".repeat(5000)} ` }).success).toBe(true);
  });

  it.each([[""], ["   "], ["\n\t "], [null], [42], [undefined]])(
    "recusa o corpo %j no campo body",
    (value) => {
      expect(bodyErrors({ body: value })).toEqual(["Escreva o comentário."]);
    }
  );

  it("recusa mais de 5.000 caracteres", () => {
    expect(bodyErrors({ body: "a".repeat(5001) })).toEqual(["Máximo de 5.000 caracteres."]);
  });

  it("emoji passa", () => {
    expect(ticketCommentSchema.parse({ body: `Resolvido ${EMOJI}` }).body).toBe(`Resolvido ${EMOJI}`);
  });

  // Passariam no zod e voltariam do banco como 22P05 (ou PGRST102): um 500.
  it.each([
    ["NUL", "abc\u0000def"],
    ["surrogate baixo solto", "abc\uDC00def"],
    ["surrogate alto no fim", "a\uD83D"],
  ])("recusa %s", (_, text) => {
    expect(bodyErrors({ body: text })).toEqual([UNSAFE_MESSAGE]);
  });

  // O autor sai da sessão; mandá-lo no corpo é erro, não campo ignorado.
  it("recusa autor e campo extra (.strict())", () => {
    expect(ticketCommentSchema.safeParse({ body: "Oi", author_user_id: AUTHOR_ID }).success).toBe(false);
    expect(ticketCommentSchema.safeParse({ body: "Oi", deleted_at: null }).success).toBe(false);
  });
});
