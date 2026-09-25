import { describe, expect, it } from "vitest";

import { aggregateInsightRows, type DailyAdRow } from "@/features/meta/insights";

function row(overrides: Partial<DailyAdRow> & { adId: string; date: string }): DailyAdRow {
  return {
    adName: "Rezum — dor",
    adsetId: "adset-1",
    adsetName: "Homens 45+",
    campaignId: "camp-1",
    campaignName: "Rezum agosto",
    spend: 0,
    impressions: 0,
    clicks: 0,
    messagingStarted: 0,
    ...overrides,
  };
}

describe("aggregateInsightRows", () => {
  it("dobra os dias em UMA linha por anúncio", () => {
    // ⚠️ É o contrato que `summarizeSpend` exige. Com `time_increment=1` a Graph
    // devolve uma linha por anúncio POR DIA; deixar passar assim multiplicaria o
    // investimento pelo número de dias do recorte.
    const { ads } = aggregateInsightRows([
      row({ adId: "ad-rezum", date: "2026-08-06", spend: 80.5, impressions: 100, clicks: 4, messagingStarted: 2 }),
      row({ adId: "ad-rezum", date: "2026-08-07", spend: 90.5, impressions: 150, clicks: 6, messagingStarted: 3 }),
      row({ adId: "ad-holep", date: "2026-08-07", spend: 40, impressions: 70, clicks: 1 }),
    ]);

    expect(ads).toHaveLength(2);
    const rezum = ads.find((ad) => ad.adId === "ad-rezum");
    expect(rezum?.spend).toBeCloseTo(171, 2);
    expect(rezum?.impressions).toBe(250);
    expect(rezum?.clicks).toBe(10);
    expect(rezum?.messagingStarted).toBe(5);
  });

  it("a soma dos dias é o mesmo total que o agregado por anúncio", () => {
    const rows = [
      row({ adId: "ad-a", date: "2026-08-06", spend: 12.34 }),
      row({ adId: "ad-b", date: "2026-08-06", spend: 7.66 }),
      row({ adId: "ad-a", date: "2026-08-07", spend: 100 }),
    ];
    const { ads, daily } = aggregateInsightRows(rows);

    const totalPorAnuncio = ads.reduce((sum, ad) => sum + ad.spend, 0);
    const totalPorDia = daily.reduce((sum, point) => sum + point.spend, 0);
    expect(totalPorDia).toBeCloseTo(totalPorAnuncio, 2);
    expect(totalPorDia).toBeCloseTo(120, 2);
  });

  it("soma o gasto de todos os anúncios dentro do dia, em ordem de data", () => {
    const { daily } = aggregateInsightRows([
      row({ adId: "ad-b", date: "2026-08-07", spend: 5 }),
      row({ adId: "ad-a", date: "2026-08-06", spend: 10 }),
      row({ adId: "ad-b", date: "2026-08-06", spend: 20 }),
    ]);

    expect(daily).toEqual([
      { date: "2026-08-06", spend: 30 },
      { date: "2026-08-07", spend: 5 },
    ]);
  });

  it("usa o nome mais recente quando o anúncio foi renomeado no meio do período", () => {
    const { ads } = aggregateInsightRows([
      row({ adId: "ad-a", date: "2026-08-06", adName: "Nome antigo" }),
      row({ adId: "ad-a", date: "2026-08-07", adName: "Nome novo" }),
    ]);
    expect(ads[0].adName).toBe("Nome novo");
  });

  it("linha sem data entra no total do anúncio e fica fora da série diária", () => {
    const { ads, daily } = aggregateInsightRows([
      { ...row({ adId: "ad-a", date: "2026-08-06", spend: 10 }), date: null },
    ]);
    expect(ads[0].spend).toBe(10);
    expect(daily).toEqual([]);
  });

  it("não quebra sem linha nenhuma", () => {
    expect(aggregateInsightRows([])).toEqual({ ads: [], daily: [] });
  });
});
