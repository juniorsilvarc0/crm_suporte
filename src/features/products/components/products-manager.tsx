"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProductOption } from "@/features/products/types";
import { getColorStyle, isColorName, type ColorName } from "@/features/tags/schemas/colors";
import { ticketRequest, type TicketRequestFailure } from "@/features/tickets/lib/ticket-request";
import {
  productPatchSchema,
  type ProductPatchInput,
  type ProductPatchValues,
} from "@/features/tickets/schemas/catalog";
import type { TicketCatalogErrorBody } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

// O padrão de POST /api/products: a fila nasce slate.
const DEFAULT_PRODUCT_COLOR: ColorName = "slate";

// Os campos do formulário: erro da rota num deles vai para o campo; o resto
// vira o alerta do topo (UI.md §5.23).
const FORM_FIELDS = ["name", "niche", "color"] as const;

const ARCHIVE_QUESTION = "Arquivar a fila? Ela some do Novo ticket e continua nos tickets antigos.";
const RESTORE_QUESTION = "Reativar a fila? Ela volta a aparecer no Novo ticket.";

/** Sucesso de POST /api/products e PATCH /api/products/[id]. */
type ProductMutationData = { ok: true; item: ProductOption };

// O corpo de erro das rotas de catálogo (`catalogErrorBody`, e o do POST, no
// mesmo formato sem `code`). O ticketRequest o tipa com os campos do ticket;
// aqui valem os da fila e o item do 409.
function catalogError(result: TicketRequestFailure): TicketCatalogErrorBody<ProductOption> | null {
  return result.body as TicketCatalogErrorBody<ProductOption> | null;
}

// 409 de nome repetido: a rota devolve a fila ATIVA que já tem o nome (o
// índice compara sem caixa, então a grafia dela pode ser outra).
function duplicateMessage(item: ProductOption): string {
  return `Já existe a fila «${item.name}».`;
}

/**
 * Filas de /app/configuracoes/atendimento (4f, admin): criar, renomear, nicho,
 * cor, arquivar e reativar. Cada fila é um software da casa (products).
 *
 * `products` desce do servidor (getServiceSettings) com as arquivadas, ativas
 * primeiro; `null` = a leitura falhou, e a tela diz isso em vez de "nenhuma".
 * Depois de gravar, `router.refresh()`: sem estado espelhado no cliente.
 *
 * Criar e editar usam o mesmo formulário, num `ModalShell`. Arquivar e
 * reativar confirmam na própria linha (UI.md §5.6), como em Categorias; o
 * sentido da confirmação sai de `archived_at`.
 */
export function ProductsManager({ products }: { products: ProductOption[] | null }) {
  const router = useRouter();
  const titleId = useId();
  // O "arquivando" dura até a lista nova chegar: a linha troca de estado junto
  // com o spinner, em vez de voltar habilitada por um instante.
  const [refreshing, startRefresh] = useTransition();
  // A fila do formulário sobrevive ao fechar: a saída animada não troca o
  // título. `session` remonta o formulário a cada abertura, sem o rascunho e o
  // erro da anterior.
  const [formOpen, setFormOpen] = useState(false);
  const [formProduct, setFormProduct] = useState<ProductOption | null>(null);
  const [session, setSession] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // Trava de duplo envio: o `pendingId` só desabilita o botão no próximo render.
  const busy = useRef(false);

  function openForm(product: ProductOption | null) {
    // O erro de uma linha (ex.: reativar com nome repetido) se resolve aqui.
    setRowError(null);
    setFormProduct(product);
    setSession((current) => current + 1);
    setFormOpen(true);
  }

  function askConfirm(product: ProductOption) {
    setRowError(null);
    setConfirmingId(product.id);
  }

  async function setArchived(product: ProductOption, archived: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPendingId(product.id);
    setRowError(null);

    const result = await ticketRequest<ProductMutationData>(`/api/products/${product.id}`, {
      method: "PATCH",
      body: { archived },
    });
    busy.current = false;

    if (result.ok) {
      toast.success(archived ? "Fila arquivada." : "Fila reativada.");
      startRefresh(() => {
        setPendingId(null);
        setConfirmingId(null);
        router.refresh();
      });
      return;
    }

    setPendingId(null);
    setConfirmingId(null);
    setRowError({ id: product.id, message: archiveFailureMessage(result, archived) });
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={titleId} className="text-sm font-semibold">
            Filas
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada software da casa é uma fila. Tickets e contratos apontam para ela.
          </p>
        </div>
        <Button type="button" onClick={() => openForm(null)} className="h-11 sm:h-9">
          <PlusIcon data-icon="inline-start" />
          Nova fila
        </Button>
      </div>

      {products === null ? (
        <EmptyState>
          <div className="grid justify-items-center gap-3">
            <p>Não foi possível carregar as filas.</p>
            <Button
              type="button"
              variant="outline"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
              className="h-11 sm:h-9"
            >
              {refreshing ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <RotateCwIcon data-icon="inline-start" />
              )}
              Tentar de novo
            </Button>
          </div>
        </EmptyState>
      ) : products.length === 0 ? (
        <EmptyState>Nenhuma fila ainda.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              confirming={confirmingId === product.id}
              pending={pendingId === product.id}
              locked={pendingId !== null || refreshing}
              error={rowError?.id === product.id ? rowError.message : null}
              onEdit={() => openForm(product)}
              onAsk={() => askConfirm(product)}
              onCancel={() => setConfirmingId(null)}
              onConfirm={() => void setArchived(product, product.archived_at === null)}
            />
          ))}
        </ul>
      )}

      <ProductForm
        key={session}
        product={formProduct}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </section>
  );
}

function archiveFailureMessage(result: TicketRequestFailure, archived: boolean): string {
  const failure = archived ? "Não foi possível arquivar a fila." : "Não foi possível reativar a fila.";
  if (result.status === 0) return `${failure} Confira a conexão e tente de novo.`;
  const error = catalogError(result);
  // Reativar com o nome que outra fila ativa já usa: a rota devolve essa fila.
  if (result.status === 409 && error?.item) {
    return `Já existe a fila ativa «${error.item.name}». Renomeie uma das duas para reativar esta.`;
  }
  return error?.message ?? failure;
}

function ProductRow({
  product,
  confirming,
  pending,
  locked,
  error,
  onEdit,
  onAsk,
  onCancel,
  onConfirm,
}: {
  product: ProductOption;
  confirming: boolean;
  /** Esta linha está gravando (ou esperando a lista nova). */
  pending: boolean;
  /** Alguma linha está gravando: arquivar e reativar esperam. */
  locked: boolean;
  error: string | null;
  onEdit: () => void;
  /** Abre a confirmação na linha: arquivar a ativa, reativar a arquivada. */
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const questionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const archived = product.archived_at !== null;

  // A confirmação nasce com o foco no "Cancelar" (a saída segura). Ao fechar,
  // o foco volta ao botão da linha só se ele se perdeu junto com a confirmação:
  // pedir a confirmação de outra fila leva o foco para lá.
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (
      wasConfirming.current &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      toggleRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li
      // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: sem trilha declarada, o
      // nome ou o nicho longo alarga a linha além do celular em vez de truncar
      // (UI.md §9).
      className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3", archived && "bg-muted/30")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", getColorStyle(product.color).dot)}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p
                className={cn(
                  "min-w-0 truncate text-sm font-medium",
                  archived && "text-muted-foreground"
                )}
                title={product.name}
              >
                {product.name}
              </p>
              {archived ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Arquivada
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {product.niche ?? "Sem nicho"}
            </p>
          </div>
        </div>

        {confirming ? null : (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onEdit}
              aria-label={`Editar a fila ${product.name}`}
              className="h-11 sm:h-8"
            >
              <PencilIcon data-icon="inline-start" />
              Editar
            </Button>
            <Button
              ref={toggleRef}
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={onAsk}
              aria-label={`${archived ? "Reativar" : "Arquivar"} a fila ${product.name}`}
              className="h-11 sm:h-8"
            >
              {archived ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {archived ? "Reativar" : "Arquivar"}
            </Button>
          </div>
        )}
      </div>

      {confirming ? (
        <div
          role="group"
          aria-labelledby={questionId}
          onKeyDown={(event) => {
            // Esc desfaz a confirmação, como o "Cancelar".
            if (event.key !== "Escape" || pending) return;
            event.preventDefault();
            onCancel();
          }}
          className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p id={questionId} className="min-w-0 text-sm">
            {archived ? RESTORE_QUESTION : ARCHIVE_QUESTION}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onCancel}
              className="h-11 sm:h-8"
            >
              Cancelar
            </Button>
            {/* Reativar não tira nada de lugar nenhum: o confirmar não é destrutivo. */}
            <Button
              type="button"
              variant={archived ? "default" : "destructive"}
              size="sm"
              disabled={locked}
              onClick={onConfirm}
              className="h-11 sm:h-8"
            >
              {pending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : archived ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {archived ? "Reativar" : "Arquivar"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Criar (sem `product`) e editar a fila. react-hook-form + zod com o schema da
 * rota de edição (`productPatchSchema`) nos dois modos: com os três campos
 * presentes, ele é a mesma regra do POST (nome de 2 a 80, nicho vazio = sem
 * nicho, cor da paleta). A edição manda só o que mudou (`dirtyFields`).
 */
function ProductForm({
  product,
  open,
  onOpenChange,
}: {
  product: ProductOption | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, dirtyFields },
  } = useForm<ProductPatchValues, unknown, ProductPatchInput>({
    resolver: zodResolver(productPatchSchema),
    defaultValues: {
      name: product?.name ?? "",
      niche: product?.niche ?? "",
      // Cor fora da paleta (o banco só confere o formato) aparece como a de
      // recurso, como nos selos, e só é gravada se a pessoa escolher outra.
      color: product && isColorName(product.color) ? product.color : DEFAULT_PRODUCT_COLOR,
    },
  });

  function handleOpenChange(next: boolean) {
    // O diálogo não fecha no meio do envio: a resposta ainda vai pintar aqui.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: ProductPatchInput) {
    if (submitting.current) return;

    // Edição manda só o que mudou: ausente não mexe na coluna.
    const body: Record<string, unknown> = product
      ? Object.fromEntries(
          FORM_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]])
        )
      : values;
    if (product && Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    submitting.current = true;
    setPending(true);
    const result = await ticketRequest<ProductMutationData>(
      product ? `/api/products/${product.id}` : "/api/products",
      { method: product ? "PATCH" : "POST", body }
    );
    submitting.current = false;
    setPending(false);

    if (result.ok) {
      toast.success(product ? "Fila atualizada." : "Fila criada.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    const failure = product ? "Não foi possível salvar a fila." : "Não foi possível criar a fila.";
    if (result.status === 0) {
      setError("root.server", {
        type: "network",
        message: `${failure} Confira a conexão e tente de novo.`,
      });
      return;
    }

    const error = catalogError(result);
    let marked = false;
    for (const field of FORM_FIELDS) {
      const message = error?.errors?.[field]?.[0];
      if (!message) continue;
      const duplicate = field === "name" && result.status === 409 && error?.item;
      setError(
        field,
        { type: "server", message: duplicate ? duplicateMessage(duplicate) : message },
        { shouldFocus: !marked }
      );
      marked = true;
    }
    // Erro sem campo (sessão, fila sumida, falha do banco): alerta no topo do
    // formulário, não toast que some.
    if (!marked) {
      setError("root.server", {
        type: String(result.status),
        message: error?.message ?? failure,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="compact"
        title={product ? "Editar fila" : "Nova fila"}
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
              {product ? "Salvar alterações" : "Criar fila"}
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          {errors.root?.server ? (
            <Alert variant="destructive">{errors.root.server.message}</Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor={id("name")}>
              <span>
                Nome<span className="text-primary" aria-hidden> *</span>
              </span>
            </FieldLabel>
            <Input
              id={id("name")}
              autoComplete="off"
              maxLength={80}
              aria-required
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? id("name-error") : undefined}
              className="h-11 sm:h-10"
              {...register("name")}
            />
            <FieldError id={id("name-error")} className="text-xs">
              {errors.name?.message}
            </FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor={id("niche")}>Nicho</FieldLabel>
            <Input
              id={id("niche")}
              autoComplete="off"
              maxLength={80}
              placeholder="Ex.: varejo"
              aria-invalid={errors.niche ? true : undefined}
              aria-describedby={errors.niche ? id("niche-error") : id("niche-hint")}
              className="h-11 sm:h-10"
              {...register("niche")}
            />
            {errors.niche ? (
              <FieldError id={id("niche-error")} className="text-xs">
                {errors.niche.message}
              </FieldError>
            ) : (
              <FieldDescription id={id("niche-hint")} className="text-xs">
                Opcional.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldTitle>Cor</FieldTitle>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <ColorSwatchPicker
                  value={
                    field.value && isColorName(field.value) ? field.value : DEFAULT_PRODUCT_COLOR
                  }
                  onChange={field.onChange}
                />
              )}
            />
            <FieldError className="text-xs">{errors.color?.message}</FieldError>
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
