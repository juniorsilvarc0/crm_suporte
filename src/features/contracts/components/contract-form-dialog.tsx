"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { Loader2Icon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { CatalogCombobox } from "@/components/forms/catalog-combobox";
import type { CatalogOption } from "@/components/forms/catalog-options";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CONTRACT_STATUS_LABEL } from "@/features/contracts/lib/contract-status";
import {
  contractCreateSchema,
  contractUpdateSchema,
} from "@/features/contracts/schemas/contract";
import type { AdminContractView, SupportPlanOption } from "@/features/contracts/types";
import type { ProductOption } from "@/features/products/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { getTodayAppDateKey } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

// Os campos como o formulário os guarda (texto cru dos inputs, ids) e como o
// schema da rota os devolve. A entrada de criação contém a de edição (mais
// customer_id e status), então um formulário serve aos dois schemas: cada modo
// valida com o schema da SUA rota, e o corpo enviado é a saída dele.
type ContractFormValues = z.input<typeof contractCreateSchema>;
type ContractFormOutput =
  | z.output<typeof contractCreateSchema>
  | z.output<typeof contractUpdateSchema>;

const createResolver = zodResolver(contractCreateSchema);
const updateResolver = zodResolver(contractUpdateSchema);

// A edição entrega ao contractUpdateSchema só as chaves do PATCH: ele é
// .strict() e recusaria customer_id e status. `names` fica de fora porque lista
// campos do formulário de criação, que o schema de edição não tem.
const editResolver: Resolver<ContractFormValues, unknown, ContractFormOutput> = (
  values,
  context,
  options
) =>
  updateResolver(
    {
      starts_on: values.starts_on,
      ends_on: values.ends_on,
      monthly_amount: values.monthly_amount,
      billing_day: values.billing_day,
      plan_id: values.plan_id,
      product_ids: values.product_ids,
    },
    context,
    { ...options, names: undefined }
  );

// Campos com lugar na tela, por modo. Erro do servidor fora deles (empresa,
// contrato vigente, falha do banco) vai para o alerta do topo.
const EDIT_FIELDS = [
  "product_ids",
  "plan_id",
  "starts_on",
  "ends_on",
  "monthly_amount",
  "billing_day",
] as const;
const CREATE_FIELDS = [...EDIT_FIELDS, "status"] as const;

const STATUS_OPTIONS = (["ativo", "suspenso"] as const).map((status) => ({
  value: status,
  label: CONTRACT_STATUS_LABEL[status],
}));

// 1..28 existe em todo mês (support_contracts_billing_day_check). Sem padrão:
// o dia é combinado com o cliente, e um valor pré-escolhido passaria batido.
const BILLING_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

/** Respostas de POST /api/contracts e PATCH /api/contracts/[id]. */
type ContractMutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

type ContractFormDialogProps = {
  customerId: string;
  /** Nome de exibição da empresa: contexto no cabeçalho do modal. */
  customerName: string;
  /** Presente = edição do contrato vigente. Ausente = contrato novo. */
  contract?: AdminContractView | null;
  /** Catálogos ATIVOS, do servidor; revalidam com `router.refresh()`. */
  /** `null` = a leitura do catálogo falhou (não é catálogo vazio). */
  products: ProductOption[] | null;
  plans: SupportPlanOption[] | null;
  /** Gatilho travado (ex.: empresa arquivada, valor indisponível). */
  disabled?: boolean;
  /** Id do texto que explica a trava, visível ao lado do botão. */
  describedBy?: string;
};

/**
 * Contrato novo ou edição do vigente — só admin monta este componente.
 *
 * react-hook-form + zodResolver com o schema da rota de cada modo
 * (`contractCreateSchema` no POST, `contractUpdateSchema` no PATCH). O que só o
 * banco sabe (contrato vigente já existe, plano arquivado) volta da rota e vai
 * para o campo com `setError`, ou para o alerta do topo.
 */
export function ContractFormDialog({
  customerId,
  customerName,
  contract = null,
  products,
  plans,
  disabled,
  describedBy,
}: ContractFormDialogProps) {
  const [open, setOpen] = useState(false);
  // Cada abertura é um formulário novo, com os valores de agora (o contrato
  // pode ter mudado por `router.refresh()`): o estado do react-hook-form mora
  // fora do conteúdo que o Dialog desmonta e sobreviveria entre aberturas.
  const [session, setSession] = useState(0);

  return (
    <>
      <Button
        type="button"
        variant={contract ? "outline" : "default"}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => {
          setSession((current) => current + 1);
          setOpen(true);
        }}
        className="h-11 sm:h-9"
      >
        {contract ? <PencilIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
        {contract ? "Editar contrato" : "Novo contrato"}
      </Button>

      <ContractForm
        key={session}
        customerId={customerId}
        customerName={customerName}
        contract={contract}
        products={products}
        plans={plans}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function productToOption(product: ProductOption): CatalogOption {
  return {
    id: product.id,
    name: product.name,
    color: product.color,
    hint: product.niche,
    archived: product.archived_at !== null,
  };
}

function planToOption(plan: Pick<SupportPlanOption, "id" | "name" | "archived_at">): CatalogOption {
  return { id: plan.id, name: plan.name, archived: plan.archived_at !== null };
}

function indexById(options: readonly CatalogOption[]): Map<string, CatalogOption> {
  return new Map(options.map((option) => [option.id, option]));
}

function defaultValues(
  customerId: string,
  contract: AdminContractView | null
): Partial<ContractFormValues> {
  if (!contract) {
    return {
      customer_id: customerId,
      status: "ativo",
      starts_on: getTodayAppDateKey(),
      ends_on: "",
      monthly_amount: "",
      billing_day: "",
      plan_id: null,
      product_ids: [],
    };
  }
  // Edição: sem customer_id e sem status. O contractUpdateSchema é .strict() e
  // recusaria as duas chaves; a situação muda pela rota própria.
  return {
    starts_on: contract.starts_on,
    ends_on: contract.ends_on ?? "",
    monthly_amount: contract.monthly_amount === null ? "" : contract.monthly_amount.toFixed(2),
    billing_day: String(contract.billing_day),
    plan_id: contract.plan?.id ?? null,
    product_ids: contract.products.map((product) => product.id),
  };
}

function ContractForm({
  customerId,
  customerName,
  contract,
  products,
  plans,
  open,
  onOpenChange,
}: {
  customerId: string;
  customerName: string;
  contract: AdminContractView | null;
  /** `null` = a leitura do catálogo falhou (não é catálogo vazio). */
  products: ProductOption[] | null;
  plans: SupportPlanOption[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);

  // Criado agora pelo "Criar «X»": o item só chega nos catálogos depois do
  // `router.refresh()`, e o chip e o campo precisam do nome já.
  const [learnedProducts, setLearnedProducts] = useState<CatalogOption[]>([]);
  const [learnedPlans, setLearnedPlans] = useState<CatalogOption[]>([]);

  const productOptions = useMemo(() => (products ?? []).map(productToOption), [products]);
  const planOptions = useMemo(() => (plans ?? []).map(planToOption), [plans]);

  // O contrato pode cobrir produto ou plano ARQUIVADO: fora do catálogo ativo,
  // mas continua valendo nele (a RPC aceita) e aparece com "(arquivado)".
  const productById = useMemo(
    () =>
      indexById([
        ...(contract?.products.map(productToOption) ?? []),
        ...productOptions,
        ...learnedProducts,
      ]),
    [contract, productOptions, learnedProducts]
  );
  const planById = useMemo(
    () =>
      indexById([
        ...(contract?.plan
          ? [{ id: contract.plan.id, name: contract.plan.name, archived: contract.plan.archived }]
          : []),
        ...planOptions,
        ...learnedPlans,
      ]),
    [contract, planOptions, learnedPlans]
  );

  const {
    control,
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors },
  } = useForm<ContractFormValues, unknown, ContractFormOutput>({
    resolver: contract ? editResolver : createResolver,
    defaultValues: defaultValues(customerId, contract),
  });

  function handleOpenChange(next: boolean) {
    // O modal não fecha no meio do envio: a resposta ainda vai pintar erro
    // aqui. O guard cobre X, Esc e clique fora de uma vez.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: ContractFormOutput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);

    const failure = contract
      ? "Não foi possível salvar o contrato."
      : "Não foi possível criar o contrato.";

    try {
      const response = await fetch(contract ? `/api/contracts/${contract.id}` : "/api/contracts", {
        method: contract ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = (await response.json().catch(() => ({}))) as ContractMutationResponse;

      if (!response.ok || !result.ok) {
        let marked = false;
        for (const field of contract ? EDIT_FIELDS : CREATE_FIELDS) {
          const message = result.errors?.[field]?.[0];
          if (!message) continue;
          setError(field, { type: "server", message }, { shouldFocus: !marked });
          marked = true;
        }
        // Sem campo na tela: contrato vigente já existe (409), empresa
        // arquivada ou sumida, sessão, falha do banco. O alerta fica no topo,
        // dentro do modal, onde a pessoa está olhando.
        if (!marked) {
          setError("root.server", {
            type: String(response.status),
            message: result.errors?.customer_id?.[0] ?? result.message ?? failure,
          });
        }
        return;
      }

      toast.success(result.message ?? (contract ? "Contrato atualizado." : "Contrato criado."));
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("root.server", { type: "network", message: failure });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const required = (
    <span className="text-primary" aria-hidden>
      {" *"}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="medium"
        title={contract ? "Editar contrato" : "Novo contrato"}
        description={customerName}
        // Dentro do handler, não no render: `handleSubmit(onValid)` no render
        // entrega ao React Compiler uma função que lê a trava (ref) de envio.
        onSubmit={(event) => void handleSubmit(onValid)(event)}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {contract ? "Salvar alterações" : "Criar contrato"}
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          {errors.root?.server?.message ? (
            <Alert variant="destructive">{errors.root.server.message}</Alert>
          ) : null}

          <Controller
            control={control}
            name="product_ids"
            render={({ field, fieldState }) => {
              const chosen = field.value.flatMap((productId) => productById.get(productId) ?? []);
              return (
                <Field data-invalid={fieldState.error ? true : undefined}>
                  <FieldLabel htmlFor={id("products")}>
                    <span>Produtos cobertos{required}</span>
                  </FieldLabel>
                  <CatalogCombobox
                    mode="adder"
                    id={id("products")}
                    options={productOptions}
                    chosen={chosen}
                    onAdd={(option) => {
                      // Valor ATUAL do formulário, não o da renderização do
                      // clique: "Criar «X»" termina depois de um fetch, e nesse
                      // meio tempo a pessoa pode ter escolhido outro produto.
                      const current = getValues("product_ids");
                      setLearnedProducts((learned) => [...learned, option]);
                      if (!current.includes(option.id)) field.onChange([...current, option.id]);
                    }}
                    createUrl="/api/products"
                    placeholder="Busque ou crie um produto"
                    emptyText={
                      products === null
                        ? "Não foi possível carregar os produtos. Recarregue a página."
                        : "Nenhum produto cadastrado."
                    }
                    triggerLabel="Abrir lista de produtos"
                    required
                    invalid={Boolean(fieldState.error)}
                    describedBy={fieldState.error ? id("products-error") : undefined}
                  />
                  {chosen.length > 0 ? (
                    <ul aria-label="Produtos escolhidos" className="flex flex-wrap gap-1.5">
                      {chosen.map((option) => (
                        <li
                          key={option.id}
                          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 ps-2.5 text-sm"
                        >
                          <span
                            aria-hidden
                            className={cn("size-2 shrink-0 rounded-full", getColorStyle(option.color).dot)}
                          />
                          <span className="min-w-0 truncate" title={option.name}>
                            {option.name}
                          </span>
                          {option.archived ? (
                            <span className="shrink-0 text-xs text-muted-foreground">(arquivado)</span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Remover ${option.name}`}
                            onClick={() =>
                              field.onChange(field.value.filter((productId) => productId !== option.id))
                            }
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-7"
                          >
                            <XIcon className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <FieldError id={id("products-error")} className="text-xs">
                    {fieldState.error?.message}
                  </FieldError>
                </Field>
              );
            }}
          />

          <Controller
            control={control}
            name="plan_id"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.error ? true : undefined}>
                <FieldLabel htmlFor={id("plan")}>Plano</FieldLabel>
                <CatalogCombobox
                  mode="single"
                  id={id("plan")}
                  options={planOptions}
                  value={field.value ? (planById.get(field.value) ?? null) : null}
                  onChange={(option) => {
                    if (option) setLearnedPlans((current) => [...current, option]);
                    field.onChange(option ? option.id : null);
                  }}
                  createUrl="/api/support-plans"
                  placeholder="Sem plano"
                  emptyText={
                    plans === null
                      ? "Não foi possível carregar os planos. Recarregue a página."
                      : "Nenhum plano cadastrado."
                  }
                  triggerLabel="Abrir lista de planos"
                  invalid={Boolean(fieldState.error)}
                  describedBy={fieldState.error ? id("plan-error") : undefined}
                />
                <FieldError id={id("plan-error")} className="text-xs">
                  {fieldState.error?.message}
                </FieldError>
              </Field>
            )}
          />

          {contract ? null : (
            <Controller
              control={control}
              name="status"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.error ? true : undefined}>
                  <FieldLabel htmlFor={id("status")}>Situação</FieldLabel>
                  <FormSelect
                    id={id("status")}
                    value={field.value ?? "ativo"}
                    onValueChange={field.onChange}
                    options={STATUS_OPTIONS}
                    aria-invalid={fieldState.error ? true : undefined}
                    aria-describedby={fieldState.error ? id("status-error") : undefined}
                  />
                  <FieldError id={id("status-error")} className="text-xs">
                    {fieldState.error?.message}
                  </FieldError>
                </Field>
              )}
            />
          )}

          <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
            <Field data-invalid={errors.starts_on ? true : undefined}>
              <FieldLabel htmlFor={id("starts_on")}>
                <span>Início{required}</span>
              </FieldLabel>
              <Input
                id={id("starts_on")}
                type="date"
                aria-required
                aria-invalid={errors.starts_on ? true : undefined}
                aria-describedby={errors.starts_on ? id("starts_on-error") : undefined}
                className="h-11 sm:h-10"
                {...register("starts_on")}
              />
              <FieldError id={id("starts_on-error")} className="text-xs">
                {errors.starts_on?.message}
              </FieldError>
            </Field>

            <Field data-invalid={errors.ends_on ? true : undefined}>
              <FieldLabel htmlFor={id("ends_on")}>Término</FieldLabel>
              <Input
                id={id("ends_on")}
                type="date"
                aria-invalid={errors.ends_on ? true : undefined}
                aria-describedby={errors.ends_on ? id("ends_on-error") : id("ends_on-hint")}
                className="h-11 sm:h-10"
                {...register("ends_on")}
              />
              {errors.ends_on ? (
                <FieldError id={id("ends_on-error")} className="text-xs">
                  {errors.ends_on.message}
                </FieldError>
              ) : (
                <FieldDescription id={id("ends_on-hint")} className="text-xs">
                  Vazio = prazo indeterminado.
                </FieldDescription>
              )}
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
            <Field data-invalid={errors.monthly_amount ? true : undefined}>
              <FieldLabel htmlFor={id("monthly_amount")}>
                <span>Valor mensal{required}</span>
              </FieldLabel>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                >
                  R$
                </span>
                <Input
                  id={id("monthly_amount")}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  aria-required
                  aria-invalid={errors.monthly_amount ? true : undefined}
                  aria-describedby={
                    errors.monthly_amount ? id("monthly_amount-error") : undefined
                  }
                  className="h-11 ps-10 tabular-nums sm:h-10"
                  {...register("monthly_amount")}
                />
              </div>
              <FieldError id={id("monthly_amount-error")} className="text-xs">
                {errors.monthly_amount?.message}
              </FieldError>
            </Field>

            <Controller
              control={control}
              name="billing_day"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.error ? true : undefined}>
                  <FieldLabel htmlFor={id("billing_day")}>
                    <span>Dia de vencimento{required}</span>
                  </FieldLabel>
                  <FormSelect
                    id={id("billing_day")}
                    value={field.value === undefined ? "" : String(field.value)}
                    onValueChange={field.onChange}
                    options={BILLING_DAY_OPTIONS}
                    emptyLabel="Selecione"
                    aria-invalid={fieldState.error ? true : undefined}
                    aria-describedby={
                      fieldState.error ? id("billing_day-error") : id("billing_day-hint")
                    }
                  />
                  {fieldState.error ? (
                    <FieldError id={id("billing_day-error")} className="text-xs">
                      {fieldState.error.message}
                    </FieldError>
                  ) : (
                    <FieldDescription id={id("billing_day-hint")} className="text-xs">
                      De 1 a 28 — todo mês tem esse dia.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
          </div>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
