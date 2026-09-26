import { describe, expect, it } from "vitest";

import {
  buildCatalogEntries,
  isSameCatalogEntry,
  normalizeCatalogText,
  parseCreatedCatalogItem,
  toCatalogOption,
  type CatalogEntry,
  type CatalogOption,
} from "@/components/forms/catalog-options";

const CATALOG: CatalogOption[] = [
  { id: "p1", name: "ERP Varejo", color: "blue" },
  { id: "p2", name: "Gestão Fiscal", color: "emerald" },
  { id: "p3", name: "App Mobile", color: null },
  { id: "p4", name: "C++ SDK" },
];

function labels(entries: CatalogEntry[]) {
  return entries.map((entry) => `${entry.kind}:${entry.name}`);
}

describe("normalizeCatalogText", () => {
  it("tira acento e caixa, mas mantém a pontuação", () => {
    expect(normalizeCatalogText("  Gestão ")).toBe("gestao");
    expect(normalizeCatalogText("C++ SDK")).toBe("c++ sdk");
  });
});

describe("buildCatalogEntries — filtro", () => {
  it("sem termo, devolve o catálogo inteiro como itens", () => {
    const entries = buildCatalogEntries({ options: CATALOG, term: "", canCreate: true });
    expect(labels(entries)).toEqual([
      "item:ERP Varejo",
      "item:Gestão Fiscal",
      "item:App Mobile",
      "item:C++ SDK",
    ]);
  });

  it("casa no meio do nome, sem acento e sem caixa", () => {
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "FISC", canCreate: false }))).toEqual([
      "item:Gestão Fiscal",
    ]);
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "gestao", canCreate: false }))).toEqual([
      "item:Gestão Fiscal",
    ]);
  });

  it("o item carrega id, cor e flag de arquivado — o valor é o objeto, não o texto", () => {
    const [entry] = buildCatalogEntries({ options: CATALOG, term: "erp", canCreate: false });
    expect(entry).toEqual({
      kind: "item",
      id: "p1",
      name: "ERP Varejo",
      color: "blue",
      hint: null,
      archived: false,
    });
  });
});

describe("buildCatalogEntries — linha de criar", () => {
  it("só aparece com canCreate (admin)", () => {
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "Portal", canCreate: false }))).toEqual([]);
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "Portal", canCreate: true }))).toEqual([
      "create:Portal",
    ]);
  });

  it("não aparece com menos de 2 caracteres", () => {
    expect(buildCatalogEntries({ options: CATALOG, term: "Z", canCreate: true })).toEqual([]);
  });

  it("não aparece quando o termo casa exatamente, nem com diferença de caixa ou acento", () => {
    for (const term of ["ERP Varejo", "erp varejo", "gestao fiscal"]) {
      const entries = buildCatalogEntries({ options: CATALOG, term, canCreate: true });
      expect(entries.some((entry) => entry.kind === "create")).toBe(false);
    }
  });

  it("pontuação diferencia: C# não é o mesmo que C++", () => {
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "C#", canCreate: true }))).toEqual([
      "create:C#",
    ]);
  });

  it("aparece junto de resultados parciais, com o termo aparado", () => {
    expect(labels(buildCatalogEntries({ options: CATALOG, term: "  App  ", canCreate: true }))).toEqual([
      "item:App Mobile",
      "create:App",
    ]);
  });

  it("catálogo vazio: oferece criar o primeiro", () => {
    expect(labels(buildCatalogEntries({ options: [], term: "Suporte", canCreate: true }))).toEqual([
      "create:Suporte",
    ]);
    expect(buildCatalogEntries({ options: [], term: "", canCreate: true })).toEqual([]);
  });
});

describe("buildCatalogEntries — valor atual (modo single)", () => {
  const archived: CatalogOption = { id: "old", name: "Plano Ouro", archived: true };

  it("valor arquivado fora do catálogo entra na lista marcado como arquivado", () => {
    const entries = buildCatalogEntries({
      options: CATALOG,
      term: "",
      selected: archived,
      canCreate: true,
    });
    expect(entries.at(-1)).toMatchObject({ kind: "item", id: "old", archived: true });
  });

  it("valor que está no catálogo não duplica", () => {
    const entries = buildCatalogEntries({
      options: CATALOG,
      term: "",
      selected: CATALOG[0],
      canCreate: true,
    });
    expect(entries.filter((entry) => entry.kind === "item" && entry.id === "p1")).toHaveLength(1);
  });

  it("respeita o filtro e bloqueia o criar do mesmo nome", () => {
    expect(
      labels(buildCatalogEntries({ options: CATALOG, term: "erp", selected: archived, canCreate: true }))
    ).toEqual(["item:ERP Varejo", "create:erp"]);
    expect(
      labels(
        buildCatalogEntries({ options: CATALOG, term: "plano ouro", selected: archived, canCreate: true })
      )
    ).toEqual(["item:Plano Ouro"]);
  });
});

describe("buildCatalogEntries — já escolhidos (modo adder)", () => {
  it("somem da lista", () => {
    const entries = buildCatalogEntries({
      options: CATALOG,
      term: "",
      chosen: [CATALOG[0], CATALOG[2]],
      canCreate: false,
    });
    expect(labels(entries)).toEqual(["item:Gestão Fiscal", "item:C++ SDK"]);
  });

  it("contam como existentes: não oferece criar um repetido", () => {
    const novo: CatalogOption = { id: "n1", name: "Portal do Cliente" };
    const entries = buildCatalogEntries({
      options: CATALOG,
      term: "portal do cliente",
      chosen: [novo],
      canCreate: true,
    });
    expect(entries).toEqual([]);
  });
});

describe("isSameCatalogEntry", () => {
  it("compara item pelo id, nunca pela referência nem pelo nome", () => {
    expect(
      isSameCatalogEntry({ kind: "item", id: "p1", name: "A" }, { kind: "item", id: "p1", name: "B" })
    ).toBe(true);
    expect(
      isSameCatalogEntry({ kind: "item", id: "p1", name: "A" }, { kind: "item", id: "p2", name: "A" })
    ).toBe(false);
  });

  it("criar só é igual a criar do mesmo nome", () => {
    expect(isSameCatalogEntry({ kind: "create", name: "X" }, { kind: "create", name: "X" })).toBe(true);
    expect(isSameCatalogEntry({ kind: "create", name: "X" }, { kind: "item", id: "X", name: "X" })).toBe(
      false
    );
  });
});

describe("toCatalogOption", () => {
  it("devolve o item sem o kind", () => {
    expect(toCatalogOption({ kind: "item", id: "p1", name: "ERP", color: "blue" })).toEqual({
      id: "p1",
      name: "ERP",
      color: "blue",
      hint: null,
      archived: false,
    });
  });
});

describe("parseCreatedCatalogItem", () => {
  it("lê o item de produto devolvido pela rota", () => {
    expect(
      parseCreatedCatalogItem({
        id: "p9",
        name: "Portal",
        niche: null,
        color: "slate",
        archived_at: null,
      })
    ).toEqual({ id: "p9", name: "Portal", color: "slate", hint: null, archived: false });
  });

  it("lê o item de plano (sem cor)", () => {
    expect(
      parseCreatedCatalogItem({ id: "s1", name: "Premium", description: null, archived_at: null })
    ).toEqual({ id: "s1", name: "Premium", color: null, hint: null, archived: false });
  });

  it("resposta sem item legível vira null", () => {
    for (const raw of [undefined, null, "x", {}, { id: 1, name: "A" }, { id: "a" }]) {
      expect(parseCreatedCatalogItem(raw)).toBeNull();
    }
  });
});
