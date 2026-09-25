import { describe, expect, it } from "vitest";

import { leadsToCsv } from "@/features/leads/lib/leads-to-csv";
import type { Lead } from "@/features/leads/types";

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: "1",
    name: "Fulano",
    phone: "(27) 99999-0000",
    email: null,
    instagram_user: null,
    source: "whatsapp",
    status: "novo",
    tipo_ensaio: null,
    interesse: null,
    valor_estimado: null,
    is_recorrente: null,
    agencia_nome: null,
    modelo_nome: null,
    notes: null,
    tags: [],
    created_at: "2026-07-03T14:30:00-03:00",
    last_message_at: null,
    ...overrides,
  } as unknown as Lead;
}

describe("leadsToCsv", () => {
  it("gera o cabeçalho e uma linha por lead", () => {
    const csv = leadsToCsv([makeLead({ name: "Ana" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Nome;Telefone;Email")).toBe(true);
    expect(lines[1].startsWith("Ana;")).toBe(true);
  });

  it("traduz origem/status/tipo para rótulos legíveis", () => {
    const csv = leadsToCsv([
      makeLead({ source: "agencia", status: "agendado", tipo_ensaio: "reuniao" }),
    ]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("Agência parceira");
    expect(row).toContain("Agendado");
    expect(row).toContain("Reunião");
  });

  it("escapa aspas, separador e quebras de linha (RFC 4180)", () => {
    const csv = leadsToCsv([
      makeLead({ name: 'Ana "A"; Silva', notes: "linha1\nlinha2" }),
    ]);
    const row = csv.split("\r\n").slice(1).join("\r\n");
    // aspas duplicadas + campo entre aspas por conter ; e "
    expect(row).toContain('"Ana ""A""; Silva"');
    // o campo com \n fica entre aspas (então a linha logica quebra em 2 fisicas)
    expect(row).toContain('"linha1\nlinha2"');
  });

  it("junta as tags e formata valor com vírgula decimal", () => {
    const csv = leadsToCsv([
      makeLead({
        valor_estimado: 1800.5,
        is_recorrente: true,
        tags: [
          { id: "t1", name: "Quente", color: "rose", created_at: "" },
          { id: "t2", name: "VIP", color: "amber", created_at: "" },
        ] as Lead["tags"],
      }),
    ]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("1800,5");
    expect(row).toContain("Sim");
    expect(row).toContain("Quente, VIP");
  });

  it("lida com base vazia (só cabeçalho)", () => {
    const csv = leadsToCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
  });
});
