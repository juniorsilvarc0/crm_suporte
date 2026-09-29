"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CornerDownRightIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
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
import type { ProductOption } from "@/features/products/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import {
  ticketFieldError,
  ticketRequest,
  type TicketRequestFailure,
} from "@/features/tickets/lib/ticket-request";
import {
  ticketCategoryCreateSchema,
  ticketCategoryPatchSchema,
  type TicketCategoryCreateInput,
  type TicketCategoryCreateValues,
  type TicketCategoryPatchInput,
  type TicketCategoryPatchValues,
} from "@/features/tickets/schemas/catalog";
import type { TicketCatalogErrorBody, TicketCategoryOption } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

const CATEGORIES_URL = "/api/ticket-categories";
const CREATE_FAILURE = "Não foi possível criar a categoria.";
const SAVE_FAILURE = "Não foi possível salvar a categoria.";
const NETWORK_MESSAGE = "Sem resposta do servidor. Confira a conexão e tente de novo.";

// O teto do check de nome (schemas/catalog.ts).
const NAME_MAX_LENGTH = 80;

// Os campos do "Nova categoria": erro da rota num deles vai para o campo; o
// resto vira o alerta do topo (UI.md §5.23).
const CREATE_FIELDS = ["name", "product_id", "parent_id"] as const;

type CategoryItemBody = { ok: true; item: TicketCategoryOption };
type CategoryErrorBody = TicketCatalogErrorBody<TicketCategoryOption>;

// O que está aberto numa linha: o nome em edição ou a confirmação.
type RowMode = "rename" | "archive" | "restore";

// Recusa de uma gravação: `field` = a rota marcou um campo (o nome, ou o
// `archived` de arquivar e reativar).
type SaveFailure = { message: string; field: boolean };

type Lookup = {
  products: ReadonlyMap<string, ProductOption>;
  categories: ReadonlyMap<string, TicketCategoryOption>;
};

// Uma categoria principal e as subcategorias dela (2 níveis: o trigger
// guard_ticket_category recusa a 3ª).
type CategoryNode = { category: TicketCategoryOption; children: TicketCategoryOption[] };

type CategoryGroup = {
  key: string;
  /** `null` com `missing` falso = "Sem fila" (as gerais). */
  product: ProductOption | null;
  /** A fila da categoria não veio na leitura das filas (criada entre as duas leituras). */
  missing: boolean;
  nodes: CategoryNode[];
};

/**
 * O corpo de erro das rotas de catálogo. `ticketRequest` o tipa como o das
 * rotas de ticket; o formato é o mesmo (catalogErrorBody), com os campos do
 * catálogo e o `item` do 409 `duplicate`.
 */
function catalogError(failure: TicketRequestFailure): CategoryErrorBody | null {
  return failure.body as CategoryErrorBody | null;
}

// Onde a categoria mora: "Fila › Mãe › Nome", com "Sem fila" para as gerais.
function categoryPath(category: TicketCategoryOption, lookup: Lookup): string {
  const product = category.product_id
    ? (lookup.products.get(category.product_id)?.name ?? "Fila não encontrada")
    : "Sem fila";
  const parent = category.parent_id ? lookup.categories.get(category.parent_id)?.name : undefined;
  return [product, parent, category.name].filter(Boolean).join(" › ");
}

// 409 `duplicate`: a mensagem da rota com a categoria ativa que já tem o nome
// (o único é por lugar e sem diferenciar maiúsculas: "fiscal" esbarra em "Fiscal").
function withExisting(
  message: string,
  existing: TicketCategoryOption | undefined,
  lookup: Lookup
): string {
  if (!existing) return message;
  return `${message.replace(/\.$/, "")}: ${categoryPath(existing, lookup)}.`;
}

function saveFailure(failure: TicketRequestFailure, lookup: Lookup): SaveFailure {
  if (failure.status === 0) return { message: NETWORK_MESSAGE, field: false };
  const body = catalogError(failure);
  const fieldMessage = ticketFieldError(failure.body);
  const message = fieldMessage ?? body?.message ?? SAVE_FAILURE;
  return {
    message: body?.code === "duplicate" ? withExisting(message, body.item, lookup) : message,
    field: fieldMessage !== undefined,
  };
}

/**
 * Agrupa por fila, com as subcategorias sob a mãe e a ordem da leitura (nome).
 * "Sem fila" primeiro (valem para todas as filas), depois as filas na ordem
 * recebida (ativas antes das arquivadas) e, por último, a fila que não veio na
 * leitura: some da tela nunca, mesmo sem nome.
 */
function groupCategories(
  categories: readonly TicketCategoryOption[],
  products: readonly ProductOption[]
): CategoryGroup[] {
  const ids = new Set(categories.map((category) => category.id));
  const isChild = (category: TicketCategoryOption) =>
    category.parent_id !== null && ids.has(category.parent_id);

  const children = new Map<string, TicketCategoryOption[]>();
  for (const category of categories) {
    if (!isChild(category) || category.parent_id === null) continue;
    children.set(category.parent_id, [...(children.get(category.parent_id) ?? []), category]);
  }

  const roots = new Map<string | null, CategoryNode[]>();
  for (const category of categories) {
    if (isChild(category)) continue;
    const node = { category, children: children.get(category.id) ?? [] };
    roots.set(category.product_id, [...(roots.get(category.product_id) ?? []), node]);
  }

  const groups: CategoryGroup[] = [];
  const general = roots.get(null);
  if (general) groups.push({ key: "sem-fila", product: null, missing: false, nodes: general });
  for (const product of products) {
    const nodes = roots.get(product.id);
    if (nodes) groups.push({ key: product.id, product, missing: false, nodes });
  }
  const known = new Set(products.map((product) => product.id));
  for (const [productId, nodes] of roots) {
    if (productId !== null && !known.has(productId)) {
      groups.push({ key: productId, product: null, missing: true, nodes });
    }
  }
  return groups;
}

// Mães que o "Nova categoria" oferece: principais, ativas e da mesma fila
// (null = as gerais). O trigger recusa as outras.
function motherOptions(
  categories: readonly TicketCategoryOption[],
  productId: string | null
): TicketCategoryOption[] {
  return categories.filter(
    (category) =>
      category.parent_id === null &&
      category.archived_at === null &&
      category.product_id === productId
  );
}

// Por que a arquivada não reativa (o trigger recusaria): a fila ou a mãe estão
// arquivadas. `null` = pode reativar. Fila que não veio na leitura não bloqueia:
// o banco decide.
function restoreBlockedReason(category: TicketCategoryOption, lookup: Lookup): string | null {
  const product = category.product_id ? lookup.products.get(category.product_id) : undefined;
  if (product?.archived_at) return "Fila arquivada: reative a fila antes.";
  const parent = category.parent_id ? lookup.categories.get(category.parent_id) : undefined;
  if (parent?.archived_at) return `Mãe arquivada: reative “${parent.name}” antes.`;
  return null;
}

/**
 * Categorias de ticket (4f, admin): agrupadas por fila ("Sem fila" para as
 * gerais), em 2 níveis, com as arquivadas marcadas. Criar (POST
 * /api/ticket-categories), renomear, arquivar e reativar (PATCH
 * /api/ticket-categories/[id]); arquivar e reativar confirmam na própria linha
 * (UI.md §5.6). A fila e a mãe não mudam depois de criada.
 *
 * O banco decide as regras (trigger guard_ticket_category) e a recusa volta no
 * campo: mãe com subcategoria ativa não arquiva, nome repetido cita a que já
 * existe. Onde a tela já sabe a resposta (fila ou mãe arquivada), ela explica
 * em vez de oferecer "Reativar".
 *
 * `categories` ou `products` nulos = a leitura falhou: sem as filas não dá para
 * agrupar nem saber quais estão arquivadas, então a tela diz que falhou e
 * oferece "Tentar de novo", nunca uma lista vazia.
 */
export function TicketCategoriesManager({
  categories,
  products,
}: {
  categories: TicketCategoryOption[] | null;
  products: ProductOption[] | null;
}) {
  const router = useRouter();
  const titleId = useId();
  const [refreshing, startRefresh] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  // Cada abertura é um formulário novo: a `key` descarta o rascunho anterior.
  const [createSession, setCreateSession] = useState(0);
  const [openRow, setOpenRow] = useState<{ id: string; mode: RowMode } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // Uma gravação por vez. O `busyId` só desabilita no próximo render; a trava é o ref.
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);

  const lookup = useMemo<Lookup>(
    () => ({
      products: new Map((products ?? []).map((product) => [product.id, product])),
      categories: new Map((categories ?? []).map((category) => [category.id, category])),
    }),
    [products, categories]
  );
  const groups = useMemo(
    () => (categories && products ? groupCategories(categories, products) : []),
    [categories, products]
  );

  function refresh() {
    startRefresh(() => router.refresh());
  }

  function openCreate() {
    setCreateSession((current) => current + 1);
    setCreateOpen(true);
  }

  function handleCreated() {
    toast.success("Categoria criada.");
    setCreateOpen(false);
    refresh();
  }

  function openMode(category: TicketCategoryOption, mode: RowMode) {
    if (busy.current) return;
    setRowError(null);
    setOpenRow({ id: category.id, mode });
  }

  function closeRow() {
    if (!busy.current) setOpenRow(null);
  }

  /** PATCH da categoria. `null` = gravou (ou saiu da base: toast e releitura). */
  async function save(
    category: TicketCategoryOption,
    body: TicketCategoryPatchInput,
    success: string
  ): Promise<SaveFailure | null> {
    if (busy.current) return null;
    busy.current = true;
    setBusyId(category.id);
    setRowError(null);

    const result = await ticketRequest<CategoryItemBody>(`${CATEGORIES_URL}/${category.id}`, {
      method: "PATCH",
      body,
    });

    busy.current = false;
    setBusyId(null);

    if (result.ok) {
      toast.success(success);
      setOpenRow(null);
      refresh();
      return null;
    }
    if (result.status === 404) {
      toast.error(result.body?.message ?? "Categoria não encontrada.");
      setOpenRow(null);
      refresh();
      return null;
    }
    return saveFailure(result, lookup);
  }

  async function confirm(category: TicketCategoryOption, mode: "archive" | "restore") {
    const failure = await save(
      category,
      { archived: mode === "archive" },
      mode === "archive" ? "Categoria arquivada." : "Categoria reativada."
    );
    if (!failure) return;
    setOpenRow(null);
    setRowError({ id: category.id, message: failure.message });
  }

  function renderRow(category: TicketCategoryOption, child: boolean) {
    const mode = openRow?.id === category.id ? openRow.mode : null;
    return (
      <CategoryRow
        category={category}
        child={child}
        mode={mode}
        error={rowError?.id === category.id ? rowError.message : null}
        pending={busyId === category.id}
        // A releitura não trava as ações: gravar de novo o que já foi gravado
        // não muda nada na rota, e o botão desabilitado perderia o foco.
        disabled={busyId !== null}
        restoreBlocked={
          category.archived_at === null ? null : restoreBlockedReason(category, lookup)
        }
        onOpen={(next) => openMode(category, next)}
        onCancel={closeRow}
        onConfirm={() => {
          if (mode === "archive" || mode === "restore") void confirm(category, mode);
        }}
        onSaveName={(name) => save(category, { name }, "Categoria renomeada.")}
      />
    );
  }

  const failure =
    categories === null
      ? "Não foi possível carregar as categorias."
      : products === null
        ? "Não foi possível carregar as filas das categorias."
        : null;

  let content: ReactNode;
  if (failure) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>{failure}</span>
          <Button
            type="button"
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
            className="h-11 sm:h-9"
          >
            <RotateCwIcon data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
            Tentar de novo
          </Button>
        </span>
      </EmptyState>
    );
  } else if (groups.length === 0) {
    content = <EmptyState>Nenhuma categoria ainda.</EmptyState>;
  } else {
    content = (
      <div className="grid gap-5" aria-busy={refreshing || undefined}>
        {groups.map((group) => (
          <CategoryGroupSection key={group.key} group={group} renderRow={renderRow} />
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={titleId} className="text-sm font-semibold">
            Categorias
          </h2>
          <p className="text-sm text-muted-foreground">
            Classificam os tickets de cada fila, em até dois níveis.
          </p>
        </div>
        {failure ? null : (
          <Button type="button" onClick={openCreate} className="h-11 sm:h-9">
            <PlusIcon data-icon="inline-start" />
            Nova categoria
          </Button>
        )}
      </div>

      {content}

      {categories && products ? (
        <CreateCategoryDialog
          key={createSession}
          open={createOpen}
          onOpenChange={setCreateOpen}
          categories={categories}
          products={products}
          lookup={lookup}
          onCreated={handleCreated}
        />
      ) : null}
    </section>
  );
}

function CategoryGroupSection({
  group,
  renderRow,
}: {
  group: CategoryGroup;
  renderRow: (category: TicketCategoryOption, child: boolean) => ReactNode;
}) {
  const headingId = useId();
  const label = group.product?.name ?? (group.missing ? "Fila não encontrada" : "Sem fila");
  const general = group.product === null && !group.missing;

  return (
    // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: sem trilha declarada, o
    // nome longo da fila alarga a página no celular em vez de truncar (UI.md §9).
    <section aria-labelledby={headingId} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {group.product ? (
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-full", getColorStyle(group.product.color).dot)}
          />
        ) : null}
        <h3 id={headingId} title={label} className="min-w-0 truncate text-sm font-medium">
          {label}
        </h3>
        {group.product?.archived_at ? (
          <Badge variant="outline" className="text-muted-foreground">
            Arquivada
          </Badge>
        ) : null}
        {general ? (
          <span className="text-xs text-muted-foreground">Aparecem em todas as filas.</span>
        ) : null}
      </div>

      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        {group.nodes.map((node) => (
          <li key={node.category.id}>
            {renderRow(node.category, false)}
            {node.children.length > 0 ? (
              <ul
                aria-label={`Subcategorias de ${node.category.name}`}
                className="divide-y divide-border/70 border-t border-border/70"
              >
                {node.children.map((childCategory) => (
                  <li key={childCategory.id}>{renderRow(childCategory, true)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Uma categoria: nome, selo "Arquivada" e as ações. Renomear troca o nome por
 * um campo; arquivar e reativar abrem a confirmação na própria linha, com o
 * foco na saída segura ("Cancelar") e Esc desistindo.
 */
function CategoryRow({
  category,
  child,
  mode,
  error,
  pending,
  disabled,
  restoreBlocked,
  onOpen,
  onCancel,
  onConfirm,
  onSaveName,
}: {
  category: TicketCategoryOption;
  child: boolean;
  mode: RowMode | null;
  error: string | null;
  /** A gravação desta linha está em voo. */
  pending: boolean;
  /** Alguma gravação em voo: as ações esperam. */
  disabled: boolean;
  restoreBlocked: string | null;
  onOpen: (mode: RowMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSaveName: (name: string) => Promise<SaveFailure | null>;
}) {
  const errorId = useId();
  const archived = category.archived_at !== null;
  const confirming = mode === "archive" || mode === "restore";
  const cancelRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previousMode = useRef<RowMode | null>(null);

  // O campo e a confirmação somem com os botões da linha: abrir leva o foco a
  // "Cancelar" e fechar o devolve ao botão que abriu, senão ele cairia no body.
  // Só devolve se ninguém pegou o foco (a outra linha que acabou de abrir).
  useEffect(() => {
    const previous = previousMode.current;
    previousMode.current = mode;
    if (mode === "archive" || mode === "restore") {
      cancelRef.current?.focus({ preventScroll: true });
    } else if (mode === null && previous !== null) {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      (previous === "rename" ? renameRef : toggleRef).current?.focus({ preventScroll: true });
    }
  }, [mode]);

  function onConfirmKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  const actionClass = "h-11 sm:h-8";

  return (
    <div className={cn("py-2.5 pe-4", child ? "ps-6" : "ps-4")}>
      {mode === "rename" ? (
        <RenameCategoryForm
          category={category}
          pending={pending}
          disabled={disabled}
          onSave={onSaveName}
          onCancel={onCancel}
        />
      ) : (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {child ? (
              <CornerDownRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
            <span
              title={category.name}
              className={cn(
                "min-w-0 truncate text-sm",
                archived ? "text-muted-foreground" : "font-medium"
              )}
            >
              {category.name}
            </span>
            {archived ? (
              <Badge variant="outline" className="text-muted-foreground">
                Arquivada
              </Badge>
            ) : null}
          </div>

          {confirming ? null : (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-describedby={error ? errorId : undefined}
                ref={renameRef}
                aria-label={`Renomear ${category.name}`}
                onClick={() => onOpen("rename")}
                className={actionClass}
              >
                <PencilIcon data-icon="inline-start" />
                Renomear
              </Button>
              {!archived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={error ? errorId : undefined}
                  ref={toggleRef}
                  aria-label={`Arquivar ${category.name}`}
                  onClick={() => onOpen("archive")}
                  className={actionClass}
                >
                  <ArchiveIcon data-icon="inline-start" />
                  Arquivar
                </Button>
              ) : restoreBlocked ? (
                <span className="px-2 text-xs text-muted-foreground">{restoreBlocked}</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={error ? errorId : undefined}
                  ref={toggleRef}
                  aria-label={`Reativar ${category.name}`}
                  onClick={() => onOpen("restore")}
                  className={actionClass}
                >
                  <ArchiveRestoreIcon data-icon="inline-start" />
                  Reativar
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {confirming ? (
        <div
          role="group"
          aria-label={mode === "archive" ? `Arquivar ${category.name}` : `Reativar ${category.name}`}
          onKeyDown={onConfirmKeyDown}
          className="mt-2 flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 text-sm">
            <p className="break-words font-medium">
              {mode === "archive" ? "Arquivar" : "Reativar"} “{category.name}”?
            </p>
            <p className="text-xs text-muted-foreground">
              {mode === "archive"
                ? "Deixa de ser oferecida nos tickets e continua nos que já a usam."
                : "Volta a ser oferecida nos tickets."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onCancel}
              className={cn("flex-1 sm:flex-none", actionClass)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={mode === "archive" ? "destructive" : "default"}
              size="sm"
              disabled={disabled}
              onClick={onConfirm}
              className={cn("flex-1 sm:flex-none", actionClass)}
            >
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {mode === "archive" ? "Arquivar" : "Reativar"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renomear na linha: react-hook-form com o MESMO schema do PATCH (UI.md
 * §5.23). O mesmo nome nem sai; Enter salva, Esc desiste. Erro da rota no nome
 * (repetido, fora do check) vai para o campo; o resto, para o alerta abaixo.
 */
function RenameCategoryForm({
  category,
  pending,
  disabled,
  onSave,
  onCancel,
}: {
  category: TicketCategoryOption;
  pending: boolean;
  disabled: boolean;
  onSave: (name: string) => Promise<SaveFailure | null>;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TicketCategoryPatchValues, unknown, TicketCategoryPatchInput>({
    resolver: zodResolver(ticketCategoryPatchSchema),
    defaultValues: { name: category.name },
  });

  async function onValid(values: TicketCategoryPatchInput) {
    if (values.name === undefined || values.name === category.name) {
      onCancel();
      return;
    }
    setFormError(null);
    const failure = await onSave(values.name);
    if (!failure) return;
    if (failure.field) setError("name", { type: "server", message: failure.message }, { shouldFocus: true });
    else setFormError(failure.message);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      noValidate
      aria-busy={pending}
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
    >
      <Field className="min-w-0 flex-1 gap-1.5">
        <FieldLabel htmlFor={id("name")} className="sr-only">
          Novo nome de {category.name}
        </FieldLabel>
        <Input
          id={id("name")}
          autoFocus
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          // `readOnly`, não `disabled`: o campo desabilitado perde o foco, e o
          // `setError(..., { shouldFocus })` da resposta não o traria de volta
          // (UI.md §5.7.17). A trava de duplo envio é o ref do `save`.
          readOnly={pending}
          onKeyDown={onKeyDown}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? id("name-error") : formError ? id("form-error") : undefined}
          className="h-11 sm:h-9"
          {...register("name")}
        />
        <FieldError id={id("name-error")} className="text-xs">
          {errors.name?.message}
        </FieldError>
        {formError ? (
          <p id={id("form-error")} role="alert" className="text-xs text-destructive">
            {formError}
          </p>
        ) : null}
      </Field>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
          className="h-11 flex-1 sm:h-9 sm:flex-none"
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={disabled} className="h-11 flex-1 sm:h-9 sm:flex-none">
          {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Salvar nome
        </Button>
      </div>
    </form>
  );
}

/**
 * "Nova categoria": nome, fila (só as ativas; vazio = geral) e mãe (só as
 * principais ativas da MESMA fila). A subcategoria vai com o product_id da mãe,
 * que é o que o trigger exige; trocar a fila tira a mãe que não é dela.
 */
function CreateCategoryDialog({
  open,
  onOpenChange,
  categories,
  products,
  lookup,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly TicketCategoryOption[];
  products: readonly ProductOption[];
  lookup: Lookup;
  onCreated: () => void;
}) {
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<TicketCategoryCreateValues, unknown, TicketCategoryCreateInput>({
    resolver: zodResolver(ticketCategoryCreateSchema),
    defaultValues: { name: "", product_id: "", parent_id: "" },
  });

  const productId = useWatch({ control, name: "product_id" }) || null;
  const productOptions = products
    .filter((product) => product.archived_at === null)
    .map((product) => ({ value: product.id, label: product.name }));
  const parentOptions = motherOptions(categories, productId).map((category) => ({
    value: category.id,
    label: category.name,
  }));

  function handleOpenChange(next: boolean) {
    // Não fecha no meio do envio: a resposta ainda vai pintar erro aqui.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  // Mãe de outra fila seria CATEGORY_PRODUCT_MISMATCH no banco.
  function changeProduct(value: string, onChange: (value: string) => void) {
    onChange(value);
    const parentId = getValues("parent_id");
    const parent = parentId ? lookup.categories.get(parentId) : undefined;
    if (parent && parent.product_id !== (value || null)) setValue("parent_id", "");
  }

  async function onValid(values: TicketCategoryCreateInput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFormError(null);

    const result = await ticketRequest<CategoryItemBody>(CATEGORIES_URL, {
      method: "POST",
      body: values,
    });

    submitting.current = false;
    setPending(false);

    if (result.ok) {
      onCreated();
      return;
    }
    if (result.status === 0) {
      setFormError(NETWORK_MESSAGE);
      return;
    }

    const errorBody = catalogError(result);
    let marked = false;
    for (const field of CREATE_FIELDS) {
      const message = errorBody?.errors?.[field]?.[0];
      if (!message) continue;
      setError(
        field,
        {
          type: "server",
          message:
            field === "name" && errorBody?.code === "duplicate"
              ? withExisting(message, errorBody.item, lookup)
              : message,
        },
        { shouldFocus: !marked }
      );
      marked = true;
    }
    // Erro sem campo (falha do banco, sessão) vira alerta no topo, não toast
    // que some (UI.md §5.23).
    if (!marked) setFormError(errorBody?.message ?? CREATE_FAILURE);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="compact"
        title="Nova categoria"
        description="Sem fila, a categoria aparece em todas as filas."
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
              Criar categoria
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          {formError ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
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
              maxLength={NAME_MAX_LENGTH}
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

          <Controller
            control={control}
            name="product_id"
            render={({ field, fieldState }) => (
              <Field>
                <FieldLabel htmlFor={id("product")}>Fila</FieldLabel>
                <FormSelect
                  id={id("product")}
                  aria-label="Fila"
                  value={field.value ?? ""}
                  emptyLabel="Sem fila"
                  onValueChange={(value) => changeProduct(value, field.onChange)}
                  options={productOptions}
                  disabled={pending}
                  aria-invalid={fieldState.error ? true : undefined}
                  aria-describedby={fieldState.error ? id("product-error") : undefined}
                />
                <FieldError id={id("product-error")} className="text-xs">
                  {fieldState.error?.message}
                </FieldError>
              </Field>
            )}
          />

          <Controller
            control={control}
            name="parent_id"
            render={({ field, fieldState }) => (
              <Field>
                <FieldLabel htmlFor={id("parent")}>Categoria mãe</FieldLabel>
                <FormSelect
                  id={id("parent")}
                  aria-label="Categoria mãe"
                  value={field.value ?? ""}
                  emptyLabel="Nenhuma (categoria principal)"
                  onValueChange={field.onChange}
                  options={parentOptions}
                  disabled={pending}
                  aria-invalid={fieldState.error ? true : undefined}
                  aria-describedby={
                    fieldState.error ? id("parent-error") : id("parent-hint")
                  }
                />
                {fieldState.error ? (
                  <FieldError id={id("parent-error")} className="text-xs">
                    {fieldState.error.message}
                  </FieldError>
                ) : (
                  <FieldDescription id={id("parent-hint")} className="text-xs">
                    Opcional. Só as categorias principais ativas desta fila.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
