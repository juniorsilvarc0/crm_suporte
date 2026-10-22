import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { OverdueBanner } from "@/features/chat/components/overdue-banner";
import type { UseCustomerContext } from "@/features/chat/hooks/use-customer-context";
import type { CustomerContext, CustomerContextResult, CustomerOpenInvoice } from "@/features/customer-source/types";

const invoice = (id: number, due: string, principal = 200): CustomerOpenInvoice => ({
  id,
  contratoId: 40,
  contratoNumero: "CT-40",
  descricao: "Mensalidade",
  tipo: "mensalidade",
  dataEmissao: null,
  dataVencimento: due,
  valorPrincipal: principal,
  multaValor: 0,
  jurosValor: 0,
  situacao: "aberto",
  parcelaN: null,
  parcelaDe: null,
});

const context = (titulosEmAberto: CustomerOpenInvoice[]): CustomerContext => ({
  externalId: "33",
  tipoPessoa: "PJ",
  documento: "12321030000189",
  razaoSocial: "EMPRESA LTDA",
  nomeFantasia: "EMPRESA",
  status: "ativo",
  emailPrincipal: null,
  emailFinanceiro: null,
  telefonePrincipal: null,
  telefoneSecundario: null,
  contratos: [],
  titulosEmAberto,
  contatos: [],
});

const state = (result: CustomerContextResult | null): UseCustomerContext => ({
  loading: result === null,
  result,
  retry: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverdueBanner", () => {
  it("com título vencido, avisa quantos, quanto e desde quando; Ver detalhes abre o painel", () => {
    const onOpenDetails = vi.fn();
    render(
      <OverdueBanner
        state={state({
          state: "ok",
          context: context([invoice(1, "2026-10-05"), invoice(2, "2026-09-05"), invoice(3, "2026-11-05")]),
        })}
        onOpenDetails={onOpenDetails}
      />
    );

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Cliente em atraso: 2 títulos vencidos");
    expect(banner).toHaveTextContent("R$ 400");
    expect(banner).toHaveTextContent("o mais antigo venceu em 05/09/2026");
    fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("um título só: no singular", () => {
    render(<OverdueBanner state={state({ state: "ok", context: context([invoice(1, "2026-10-21")]) })} onOpenDetails={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("1 título vencido · R$ 200 · venceu em 21/10/2026.");
  });

  it("em dia (o do dia ainda não venceu): nada aparece", () => {
    render(<OverdueBanner state={state({ state: "ok", context: context([invoice(1, "2026-10-22")]) })} onOpenDetails={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each<CustomerContextResult | null>([
    null,
    { state: "not_configured" },
    { state: "unavailable" },
    { state: "not_found" },
    { state: "ambiguous" },
  ])("sem a fonte confirmar o atraso (%o): nada aparece", (result) => {
    render(<OverdueBanner state={state(result)} onOpenDetails={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});
