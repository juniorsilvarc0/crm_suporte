"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { ProcedureCombobox } from "@/features/financeiro/components/procedure-combobox";
import { fromCents, netAmountCents, toCents } from "@/features/financeiro/lib/money";
import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import {
  PAYMENT_METHODS,
  saleEditSchema,
  saleSchema,
} from "@/features/financeiro/schemas/sale";
import { paymentMethodLabel } from "@/features/financeiro/schemas/labels";
import type { LeadSale } from "@/features/financeiro/types";
import type { Deal } from "@/features/deals/types";
import type { Lead } from "@/features/leads/types";
import { formatMoneyExact } from "@/lib/formatters/money";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type FormValues = {
  procedureName: string;
  totalAmount: string;
  discount: string;
  method: string;
  notes: string;
};

const methodOptions = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: paymentMethodLabel[method],
}));

function emptyValues(): FormValues {
  return {
    procedureName: "",
    totalAmount: "",
    discount: "",
    method: "pix",
    notes: "",
  };
}

function valuesFromSale(sale: LeadSale): FormValues {
  return {
    procedureName: sale.procedureName ?? "",
    totalAmount: String(sale.totalAmount),
    discount: sale.discount ? String(sale.discount) : "",
    method: sale.method ?? "pix",
    notes: sale.notes ?? "",
  };
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * O que a venda precisa saber do lead: para quem gravar e como identificá-lo na
 * tela. Estreito de propósito — assim quem tem só um recorte do lead (a agenda,
 * por exemplo) passa direto, sem cast.
 */
export type SaleLead = Pick<Lead, "id" | "name" | "phone">;

export function SaleDialog({
  deal = null,
  lead: leadProp = null,
  sale = null,
  procedures,
  open = true,
  onOpenChange,
  variant = "dialog",
}: {
  deal?: Deal | null;
  /**
   * Para quem só tem o lead na mão — a lista de leads não carrega `deals`, e a
   * agenda carrega só um recorte dele. O card de destino é resolvido no
   * servidor (POST /api/financeiro/sales), senão registrar pela lista deixaria
   * o funil parado e só o funil moveria.
   */
  lead?: SaleLead | null;
  /** Presente = modo edição. A venda já existe e o funil não é tocado. */
  sale?: LeadSale | null;
  procedures: Procedure[];
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `panel` rende só o formulário, para quem já está dentro de um modal.
   * Empilhar Dialog sobre Dialog dá dois backdrops, dois focus traps e dois
   * donos do Esc — ver UI.md §Anti-padrões.
   */
  variant?: "dialog" | "panel";
}) {
  const editing = sale !== null;
  const router = useRouter();
  const fieldId = useId();
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  // `pending` é estado: entre o clique e o re-render dá tempo de disparar um
  // segundo submit. O ref trava na hora — era assim que o diálogo antigo criava
  // duas vendas com um duplo-clique.
  const submitting = useRef(false);
  const idempotencyKey = useRef<string>("");
  // O total só é pré-preenchido enquanto o operador não digitou nada. Sobrescrever
  // um valor digitado é como se erra o número.
  const totalDirty = useRef(false);

  // Reset ao ABRIR, não ao fechar: mexer nos campos durante a animação de saída
  // deixava o valor mudando na cara do usuário. O estado vai no ajuste durante
  // o render (padrão do repo); os refs vão num efeito, porque tocar ref durante
  // o render é proibido — e, como ref não entra na renderização, não pisca.
  const [syncedOpen, setSyncedOpen] = useState(open);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) {
      setValues(sale ? valuesFromSale(sale) : emptyValues());
      setErrors({});
      setPending(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    submitting.current = false;
    // Em edição o valor já veio preenchido: escolher outro procedimento não
    // pode sobrescrever o número que está gravado.
    totalDirty.current = editing;
    // Uma chave por abertura: retry e clique repetido caem na mesma venda.
    idempotencyKey.current = crypto.randomUUID();
  }, [open, editing]);

  const lead = deal?.lead ?? leadProp;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const totalCents = toCents(toNumber(values.totalAmount));
  const discountCents = toCents(toNumber(values.discount));
  const netCents = netAmountCents(totalCents, discountCents);

  function payload() {
    return {
      ...(editing
        ? {}
        : {
            idempotency_key: idempotencyKey.current,
            lead_id: lead?.id ?? "",
            deal_id: deal?.id ?? null,
            move_to_won: true,
          }),
      procedure_name: values.procedureName,
      total_amount: toNumber(values.totalAmount),
      discount: toNumber(values.discount),
      method: values.method,
      notes: values.notes.trim() || undefined,
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    if (!editing && !lead) {
      toast.error("Este card não tem cliente vinculado.");
      return;
    }

    // Mesmo schema da rota: um safeParse só, com todos os erros de uma vez.
    const schema = editing ? saleEditSchema : saleSchema;
    const parsed = schema.safeParse(payload());
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }

    submitting.current = true;
    setPending(true);
    setErrors({});

    try {
      const response = await fetch(
        editing ? `/api/financeiro/sales/${sale.id}` : "/api/financeiro/sales",
        {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        errors?: Record<string, string[]>;
        moved?: boolean;
        alreadyRegistered?: boolean;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(
          result.message ??
            (editing ? "Não foi possível salvar a venda." : "Não foi possível registrar a venda.")
        );
        return;
      }

      if (editing) {
        toast.success("Venda atualizada.");
      } else if (result.alreadyRegistered) {
        toast.success("Esta venda já estava registrada.");
      } else if (result.moved) {
        toast.success("Venda registrada. O card foi para a etapa de ganho.");
      } else {
        toast.success(
          "Venda registrada. Nenhuma etapa de ganho configurada no funil — o card não foi movido."
        );
      }

      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(
        editing ? "Não foi possível salvar a venda." : "Não foi possível registrar a venda."
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // O lead é o mínimo para registrar; o card é opcional e pode vir do servidor.
  if (!editing && !lead) return null;

  const body = (
        <div className="grid gap-5" aria-busy={pending}>
          <Field
            id={`${fieldId}-procedure`}
            label="Procedimento"
            required
            error={errors.procedure_name?.[0]}
          >
            <ProcedureCombobox
              id={`${fieldId}-procedure`}
              value={values.procedureName}
              procedures={procedures}
              invalid={Boolean(errors.procedure_name)}
              describedBy={errors.procedure_name ? `${fieldId}-procedure-error` : undefined}
              disabled={pending}
              onChange={(name, defaultAmount) => {
                set("procedureName", name);
                if (defaultAmount !== null && !totalDirty.current) {
                  set("totalAmount", String(defaultAmount));
                }
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${fieldId}-total`}
              label="Valor"
              required
              error={errors.total_amount?.[0]}
            >
              <MoneyInput
                id={`${fieldId}-total`}
                value={values.totalAmount}
                invalid={Boolean(errors.total_amount)}
                describedBy={errors.total_amount ? `${fieldId}-total-error` : undefined}
                disabled={pending}
                onChange={(next) => {
                  totalDirty.current = next.trim() !== "";
                  set("totalAmount", next);
                }}
              />
            </Field>

            <Field id={`${fieldId}-discount`} label="Desconto" error={errors.discount?.[0]}>
              <MoneyInput
                id={`${fieldId}-discount`}
                value={values.discount}
                invalid={Boolean(errors.discount)}
                describedBy={errors.discount ? `${fieldId}-discount-error` : undefined}
                disabled={pending}
                onChange={(next) => set("discount", next)}
              />
            </Field>
          </div>

          <Field id={`${fieldId}-method`} label="Forma de pagamento" required error={errors.method?.[0]}>
            <FormSelect
              id={`${fieldId}-method`}
              value={values.method}
              disabled={pending}
              aria-label="Forma de pagamento"
              onValueChange={(next) => set("method", next)}
              options={methodOptions}
            />
          </Field>

          <Field id={`${fieldId}-notes`} label="Observações" error={errors.notes?.[0]}>
            <Textarea
              id={`${fieldId}-notes`}
              value={values.notes}
              disabled={pending}
              maxLength={500}
              placeholder="Combinado com o paciente, condição especial, o que mais precisar."
              className="min-h-20 resize-y"
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>

          {/* Resumo: o operador confirma o número antes de gravar dinheiro. */}
          {/* Resumo: o operador confirma o número antes de gravar dinheiro. */}
          <dl className="grid gap-1.5 rounded-lg border border-border/70 bg-card p-3 text-sm sm:p-4">
            <SummaryRow label="Valor" value={formatMoneyExact(fromCents(totalCents))} />
            {discountCents > 0 ? (
              <SummaryRow
                label="Desconto"
                value={`− ${formatMoneyExact(fromCents(discountCents))}`}
              />
            ) : null}
            <SummaryRow
              label="Recebido"
              value={formatMoneyExact(fromCents(netCents))}
              strong
            />
          </dl>
        </div>
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={pending}
        className="h-11 sm:h-9"
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        disabled={pending || (!editing && !lead)}
        className="h-11 sm:h-9"
      >
        {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
        {editing ? "Salvar alterações" : "Registrar venda"}
      </Button>
    </>
  );

  // Painel: o formulário toma o lugar do conteúdo de quem chama, sem Dialog
  // próprio. Empilhar modal sobre modal cria dois backdrops, dois focus traps e
  // dois donos do Esc — e o modal do lead já ocupa 95dvh.
  if (variant === "panel") {
    return (
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Editar venda</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Alterar o valor refaz o pagamento desta venda.
          </p>
        </div>
        {body}
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          {actions}
        </div>
      </form>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Fechar no meio do envio deixava o fetch voando e o estado sendo
        // resetado por baixo. Um guard aqui cobre X, Esc e clique fora.
        if (!next && submitting.current) return;
        onOpenChange(next);
      }}
    >
      <ModalShell
        size="medium"
        title={editing ? "Editar venda" : "Registrar venda"}
        description={
          lead
            ? `${lead.name ?? "Sem nome"} · ${formatPhone(lead.phone)}`
            : "Este card não tem cliente vinculado."
        }
        onSubmit={handleSubmit}
        footer={<ModalFooterActions>{actions}</ModalFooterActions>}
      >
        {body}
      </ModalShell>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold" : "text-muted-foreground")}>
        {value}
      </dd>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="justify-between gap-3 text-xs">
        <span>
          {label}
          {required ? (
            <>
              <span aria-hidden className="text-primary">
                {" *"}
              </span>
              <span className="sr-only"> (obrigatório)</span>
            </>
          ) : null}
        </span>
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        placeholder="0,00"
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 ps-10 sm:h-10"
      />
    </div>
  );
}
