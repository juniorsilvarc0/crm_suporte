"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BanknoteIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  TagIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContractFormDialog } from "@/features/contracts/components/contract-form-dialog";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import type { ContractStatus } from "@/features/contracts/lib/contract-status";
import type {
  AdminContractView,
  ContractView,
  SupportPlanOption,
} from "@/features/contracts/types";
import type { ProductOption } from "@/features/products/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatDate, getTodayAppDateKey } from "@/lib/formatters/date";
import { formatMoneyExact } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

// ⚠️ O valor e o dia de vencimento só existem em AdminContractView, e só o
// ramo "admin" os lê. A ficha do member recebe ContractView: o payload dele
// nem tem os campos.

/** O que o admin precisa para editar o contrato ali mesmo. */
export type ContractAdminContext = {
  customerId: string;
  customerName: string;
  products: ProductOption[] | null;
  plans: SupportPlanOption[] | null;
};

export type ContractCardProps =
  | { role: "member"; contract: ContractView }
  | ({ role: "admin"; contract: AdminContractView } & ContractAdminContext);

/** Resposta de POST /api/contracts/[id]/status. */
type StatusResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

type PendingAction = "suspenso" | "ativo" | "encerrado";

function termLabel(contract: Pick<ContractView, "starts_on" | "ends_on">): string {
  const since = `desde ${formatDate(contract.starts_on)}`;
  return contract.ends_on
    ? `${since} · até ${formatDate(contract.ends_on)}`
    : `${since} · sem data de término`;
}

function planLabel(plan: ContractView["plan"]): string {
  if (!plan) return "Sem plano";
  return plan.archived ? `${plan.name} (arquivado)` : plan.name;
}

/**
 * Contrato vigente (ativo ou suspenso) da empresa.
 *
 * Todos veem selo, plano, vigência e produtos. O admin vê também o valor e o
 * vencimento, e age: editar, suspender/reativar e encerrar (com data e
 * confirmação na própria linha — encerrar é definitivo).
 */
export function ContractCard(props: ContractCardProps) {
  const { contract } = props;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
      <div className="min-w-0">
        <ContractStatusBadge status={contract.status} />
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailRow icon={<TagIcon />} label="Plano">
          <span className={cn(!contract.plan && "text-muted-foreground")}>
            {planLabel(contract.plan)}
          </span>
        </DetailRow>
        <DetailRow icon={<CalendarDaysIcon />} label="Vigência">
          <span className="tabular-nums">{termLabel(contract)}</span>
        </DetailRow>
        {props.role === "admin" ? (
          <>
            <DetailRow icon={<BanknoteIcon />} label="Valor mensal">
              {props.contract.monthly_amount === null ? (
                <span className="text-muted-foreground">Valor indisponível</span>
              ) : (
                <span className="tabular-nums">
                  {formatMoneyExact(props.contract.monthly_amount)}
                </span>
              )}
            </DetailRow>
            <DetailRow icon={<CalendarClockIcon />} label="Vencimento">
              <span className="tabular-nums">Todo dia {props.contract.billing_day}</span>
            </DetailRow>
          </>
        ) : null}
      </dl>

      <div className="mt-4">
        <p className="text-xs text-muted-foreground">Produtos cobertos</p>
        <ProductChips products={contract.products} className="mt-2" />
      </div>

      {props.role === "admin" ? (
        <ContractAdminActions
          contract={props.contract}
          customerId={props.customerId}
          customerName={props.customerName}
          products={props.products}
          plans={props.plans}
        />
      ) : null}
    </div>
  );
}

function ContractAdminActions({
  contract,
  customerId,
  customerName,
  products,
  plans,
}: { contract: AdminContractView } & ContractAdminContext) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeDate, setCloseDate] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);

  const amountMissing = contract.monthly_amount === null;

  function openClosing() {
    // O término padrão é o de hoje, mas nunca antes do início — o mesmo que a
    // RPC usa quando não recebe data. Datas ISO comparam como texto.
    const today = getTodayAppDateKey();
    setCloseDate(today < contract.starts_on ? contract.starts_on : today);
    setCloseError(null);
    setClosing(true);
  }

  async function changeStatus(status: ContractStatus) {
    if (pending) return;
    let endsOn: string | undefined;
    if (status === "encerrado") {
      // A rota recusa término vazio ("" não é data); sem data, não envia.
      if (!closeDate) {
        setCloseError("Informe a data de término.");
        return;
      }
      endsOn = closeDate;
      setCloseError(null);
    }

    setPending(status);
    try {
      const response = await fetch(`/api/contracts/${contract.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endsOn ? { status, ends_on: endsOn } : { status }),
      });
      const result = (await response.json().catch(() => ({}))) as StatusResponse;

      if (!response.ok || !result.ok) {
        const endsOnMessage = result.errors?.ends_on?.[0];
        if (status === "encerrado" && endsOnMessage) {
          setCloseError(endsOnMessage);
          return;
        }
        toast.error(result.message ?? "Não foi possível mudar a situação do contrato.");
        return;
      }

      toast.success(result.message ?? "Contrato atualizado.");
      setClosing(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível mudar a situação do contrato.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="mt-5 border-t border-border/70 pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <ContractFormDialog
          customerId={customerId}
          customerName={customerName}
          contract={contract}
          products={products}
          plans={plans}
          disabled={amountMissing || busy}
          describedBy={amountMissing ? id("edit-reason") : undefined}
        />
        {contract.status === "ativo" ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void changeStatus("suspenso")}
            className="h-11 sm:h-9"
          >
            {pending === "suspenso" ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <PauseIcon data-icon="inline-start" />
            )}
            Suspender
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void changeStatus("ativo")}
            className="h-11 sm:h-9"
          >
            {pending === "ativo" ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            Reativar
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          aria-expanded={closing}
          aria-controls={closing ? id("close") : undefined}
          onClick={() => (closing ? setClosing(false) : openClosing())}
          className="h-11 text-destructive hover:text-destructive sm:ms-auto sm:h-9"
        >
          Encerrar
        </Button>
      </div>

      {amountMissing ? (
        <p id={id("edit-reason")} className="mt-2 text-xs text-muted-foreground">
          Valor indisponível: recarregue a página para editar o contrato.
        </p>
      ) : null}

      {closing ? (
        <div
          id={id("close")}
          role="group"
          aria-labelledby={id("close-title")}
          className="mt-4 grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:p-4"
        >
          <div>
            <p id={id("close-title")} className="text-sm font-medium">
              Encerrar contrato
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Encerrar é definitivo; para voltar a atender, crie um novo contrato.
            </p>
          </div>
          <div className="grid gap-1.5 sm:max-w-56">
            <Label htmlFor={id("close-date")} className="text-xs">
              Data de término
            </Label>
            <Input
              id={id("close-date")}
              type="date"
              min={contract.starts_on}
              value={closeDate}
              disabled={busy}
              onChange={(event) => setCloseDate(event.target.value)}
              aria-invalid={closeError ? true : undefined}
              aria-describedby={closeError ? id("close-error") : undefined}
              className="h-11 bg-background sm:h-9"
            />
            {closeError ? (
              <p id={id("close-error")} role="alert" className="text-xs text-destructive">
                {closeError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setClosing(false)}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void changeStatus("encerrado")}
              className="h-11 sm:h-9"
            >
              {pending === "encerrado" ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              Encerrar contrato
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type ContractHistoryProps =
  | { role: "member"; contracts: ContractView[] }
  | { role: "admin"; contracts: AdminContractView[] };

/** Contratos encerrados, do mais recente ao mais antigo, em linhas compactas. */
export function ContractHistory(props: ContractHistoryProps) {
  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
      {props.role === "admin"
        ? props.contracts.map((contract) => (
            <ContractHistoryRow
              key={contract.id}
              contract={contract}
              amount={
                contract.monthly_amount === null ? (
                  <span className="text-muted-foreground">Valor indisponível</span>
                ) : (
                  <span className="tabular-nums">{formatMoneyExact(contract.monthly_amount)}</span>
                )
              }
            />
          ))
        : props.contracts.map((contract) => (
            <ContractHistoryRow key={contract.id} contract={contract} />
          ))}
    </ul>
  );
}

function ContractHistoryRow({
  contract,
  amount,
}: {
  contract: ContractView;
  /** Só a ficha do admin passa. */
  amount?: ReactNode;
}) {
  return (
    <li className="grid min-w-0 gap-1.5 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium tabular-nums">
          {formatDate(contract.starts_on)} – {contract.ends_on ? formatDate(contract.ends_on) : "sem término"}
        </p>
        {amount ? <p className="text-sm">{amount}</p> : null}
      </div>
      <p className={cn("text-xs", contract.plan ? "text-foreground" : "text-muted-foreground")}>
        {planLabel(contract.plan)}
      </p>
      <ProductChips products={contract.products} />
    </li>
  );
}

function ProductChips({
  products,
  className,
}: {
  products: ProductOption[];
  className?: string;
}) {
  if (products.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Nenhum produto.</p>;
  }
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {products.map((product) => (
        <li
          key={product.id}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-0.5 text-xs"
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", getColorStyle(product.color).dot)}
          />
          <span className="min-w-0 truncate" title={product.name}>
            {product.name}
          </span>
          {product.archived_at ? (
            <span className="shrink-0 text-muted-foreground">(arquivado)</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// Rótulo pequeno com ícone e o valor embaixo — o bloco de fatos da ficha.
// O ícone mora dentro do <dt>: um <div> filho de <dl> só pode ter dt/dd.
function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 break-words ps-5 text-sm">{children}</dd>
    </div>
  );
}
