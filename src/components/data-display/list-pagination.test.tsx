import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ListPagination, listPageHref } from "@/components/data-display/list-pagination";

const base = {
  basePath: "/app/clientes",
  searchParams: {},
  pageSize: 25,
  noun: ["empresa", "empresas"] as const,
};

describe("listPageHref", () => {
  it("mantém os filtros da URL e troca só a página", () => {
    expect(listPageHref("/app/clientes", { q: "padaria", situacao: "ativo", page: "2" }, 3)).toBe(
      "/app/clientes?q=padaria&situacao=ativo&page=3"
    );
  });

  it("página 1 sai sem page, e parâmetro vazio não vai para a URL", () => {
    expect(listPageHref("/app/contatos", { q: "", empresa: "sem", page: "2" }, 1)).toBe(
      "/app/contatos?empresa=sem"
    );
    expect(listPageHref("/app/contatos", {}, 1)).toBe("/app/contatos");
  });

  it("parâmetro repetido continua repetido", () => {
    expect(listPageHref("/app/x", { tag: ["a", "b"] }, 2)).toBe("/app/x?tag=a&tag=b&page=2");
  });
});

describe("ListPagination", () => {
  it("mostra o intervalo e o total com o substantivo certo", () => {
    render(<ListPagination {...base} page={2} pageCount={13} total={312} />);

    expect(screen.getByText("26–50 de 312 empresas")).toBeTruthy();
    expect(screen.getByText("Página 2 de 13")).toBeTruthy();
  });

  it("singular com um item só, e sem botões numa página só", () => {
    render(<ListPagination {...base} page={1} pageCount={1} total={1} />);

    expect(screen.getByText("1–1 de 1 empresa")).toBeTruthy();
    expect(screen.queryByText("Anterior")).toBeNull();
  });

  it("Anterior e Próxima são links com rel, levando os filtros", () => {
    render(
      <ListPagination
        {...base}
        searchParams={{ q: "padaria", page: "2" }}
        page={2}
        pageCount={3}
        total={60}
      />
    );

    const prev = screen.getByRole("link", { name: /Anterior/ });
    const next = screen.getByRole("link", { name: /Próxima/ });
    expect(prev.getAttribute("href")).toBe("/app/clientes?q=padaria");
    expect(prev.getAttribute("rel")).toBe("prev");
    expect(next.getAttribute("href")).toBe("/app/clientes?q=padaria&page=3");
    expect(next.getAttribute("rel")).toBe("next");
  });

  it("na primeira página, Anterior não é link", () => {
    render(<ListPagination {...base} page={1} pageCount={3} total={60} />);

    expect(screen.queryByRole("link", { name: /Anterior/ })).toBeNull();
    expect(screen.getByText("Anterior").closest("[aria-disabled]")).toBeTruthy();
  });

  it("lista vazia (ou que falhou) não mostra paginação", () => {
    const { container } = render(<ListPagination {...base} page={1} pageCount={1} total={0} />);

    expect(container.innerHTML).toBe("");
  });
});
