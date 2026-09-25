import { describe, expect, it } from "vitest";

import {
  buildTopNavigation,
  dashboardNavigation,
  getDashboardNavigation,
  getMobileTabs,
  mobileTabHrefs,
  navGroupOrder,
} from "@/config/navigation";
import { decideRouteAccess } from "@/lib/auth/route-guard";

describe("getDashboardNavigation", () => {
  it("expõe somente Rastreamento para tráfego pago", () => {
    expect(getDashboardNavigation("paid_traffic").map((item) => item.href)).toEqual([
      "/app/rastreamento",
    ]);
  });

  it("mantém menu e guard alinhados para tráfego pago", () => {
    const visiblePaths = new Set(
      getDashboardNavigation("paid_traffic").map((item) => item.href)
    );

    for (const path of [
      "/app",
      "/app/leads",
      "/app/pacientes",
      "/app/funil",
      "/app/agendamentos",
      "/app/chat",
      "/app/rastreamento",
      "/app/follow-ups",
      "/app/conexao",
      "/app/equipe",
      "/app/configuracoes",
    ]) {
      expect(decideRouteAccess(path, true, "paid_traffic")).toEqual(
        visiblePaths.has(path) ? { type: "allow" } : { type: "redirect-tracking" }
      );
    }
  });

  it("mantém as áreas operacionais do membro", () => {
    const paths = getDashboardNavigation("member").map((item) => item.href);
    expect(paths).toContain("/app/leads");
    expect(paths).toContain("/app/chat");
    expect(paths).not.toContain("/app/rastreamento");
    expect(paths).not.toContain("/app/equipe");
  });

  it("dá Pacientes à operação e nega ao tráfego pago", () => {
    // O cadastro clínico é dado sensível (CPF, filiação, saúde): quem só
    // acompanha anúncio não tem por que enxergar a tela.
    for (const role of ["admin", "member"] as const) {
      expect(getDashboardNavigation(role).map((item) => item.href)).toContain(
        "/app/pacientes"
      );
    }
    expect(getDashboardNavigation("paid_traffic").map((item) => item.href)).not.toContain(
      "/app/pacientes"
    );
  });

  it("mantém todas as áreas do administrador", () => {
    const paths = getDashboardNavigation("admin").map((item) => item.href);
    expect(paths).toContain("/app/rastreamento");
    expect(paths).toContain("/app/equipe");
    expect(paths).toContain("/app/chat");
  });
});

describe("abas da barra inferior", () => {
  it("leva o WhatsApp para a barra — era o que ficava escondido no 'Mais'", () => {
    expect(getMobileTabs("admin").map((item) => item.href)).toEqual([
      "/app",
      "/app/leads",
      "/app/funil",
      "/app/agendamentos",
      "/app/chat",
    ]);
  });

  it("respeita o papel: tráfego pago não ganha aba nenhuma", () => {
    // Rastreamento não está entre as abas, e é a única área dessa role — a
    // barra some inteira em vez de mostrar uma aba solitária.
    expect(getMobileTabs("paid_traffic")).toEqual([]);
  });

  it("membro recebe as cinco abas, todas dentro do que ele pode ver", () => {
    const tabs = getMobileTabs("member");
    const allowed = new Set(getDashboardNavigation("member").map((item) => item.href));
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) expect(allowed.has(tab.href)).toBe(true);
  });

  it("toda aba configurada existe na navegação — sem href órfão", () => {
    const known = new Set(dashboardNavigation.map((item) => item.href));
    for (const href of mobileTabHrefs) expect(known.has(href)).toBe(true);
  });

  it("todo item tem grupo conhecido, senão some do menu completo", () => {
    for (const item of dashboardNavigation) {
      expect(navGroupOrder).toContain(item.group);
    }
  });
});

describe("buildTopNavigation", () => {
  // A barra superior é a única navegação do desktop: item que não entra numa
  // entrada aqui simplesmente não existe para quem usa o app no computador.
  const entryHrefs = (entries: ReturnType<typeof buildTopNavigation>) =>
    entries.flatMap((entry) => (entry.kind === "link" ? [entry.item.href] : entry.items.map((item) => item.href)));

  it("agrupa a operação do admin nas entradas da barra, na ordem certa", () => {
    const entries = buildTopNavigation(getDashboardNavigation("admin"));

    expect(
      entries.map((entry) => (entry.kind === "link" ? entry.item.title : entry.title))
    ).toEqual(["Início", "Pessoas", "Agenda", "WhatsApp", "Métricas", "Rastreamento", "Ajustes"]);

    const pessoas = entries[1];
    const ajustes = entries[6];
    expect(pessoas.kind).toBe("menu");
    expect(ajustes.kind).toBe("menu");
    if (pessoas.kind === "menu") {
      expect(pessoas.items.map((item) => item.href)).toEqual([
        "/app/leads",
        "/app/pacientes",
        "/app/funil",
        "/app/follow-ups",
      ]);
    }
    if (ajustes.kind === "menu") {
      expect(ajustes.items.map((item) => item.href)).toEqual([
        "/app/conexao",
        "/app/equipe",
        "/app/configuracoes",
      ]);
    }
  });

  it("não inventa menu de administração para membro", () => {
    const entries = buildTopNavigation(getDashboardNavigation("member"));

    expect(entries.some((entry) => entry.kind === "menu" && entry.title === "Ajustes")).toBe(false);
    expect(entryHrefs(entries)).not.toContain("/app/configuracoes");
  });

  it("deixa tráfego pago com o único módulo que ele acessa", () => {
    const entries = buildTopNavigation(getDashboardNavigation("paid_traffic"));

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("link");
    expect(entryHrefs(entries)).toEqual(["/app/rastreamento"]);
  });

  it("mantém todo módulo visível alcançável — nada some da barra", () => {
    for (const role of ["admin", "member", "paid_traffic"] as const) {
      const visible = getDashboardNavigation(role);
      expect(new Set(entryHrefs(buildTopNavigation(visible)))).toEqual(
        new Set(visible.map((item) => item.href))
      );
    }
  });

  it("mantém o Perfil fora da barra: ele mora no menu da conta", () => {
    const perfil = { title: "Perfil", href: "/app/perfil", icon: () => null };
    const entries = buildTopNavigation([...getDashboardNavigation("member"), perfil]);

    expect(entryHrefs(entries)).not.toContain("/app/perfil");
  });

  it("grupo com um item só vira link, sem menu de um item", () => {
    const leads = getDashboardNavigation("admin").filter((item) => item.href === "/app/leads");
    const entries = buildTopNavigation(leads);

    expect(entries).toEqual([{ kind: "link", item: leads[0] }]);
  });

  it("módulo novo fora da ordem da barra aparece no fim em vez de sumir", () => {
    const novo = { title: "Financeiro", href: "/app/financeiro", icon: () => null };
    const entries = buildTopNavigation([...getDashboardNavigation("member"), novo]);

    expect(entries.at(-1)).toEqual({ kind: "link", item: novo });
  });
});
