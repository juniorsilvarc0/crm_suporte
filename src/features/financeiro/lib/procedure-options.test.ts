import { describe, expect, it } from "vitest";

import {
  buildProcedureOptions,
  normalize,
  type Procedure,
} from "@/features/financeiro/lib/procedure-options";

const CATALOG: Procedure[] = [
  { id: "p1", name: "Consulta", defaultAmount: 800 },
  { id: "p2", name: "Rezum", defaultAmount: 18000 },
  { id: "p3", name: "HoLEP", defaultAmount: 25000 },
  { id: "p4", name: "Cirurgia de próstata", defaultAmount: null },
];

function kinds(options: ReturnType<typeof buildProcedureOptions>) {
  return options.map((option) => `${option.kind}:${option.name}`);
}

describe("normalize", () => {
  it("tira acento e caixa", () => {
    expect(normalize("Próstata")).toBe("prostata");
    expect(normalize("  HoLEP ")).toBe("holep");
  });
});

describe("buildProcedureOptions — filtro", () => {
  it("sem termo, devolve o catálogo inteiro", () => {
    const options = buildProcedureOptions({ items: CATALOG, term: "" });
    expect(options).toHaveLength(4);
    expect(options.every((option) => option.kind === "catalog")).toBe(true);
  });

  it("filtra ignorando caixa", () => {
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "rezum" }))).toEqual([
      "catalog:Rezum",
    ]);
  });

  it("filtra ignorando acento", () => {
    // Termo parcial: acha o item E oferece criar, porque "prostata" também pode
    // ser um procedimento novo que o operador quer cadastrar.
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "prostata" }))).toContain(
      "catalog:Cirurgia de próstata"
    );
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "próstata" }))).toContain(
      "catalog:Cirurgia de próstata"
    );
  });

  it("casa no meio do nome", () => {
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "cirurgia" }))).toEqual([
      "catalog:Cirurgia de próstata",
      "create:cirurgia",
    ]);
  });
});

describe("buildProcedureOptions — linha de criar", () => {
  it("aparece com 2 ou mais caracteres sem correspondência", () => {
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "Botox" }))).toEqual([
      "create:Botox",
    ]);
  });

  it("não aparece com menos de 2 caracteres", () => {
    expect(buildProcedureOptions({ items: CATALOG, term: "B" })).toEqual([]);
  });

  it("NÃO aparece quando o termo casa exatamente com um item", () => {
    const options = buildProcedureOptions({ items: CATALOG, term: "Rezum" });
    expect(kinds(options)).toEqual(["catalog:Rezum"]);
  });

  it("não aparece nem com diferença de caixa ou acento", () => {
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "rezum" }))).toEqual([
      "catalog:Rezum",
    ]);
    expect(
      kinds(buildProcedureOptions({ items: CATALOG, term: "cirurgia de prostata" }))
    ).toEqual(["catalog:Cirurgia de próstata"]);
  });

  it("aparece junto de resultados parciais", () => {
    expect(kinds(buildProcedureOptions({ items: CATALOG, term: "Con" }))).toEqual([
      "catalog:Consulta",
      "create:Con",
    ]);
  });

  it("usa o termo aparado", () => {
    const options = buildProcedureOptions({ items: CATALOG, term: "  Botox  " });
    expect(options[0]).toMatchObject({ kind: "create", name: "Botox" });
  });
});

describe("buildProcedureOptions — não perder o valor escolhido", () => {
  it("procedimento escolhido que saiu do catálogo vira linha orphan", () => {
    const options = buildProcedureOptions({
      items: CATALOG,
      term: "",
      selectedName: "Vasectomia",
    });

    expect(kinds(options)).toContain("orphan:Vasectomia");
  });

  it("escolhido que ainda está no catálogo NÃO duplica", () => {
    const options = buildProcedureOptions({
      items: CATALOG,
      term: "",
      selectedName: "Rezum",
    });

    expect(options.filter((option) => option.name === "Rezum")).toHaveLength(1);
    expect(options.some((option) => option.kind === "orphan")).toBe(false);
  });

  it("orphan respeita o filtro de busca", () => {
    const semTermo = buildProcedureOptions({
      items: CATALOG,
      term: "",
      selectedName: "Vasectomia",
    });
    expect(kinds(semTermo)).toContain("orphan:Vasectomia");

    const comTermoQueNaoCasa = buildProcedureOptions({
      items: CATALOG,
      term: "rezum",
      selectedName: "Vasectomia",
    });
    expect(kinds(comTermoQueNaoCasa)).not.toContain("orphan:Vasectomia");
  });

  it("orphan bloqueia a linha de criar do mesmo nome", () => {
    const options = buildProcedureOptions({
      items: CATALOG,
      term: "Vasectomia",
      selectedName: "Vasectomia",
    });

    expect(kinds(options)).toEqual(["orphan:Vasectomia"]);
  });

  it("catálogo vazio com valor escolhido ainda mostra o escolhido", () => {
    const options = buildProcedureOptions({
      items: [],
      term: "",
      selectedName: "Rezum",
    });

    expect(kinds(options)).toEqual(["orphan:Rezum"]);
  });
});

describe("buildProcedureOptions — catálogo vazio", () => {
  it("sem termo e sem escolha, lista vazia", () => {
    expect(buildProcedureOptions({ items: [], term: "" })).toEqual([]);
  });

  it("com termo, oferece criar o primeiro", () => {
    expect(kinds(buildProcedureOptions({ items: [], term: "Consulta" }))).toEqual([
      "create:Consulta",
    ]);
  });
});

describe("buildProcedureOptions — valor de referência", () => {
  it("carrega o valor do catálogo para pré-preencher o total", () => {
    const options = buildProcedureOptions({ items: CATALOG, term: "Rezum" });
    expect(options[0]).toMatchObject({ kind: "catalog", defaultAmount: 18000 });
  });

  it("procedimento sem valor devolve null", () => {
    const options = buildProcedureOptions({ items: CATALOG, term: "Cirurgia" });
    expect(options[0]).toMatchObject({ defaultAmount: null });
  });
});
