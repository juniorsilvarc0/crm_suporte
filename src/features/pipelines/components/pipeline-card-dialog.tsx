"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleSlashIcon,
  HeartPulseIcon,
  Loader2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { toAppDateKey } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type PipelineCardRow = Database["public"]["Tables"]["pipeline_cards"]["Row"];

/**
 * O diálogo consome só o que preenche o formulário. Declarar esse subconjunto —
 * em vez de exigir o tipo completo da feature — mantém qualquer `PipelineCard`
 * atribuível (com ou sem os vínculos já resolvidos pela consulta) sem acoplar
 * este arquivo à forma exata da query que o listou.
 */
export type PipelineCard = Pick<
  PipelineCardRow,
  | "id"
  | "stage"
  | "title"
  | "description"
  | "lead_id"
  | "patient_id"
  | "amount"
  | "due_at"
> & {
  /** Nome já resolvido pela consulta, quando houver — evita o rótulo genérico. */
  lead?: { name: string | null } | null;
  patient?: { full_name: string | null } | null;
};

type PipelineCardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  /** Colunas do funil. `color` é opcional e só pinta o ponto da etapa. */
  stages: ReadonlyArray<{ key: string; label: string; color?: string | null }>;
  /** Etapa em que o card nasce — a coluna que abriu o diálogo. */
  stage?: string;
  /** Presente = edição. Ausente = card novo. */
  card?: PipelineCard | null;
  onSaved?: () => void;
};

/** Resposta das rotas de card. `ok: false` é o único sinal de falha no corpo. */
type PipelineCardMutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
};

type LeadOption = { id: string; name: string | null; phone: string | null };

/**
 * Vínculo do card com uma pessoa. `none` é o padrão: card de processo interno
 * (comprar equipamento, revisar contrato) não tem lead nem paciente.
 */
type PersonLink =
  | { kind: "none" }
  | { kind: "lead"; id: string; name: string }
  | { kind: "patient"; id: string; name: string };

function initialPersonLink(card?: PipelineCard | null): PersonLink {
  if (card?.lead_id) {
    return {
      kind: "lead",
      id: card.lead_id,
      name: card.lead?.name?.trim() || "Lead vinculado",
    };
  }
  if (card?.patient_id) {
    return {
      kind: "patient",
      id: card.patient_id,
      name: card.patient?.full_name?.trim() || "Paciente vinculado",
    };
  }
  return { kind: "none" };
}

/** O paciente que o card já trazia, quando trazia. */
function initialPatientLink(card?: PipelineCard | null) {
  const link = initialPersonLink(card);
  return link.kind === "patient" ? { id: link.id, name: link.name } : null;
}

/**
 * Criação e edição de card de funil personalizado.
 *
 * O card só exige título e etapa. Valor, prazo, descrição e **pessoa** são
 * opcionais de propósito: o mesmo quadro serve para acompanhar um paciente e
 * para tocar um processo interno que não é de ninguém.
 *
 * A validação real é do servidor (`/api/pipeline-cards`), inclusive a de etapa
 * — o gatilho do banco recusa `stage` que não exista neste funil. A mensagem
 * volta pintada por campo.
 */
export function PipelineCardDialog({
  open,
  onOpenChange,
  pipelineId,
  stages,
  stage,
  card,
  onSaved,
}: PipelineCardDialogProps) {
  const router = useRouter();
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [person, setPerson] = useState<PersonLink>(() => initialPersonLink(card));
  const submitting = useRef(false);

  // Abrir o diálogo (ou trocar de card com ele aberto) precisa zerar erro,
  // confirmação de arquivamento e vínculo — o corpo desmonta junto com o
  // diálogo, mas este componente permanece montado. Ajuste durante o render,
  // mesmo padrão do cadastro de paciente.
  const instance = `${card?.id ?? "new"}:${open ? "aberto" : "fechado"}`;
  const [lastInstance, setLastInstance] = useState(instance);
  if (instance !== lastInstance) {
    setLastInstance(instance);
    setErrors({});
    setConfirmingArchive(false);
    setPerson(initialPersonLink(card));
  }

  const isEdit = Boolean(card);
  const id = (field: string) => `${fieldId}-${field}`;
  const errorId = (field: string) => (errors[field] ? `${id(field)}-error` : undefined);

  const currentStage = card?.stage ?? stage ?? stages[0]?.key ?? "";
  // Etapa órfã (coluna removida depois que o card entrou nela) não pode sumir
  // do select: sem a opção, salvar mandaria a etapa vazia e o card mudaria de
  // lugar sozinho.
  const stageOptions = [
    ...stages.map((item) => ({ value: item.key, label: item.label })),
    ...(currentStage && !stages.some((item) => item.key === currentStage)
      ? [{ value: currentStage, label: `${currentStage} (etapa removida)` }]
      : []),
  ];
  const stageColor = stages.find((item) => item.key === currentStage)?.color;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setErrors({});
    setConfirmingArchive(false);

    const payload = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const response = await fetch(
        card ? `/api/pipeline-cards/${card.id}` : "/api/pipeline-cards",
        {
          method: card ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const result = (await response
        .json()
        .catch(() => ({}))) as PipelineCardMutationResponse;

      if (!response.ok || result.ok === false) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar o card.");
        return;
      }

      toast.success(result.message ?? (card ? "Card atualizado." : "Card criado."));
      router.refresh();
      onOpenChange(false);
      onSaved?.();
    } catch {
      toast.error("Não foi possível salvar o card.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // Arquivar é destrutivo o bastante para pedir confirmação, e leve o bastante
  // para não merecer um segundo diálogo em cima deste: o próprio botão vira a
  // confirmação.
  async function handleArchive() {
    if (!card) return;
    if (!confirmingArchive) {
      setConfirmingArchive(true);
      return;
    }

    setArchiving(true);
    try {
      const response = await fetch(`/api/pipeline-cards/${card.id}`, { method: "DELETE" });
      const result = (await response
        .json()
        .catch(() => ({}))) as PipelineCardMutationResponse;

      if (!response.ok || result.ok === false) {
        toast.error(result.message ?? "Não foi possível arquivar o card.");
        return;
      }

      toast.success(result.message ?? "Card arquivado.");
      router.refresh();
      onOpenChange(false);
      onSaved?.();
    } catch {
      toast.error("Não foi possível arquivar o card.");
    } finally {
      setArchiving(false);
      setConfirmingArchive(false);
    }
  }

  const busy = pending || archiving;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Fechar no meio do envio deixaria o fetch voando e o estado sendo
        // resetado por baixo. O guard cobre X, Esc e clique fora.
        if (!next && submitting.current) return;
        onOpenChange(next);
      }}
    >
      <ModalShell
        size="medium"
        title={isEdit ? "Editar card" : "Novo card"}
        description={
          isEdit
            ? "Alterações valem para o quadro assim que você salvar."
            : "Só título e etapa são obrigatórios — o resto entra quando existir."
        }
        onSubmit={handleSubmit}
        footer={
          <ModalFooterActions>
            {isEdit ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleArchive()}
                disabled={busy}
                className="h-11 sm:mr-auto sm:h-9"
              >
                {archiving ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ArchiveIcon data-icon="inline-start" />
                )}
                {confirmingArchive ? "Confirmar arquivamento" : "Arquivar card"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {isEdit ? "Salvar alterações" : "Criar card"}
            </Button>
          </ModalFooterActions>
        }
      >
        {/* Trocar de card — ou abrir um card novo a partir de outra coluna —
            precisa refazer os campos: `defaultValue` só é lido na montagem. Sem
            a etapa na chave, o segundo "novo card" nasceria na coluna do
            primeiro. */}
        <div key={`${card?.id ?? "new"}:${currentStage}`} className="grid gap-5">
          {/* O funil só viaja na criação — mover card entre funis não é desta tela. */}
          {isEdit ? null : <input type="hidden" name="pipeline_id" value={pipelineId} />}

          <Field
            htmlFor={id("title")}
            label="Título"
            required
            error={errors.title?.[0]}
          >
            <Input
              id={id("title")}
              name="title"
              required
              maxLength={200}
              autoComplete="off"
              placeholder="Ex.: Renovar contrato do convênio"
              defaultValue={card?.title ?? ""}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errorId("title")}
              className="h-11 sm:h-10"
            />
          </Field>

          <Field htmlFor={id("stage")} label="Etapa" required error={errors.stage?.[0]}>
            <div className="flex items-center gap-2">
              {stageColor ? (
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full", getColorStyle(stageColor).dot)}
                />
              ) : null}
              <FormSelect
                id={id("stage")}
                name="stage"
                required
                defaultValue={currentStage}
                options={stageOptions}
                aria-invalid={Boolean(errors.stage)}
                aria-describedby={errorId("stage")}
              />
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor={id("amount")} label="Valor" error={errors.amount?.[0]}>
              <div className="relative">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  id={id("amount")}
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0,00"
                  defaultValue={card?.amount == null ? "" : String(card.amount)}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errorId("amount")}
                  className="h-11 ps-10 sm:h-10"
                />
              </div>
            </Field>

            <Field htmlFor={id("due_at")} label="Prazo" error={errors.due_at?.[0]}>
              <Input
                id={id("due_at")}
                name="due_at"
                type="date"
                defaultValue={card?.due_at ? toAppDateKey(card.due_at) : ""}
                aria-invalid={Boolean(errors.due_at)}
                aria-describedby={errorId("due_at")}
                className="h-11 sm:h-10"
              />
            </Field>
          </div>

          <Field htmlFor={id("description")} label="Descrição" error={errors.description?.[0]}>
            <Textarea
              id={id("description")}
              name="description"
              placeholder="O que precisa acontecer para o card avançar."
              className="min-h-24 resize-y"
              defaultValue={card?.description ?? ""}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errorId("description")}
            />
          </Field>

          <PersonLinkField
            inputId={id("person")}
            value={person}
            onChange={setPerson}
            // O vínculo de paciente que o card já tinha: sem busca, é a única
            // forma de restaurá-lo depois de o usuário passar por "Nenhuma".
            initialPatient={initialPatientLink(card)}
            error={errors.lead_id?.[0] ?? errors.patient_id?.[0]}
          />
        </div>
      </ModalShell>
    </Dialog>
  );
}

/**
 * Vínculo opcional com pessoa: nenhuma (padrão), um lead ou um paciente.
 *
 * ⚠️ **Paciente ainda não tem busca.** `/api/patients` só expõe `POST`; não há
 * rota de busca por termo, e inventar endpoint é proibido (AGENTS §3.6). Por
 * isso a aba "Paciente" só aparece quando o card **já** carrega um — para que
 * editar um card vinculado não apague o vínculo em silêncio. Assim que existir
 * `GET /api/patients?q=`, basta trocar a pílula por um `PersonCombobox`.
 */
function PersonLinkField({
  inputId,
  value,
  onChange,
  initialPatient,
  error,
}: {
  inputId: string;
  value: PersonLink;
  onChange: (next: PersonLink) => void;
  initialPatient: { id: string; name: string } | null;
  error?: string;
}) {
  const tabs: ReadonlyArray<{ kind: PersonLink["kind"]; label: string; icon: typeof UserRoundIcon }> = [
    { kind: "none", label: "Nenhuma pessoa", icon: CircleSlashIcon },
    { kind: "lead", label: "Lead", icon: UserRoundIcon },
    ...(initialPatient
      ? [{ kind: "patient" as const, label: "Paciente", icon: HeartPulseIcon }]
      : []),
  ];

  function selectTab(kind: PersonLink["kind"]) {
    if (kind === value.kind) return;
    if (kind === "none") return onChange({ kind: "none" });
    if (kind === "lead") return onChange({ kind: "lead", id: "", name: "" });
    // A aba de paciente só existe quando o card já trouxe um vínculo: voltar
    // para ela restaura exatamente aquele, nunca um vínculo vazio.
    if (initialPatient) onChange({ kind: "patient", ...initialPatient });
  }

  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <h3 className="font-display text-sm font-semibold">Vínculo com pessoa</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Card de processo interno não é de ninguém. Vincule só quando o trabalho for
        de um lead ou de um paciente.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo de vínculo">
        {tabs.map((tab) => {
          const active = tab.kind === value.kind;
          const Icon = tab.icon;
          return (
            <button
              key={tab.kind}
              type="button"
              onClick={() => selectTab(tab.kind)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors",
                active
                  ? "bg-brand-gradient text-primary-foreground shadow-sm"
                  : "border border-border/70 bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {value.kind === "lead" ? (
        <div className="mt-3">
          <LeadCombobox
            inputId={inputId}
            value={value.id ? { id: value.id, name: value.name } : null}
            onChange={(next) =>
              onChange(next ? { kind: "lead", id: next.id, name: next.name } : { kind: "lead", id: "", name: "" })
            }
            invalid={Boolean(error)}
          />
          {value.id ? null : (
            <p className="mt-2 text-xs text-muted-foreground">
              Sem escolher um lead, o card é salvo sem pessoa.
            </p>
          )}
        </div>
      ) : null}

      {value.kind === "patient" ? (
        <div className="mt-3 flex h-11 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm sm:h-10">
          <span className="flex min-w-0 items-center gap-2">
            <HeartPulseIcon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{value.name}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">vínculo atual</span>
        </div>
      ) : null}

      {value.kind === "patient" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Trocar de paciente ainda não é possível por aqui. Use “Nenhuma pessoa” para
          desfazer o vínculo.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {/* Campos do contrato. String vazia = "sem vínculo", como no resto do app. */}
      <input type="hidden" name="lead_id" value={value.kind === "lead" ? value.id : ""} />
      <input type="hidden" name="patient_id" value={value.kind === "patient" ? value.id : ""} />
    </section>
  );
}

/**
 * Busca incremental de leads no servidor (máx. 20 por consulta), no mesmo
 * desenho do combobox do financeiro.
 *
 * Não reusa `ClienteCombobox` porque aquele componente é do contrato de venda:
 * fixa o rótulo "Cliente", emite o campo `new_client_name` e oferece criar lead
 * na hora — três coisas que este formulário não tem. Generalizá-lo exigiria
 * editar arquivo de outra frente, então aqui vive a variante enxuta: sem
 * criação, com rótulo próprio.
 */
function LeadCombobox({
  inputId,
  value,
  onChange,
  invalid,
}: {
  inputId: string;
  value: { id: string; name: string } | null;
  onChange: (next: { id: string; name: string } | null) => void;
  invalid?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Busca debounced sempre que o termo muda e o painel está aberto.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const response = await fetch(`/api/leads/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const json = (await response.json()) as { items?: LeadOption[] };
        setItems(Array.isArray(json.items) ? json.items : []);
        setHighlight(0);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, open]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function select(item: LeadOption) {
    onChange({ id: item.id, name: item.name?.trim() || "Sem nome" });
    setOpen(false);
    setTerm("");
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      // Enter aqui escolhe o lead realçado; sem o preventDefault ele enviaria
      // o formulário inteiro com o vínculo ainda vazio.
      event.preventDefault();
      const item = items[highlight];
      if (item) select(item);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId} className="text-xs">
        Lead
      </Label>

      <div ref={wrapperRef} className="relative">
        {value ? (
          <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm sm:h-10">
            <span className="flex min-w-0 items-center gap-2">
              <CheckIcon className="size-4 shrink-0 text-emerald-600" aria-hidden />
              <span className="truncate">{value.name}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setTerm("");
                setOpen(true);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Trocar lead"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              id={inputId}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${inputId}-listbox`}
              aria-invalid={invalid}
              autoComplete="off"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Digite o nome ou o telefone…"
              className="h-11 pr-9 sm:h-10"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              {loading ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <ChevronsUpDownIcon className="size-4" />
              )}
            </span>
          </div>
        )}

        {open && !value ? (
          <ul
            id={`${inputId}-listbox`}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
          >
            {items.map((item, index) => (
              <li key={item.id} role="option" aria-selected={highlight === index}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => select(item)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    highlight === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                  )}
                >
                  <span className="truncate">{item.name ?? "Sem nome"}</span>
                  {item.phone ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatPhone(item.phone)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}

            {!loading && items.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                {term.trim() ? "Nenhum lead encontrado." : "Digite para buscar um lead."}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  required,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={htmlFor} className="justify-between gap-3 text-xs">
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
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
