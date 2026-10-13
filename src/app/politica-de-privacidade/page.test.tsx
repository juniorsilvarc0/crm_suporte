import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import PoliticaDePrivacidadePage, { metadata } from "@/app/politica-de-privacidade/page";
import { PRIVACY_POLICY } from "@/features/legal/privacy-policy";

describe("/politica-de-privacidade", () => {
  it("rascunho: avisa que ainda não é a política vigente e não é indexado", () => {
    render(<PoliticaDePrivacidadePage />);

    expect(screen.getByRole("note")).toHaveTextContent("Rascunho em revisão jurídica.");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("os trechos a preencher aparecem destacados, para o jurídico achar cada um", () => {
    const { container } = render(<PoliticaDePrivacidadePage />);

    const marks = [...container.querySelectorAll("mark")].map((mark) => mark.textContent);
    expect(marks).toContain("[RAZÃO SOCIAL DO CONTROLADOR]");
    expect(marks).toContain("[NOME DO ENCARREGADO]");
  });

  it("um índice com âncora para cada seção, na ordem do texto", () => {
    render(<PoliticaDePrivacidadePage />);

    const nav = screen.getByRole("navigation", { name: "Nesta página" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(PRIVACY_POLICY.sections.map((s) => `#${s.id}`));
    for (const section of PRIVACY_POLICY.sections) {
      expect(screen.getByRole("heading", { level: 2, name: new RegExp(section.title) })).toBeInTheDocument();
    }
  });
});
