import { describe, expect, it } from "vitest";

import {
  isPolicyDraft,
  pendingPolicyPlaceholders,
  PRIVACY_POLICY,
  type PolicySection,
} from "@/features/legal/privacy-policy";

const allText = (sections: PolicySection[] = PRIVACY_POLICY.sections) =>
  sections
    .flatMap((section) => [section.title, ...section.blocks.flatMap((b) => (b.kind === "p" ? [b.text] : b.items))])
    .join("\n");

describe("Política de Privacidade (rascunho para revisão jurídica)", () => {
  it("lista os trechos a preencher, sem repetição: identidade, encarregado, prazos", () => {
    const pending = pendingPolicyPlaceholders();
    expect(pending).toEqual(expect.arrayContaining(["RAZÃO SOCIAL DO CONTROLADOR", "CNPJ DO CONTROLADOR", "NOME DO ENCARREGADO", "PRAZO DEFINIDO PELO CONTROLADOR", "DATA DA PUBLICAÇÃO"]));
    expect(new Set(pending).size).toBe(pending.length);
    expect(isPolicyDraft()).toBe(true);
  });

  it("preenchido, deixa de ser rascunho", () => {
    const fill = (text: string) => text.replace(/\[\[[^\]]+\]\]/g, "preenchido");
    const filled = {
      updatedAt: fill(PRIVACY_POLICY.updatedAt),
      sections: PRIVACY_POLICY.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) =>
          block.kind === "p" ? { ...block, text: fill(block.text) } : { ...block, items: block.items.map(fill) }
        ),
      })),
    };
    expect(pendingPolicyPlaceholders(filled)).toEqual([]);
    expect(isPolicyDraft(filled)).toBe(false);
  });

  it("diz o que o sistema faz de verdade: provedores e prazos conferidos no código", () => {
    const text = allText();
    for (const fact of ["uazapi", "OpenAI", "90 dias", "30 dias", "7 dias", "cookie de sessão", "art. 18", "ANPD"]) {
      expect(text).toContain(fact);
    }
    // O resumo financeiro do sistema de gestão é consultado, não gravado.
    expect(text).toContain("consultado na hora e não gravado");
  });

  it("não sobrou nada da política da clínica de origem", () => {
    expect(allText()).not.toMatch(/cl[ií]nica|paciente|sa[uú]de|Meta Ads|an[uú]ncio/i);
  });

  it("toda seção tem âncora única, título e conteúdo", () => {
    const ids = PRIVACY_POLICY.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of PRIVACY_POLICY.sections) {
      expect(section.id).toMatch(/^[a-z-]+$/);
      expect(section.title).not.toBe("");
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });
});
