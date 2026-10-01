"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  RotateCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { RelaySigning } from "@/features/settings/queries/get-relay-signing";
import { formatDateTime } from "@/lib/formatters/date";

const ENDPOINT = "/api/connection/agent/signing-secret";
/** Teto do pedido: com ele em curso o diálogo não fecha, e não pode ficar preso para sempre. */
const REQUEST_TIMEOUT_MS = 30_000;

// O que o diálogo mostra. Gerar, trocar e remover pedem confirmação, e o pedido
// corre com o diálogo aberto; a chave gerada aparece no MESMO diálogo, com o
// conteúdo trocado (sem modal sobre modal).
type View = "generate" | "rotate" | "remove" | "reveal";

type ApiResult = { ok?: boolean; secret?: string; message?: string; applied?: boolean };

// Erro do servidor sem a marca de "nada foi gravado", resposta que não é do
// app, ou pedido que nem voltou: a gravação pode ter acontecido. Dizer "não foi
// possível" deixaria o administrador confiando numa chave que talvez já não valha.
const UNKNOWN_OUTCOME =
  "Não foi possível confirmar se a operação foi feita. Releia o estado da chave antes de tentar de novo.";

export function RelaySigningSettings({ signing }: { signing: RelaySigning }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("generate");
  // A chave em texto puro só existe em memória, enquanto o diálogo está aberto.
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  // O carimbo da chave que estava na tela quando a confirmação abriu. Trocar e
  // remover o levam, e o servidor recusa se a chave guardada já não é essa
  // (outro administrador mexeu depois).
  const [target, setTarget] = useState<string | null>(null);
  // A última operação não pôde ser confirmada: o estado na tela pode estar velho.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);

  // Um estado novo chegou do servidor (um refresh): o aviso deixa de valer.
  const [seen, setSeen] = useState(signing);
  if (signing !== seen) {
    setSeen(signing);
    setUnconfirmed(false);
  }

  function confirm(next: Exclude<View, "reveal">) {
    setView(next);
    setTarget(signing.state === "configured" ? signing.updatedAt : null);
    setOpen(true);
  }

  function close() {
    // O estado só é relido quando a chave sai de vista. Com ela na tela, um
    // refresh pode recarregar a página inteira (servidor com build novo, rede
    // que falha), e a chave, que só aparece uma vez, se perderia.
    if (secret !== null) router.refresh();
    setOpen(false);
    setSecret(null);
    setCopied(false);
  }

  // Todo desfecho que não é o sucesso fecha a confirmação.
  function failed(status: number | null, result: ApiResult) {
    close();

    // Recusa (4xx), ou erro em que o servidor diz que nada foi gravado: o
    // motivo é certo, e o app respondeu. A tela relê o estado.
    const known = (status !== null && status >= 400 && status < 500) || result.applied === false;
    if (known) {
      const fallback = status === 401 ? "Sua sessão expirou. Entre de novo." : "O pedido foi recusado.";
      toast.error(result.message ?? fallback);
      router.refresh();
      return;
    }

    // Desfecho desconhecido. A tela NÃO relê sozinha: com a rede fora do ar o
    // refresh recarrega a página e leva o aviso junto. Ela marca o estado como
    // não confirmado e oferece reler.
    toast.error(UNKNOWN_OUTCOME);
    setUnconfirmed(true);
  }

  function send(method: "POST" | "DELETE", body: unknown) {
    return fetch(ENDPOINT, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function generate() {
    setPending(true);
    try {
      const response = await send(
        "POST",
        view === "rotate" ? { replace: true, expectedUpdatedAt: target } : { replace: false }
      );
      const result = (await response.json().catch(() => ({}))) as ApiResult;

      if (!response.ok || !result.ok || !result.secret) {
        failed(response.status, result);
        return;
      }

      setSecret(result.secret);
      setCopied(false);
      setView("reveal");
      // O botão que tinha o foco (o da confirmação) sai da tela: o foco vai
      // para o de copiar, que é o próximo passo.
      requestAnimationFrame(() => copyRef.current?.focus({ preventScroll: true }));
    } catch {
      failed(null, {});
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      const response = await send("DELETE", { expectedUpdatedAt: target });
      const result = (await response.json().catch(() => ({}))) as ApiResult;

      if (!response.ok || !result.ok) {
        failed(response.status, result);
        return;
      }

      toast.success(result.message ?? "Chave removida.");
      close();
      router.refresh();
    } catch {
      failed(null, {});
    } finally {
      setPending(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Chave copiada.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  // Sem saber o estado (a leitura falhou, ou a última operação não foi
  // confirmada), o bloco não oferece gerar, trocar nem remover: só reler.
  const unknownState = unconfirmed || signing.state === "unreadable";

  return (
    <div className="grid gap-3">
      {unconfirmed ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Não foi possível confirmar a última operação: o estado da chave pode ter mudado.
        </p>
      ) : signing.state === "unreadable" ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Não foi possível ler o cofre agora.
        </p>
      ) : signing.state === "configured" ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Gerada em {formatDateTime(signing.updatedAt)} — os pedidos ao agente saem assinados.
        </p>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Sem chave — os pedidos ao agente saem sem assinatura.
        </p>
      )}

      {unknownState ? (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.refresh()}
            className="h-11 w-full sm:h-9 sm:w-auto"
          >
            <RotateCwIcon data-icon="inline-start" />
            Tentar de novo
          </Button>
        </div>
      ) : signing.state === "configured" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => confirm("rotate")}
            className="h-11 sm:h-9"
          >
            <KeyRoundIcon data-icon="inline-start" />
            Gerar nova chave
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => confirm("remove")}
            className="h-11 text-destructive hover:text-destructive sm:h-9"
          >
            <Trash2Icon data-icon="inline-start" />
            Remover chave
          </Button>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => confirm("generate")}
            className="h-11 w-full sm:h-9 sm:w-auto"
          >
            <KeyRoundIcon data-icon="inline-start" />
            Gerar chave
          </Button>
        </div>
      )}

      <Dialog
        open={open}
        // Com o pedido em curso, ou com a chave à vista, só quem abriu fecha:
        // nem toque fora, nem arrastar a gaveta. A chave só aparece uma vez.
        dismissible={!(pending || view === "reveal")}
        // Com o pedido em curso o diálogo não fecha: a chave que está sendo
        // gerada tem de aparecer para quem a pediu.
        onOpenChange={(next) => {
          if (!next && !pending) close();
        }}
      >
        {view === "reveal" ? (
          <ModalShell
            size="medium"
            title="Chave gerada"
            description="Copie agora — por segurança, ela não será exibida novamente."
            footer={
              <ModalFooterActions>
                <Button type="button" onClick={close} className="h-11 sm:h-9">
                  Concluir
                </Button>
              </ModalFooterActions>
            }
          >
            <div className="grid gap-3">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  O CRM já assina com esta chave. Configure-a no agente, para ele
                  conferir o cabeçalho X-CRM-Signature.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {secret}
                </code>
                <Button
                  ref={copyRef}
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copySecret}
                  aria-label="Copiar chave"
                  className="size-11 shrink-0 sm:size-9"
                >
                  {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
                </Button>
              </div>
            </div>
          </ModalShell>
        ) : view === "remove" ? (
          <ModalShell
            size="compact"
            title="Remover chave"
            description="Os pedidos ao agente passam a sair sem assinatura."
            footer={
              <ModalFooterActions>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={close}
                  className="h-11 sm:h-9"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={remove}
                  className="h-11 sm:h-9"
                >
                  {pending ? (
                    <Loader2Icon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Trash2Icon data-icon="inline-start" />
                  )}
                  Remover chave
                </Button>
              </ModalFooterActions>
            }
          >
            <p className="text-sm text-muted-foreground">
              Um agente que confere a assinatura passa a recusá-los. As mensagens
              recusadas não chegam à IA: não há reenvio.
            </p>
          </ModalShell>
        ) : (
          <ModalShell
            size="compact"
            title={view === "rotate" ? "Gerar nova chave" : "Gerar chave"}
            description={
              view === "rotate"
                ? "Ao confirmar, a chave atual deixa de valer."
                : "O CRM passa a assinar os pedidos ao agente com ela."
            }
            footer={
              <ModalFooterActions>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={close}
                  className="h-11 sm:h-9"
                >
                  Cancelar
                </Button>
                <Button type="button" disabled={pending} onClick={generate} className="h-11 sm:h-9">
                  {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                  {view === "rotate" ? "Gerar nova chave" : "Gerar chave"}
                </Button>
              </ModalFooterActions>
            }
          >
            <p className="text-sm text-muted-foreground">
              {view === "rotate"
                ? "Um agente que confere a assinatura recusa os pedidos do CRM até receber a chave nova. As mensagens recusadas nesse intervalo não chegam à IA: não há reenvio."
                : "A chave aparece uma única vez, aqui. Um agente que ainda não confere a assinatura continua recebendo os pedidos normalmente."}
            </p>
          </ModalShell>
        )}
      </Dialog>
    </div>
  );
}
