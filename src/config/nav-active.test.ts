import { describe, expect, it } from "vitest";

import { getActiveNavHref, matchesNavHref } from "@/config/nav-active";
import { getDashboardNavigation } from "@/config/navigation";

describe("matchesNavHref", () => {
  it("casa com a própria rota", () => {
    expect(matchesNavHref("/app/tickets", "/app/tickets")).toBe(true);
  });

  it("casa com rota filha, respeitando o limite de segmento", () => {
    expect(matchesNavHref("/app/tickets/1024", "/app/tickets")).toBe(true);
    expect(matchesNavHref("/app/ticketsx", "/app/tickets")).toBe(false);
    expect(matchesNavHref("/app/chatbot", "/app/chat")).toBe(false);
  });

  it("não casa Início com rota filha: ele é a raiz, não a seção-mãe", () => {
    expect(matchesNavHref("/app", "/app")).toBe(true);
    expect(matchesNavHref("/app/tickets", "/app")).toBe(false);
  });
});

describe("getActiveNavHref", () => {
  it("não acende Início dentro de Tickets", () => {
    expect(getActiveNavHref("/app/tickets", ["/app", "/app/tickets"])).toBe("/app/tickets");
    expect(getActiveNavHref("/app/tickets", ["/app"])).toBeNull();
  });

  it("acende Tickets no detalhe do ticket", () => {
    expect(getActiveNavHref("/app/tickets/1024", ["/app", "/app/tickets", "/app/chat"])).toBe("/app/tickets");
  });

  it("o href mais longo vence: um Quadro sob Tickets acende sozinho", () => {
    const hrefs = ["/app", "/app/tickets", "/app/tickets/quadro"];

    expect(getActiveNavHref("/app/tickets/quadro", hrefs)).toBe("/app/tickets/quadro");
    expect(getActiveNavHref("/app/tickets/1024", hrefs)).toBe("/app/tickets");
  });

  it("não depende da ordem da lista", () => {
    expect(getActiveNavHref("/app/tickets/quadro", ["/app/tickets/quadro", "/app/tickets", "/app"])).toBe(
      "/app/tickets/quadro"
    );
  });

  it("rota que nenhum item cobre não acende nada", () => {
    expect(getActiveNavHref("/app/inexistente", ["/app", "/app/tickets"])).toBeNull();
    expect(getActiveNavHref("/app/ticketsx", ["/app", "/app/tickets"])).toBeNull();
  });

  it("na navegação real, cada item acende sozinho na própria rota e nas filhas", () => {
    const hrefs = getDashboardNavigation("admin").map((item) => item.href);

    for (const href of hrefs) {
      expect(getActiveNavHref(href, hrefs)).toBe(href);
      if (href !== "/app") expect(getActiveNavHref(`${href}/detalhe`, hrefs)).toBe(href);
    }
  });
});
