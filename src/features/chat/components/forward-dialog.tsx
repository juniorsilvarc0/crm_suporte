"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ForwardIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ContactAvatar } from "@/features/chat/components/contact-avatar";
import { MAX_FORWARD_TARGETS } from "@/features/chat/lib/message-actions";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/features/chat/types";

/**
 * Só os dígitos, para casar telefone digitado de qualquer jeito.
 *
 * `normalizePhone` não serve aqui: ela remove o DDI 55, e procurar por
 * "5527999" deixaria de encontrar o contato.
 */
const digitsOf = (value: string) => value.replace(/\D/g, "");

/** O que a tela de encaminhar desenha de cada conversa. Nada além disto. */
type ForwardTarget = Pick<
  ChatConversation,
  | "id"
  | "contact_name"
  | "contact_phone"
  | "contact_avatar_url"
  | "last_message_preview"
>;

/**
 * Seletor de destino do encaminhamento, no formato do WhatsApp: busca em
 * pílula, lista com caixa de seleção à esquerda, e a barra de confirmação que
 * só aparece com alguém marcado.
 *
 * ⚠️ **Busca a própria lista, e não reusa a da barra lateral.** A lateral é
 * filtrada — por status e por etiqueta — e encaminhar a partir da caixa de
 * arquivadas oferecia como destino **apenas conversas arquivadas**. Encaminhar
 * é sempre "para qualquer conversa", como no WhatsApp; o filtro da tela não tem
 * nada a ver com para onde a mensagem pode ir.
 *
 * A lista da lateral entra como semente: a tela abre já preenchida com o que
 * existe em memória e completa quando a busca volta, em vez de piscar vazia.
 */
export function ForwardDialog({
  conversations,
  excludeConversationId,
  messageCount,
  sending,
  onCancel,
  onConfirm,
}: {
  /** Semente vinda da lista lateral — pode estar filtrada. */
  conversations: ChatConversation[];
  excludeConversationId: string;
  messageCount: number;
  sending: boolean;
  onCancel: () => void;
  onConfirm: (conversationIds: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState<ForwardTarget[] | null>(null);
  const guard = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * O cursor já nasce na busca: quem abre "Encaminhar" está procurando alguém, e
   * a lista tem 425 nomes. Sem isto era abrir, clicar no campo e só então
   * digitar — um clique cobrado em toda vez.
   *
   * ⚠️ Só com ponteiro fino. No celular o teclado subiria por cima da lista de
   * contatos, que é justamente o que a pessoa precisa enxergar para escolher.
   */
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    // Um quadro depois: o diálogo do Base UI move o foco para dentro dele ao
    // abrir, e pedir antes disso seria sobrescrito.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      // Arquivada também é destino válido — no WhatsApp ela aparece na lista de
      // encaminhar como qualquer outra.
      // Só as colunas que a tela desenha. `select("*")` traria as 425 linhas
      // inteiras — com `metadata`, `external_id` e o resto — para mostrar nome,
      // telefone, foto e prévia. No celular isso é peso no fio à toa.
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id, contact_name, contact_phone, contact_avatar_url, last_message_preview")
        .is("removed_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (!alive) return;
      // Falhar não pode esvaziar a tela: sem a busca, a semente ainda permite
      // encaminhar para o que está carregado.
      if (error) {
        console.error("[ForwardDialog] lista completa falhou:", error.message);
        return;
      }
      setAll(data as ForwardTarget[]);
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const candidates = useMemo(
    () => (all ?? conversations).filter((c) => c.id !== excludeConversationId),
    [all, conversations, excludeConversationId]
  );

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return candidates;
    const digits = digitsOf(query);
    return candidates.filter((c) => {
      const name = (c.contact_name ?? "").toLowerCase();
      if (name.includes(query)) return true;
      if (!digits) return false;
      return digitsOf(c.contact_phone ?? "").includes(digits);
    });
  }, [candidates, term]);

  const full = selected.length >= MAX_FORWARD_TARGETS;

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= MAX_FORWARD_TARGETS
        ? current
        : [...current, id]
    );
  };

  // A tentativa terminou e o diálogo continua aberto — só acontece quando o
  // envio FALHOU, porque o sucesso desmonta o diálogo. Libera o botão para a
  // nova tentativa; sem isto, uma falha deixava o botão morto e o operador
  // preso num diálogo que não responde mais.
  useEffect(() => {
    if (!sending) guard.current = false;
  }, [sending]);

  const confirm = () => {
    // Guarda de duplo clique com ref: `sending` como estado não trava entre o
    // clique e o re-render, e cada disparo extra é mensagem repetida no
    // WhatsApp de outra pessoa.
    if (guard.current || selected.length === 0) return;
    guard.current = true;
    onConfirm(selected);
  };

  const selectedNames = selected
    .map((id) => candidates.find((c) => c.id === id))
    .map((c) => c?.contact_name || c?.contact_phone || "Contato")
    .join(", ");

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !sending) onCancel();
      }}
    >
      {/* `wa-surface` aqui porque o diálogo é portalado para o `body`, fora da
          árvore do chat: sem a classe, `--wa-green` não existiria neste ramo e
          o verde cairia no valor padrão mesmo no tema escuro. Ela só declara
          variáveis. */}
      {/* Folha de tela cheia no celular, caixinha centrada no desktop. Uma
          lista de 348 conversas dentro de uma caixinha de 85vh no telefone
          mostra 4 linhas e rola apertado; a tela de envio de anexo já é folha,
          e estes dois destoavam. */}
      <DialogContent
        showCloseButton={false}
        // No celular quem manda na geometria é a gaveta (o primitivo troca de
        // superfície sozinho); aqui só sobra o que vale no desktop.
        className={cn(
          "wa-surface flex flex-col gap-0 overflow-hidden p-0",
          "sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:max-w-md"
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            aria-label="Fechar"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9"
          >
            <XIcon className="size-5" />
          </button>
          <DialogTitle className="font-sans text-[15px]">
            {messageCount > 1
              ? `Encaminhar ${messageCount} mensagens para`
              : "Encaminhar mensagem para"}
          </DialogTitle>
        </div>

        {/* Busca em pílula com aro verde no foco, como no print. */}
        <div className="shrink-0 px-3 pb-3 sm:px-4">
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 ring-1 ring-transparent transition-shadow focus-within:ring-2 focus-within:ring-[var(--wa-green)]">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              disabled={sending}
              placeholder="Pesquisar nome ou número"
              aria-label="Pesquisar conversa"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-sm"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma conversa encontrada.
            </p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-2 text-[13px] text-muted-foreground">
                Conversas recentes
              </p>
              <ul>
                {filtered.map((conversation) => {
                  const checked = selected.includes(conversation.id);
                  const name =
                    conversation.contact_name ||
                    conversation.contact_phone ||
                    "Contato desconhecido";
                  const preview = stripWhatsappFormat(
                    conversation.last_message_preview?.replace(/^\[.*?\]\s*/, "") ?? ""
                  ).replace(/\s+/g, " ");
                  // Cheio: quem já está marcado continua clicável para desmarcar.
                  const blocked = full && !checked;

                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => toggle(conversation.id)}
                        disabled={sending || blocked}
                        aria-pressed={checked}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          "hover:bg-accent/60 disabled:opacity-40 disabled:hover:bg-transparent"
                        )}
                      >
                        {/* Caixa DECORATIVA, não o primitivo `Checkbox`: ele
                            renderiza um <button>, e um botão dentro de outro é
                            HTML inválido — o navegador fecha o de fora sozinho
                            e a linha para de funcionar. Quem carrega o estado
                            para o leitor de tela é o `aria-pressed` da linha. */}
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                            checked
                              ? "border-[var(--wa-green)] bg-[var(--wa-green)] text-white"
                              : "border-input"
                          )}
                        >
                          {checked && <CheckIcon className="size-3.5" />}
                        </span>
                        <ContactAvatar
                          name={conversation.contact_name}
                          phone={conversation.contact_phone}
                          url={conversation.contact_avatar_url}
                          className="size-10"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">
                            {name}
                          </span>
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {preview || "Sem mensagens"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Barra de confirmação — só com alguém marcado, como no WhatsApp. */}
        {selected.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 border-t bg-muted/50 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-[13px]" aria-live="polite">
              {selectedNames}
              {full && (
                <span className="block text-[11px] text-muted-foreground">
                  Máximo de {MAX_FORWARD_TARGETS} conversas por vez.
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={sending}
              aria-label={`Encaminhar para ${selected.length} conversa(s)`}
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full",
                "bg-[var(--wa-green)] text-white transition-opacity",
                "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:opacity-60"
              )}
            >
              {sending ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : (
                <ForwardIcon className="size-6" />
              )}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
