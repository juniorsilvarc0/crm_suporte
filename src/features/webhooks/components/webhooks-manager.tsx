"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  KeyRoundIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlugZapIcon,
  PlusIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WebhookDeliveries } from "@/features/webhooks/components/webhook-deliveries";
import { WebhookForm } from "@/features/webhooks/components/webhook-form";
import { WebhookSecretView } from "@/features/webhooks/components/webhook-secret-view";
import {
  describeWebhookPing,
  webhookEventsSummary,
  webhookHost,
  type WebhookPingResult,
} from "@/features/webhooks/lib/webhook-display";
import type { WebhookSubscription } from "@/features/webhooks/types";
import { cn } from "@/lib/utils";

type Confirm = "rotate" | "pause" | "delete";
type Revealed = { name: string; secret: string; rotated: boolean };
type ApiResult = { ok?: boolean; message?: string; secret?: string; result?: WebhookPingResult };

const CONFIRM_COPY: Record<Confirm, { title: string; action: string; summary: (name: string) => string; body: string }> = {
  rotate: {
    title: "Trocar o segredo",
    action: "Trocar segredo",
    summary: (name) => `O segredo atual de "${name}" deixa de valer na hora.`,
    body: "Até o destino receber o novo, ele recusa a assinatura e as entregas entram em nova tentativa. O novo segredo aparece uma única vez.",
  },
  pause: {
    title: "Pausar o destino",
    action: "Pausar",
    summary: (name) => `"${name}" para de receber eventos.`,
    body: "O que acontecer enquanto estiver pausado não é guardado para depois, e o que já estava na fila não sai. Para voltar, use Reativar no mesmo menu.",
  },
  delete: {
    title: "Excluir o destino",
    action: "Excluir destino",
    summary: (name) => `"${name}" e o segredo dele são apagados.`,
    body: "O que estava na fila não sai, e o histórico de entregas continua na lista. Esta ação não pode ser desfeita.",
  },
};

/**
 * Aba Webhooks: os destinos dos eventos de ticket (docs/CONTRATO-WEBHOOKS.md).
 * `subscriptions` null = a leitura falhou — a tela não mostra "nenhum destino"
 * quando não sabe.
 */
export function WebhooksManager({ subscriptions }: { subscriptions: WebhookSubscription[] | null }) {
  const router = useRouter();

  // Formulário (cadastrar/editar) e, depois de cadastrar, o segredo — no mesmo Dialog.
  const [formOpen, setFormOpen] = useState(false);
  const [formTarget, setFormTarget] = useState<WebhookSubscription | null>(null);
  const [formSession, setFormSession] = useState(0);
  const [formPending, setFormPending] = useState(false);

  // Confirmação (trocar segredo, pausar, excluir) e, depois da troca, o segredo.
  const [confirm, setConfirm] = useState<{ kind: Confirm; subscription: WebhookSubscription } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  // O segredo em texto puro: só em memória, enquanto o diálogo está aberto.
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [pinging, setPinging] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  function openForm(subscription: WebhookSubscription | null) {
    setFormTarget(subscription);
    setFormSession((current) => current + 1);
    setRevealed(null);
    setFormOpen(true);
  }

  // O estado só é relido quando o segredo sai de vista: um refresh com ele na
  // tela pode recarregar a página inteira, e o segredo se perderia.
  function closeForm() {
    if (formPending) return;
    setFormOpen(false);
    if (revealed) router.refresh();
    setRevealed(null);
  }

  function closeConfirm() {
    if (confirmPending) return;
    setConfirm(null);
    if (revealed) router.refresh();
    setRevealed(null);
  }

  function saved({ subscription, secret }: { subscription: WebhookSubscription; secret: string | null }) {
    if (secret) {
      setRevealed({ name: subscription.name, secret, rotated: false });
      return;
    }
    toast.success("Destino salvo.");
    setFormOpen(false);
    router.refresh();
  }

  /** null = o pedido não voltou: o desfecho é desconhecido. */
  async function request(path: string, init: RequestInit): Promise<{ result: ApiResult } | null> {
    try {
      const response = await fetch(path, init);
      return { result: (await response.json().catch(() => ({}))) as ApiResult };
    } catch {
      return null;
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, subscription } = confirm;
    setConfirmPending(true);
    const outcome =
      kind === "rotate"
        ? await request(`/api/webhooks/${subscription.id}/secret`, { method: "POST" })
        : kind === "pause"
          ? await request(`/api/webhooks/${subscription.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ is_active: false }),
            })
          : await request(`/api/webhooks/${subscription.id}`, { method: "DELETE" });
    setConfirmPending(false);

    if (!outcome || !outcome.result.ok) {
      // Sem resposta, a troca pode ter acontecido sem o segredo novo chegar à
      // tela: o destino passaria a recusar, e só outra troca resolve.
      const unknown =
        kind === "rotate"
          ? "Não deu para confirmar a troca. Se o destino passar a recusar a assinatura, troque o segredo de novo."
          : "Não deu para confirmar. Confira o estado e tente de novo.";
      toast.error(outcome?.result.message ?? unknown);
      setConfirm(null);
      router.refresh();
      return;
    }
    if (kind === "rotate" && outcome.result.secret) {
      setRevealed({ name: subscription.name, secret: outcome.result.secret, rotated: true });
      return;
    }
    toast.success(kind === "pause" ? "Destino pausado." : "Destino excluído.");
    setConfirm(null);
    router.refresh();
  }

  async function activate(subscription: WebhookSubscription) {
    setToggling(subscription.id);
    const outcome = await request(`/api/webhooks/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    setToggling(null);
    if (!outcome || !outcome.result.ok) {
      toast.error(outcome?.result.message ?? "Não foi possível reativar o destino.");
      return;
    }
    toast.success("Destino reativado: os próximos eventos voltam a sair.");
    router.refresh();
  }

  async function ping(subscription: WebhookSubscription) {
    setPinging(subscription.id);
    const outcome = await request(`/api/webhooks/${subscription.id}/ping`, { method: "POST" });
    setPinging(null);
    if (!outcome || !outcome.result.ok || !outcome.result.result) {
      toast.error(outcome?.result.message ?? "Não foi possível testar a conexão.");
      return;
    }
    const described = describeWebhookPing(webhookHost(subscription.url), outcome.result.result);
    if (described.delivered) toast.success(described.message);
    else toast.error(described.message);
  }

  const actions = (subscription: WebhookSubscription) => (
    <div className="flex shrink-0 justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 sm:h-8"
        disabled={pinging === subscription.id}
        onClick={() => void ping(subscription)}
        aria-label={`Testar a conexão com ${subscription.name}`}
      >
        {pinging === subscription.id ? (
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
        ) : (
          <PlugZapIcon data-icon="inline-start" />
        )}
        Testar
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11 sm:size-8")}
          aria-label={`Mais ações de ${subscription.name}`}
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openForm(subscription)}>
            <PencilIcon data-icon="inline-start" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirm({ kind: "rotate", subscription })}>
            <KeyRoundIcon data-icon="inline-start" />
            Trocar segredo
          </DropdownMenuItem>
          {subscription.isActive ? (
            <DropdownMenuItem onClick={() => setConfirm({ kind: "pause", subscription })}>
              <PauseIcon data-icon="inline-start" />
              Pausar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={toggling === subscription.id} onClick={() => void activate(subscription)}>
              <PlayIcon data-icon="inline-start" />
              Reativar
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: "delete", subscription })}>
            <Trash2Icon data-icon="inline-start" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Webhooks de saída</h2>
          <p className="text-sm text-muted-foreground">
            Quando um ticket muda, o CRM avisa os sistemas cadastrados aqui, com o evento assinado. Cada destino tem o
            seu segredo, mostrado uma única vez.
          </p>
        </div>
        <Button onClick={() => openForm(null)} disabled={subscriptions === null} className="h-11 sm:h-9">
          <PlusIcon data-icon="inline-start" />
          Novo destino
        </Button>
      </div>

      {subscriptions === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-4 text-sm">
          <span className="text-amber-600 dark:text-amber-400">Não foi possível carregar os destinos.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()} className="h-11 sm:h-8">
            Tentar de novo
          </Button>
        </div>
      ) : subscriptions.length === 0 ? (
        <EmptyState>Nenhum destino cadastrado. Cadastre um para o CRM começar a enviar eventos.</EmptyState>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
          {subscriptions.map((subscription) => (
            <li key={subscription.id} className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className={subscription.isActive ? "min-w-0 flex-1" : "min-w-0 flex-1 opacity-70"}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <WebhookIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h3 className="min-w-0 truncate font-medium">{subscription.name}</h3>
                  <Badge variant={subscription.isActive ? "default" : "outline"}>
                    {subscription.isActive ? "Ativo" : "Pausado"}
                  </Badge>
                  {subscription.hasSecret ? null : (
                    <Badge variant="destructive">Sem segredo: nada sai</Badge>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={subscription.url}>
                  {subscription.url}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{webhookEventsSummary(subscription.events)}</p>
              </div>
              {actions(subscription)}
            </li>
          ))}
        </ul>
      )}

      {subscriptions && subscriptions.length > 0 ? <WebhookDeliveries subscriptions={subscriptions} /> : null}

      <Dialog
        open={formOpen}
        onOpenChange={(next) => (next ? setFormOpen(true) : closeForm())}
        dismissible={!(formPending || revealed)}
      >
        {revealed ? (
          <WebhookSecretView {...revealed} onDone={closeForm} />
        ) : formSession > 0 ? (
          // Fica montado durante a animação de saída; cada abertura é um formulário novo.
          <WebhookForm
            key={`${formTarget?.id ?? "novo"}:${formSession}`}
            subscription={formTarget}
            onCancel={closeForm}
            onSaved={saved}
            onPendingChange={setFormPending}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => (next ? undefined : closeConfirm())}
        dismissible={!(confirmPending || revealed)}
      >
        {revealed ? (
          <WebhookSecretView {...revealed} onDone={closeConfirm} />
        ) : confirm ? (
          <ModalShell
            size="compact"
            title={CONFIRM_COPY[confirm.kind].title}
            description={CONFIRM_COPY[confirm.kind].summary(confirm.subscription.name)}
            footer={
              <ModalFooterActions>
                <Button type="button" variant="outline" onClick={closeConfirm} disabled={confirmPending} className="h-11 sm:h-9">
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant={confirm.kind === "rotate" ? "default" : "destructive"}
                  onClick={() => void runConfirm()}
                  disabled={confirmPending}
                  className="h-11 sm:h-9"
                >
                  {confirmPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                  {CONFIRM_COPY[confirm.kind].action}
                </Button>
              </ModalFooterActions>
            }
          >
            <p className="text-sm text-muted-foreground">{CONFIRM_COPY[confirm.kind].body}</p>
          </ModalShell>
        ) : null}
      </Dialog>
    </section>
  );
}
