import { MessageCircleIcon, SettingsIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { getActiveNavHref } from "@/config/nav-active";
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
  it("dá ao membro só a operação, com os tickets e os cadastros", () => {
    expect(getDashboardNavigation("member").map((item) => item.href)).toEqual([
      "/app",
      "/app/tickets",
      "/app/chat",
      "/app/clientes",
      "/app/contatos",
    ]);
  });

  it("dá ao administrador a operação e os ajustes", () => {
    expect(getDashboardNavigation("admin").map((item) => item.href)).toEqual([
      "/app",
      "/app/tickets",
      "/app/chat",
      "/app/clientes",
      "/app/contatos",
      "/app/conexao",
      "/app/equipe",
      "/app/configuracoes",
      "/app/configuracoes/atendimento",
    ]);
  });

  it("mantém menu e guard alinhados: o que o membro não vê, o guard devolve para /app", () => {
    const visible = new Set(getDashboardNavigation("member").map((item) => item.href));

    for (const item of dashboardNavigation) {
      expect(decideRouteAccess(item.href, true, "member")).toEqual(
        visible.has(item.href) ? { type: "allow" } : { type: "redirect-app" }
      );
    }
  });
});

describe("abas da barra inferior", () => {
  it("leva o WhatsApp para a barra — era o que ficava escondido no 'Mais'", () => {
    expect(getMobileTabs("admin").map((item) => item.href)).toEqual([
      "/app",
      "/app/tickets",
      "/app/chat",
      "/app/clientes",
    ]);
  });

  it("membro recebe as mesmas abas, todas dentro do que ele pode ver", () => {
    const tabs = getMobileTabs("member");
    const allowed = new Set(getDashboardNavigation("member").map((item) => item.href));
    expect(tabs.map((tab) => tab.href)).toEqual(["/app", "/app/tickets", "/app/chat", "/app/clientes"]);
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

  it("deixa a operação solta e agrupa os ajustes do admin num menu", () => {
    const entries = buildTopNavigation(getDashboardNavigation("admin"));

    expect(
      entries.map((entry) => (entry.kind === "link" ? entry.item.title : entry.title))
    ).toEqual(["Início", "Tickets", "WhatsApp", "Clientes", "Contatos", "Ajustes"]);

    const ajustes = entries[5];
    expect(ajustes.kind).toBe("menu");
    if (ajustes.kind === "menu") {
      expect(ajustes.items.map((item) => item.href)).toEqual([
        "/app/conexao",
        "/app/equipe",
        "/app/configuracoes",
        "/app/configuracoes/atendimento",
      ]);
    }
  });

  it("dá ao menu Ajustes o ícone de engrenagem, como os links soltos têm o deles", () => {
    const ajustes = buildTopNavigation(getDashboardNavigation("admin")).find((entry) => entry.kind === "menu");

    expect(ajustes?.kind === "menu" ? ajustes.icon : undefined).toBe(SettingsIcon);
  });

  it("usa na navegação o balão de traço para o WhatsApp, não o logo preenchido", () => {
    const whatsapp = getDashboardNavigation("member").find((item) => item.href === "/app/chat");

    expect(whatsapp?.icon).toBe(MessageCircleIcon);
  });

  it("não inventa menu de administração para membro", () => {
    const entries = buildTopNavigation(getDashboardNavigation("member"));

    expect(entries.some((entry) => entry.kind === "menu" && entry.title === "Ajustes")).toBe(false);
    expect(entryHrefs(entries)).not.toContain("/app/configuracoes");
    expect(entryHrefs(entries)).not.toContain("/app/configuracoes/atendimento");
  });

  it("mantém todo módulo visível alcançável — nada some da barra", () => {
    for (const role of ["admin", "member"] as const) {
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
    const conexao = getDashboardNavigation("admin").filter((item) => item.href === "/app/conexao");
    const entries = buildTopNavigation(conexao);

    expect(entries).toEqual([{ kind: "link", item: conexao[0] }]);
  });

  it("módulo novo fora da ordem da barra aparece no fim em vez de sumir", () => {
    const novo = { title: "Agenda", href: "/app/agendamentos", icon: () => null };
    const entries = buildTopNavigation([...getDashboardNavigation("member"), novo]);

    expect(entries.at(-1)).toEqual({ kind: "link", item: novo });
  });
});

describe("Atendimento sob Configurações", () => {
  // O href de Atendimento começa com o de Configurações: com prefixo simples,
  // os dois acenderiam juntos na página de Atendimento.
  const hrefs = getDashboardNavigation("admin").map((item) => item.href);

  it("acende só Atendimento na página dele, com ou sem sub-rota", () => {
    expect(getActiveNavHref("/app/configuracoes/atendimento", hrefs)).toBe("/app/configuracoes/atendimento");
    expect(getActiveNavHref("/app/configuracoes/atendimento/filas", hrefs)).toBe(
      "/app/configuracoes/atendimento"
    );
  });

  it("acende só Configurações na página delas", () => {
    expect(getActiveNavHref("/app/configuracoes", hrefs)).toBe("/app/configuracoes");
    expect(getActiveNavHref("/app/configuracoes/atendimentox", hrefs)).toBe("/app/configuracoes");
  });

  it("o guard devolve o membro para /app, já pelo prefixo de /app/configuracoes", () => {
    expect(decideRouteAccess("/app/configuracoes/atendimento", true, "member")).toEqual({
      type: "redirect-app",
    });
    expect(decideRouteAccess("/app/configuracoes/atendimento", true, "admin")).toEqual({ type: "allow" });
  });
});
