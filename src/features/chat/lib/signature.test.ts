import { describe, expect, it } from "vitest";

import { resolveSignature, signMessage } from "@/features/chat/lib/signature";

const base = { name: "Ana Paula Souza", apelido_atendimento: null, assinar_mensagens: true };

describe("resolveSignature", () => {
  it("usa o apelido quando preenchido", () => {
    expect(resolveSignature({ ...base, apelido_atendimento: "Ana Lima" })).toBe("Ana Lima");
  });

  it("cai para o primeiro nome quando o apelido é nulo", () => {
    expect(resolveSignature(base)).toBe("Ana");
  });

  it.each(["", "   "])("cai para o primeiro nome quando o apelido é %p", (apelido) => {
    expect(resolveSignature({ ...base, apelido_atendimento: apelido })).toBe("Ana");
  });

  it("não assina quando o checkbox está desmarcado, mesmo com apelido", () => {
    expect(
      resolveSignature({ ...base, apelido_atendimento: "Ana Lima", assinar_mensagens: false })
    ).toBeNull();
  });

  it("apara espaços do apelido", () => {
    expect(resolveSignature({ ...base, apelido_atendimento: "  Suporte N1  " })).toBe("Suporte N1");
  });

  it("devolve null se não há apelido nem nome utilizável", () => {
    expect(resolveSignature({ ...base, name: "   " })).toBeNull();
  });
});

describe("signMessage", () => {
  it("prefixa a assinatura em negrito e quebra a linha", () => {
    expect(signMessage("Bom dia!", "Ana Lima")).toBe("*Ana Lima:*\nBom dia!");
  });

  it("devolve o texto intacto quando não há assinatura", () => {
    expect(signMessage("Bom dia!", null)).toBe("Bom dia!");
  });

  it("preserva mensagens de várias linhas", () => {
    expect(signMessage("Linha 1\nLinha 2", "Ana")).toBe("*Ana:*\nLinha 1\nLinha 2");
  });
});
