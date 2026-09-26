"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import type { ProductOption } from "@/features/products/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/features/tickets/lib/ticket-priority";
import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import {
  ticketCreateSchema,
  type TicketCreateInput,
  type TicketCreateValues,
} from "@/features/tickets/schemas/ticket";
import type { CreateTicketData } from "@/features/tickets/types";
import { cn } from "@/lib/utils";
import { newUuid } from "@/lib/validation/uuid";

const FAILURE_MESSAGE = "Não foi possível abrir o ticket.";
const NETWORK_MESSAGE = "Não foi possível abrir o ticket. Confira a conexão e tente de novo.";

// Os campos que o formulário mostra: erro da rota num deles vai para o campo;
// nos outros (conversa, chave), vira o alerta do topo.
const FORM_FIELDS = ["title", "priority", "product_id", "description"] as const;

// O padrão do banco (create_ticket, p_priority default 'media').
const DEFAULT_PRIORITY = "media";

export type NewTicketFormHandle = {
  /**
   * Quem monta (o painel) pergunta antes de sair da vista — Esc, "Voltar" ou
   * toque fora. `true` = pode sair. Enviando: `false` (a resposta ainda vai
   * pintar aqui). Sujo: mostra "Descartar?" e devolve `false`; com a pergunta
   * aberta, fecha a pergunta e devolve `false` — cada Esc desfaz uma coisa só
   * (UI.md §5.7.18).
   */
  requestExit: () => boolean;
};

const LABEL_CLASS =
  "block px-4 pb-1.5 text-[13px] font-medium tracking-[0.02em] text-[var(--wa-info-label)] uppercase";

// `text-base` no celular: abaixo de 16px o iOS dá zoom ao focar (UI.md §5.11).
const FIELD_CLASS =
  "w-full rounded-xl bg-[var(--wa-info-card)] px-4 text-base text-foreground outline-none placeholder:text-[var(--wa-info-label)] focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-destructive/40 sm:text-[15px]";

// Pílula de escolha única: rádio nativo escondido (setas e leitor de tela de
// graça) e o rótulo desenhado. Sem popup: o sheet do chat não porta popups.
const PILL_CLASS =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--wa-info-card)] px-4 text-[15px] text-foreground transition-colors peer-checked:bg-[var(--wa-green-deep)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-[var(--wa-info-active)] peer-checked:hover:bg-[var(--wa-green-deep)]";

/**
 * "Novo ticket" do painel do contato: Título, Prioridade e Fila em pílulas,
 * Descrição e o interruptor "Assumir o atendimento" (ligado por padrão: na
 * mesma transação o ticket fica com quem abriu, em atendimento, e a conversa
 * passa para humano).
 *
 * react-hook-form + zod com o schema da rota (`ticketCreateSchema`). A chave de
 * idempotência nasce quando o formulário abre e se repete nos reenvios: duplo
 * clique ou reenvio depois de uma falha de rede abrem UM ticket. A trava é uma
 * ref, porque o botão só desabilita no próximo render.
 *
 * É conteúdo de uma vista do sheet (não camada): o painel é o dono do Esc e
 * pergunta pela `ref` (`requestExit`) antes de sair.
 */
export function NewTicketForm({
  ref,
  conversationId,
  products,
  productsLoading,
  onRetryProducts,
  onCreated,
  onExit,
}: {
  ref?: Ref<NewTicketFormHandle>;
  conversationId: string;
  /** Filas ativas do catálogo; `null` = a leitura falhou (ou ainda não veio: `productsLoading`). */
  products: readonly ProductOption[] | null;
  productsLoading: boolean;
  onRetryProducts: () => void;
  /** Ticket aberto (ou o mesmo pedido já atendido: `created: false`). O toast já saiu. */
  onCreated: (data: CreateTicketData) => void;
  /** Sair sem abrir: "Cancelar" com o formulário limpo, ou "Descartar". */
  onExit: () => void;
}) {
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  // Gerada UMA vez, ao abrir. `useState`, não `useRef`: o inicializador só roda
  // na montagem. `newUuid`, não `crypto.randomUUID`: este some em http:// fora
  // do localhost.
  const [idempotencyKey] = useState(newUuid);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<TicketCreateValues, unknown, TicketCreateInput>({
    resolver: zodResolver(ticketCreateSchema),
    defaultValues: {
      conversation_id: conversationId,
      idempotency_key: idempotencyKey,
      title: "",
      priority: DEFAULT_PRIORITY,
      product_id: "",
      description: "",
      take_over: true,
    },
  });

  function requestExit(): boolean {
    if (submitting.current) return false;
    if (confirmingDiscard) {
      setConfirmingDiscard(false);
      return false;
    }
    if (isDirty) {
      setConfirmingDiscard(true);
      return false;
    }
    return true;
  }

  useImperativeHandle(ref, () => ({ requestExit }));

  // A pergunta substitui os botões do rodapé: o foco vai para a saída segura
  // ("Continuar editando"), senão ficaria no botão que sumiu.
  useEffect(() => {
    if (confirmingDiscard) keepEditingRef.current?.focus({ preventScroll: true });
  }, [confirmingDiscard]);

  async function onValid(values: TicketCreateInput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFormError(null);

    const result = await ticketRequest<{ ok: true } & CreateTicketData>("/api/tickets", {
      method: "POST",
      body: values,
    });

    submitting.current = false;
    setPending(false);

    if (result.ok) {
      const protocol = formatProtocol(result.data.ticket.number);
      if (result.data.created) {
        toast.success(`Ticket ${protocol} aberto.`);
      } else {
        // Replay da chave: a tentativa cuja resposta se perdeu já tinha aberto o
        // ticket, com os dados daquela vez. O que foi editado depois não entrou.
        toast.warning(
          `O ticket ${protocol} já tinha sido aberto na tentativa anterior, com os dados daquela vez. Confira título, prioridade e fila.`
        );
      }
      onCreated(result.data);
      return;
    }
    if (result.status === 0) {
      setFormError(NETWORK_MESSAGE);
      return;
    }

    let marked = false;
    for (const field of FORM_FIELDS) {
      const message = result.body?.errors?.[field]?.[0];
      if (!message) continue;
      setError(field, { type: "server", message }, { shouldFocus: !marked });
      marked = true;
    }
    // Erro sem campo (conversa, chave reusada, falha do banco) vira alerta no
    // topo, não toast que some (UI.md §5.23).
    if (!marked) setFormError(result.body?.message ?? FAILURE_MESSAGE);
  }

  function cancel() {
    if (requestExit()) onExit();
  }

  return (
    <form
      noValidate
      aria-busy={pending}
      // Dentro do handler, não no render: `handleSubmit(onValid)` no render
      // entrega ao React Compiler uma função que lê a trava (ref) de envio.
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
          {formError ? (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-[15px] text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <div>
            <label htmlFor={id("title")} className={LABEL_CLASS}>
              Título
            </label>
            <input
              id={id("title")}
              autoComplete="off"
              maxLength={200}
              aria-required
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? id("title-error") : undefined}
              placeholder="O que o cliente precisa"
              className={cn(FIELD_CLASS, "min-h-11")}
              {...register("title")}
            />
            <FieldMessage id={id("title-error")} message={errors.title?.message} />
          </div>

          <fieldset className="min-w-0" aria-describedby={errors.priority ? id("priority-error") : undefined}>
            <legend className={LABEL_CLASS}>Prioridade</legend>
            <div className="flex flex-wrap gap-2">
              {TICKET_PRIORITIES.map((priority) => (
                <label key={priority} className="relative">
                  <input
                    type="radio"
                    value={priority}
                    className="peer sr-only"
                    {...register("priority")}
                  />
                  <span className={PILL_CLASS}>{TICKET_PRIORITY_LABEL[priority]}</span>
                </label>
              ))}
            </div>
            <FieldMessage id={id("priority-error")} message={errors.priority?.message} />
          </fieldset>

          <fieldset className="min-w-0" aria-describedby={errors.product_id ? id("product-error") : undefined}>
            <legend className={LABEL_CLASS}>Fila</legend>
            {productsLoading ? (
              <div aria-busy className="flex flex-wrap gap-2">
                <Skeleton className="h-11 w-24 rounded-full bg-[var(--wa-info-active)]" />
                <Skeleton className="h-11 w-32 rounded-full bg-[var(--wa-info-active)]" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <label className="relative">
                  <input
                    type="radio"
                    value=""
                    className="peer sr-only"
                    {...register("product_id")}
                  />
                  <span className={PILL_CLASS}>Sem fila</span>
                </label>
                {products?.map((product) => (
                  <label key={product.id} className="relative min-w-0 max-w-full">
                    <input
                      type="radio"
                      value={product.id}
                      className="peer sr-only"
                      {...register("product_id")}
                    />
                    <span className={cn(PILL_CLASS, "max-w-full")}>
                      <span
                        aria-hidden
                        className={cn("size-2.5 shrink-0 rounded-full", getColorStyle(product.color).dot)}
                      />
                      <span className="min-w-0 truncate">{product.name}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!productsLoading && products === null ? (
              // Sem as filas o ticket ainda abre (a fila é opcional): o aviso
              // tem saída, e o resto do formulário segue.
              <div className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--wa-info-card)] px-4 py-2">
                <span className="min-w-0 text-[15px] text-[var(--wa-info-label)]">
                  Não foi possível carregar as filas.
                </span>
                <button
                  type="button"
                  onClick={onRetryProducts}
                  className="min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Tentar de novo
                </button>
              </div>
            ) : null}
            <FieldMessage id={id("product-error")} message={errors.product_id?.message} />
          </fieldset>

          <div>
            <label htmlFor={id("description")} className={LABEL_CLASS}>
              Descrição
            </label>
            <textarea
              id={id("description")}
              rows={4}
              maxLength={10000}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? id("description-error") : undefined}
              placeholder="Opcional"
              className={cn(FIELD_CLASS, "min-h-28 resize-none py-3 leading-normal")}
              {...register("description")}
            />
            <FieldMessage id={id("description-error")} message={errors.description?.message} />
          </div>

          {/* A linha inteira é o rótulo: tocar em qualquer ponto liga e desliga. */}
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-[var(--wa-info-card)] px-4 py-2.5">
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px]">Assumir o atendimento</span>
              <span className="text-[13px] text-[var(--wa-info-label)]">
                O ticket fica com você e a conversa passa para atendimento humano.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              {...register("take_over")}
            />
            <span
              aria-hidden
              className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-black/15 transition-colors dark:bg-white/20 after:absolute after:top-0.5 after:left-0.5 after:size-[27px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[var(--wa-green-deep)] dark:peer-checked:bg-[var(--wa-green-deep)] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            />
          </label>
        </div>
      </div>

      {/* Rodapé fora da área que rola (UI.md §9). */}
      <div className="shrink-0 border-t border-[var(--wa-info-divider)] px-4 py-3">
        {confirmingDiscard ? (
          <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-end gap-2">
            <p role="alert" className="min-w-0 flex-1 text-[15px]">
              Descartar o novo ticket?
            </p>
            <button
              ref={keepEditingRef}
              type="button"
              onClick={() => setConfirmingDiscard(false)}
              className="min-h-11 rounded-lg px-3 text-[15px] text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Continuar editando
            </button>
            <button
              type="button"
              onClick={onExit}
              className="min-h-11 rounded-lg bg-destructive px-4 text-[15px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Descartar
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="min-h-11 rounded-lg px-3 text-[15px] text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-[var(--wa-green-deep)] px-4 text-[15px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {pending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : null}
              Abrir ticket
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function FieldMessage({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="px-4 pt-1.5 text-[13px] text-destructive">
      {message}
    </p>
  );
}
