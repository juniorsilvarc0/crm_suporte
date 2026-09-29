import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LogoMark } from "@/components/ui/logo-mark";
import { siteConfig } from "@/config/site";

function svgOf(container: HTMLElement) {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("LogoMark não renderizou um <svg>");
  return svg;
}

describe("LogoMark", () => {
  it("usa a marca do cliente como rótulo acessível por padrão (a logo diz 'ticbox')", () => {
    render(<LogoMark />);

    expect(screen.getByRole("img", { name: siteConfig.brand })).toBeInTheDocument();
  });

  it("sai da árvore de acessibilidade quando o rótulo é vazio (logo decorativa)", () => {
    const { container } = render(<LogoMark aria-label="" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("trata `size` como altura e tira a largura da proporção de cada recorte", () => {
    const symbol = svgOf(render(<LogoMark size={44} />).container);
    const wordmark = svgOf(render(<LogoMark variant="wordmark" size={26} />).container);
    const full = svgOf(render(<LogoMark variant="full" size={46} />).container);

    expect([symbol.getAttribute("width"), symbol.getAttribute("height")]).toEqual(["44", "44"]);
    expect([wordmark.getAttribute("width"), wordmark.getAttribute("height")]).toEqual(["120", "26"]);
    expect([full.getAttribute("width"), full.getAttribute("height")]).toEqual(["167", "46"]);
  });

  it("desenha as letras só nos recortes com nome, e 'sistemas' só na assinatura completa", () => {
    const partes = (variant: "symbol" | "wordmark" | "full") =>
      svgOf(render(<LogoMark variant={variant} />).container).querySelectorAll("path, polygon").length;

    expect(partes("symbol")).toBe(1);
    expect(partes("wordmark")).toBe(4);
    expect(partes("full")).toBe(5);
  });

  it("deixa a cor ser trocada por classe (branca sobre a faixa verde)", () => {
    const svg = svgOf(render(<LogoMark className="text-white" />).container);

    expect(svg).toHaveClass("text-white");
    expect(svg).not.toHaveClass("text-brand-deep");
  });
});
