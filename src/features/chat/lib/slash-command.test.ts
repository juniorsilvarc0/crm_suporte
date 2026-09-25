import { describe, expect, it } from "vitest";

import {
  matchQuickReplies,
  nextSlashIndex,
  readSlashCommand,
} from "@/features/chat/lib/slash-command";
import type { QuickReply } from "@/features/quick-replies/types";

function reply(
  shortcut: string,
  title: string,
  overrides: Partial<QuickReply> = {}
): QuickReply {
  return {
    id: shortcut,
    title,
    shortcut,
    content: `Conteúdo de ${title}`,
    is_active: true,
    created_by_user_id: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  } as QuickReply;
}

describe("readSlashCommand", () => {
  it("a barra sozinha abre a lista inteira", () => {
    expect(readSlashCommand("/")).toBe("");
  });

  it("devolve o termo digitado depois da barra", () => {
    expect(readSlashCommand("/teste")).toBe("teste");
    expect(readSlashCommand("/bom-dia")).toBe("bom-dia");
    expect(readSlashCommand("/exame_2")).toBe("exame_2");
  });

  it("normaliza para minúsculas", () => {
    expect(readSlashCommand("/TESTE")).toBe("teste");
  });

  // O falso positivo que justifica a regra: barra no meio do texto é barra.
  it("não abre com barra fora do começo", () => {
    expect(readSlashCommand("das 8/9h")).toBeNull();
    expect(readSlashCommand("1/2 comprimido")).toBeNull();
    expect(readSlashCommand("a/c Dra. Ana")).toBeNull();
  });

  it("fecha assim que o texto deixa de ser um comando", () => {
    expect(readSlashCommand("/teste ")).toBeNull();
    expect(readSlashCommand("/teste agora")).toBeNull();
    expect(readSlashCommand("/exame!")).toBeNull();
    expect(readSlashCommand("/linha\nquebrada")).toBeNull();
  });

  it("texto sem barra nenhuma não abre", () => {
    expect(readSlashCommand("")).toBeNull();
    expect(readSlashCommand("bom dia")).toBeNull();
  });
});

describe("matchQuickReplies", () => {
  const items = [
    // `atendimento` contém "te" no MEIO; `teste` começa com "te".
    reply("atendimento", "Atendimento humano"),
    reply("teste", "Teste"),
    reply("tarde", "Boa tarde"),
    reply("antigo", "Antigo", { is_active: false }),
  ];

  it("sem termo, devolve todas as ativas na ordem recebida", () => {
    expect(matchQuickReplies(items, "").map((i) => i.shortcut)).toEqual([
      "atendimento",
      "teste",
      "tarde",
    ]);
  });

  it("inativa nunca entra", () => {
    expect(matchQuickReplies(items, "antigo")).toEqual([]);
  });

  // Quem digita `/te` está mirando o atalho que COMEÇA com "te", mesmo que
  // outro atalho contenha "te" no meio e venha antes na lista.
  it("prefixo do atalho vem antes de casamento no meio", () => {
    expect(matchQuickReplies(items, "te").map((i) => i.shortcut)).toEqual([
      "teste",
      "atendimento",
    ]);
  });

  it("casa também pelo título", () => {
    expect(matchQuickReplies(items, "boa").map((i) => i.shortcut)).toEqual([
      "tarde",
    ]);
  });

  it("nada casa, lista vazia", () => {
    expect(matchQuickReplies(items, "zzz")).toEqual([]);
  });
});

describe("nextSlashIndex", () => {
  it("anda para frente e circula no fim", () => {
    expect(nextSlashIndex(0, 3, 1)).toBe(1);
    expect(nextSlashIndex(2, 3, 1)).toBe(0);
  });

  it("anda para trás e circula no começo", () => {
    expect(nextSlashIndex(1, 3, -1)).toBe(0);
    expect(nextSlashIndex(0, 3, -1)).toBe(2);
  });

  it("lista vazia não estoura", () => {
    expect(nextSlashIndex(0, 0, 1)).toBe(0);
  });
});
