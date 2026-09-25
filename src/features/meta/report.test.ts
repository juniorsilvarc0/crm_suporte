import { describe, expect, it } from "vitest";
import {
  buildMetaTrackingReport,
  metaReportToCsv,
  type MetaAttributionForReport,
} from "@/features/meta/report";

const attributions: MetaAttributionForReport[] = [
  {
    id: "a-1",
    lead_id: "lead-1",
    source_id: "ad-1",
    had_ctwa_clid: false,
    message_at: "2026-07-03T12:00:00.000Z",
    ad_id_snapshot: "ad-1",
    ad_name_snapshot: "Anúncio A",
    adset_id_snapshot: "set-1",
    adset_name_snapshot: "Conjunto",
    campaign_id_snapshot: "campaign-1",
    campaign_name_snapshot: "Campanha antiga",
  },
  {
    id: "a-2",
    lead_id: "lead-1",
    source_id: "ad-2",
    had_ctwa_clid: true,
    message_at: "2026-07-10T12:00:00.000Z",
    ad_id_snapshot: "ad-2",
    ad_name_snapshot: "Outro anúncio",
    adset_id_snapshot: "set-2",
    adset_name_snapshot: "Outro conjunto",
    campaign_id_snapshot: "campaign-2",
    campaign_name_snapshot: "Outra campanha",
  },
  {
    id: "a-3",
    lead_id: "lead-2",
    source_id: "ad-3",
    had_ctwa_clid: false,
    message_at: "2026-07-05T12:00:00.000Z",
    ad_id_snapshot: "ad-3",
    ad_name_snapshot: "Anúncio B",
    adset_id_snapshot: "set-1",
    adset_name_snapshot: "Conjunto",
    campaign_id_snapshot: "campaign-1",
    campaign_name_snapshot: "Campanha nova",
  },
];

describe("Meta tracking report", () => {
  it("usa a primeira atribuição como coorte e conta leads únicos com maturação", () => {
    const report = buildMetaTrackingReport(
      attributions,
      [
        {
          leadId: "lead-1",
          name: "Lead Um",
          phone: "5511999990001",
          status: "compareceu",
          stages: new Set(["agendado", "compareceu"]),
          agendadoAt: null,
          compareceuAt: null,
          clienteAt: null,
        },
        {
          leadId: "lead-2",
          name: "Lead Dois",
          phone: "5511999990002",
          status: "cliente",
          stages: new Set(["cliente"]),
          agendadoAt: "2026-08-01T00:00:00.000Z",
          compareceuAt: null,
          clienteAt: "2026-08-10T00:00:00.000Z",
        },
      ],
      { from: "2026-07-01", to: "2026-07-31" },
      { qualified: "agendado", attended: "compareceu", patient: "cliente" }
    );

    expect(report.totals).toEqual({
      contacts: 2,
      scheduled: 2,
      attended: 1,
      patients: 1,
      covered: 1,
      coveragePercent: 50,
    });
    expect(report.campaigns).toHaveLength(1);
    expect(report.campaigns[0]).toMatchObject({
      campaignId: "campaign-1",
      campaignName: "Campanha nova",
      nameVariants: ["Campanha antiga"],
    });
  });

  it("mantém filtros e CSV na mesma semântica sem identificador de click", () => {
    const report = buildMetaTrackingReport(
      attributions,
      [],
      { from: "2026-07-01", to: "2026-07-31", campaignId: "campaign-1" },
      { qualified: "agendado", attended: "compareceu", patient: "cliente" }
    );
    const csv = metaReportToCsv(report);
    expect(csv).toContain('"campaign-1"');
    expect(csv).not.toContain("ctwa_clid");
    expect(csv).not.toContain("click-sensitive");
  });

  // O accordion da campanha precisa responder "quem", não só "quantos".
  describe("leads por campanha", () => {
    const outcomes = [
      {
        leadId: "lead-1",
        name: "Lead Um",
        phone: "5511999990001",
        status: "compareceu",
        stages: new Set(["agendado", "compareceu"]),
        agendadoAt: null,
        compareceuAt: null,
        clienteAt: null,
      },
      {
        leadId: "lead-2",
        name: "Lead Dois",
        phone: "5511999990002",
        status: "cliente",
        stages: new Set(["cliente"]),
        agendadoAt: "2026-08-01T00:00:00.000Z",
        compareceuAt: null,
        clienteAt: "2026-08-10T00:00:00.000Z",
      },
    ];

    function report() {
      return buildMetaTrackingReport(attributions, outcomes, { from: "2026-07-01", to: "2026-07-31" }, {
        qualified: "agendado",
        attended: "compareceu",
        patient: "cliente",
      });
    }

    it("lista os leads da campanha com identidade e etapa", () => {
      const leads = report().campaigns[0].leads;

      expect(leads).toHaveLength(2);
      expect(leads.map((lead) => lead.leadId).sort()).toEqual(["lead-1", "lead-2"]);
      expect(leads.find((lead) => lead.leadId === "lead-1")).toMatchObject({
        name: "Lead Um",
        phone: "5511999990001",
        status: "compareceu",
      });
    });

    it("ordena do toque mais recente para o mais antigo", () => {
      const leads = report().campaigns[0].leads;
      expect(leads.map((lead) => lead.leadId)).toEqual(["lead-2", "lead-1"]);
    });

    it("usa o PRIMEIRO toque do lead, não o último", () => {
      // lead-1 tocou campaign-1 em 03/07 e campaign-2 em 10/07: pertence à
      // campaign-1, com a data e o anúncio do primeiro toque.
      const lead = report().campaigns[0].leads.find((item) => item.leadId === "lead-1");
      expect(lead).toMatchObject({
        firstTouchAt: "2026-07-03T12:00:00.000Z",
        adName: "Anúncio A",
      });
    });

    it("marca cobertura de click ID por lead, não pela campanha inteira", () => {
      const leads = report().campaigns[0].leads;
      // lead-1 teve um toque com click ID (a-2); lead-2 nenhum.
      expect(leads.find((lead) => lead.leadId === "lead-1")?.hasClickId).toBe(true);
      expect(leads.find((lead) => lead.leadId === "lead-2")?.hasClickId).toBe(false);
    });

    it("carrega as etapas alcançadas em cada lead", () => {
      const leads = report().campaigns[0].leads;
      expect(leads.find((lead) => lead.leadId === "lead-1")).toMatchObject({
        scheduled: true,
        attended: true,
        patient: false,
      });
      expect(leads.find((lead) => lead.leadId === "lead-2")).toMatchObject({
        scheduled: true,
        attended: false,
        patient: true,
      });
    });

    it("as somas da campanha continuam batendo com a lista", () => {
      const campaign = report().campaigns[0];
      expect(campaign.contacts).toBe(campaign.leads.length);
      expect(campaign.attended).toBe(campaign.leads.filter((lead) => lead.attended).length);
      expect(campaign.covered).toBe(campaign.leads.filter((lead) => lead.hasClickId).length);
    });

    it("o CSV segue sem nome, telefone ou click ID de lead", () => {
      const csv = metaReportToCsv(report());
      expect(csv).not.toContain("Lead Um");
      expect(csv).not.toContain("5511999990001");
      expect(csv).not.toContain("ctwa_clid");
    });
  });

  describe("coorte para o funil e para o custo", () => {
    const columns = [
      { key: "novo", label: "Novo", position: 0, stage_type: "open", counts_as_conversion: false },
      { key: "em_atendimento", label: "Em atendimento", position: 1, stage_type: "open", counts_as_conversion: false },
      { key: "qualificado", label: "Qualificado", position: 2, stage_type: "open", counts_as_conversion: false },
      { key: "agendado", label: "Agendado", position: 3, stage_type: "open", counts_as_conversion: true },
      { key: "compareceu", label: "Compareceu", position: 4, stage_type: "open", counts_as_conversion: true },
      { key: "cliente", label: "Cliente", position: 5, stage_type: "won", counts_as_conversion: true },
      { key: "perdido", label: "Perdido", position: 6, stage_type: "lost", counts_as_conversion: false },
    ];

    // lead-1 PULA em_atendimento e qualificado: vai de novo direto a agendado.
    // É o caso real de produção, e o que quebra um funil por "tocou a etapa".
    const outcomes = [
      {
        leadId: "lead-1",
        name: null,
        phone: null,
        status: "agendado",
        stages: new Set(["novo", "agendado"]),
        agendadoAt: null,
        compareceuAt: null,
        clienteAt: null,
      },
      {
        leadId: "lead-2",
        name: null,
        phone: null,
        status: "perdido",
        stages: new Set(["novo", "perdido"]),
        agendadoAt: null,
        compareceuAt: null,
        clienteAt: null,
      },
    ];

    function report() {
      return buildMetaTrackingReport(
        attributions,
        outcomes,
        { from: "2026-07-01", to: "2026-07-31" },
        { qualified: "agendado", attended: "compareceu", patient: "cliente" },
        columns
      );
    }

    it("devolve a posição mais avançada, mesmo com etapa pulada", () => {
      const cohort = report().cohort;
      expect(cohort.find((lead) => lead.leadId === "lead-1")?.furthestPosition).toBe(3);
    });

    it("ignora a coluna de perda ao medir avanço e a conta à parte", () => {
      const result = report();
      expect(result.cohort.find((lead) => lead.leadId === "lead-2")?.furthestPosition).toBe(0);
      expect(result.lost).toBe(1);
    });

    it("carrega o anúncio do PRIMEIRO toque, que é quem tem o gasto", () => {
      const cohort = report().cohort;
      expect(cohort.find((lead) => lead.leadId === "lead-1")?.adId).toBe("ad-1");
      expect(cohort.find((lead) => lead.leadId === "lead-2")?.adId).toBe("ad-3");
    });

    it("carrega campanha, conjunto e data do primeiro toque para a tabela de custos", () => {
      // Sem estes campos a aba de Custos precisaria refazer o agrupamento por
      // fora, com outra fonte — duas verdades para a mesma pergunta.
      const lead = report().cohort.find((entry) => entry.leadId === "lead-1");
      expect(lead).toMatchObject({
        campaignId: "campaign-1",
        adsetId: "set-1",
        adId: "ad-1",
      });
      expect(lead?.firstTouchAt).toBeTruthy();
      expect(lead?.campaignName).toBeTruthy();
    });

    it("o desfecho da coorte é o mesmo da lista da campanha", () => {
      const result = report();
      const fromCampaign = result.campaigns
        .flatMap((campaign) => campaign.leads)
        .find((entry) => entry.leadId === "lead-1");
      const fromCohort = result.cohort.find((entry) => entry.leadId === "lead-1");

      expect(fromCohort?.scheduled).toBe(fromCampaign?.scheduled);
      expect(fromCohort?.patient).toBe(fromCampaign?.patient);
    });

    it("deriva as etapas do funil do board, sem as colunas comuns", () => {
      expect(report().funnelStages.map((stage) => stage.key)).toEqual([
        "qualificado",
        "agendado",
        "compareceu",
        "cliente",
      ]);
    });

    it("sem board, o relatório continua de pé e o funil fica vazio", () => {
      const semBoard = buildMetaTrackingReport(
        attributions,
        outcomes,
        { from: "2026-07-01", to: "2026-07-31" },
        { qualified: "agendado", attended: "compareceu", patient: "cliente" }
      );
      expect(semBoard.funnelStages).toEqual([]);
      expect(semBoard.campaigns.length).toBeGreaterThan(0);
      expect(semBoard.cohort).toHaveLength(2);
    });
  });
});

