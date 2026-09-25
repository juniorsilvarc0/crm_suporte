import { describe, expect, it } from "vitest";

import {
  buildCostRows,
  buildPeriodSeries,
  contactsByDay,
  sumCostRows,
  UNKNOWN_ROW_LABEL,
} from "@/features/meta/costs";
import type { MetaAdInsight } from "@/features/meta/insights";
import type { MetaCohortLead } from "@/features/meta/report";

function lead(overrides: Partial<MetaCohortLead> & { leadId: string }): MetaCohortLead {
  return {
    adId: "ad-rezum",
    adName: "Rezum — dor",
    adsetId: "adset-1",
    adsetName: "Homens 45+",
    campaignId: "camp-1",
    campaignName: "Rezum agosto",
    firstTouchAt: "2026-08-06T10:00:00+00:00",
    furthestPosition: 1,
    scheduled: false,
    patient: false,
    ...overrides,
  };
}

function insight(overrides: Partial<MetaAdInsight> & { adId: string }): MetaAdInsight {
  return {
    adName: "Rezum — dor",
    adsetId: "adset-1",
    adsetName: "Homens 45+",
    campaignId: "camp-1",
    campaignName: "Rezum agosto",
    spend: 100,
    impressions: 1_000,
    clicks: 50,
    messagingStarted: 10,
    ...overrides,
  };
}

describe("buildCostRows", () => {
  it("cruza gasto da Meta com desfecho do CRM no nível do anúncio", () => {
    const rows = buildCostRows(
      [
        lead({ leadId: "l1", scheduled: true, patient: true }),
        lead({ leadId: "l2", scheduled: true }),
        lead({ leadId: "l3" }),
      ],
      [insight({ adId: "ad-rezum", spend: 300 })],
      "ad"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ad-rezum",
      spend: 300,
      contacts: 3,
      scheduled: 2,
      patients: 1,
    });
    expect(rows[0].costPerContact).toBe(100);
    expect(rows[0].costPerPatient).toBe(300);
  });

  it("mantém na tabela o anúncio que gastou e não trouxe ninguém", () => {
    // É a linha que justifica cortar verba. Montar a tabela a partir dos leads
    // faria ela sumir exatamente quando mais importa.
    const rows = buildCostRows(
      [lead({ leadId: "l1" })],
      [
        insight({ adId: "ad-rezum", spend: 100 }),
        insight({ adId: "ad-trafego", adName: "Tráfego frio", spend: 222.35 }),
      ],
      "ad"
    );

    const trafego = rows.find((row) => row.id === "ad-trafego");
    expect(trafego).toMatchObject({ spend: 222.35, contacts: 0 });
    // Custo sem denominador é ausência, não R$ 0,00.
    expect(trafego?.costPerContact).toBeNull();
    expect(trafego?.spendMissing).toBe(false);
  });

  it("marca contato vindo de anúncio fora do ar no período", () => {
    const rows = buildCostRows(
      [lead({ leadId: "l1", adId: "ad-pausado", adName: "HoLEP — antigo" })],
      [insight({ adId: "ad-rezum", spend: 100 })],
      "ad"
    );

    const pausado = rows.find((row) => row.id === "ad-pausado");
    expect(pausado).toMatchObject({
      name: "HoLEP — antigo",
      spend: null,
      contacts: 1,
      spendMissing: true,
    });
    expect(pausado?.costPerContact).toBeNull();
  });

  it("não soma contato sem anúncio identificado a uma campanha real", () => {
    const rows = buildCostRows(
      [
        lead({ leadId: "l1" }),
        lead({ leadId: "l2", adId: null, adName: null }),
      ],
      [insight({ adId: "ad-rezum", spend: 100 })],
      "ad"
    );

    expect(rows.find((row) => row.id === "ad-rezum")?.contacts).toBe(1);
    expect(rows.find((row) => row.name === UNKNOWN_ROW_LABEL)).toMatchObject({
      contacts: 1,
      spend: null,
    });
  });

  it("lead sem anúncio mas COM nome não rebatiza a linha sem identificação", () => {
    // Sem a guarda de `id`, a linha "Sem identificação" herdava o nome do lead
    // e passava a parecer um anúncio de verdade na tabela.
    const rows = buildCostRows(
      [
        lead({ leadId: "l1", adId: null, adName: "Rezum — dor" }),
        lead({ leadId: "l2", adId: null, adName: null }),
      ],
      [],
      "ad"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: UNKNOWN_ROW_LABEL, contacts: 2 });
  });

  it("sem identificação NÃO é marcado como 'sem veiculação'", () => {
    // São dois problemas diferentes: um é "o anúncio existe e não estava no ar",
    // o outro é "não se sabe qual anúncio foi". Marcar os dois igual afirmaria
    // algo que ninguém verificou.
    const rows = buildCostRows(
      [
        lead({ leadId: "l1", adId: null, adName: null }),
        lead({ leadId: "l2", adId: "ad-pausado", adName: "Pausado" }),
      ],
      [],
      "ad"
    );

    expect(rows.find((row) => row.name === UNKNOWN_ROW_LABEL)?.spendMissing).toBe(false);
    expect(rows.find((row) => row.id === "ad-pausado")?.spendMissing).toBe(true);
  });

  it("agrupa por campanha e por conjunto somando os anúncios de dentro", () => {
    const cohort = [
      lead({ leadId: "l1", adId: "ad-a", adsetId: "adset-1" }),
      lead({ leadId: "l2", adId: "ad-b", adsetId: "adset-2", adsetName: "Homens 60+" }),
    ];
    const insights = [
      insight({ adId: "ad-a", spend: 100 }),
      insight({ adId: "ad-b", spend: 250, adsetId: "adset-2", adsetName: "Homens 60+" }),
    ];

    const byCampaign = buildCostRows(cohort, insights, "campaign");
    expect(byCampaign).toHaveLength(1);
    expect(byCampaign[0]).toMatchObject({ id: "camp-1", spend: 350, contacts: 2 });

    const byAdset = buildCostRows(cohort, insights, "adset");
    expect(byAdset.map((row) => row.id)).toEqual(["adset-2", "adset-1"]);
    expect(byAdset[0]).toMatchObject({ name: "Homens 60+", spend: 250 });
  });

  it("ordena por gasto e joga a linha sem gasto para o fim", () => {
    const rows = buildCostRows(
      [
        lead({ leadId: "l1", adId: "ad-pausado", adName: "Pausado" }),
        lead({ leadId: "l2", adId: "ad-caro" }),
      ],
      [
        insight({ adId: "ad-barato", adName: "Barato", spend: 10 }),
        insight({ adId: "ad-caro", adName: "Caro", spend: 900 }),
      ],
      "ad"
    );

    expect(rows.map((row) => row.id)).toEqual(["ad-caro", "ad-barato", "ad-pausado"]);
  });

  it("não quebra sem coorte nem sem investimento", () => {
    expect(buildCostRows([], [], "campaign")).toEqual([]);
    expect(buildCostRows([lead({ leadId: "l1" })], [], "campaign")).toHaveLength(1);
    expect(buildCostRows([], [insight({ adId: "ad-x" })], "campaign")).toHaveLength(1);
  });
});

describe("sumCostRows", () => {
  it("o total fecha com a soma das linhas exibidas", () => {
    const rows = buildCostRows(
      [
        lead({ leadId: "l1", patient: true, scheduled: true }),
        lead({ leadId: "l2", adId: "ad-pausado", adName: "Pausado" }),
      ],
      [
        insight({ adId: "ad-rezum", spend: 300 }),
        insight({ adId: "ad-trafego", adName: "Tráfego", spend: 200 }),
      ],
      "ad"
    );
    const totals = sumCostRows(rows);

    expect(totals.spend).toBe(500);
    expect(totals.contacts).toBe(2);
    expect(totals.patients).toBe(1);
    expect(totals.costPerContact).toBe(250);
    expect(totals.costPerPatient).toBe(500);
  });

  it("devolve null sem denominador em vez de R$ 0", () => {
    const totals = sumCostRows(buildCostRows([], [insight({ adId: "ad-x" })], "ad"));
    expect(totals.spend).toBe(100);
    expect(totals.costPerContact).toBeNull();
    expect(totals.costPerPatient).toBeNull();
  });
});

describe("contactsByDay", () => {
  it("usa o dia do fuso da clínica, sem passar por UTC", () => {
    // 21h20 em -03:00 é o dia seguinte em UTC. Converter aqui já tirou lead do
    // período uma vez; o dia sai do texto do ISO por isso.
    const byDay = contactsByDay([
      lead({ leadId: "l1", firstTouchAt: "2026-08-05T21:20:00-03:00" }),
      lead({ leadId: "l2", firstTouchAt: "2026-08-05T09:00:00-03:00" }),
      lead({ leadId: "l3", firstTouchAt: "2026-08-06T09:00:00-03:00" }),
    ]);

    expect(byDay.get("2026-08-05")).toBe(2);
    expect(byDay.get("2026-08-06")).toBe(1);
  });

  it("ignora primeiro toque vazio em vez de criar um dia inválido", () => {
    expect(contactsByDay([lead({ leadId: "l1", firstTouchAt: "" })]).size).toBe(0);
  });
});

describe("buildPeriodSeries", () => {
  it("cria um ponto por dia, inclusive os dias sem nada", () => {
    const points = buildPeriodSeries({
      from: "2026-08-06",
      to: "2026-08-10",
      daily: [
        { date: "2026-08-06", spend: 40 },
        { date: "2026-08-09", spend: 60 },
      ],
      cohort: [
        lead({ leadId: "l1", firstTouchAt: "2026-08-06T10:00:00-03:00" }),
        lead({ leadId: "l2", firstTouchAt: "2026-08-10T10:00:00-03:00" }),
      ],
    });

    expect(points).toHaveLength(5);
    expect(points.map((point) => point.date)).toEqual([
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
    expect(points[0]).toEqual({ date: "2026-08-06", spend: 40, contacts: 1 });
    expect(points[1]).toEqual({ date: "2026-08-07", spend: 0, contacts: 0 });
    expect(points[4]).toEqual({ date: "2026-08-10", spend: 0, contacts: 1 });
  });

  it("atravessa a virada de mês", () => {
    const points = buildPeriodSeries({
      from: "2026-07-30",
      to: "2026-08-02",
      daily: [],
      cohort: [],
    });
    expect(points.map((point) => point.date)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("um dia só continua sendo um ponto", () => {
    const points = buildPeriodSeries({
      from: "2026-08-06",
      to: "2026-08-06",
      daily: [{ date: "2026-08-06", spend: 12 }],
      cohort: [],
    });
    expect(points).toEqual([{ date: "2026-08-06", spend: 12, contacts: 0 }]);
  });

  it("intervalo invertido devolve vazio em vez de laço", () => {
    expect(
      buildPeriodSeries({ from: "2026-08-10", to: "2026-08-01", daily: [], cohort: [] })
    ).toEqual([]);
  });
});
