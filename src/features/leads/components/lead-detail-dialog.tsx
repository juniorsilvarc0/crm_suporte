"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AtSignIcon,
  ArchiveIcon,
  BanknoteIcon,
  CalendarClockIcon,
  CheckIcon,
  ArrowLeftIcon,
  CopyIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  StethoscopeIcon,
  UserRoundPlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadEditPanel } from "@/features/leads/components/lead-edit-panel";
import { LeadTagsEditor } from "@/features/leads/components/lead-tags-editor";
import {
  formatLeadHistoryTimestamp,
  getLeadHistoryTransitionLabel,
  type LeadHistoryItem,
} from "@/features/leads/lib/lead-history";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import {
  getLeadSourceLabel,
  getLeadStatusLabel,
  getLeadStatusStyle,
  getTipoEnsaioLabel,
} from "@/features/leads/schemas/status";
import { LeadSalesBlock } from "@/features/financeiro/components/lead-sales-block";
import { SaleDialog } from "@/features/financeiro/components/sale-dialog";
import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import type { LeadSale } from "@/features/financeiro/types";
import {
  attributionCampaignLabel,
  type LeadAttribution,
} from "@/features/meta/lead-attribution";
import type { Lead, Tag } from "@/features/leads/types";
import { formatDateTime } from "@/lib/formatters/date";
import { formatPhoneLocation } from "@/lib/formatters/location";
import { formatPhoneBR } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type LeadHistoryState = {
  key: string | null;
  status: "idle" | "loading" | "ready" | "error";
  items: LeadHistoryItem[];
};

function boolLabel(value: boolean | null) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "—";
}

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildClipboardText(lead: Lead) {
  return [
    lead.name,
    lead.phone ? formatPhoneBR(lead.phone) : null,
    lead.email,
    lead.instagram_user ? `@${lead.instagram_user.replace(/^@/, "")}` : null,
    lead.tipo_ensaio ? getTipoEnsaioLabel(lead.tipo_ensaio) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
  allTags = [],
  attribution = null,
  sales = [],
  procedures = [],
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTags?: Tag[];
  attribution?: LeadAttribution | null;
  sales?: LeadSale[];
  procedures?: Procedure[];
}) {
  const router = useRouter();
  const { startConversation, checkingPhone } = useStartConversation();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Editar venda TROCA o conteúdo do modal, como o modo de edição do lead —
  // não abre um segundo Dialog por cima.
  const [editingSale, setEditingSale] = useState<LeadSale | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // A lista que abriu o modal guarda uma cópia do lead: router.refresh() não
  // reescreve o objeto já aberto. Este flag reflete a promoção na hora.
  const [promoted, setPromoted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);

  const currentId = lead?.id ?? null;
  const historyKey = open && currentId ? `${currentId}:${historyRevision}` : null;
  const [historyState, setHistoryState] = useState<LeadHistoryState>(() => ({
    key: historyKey,
    status: historyKey ? "loading" : "idle",
    items: [],
  }));
  const [trackedId, setTrackedId] = useState<string | null>(currentId);
  if (currentId !== trackedId) {
    setTrackedId(currentId);
    setEditing(false);
    setConfirmingDelete(false);
    setCopied(false);
    setEditingSale(null);
    setPromoted(false);
  }
  if (historyState.key !== historyKey) {
    setHistoryState({
      key: historyKey,
      status: historyKey ? "loading" : "idle",
      items: [],
    });
  }

  useEffect(() => {
    if (!currentId || !historyKey) return;

    const controller = new AbortController();

    async function loadHistory() {
      try {
        const response = await fetch(`/api/leads/${currentId}/history`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          items?: LeadHistoryItem[];
        } | null;

        if (!response.ok || !result?.ok || !Array.isArray(result.items)) {
          throw new Error("invalid_lead_history_response");
        }

        setHistoryState((current) =>
          current.key === historyKey
            ? { key: historyKey, status: "ready", items: result.items ?? [] }
            : current
        );
      } catch {
        if (controller.signal.aborted) return;
        setHistoryState((current) =>
          current.key === historyKey
            ? { key: historyKey, status: "error", items: [] }
            : current
        );
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [currentId, historyKey]);

  if (!lead) return null;

  const selectedLead = lead;
  const statusStyle = getLeadStatusStyle(lead.status);
  const isPatient = Boolean(lead.patient_id) || promoted;

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead.id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível arquivar a pessoa.");
        return;
      }
      toast.success("Pessoa arquivada.");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível arquivar a pessoa.");
    } finally {
      setDeleting(false);
    }
  }

  async function handlePromote() {
    if (promoting) return;
    setPromoting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead.id}/promote`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível criar o cadastro de paciente.");
        return;
      }
      setPromoted(true);
      toast.success(result.message ?? "Cadastro de paciente criado.");
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o cadastro de paciente.");
    } finally {
      setPromoting(false);
    }
  }

  async function copyValue(label: string, value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(buildClipboardText(selectedLead));
      setCopied(true);
      toast.success("Dados copiados.");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setEditing(false);
      setConfirmingDelete(false);
    }
  }

  function openChat() {
    const digits =
      (selectedLead.phone ?? "").replace(/\D/g, "") ||
      (selectedLead.normalized_phone ?? "").replace(/\D/g, "");
    if (digits) void startConversation(digits, selectedLead.name ?? undefined);
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[95dvh] w-[97vw] max-w-[97vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/70 bg-card/95 px-4 py-2.5 sm:px-6">
          <DialogTitle className="sr-only">
            {editing ? `Editar ${lead.name ?? "lead"}` : lead.name ?? "Detalhe do lead"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Dados de contato, qualificação, funil e histórico do lead.
          </DialogDescription>

          <Badge
            variant="outline"
            className={cn("shrink-0 rounded-md border-0 px-2.5 py-1 text-xs font-medium", statusStyle.badge)}
          >
            <span className={cn("size-1.5 rounded-full", statusStyle.dot)} aria-hidden />
            {getLeadStatusLabel(lead.status)}
          </Badge>

          {editingSale ? (
            <div className="hidden min-w-0 border-l border-border/70 pl-3 sm:block">
              <p className="text-sm font-semibold leading-tight">Editar venda</p>
              <p className="truncate text-xs text-muted-foreground">
                {lead.name ?? "Sem nome"}
              </p>
            </div>
          ) : editing ? (
            <div className="hidden min-w-0 border-l border-border/70 pl-3 sm:block">
              <p className="text-sm font-semibold leading-tight">Editar lead</p>
              <p className="truncate text-xs text-muted-foreground">
                {lead.name ?? "Contato sem nome"}
              </p>
            </div>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!editing && !confirmingDelete ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden h-11 gap-1.5 px-2 text-muted-foreground sm:inline-flex sm:h-8"
                  onClick={copyAll}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  <span className="hidden sm:inline">Copiar tudo</span>
                </Button>
                {editingSale ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 gap-1.5 px-2 text-muted-foreground sm:h-8"
                    onClick={() => setEditing(true)}
                  >
                    <PencilIcon />
                    <span className="hidden sm:inline">Editar</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 px-2 text-muted-foreground sm:h-8"
                  onClick={openChat}
                  disabled={Boolean(checkingPhone)}
                >
                  {checkingPhone ? <Loader2Icon className="size-4 animate-spin" /> : <WhatsAppIcon className="size-4" brand />}
                  <span className="hidden md:inline">Abrir chat</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground sm:size-8"
                        aria-label="Mais ações"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem className="min-h-11 sm:hidden" onClick={copyAll}>
                      <CopyIcon />
                      Copiar tudo
                    </DropdownMenuItem>
                    {lead.phone ? (
                      <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => copyValue("Telefone", formatPhoneBR(lead.phone))}>
                        <PhoneIcon />
                        Copiar telefone
                      </DropdownMenuItem>
                    ) : null}
                    {lead.email ? (
                      <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => copyValue("E-mail", lead.email)}>
                        <MailIcon />
                        Copiar e-mail
                      </DropdownMenuItem>
                    ) : null}
                    {lead.instagram_user ? (
                      <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => copyValue("Instagram", `@${lead.instagram_user?.replace(/^@/, "")}`)}>
                        <AtSignIcon />
                        Copiar Instagram
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    {isPatient ? null : (
                      <DropdownMenuItem
                        className="min-h-11 sm:min-h-8"
                        disabled={promoting}
                        onClick={handlePromote}
                      >
                        {promoting ? <Loader2Icon className="animate-spin" /> : <UserRoundPlusIcon />}
                        Tornar paciente
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => setConfirmingDelete(true)}>
                      <ArchiveIcon />
                      Arquivar pessoa
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}

            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 sm:size-8"
              aria-label="Fechar"
              onClick={() => handleDialogOpenChange(false)}
            >
              <XIcon />
            </Button>
          </div>
        </header>

        <div
          className={cn(
            "min-h-0 flex-1",
            editing
              ? "overflow-hidden"
              : "overflow-y-auto overscroll-contain px-5 py-5 [-webkit-overflow-scrolling:touch] sm:px-6 lg:px-8 lg:py-7"
          )}
        >
          {editingSale ? (
            // Formulário da venda NO LUGAR do detalhe, não por cima dele.
            <div className="mx-auto w-full max-w-2xl">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingSale(null)}
                className="mb-4 -ms-2"
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Voltar ao lead
              </Button>
              <SaleDialog
                variant="panel"
                sale={editingSale}
                procedures={procedures}
                onOpenChange={(next) => {
                  if (!next) setEditingSale(null);
                }}
              />
            </div>
          ) : editing ? (
            <LeadEditPanel
              lead={selectedLead}
              onSaved={() => {
                setEditing(false);
                setHistoryRevision((revision) => revision + 1);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="mx-auto grid max-w-5xl gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.85fr)]">
              <main className="min-w-0">
                <div className="mb-6 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h2 className="break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                      {lead.name ?? "Sem nome"}
                    </h2>
                    {isPatient ? (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <StethoscopeIcon data-icon="inline-start" aria-hidden />
                        Paciente
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono tabular-nums">
                      <PhoneIcon className="size-3.5" aria-hidden />
                      {lead.phone ? formatPhoneBR(lead.phone) : "Sem telefone"}
                    </span>
                    {lead.instagram_user ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AtSignIcon className="size-3.5" aria-hidden />
                        @{lead.instagram_user.replace(/^@/, "")}
                      </span>
                    ) : null}
                    {lead.source ? <span>{getLeadSourceLabel(lead.source)}</span> : null}
                    {attribution ? (
                      <span
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-medium text-primary"
                        title={attributionCampaignLabel(attribution)}
                      >
                        <MegaphoneIcon className="size-3 shrink-0" aria-hidden />
                        <span className="sr-only">Campanha:</span>
                        <span className="truncate">{attributionCampaignLabel(attribution)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-4">
                  <InlineFact icon={<CalendarClockIcon />} label="Entrada" value={formatDateTime(lead.created_at)} />
                  <InlineFact icon={<CalendarClockIcon />} label="Agendado" value={formatDateTime(lead.agendado_at)} />
                  <InlineFact icon={<BanknoteIcon />} label="Valor" value={formatCurrency(lead.valor_estimado)} />
                </div>

                <FieldGroup title="Resumo">
                  <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <DetailRow label="Serviço" value={lead.tipo_ensaio ? getTipoEnsaioLabel(lead.tipo_ensaio) : null} />
                    <DetailRow label="Interesse" value={lead.interesse} />
                  </div>
                </FieldGroup>

                {sales.length > 0 ? (
                  <FieldGroup title="Vendas">
                    <LeadSalesBlock sales={sales} onEdit={setEditingSale} />
                  </FieldGroup>
                ) : null}

                <FieldGroup title="Tags">
                  <LeadTagsEditor leadId={lead.id} leadTags={lead.tags ?? []} allTags={allTags} />
                </FieldGroup>

                <FieldGroup title="Anotações">
                  {lead.notes || lead.interesse ? (
                    <div className="grid gap-3 text-sm leading-relaxed">
                      {lead.interesse ? <p>{lead.interesse}</p> : null}
                      {lead.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{lead.notes}</p> : null}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Sem anotações.</p>}
                </FieldGroup>

                <FieldGroup title="Histórico do Lead">
                  <LeadHistoryTimeline
                    state={historyState}
                    onRetry={() => setHistoryRevision((revision) => revision + 1)}
                  />
                </FieldGroup>

                {lead.memoria_contexto ? (
                  <FieldGroup title="Memória da IA">
                    <details className="text-xs text-muted-foreground">
                      <summary className="min-h-11 cursor-pointer select-none py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Ver memória técnica da conversa
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{lead.memoria_contexto}</p>
                    </details>
                  </FieldGroup>
                ) : null}
              </main>

              <aside className="grid min-w-0 content-start gap-5 border-t border-border/70 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
                <FieldGroup title="Contato">
                  <dl className="grid gap-1">
                    <DetailRow icon={<PhoneIcon />} label="Telefone" value={lead.phone ? formatPhoneBR(lead.phone) : null} />
                    {/* Derivado do DDD, não digitado: todo lead tem telefone, então
                        a cobertura é total. Para uma clínica que anuncia num raio
                        fechado, saber que o lead é de fora muda o atendimento. */}
                    <DetailRow
                      icon={<MapPinIcon />}
                      label="Local"
                      value={formatPhoneLocation(lead.normalized_phone ?? lead.phone)}
                    />
                    <DetailRow icon={<MailIcon />} label="E-mail" value={lead.email} />
                    <DetailRow icon={<AtSignIcon />} label="Instagram" value={lead.instagram_user ? `@${lead.instagram_user.replace(/^@/, "")}` : null} />
                  </dl>
                </FieldGroup>
                <FieldGroup title="Funil">
                  <dl className="grid gap-1">
                    <DetailRow label="Status" value={getLeadStatusLabel(lead.status)} />
                    <DetailRow label="Origem" value={lead.source ? getLeadSourceLabel(lead.source) : null} />
                    <DetailRow label="Cliente recorrente" value={boolLabel(lead.is_recorrente)} />
                    {isPatient ? (
                      <DetailRow
                        icon={<StethoscopeIcon />}
                        label="Cadastro clínico"
                        value="Ver em Pacientes"
                        href="/app/pacientes"
                      />
                    ) : null}
                  </dl>
                </FieldGroup>
                {/* Só existe para lead que chegou por clique em anúncio (CTWA). */}
                {attribution ? (
                  <FieldGroup title="Campanha">
                    <dl className="grid gap-1">
                      <DetailRow
                        icon={<MegaphoneIcon />}
                        label="Campanha"
                        value={attributionCampaignLabel(attribution)}
                      />
                      <DetailRow label="Conjunto" value={attribution.adsetName} />
                      <DetailRow label="Anúncio" value={attribution.adName} />
                      <DetailRow label="Clique em" value={formatDateTime(attribution.messageAt)} />
                    </dl>
                    {!attribution.enriched ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Nomes da campanha ainda sendo buscados no Meta.
                      </p>
                    ) : null}
                  </FieldGroup>
                ) : null}
                <FieldGroup title="Datas">
                  <dl className="grid gap-1">
                    <DetailRow label="Última mensagem" value={formatDateTime(lead.last_message_at)} />
                    <DetailRow label="Qualificado em" value={formatDateTime(lead.qualificado_at)} />
                    <DetailRow label="Compareceu em" value={formatDateTime(lead.compareceu_at)} />
                    <DetailRow label="Tornou-se cliente" value={formatDateTime(lead.cliente_at)} />
                  </dl>
                </FieldGroup>
              </aside>
            </div>
          )}
        </div>

        <div className={cn(
          "flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-muted/20 px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:flex-row sm:items-center sm:justify-end sm:px-6",
          !confirmingDelete && "hidden",
        )}>
          {confirmingDelete ? (
            <>
              <p className="self-center text-xs text-muted-foreground sm:mr-auto">
                Arquivar {lead.name ?? "esta pessoa"}? Conversas e histórico serão preservados.
              </p>
              <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="h-11 sm:h-9">
                Cancelar
              </Button>
              <Button type="button" onClick={handleDelete} disabled={deleting} className="h-11 sm:h-9">
                {deleting ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ArchiveIcon data-icon="inline-start" />}
                Confirmar arquivamento
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function LeadHistoryTimeline({
  state,
  onRetry,
}: {
  state: LeadHistoryState;
  onRetry: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="grid gap-4" role="status" aria-live="polite">
        <span className="sr-only">Carregando histórico do lead.</span>
        {["first", "second"].map((key) => (
          <div key={key} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-3">
            <Skeleton className="mt-1 size-2 rounded-full" />
            <div className="grid gap-2">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar o histórico.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-11 sm:h-9"
          onClick={onRetry}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma mudança de etapa registrada.
      </p>
    );
  }

  return (
    <ol
      className="ms-1 max-h-64 overflow-y-auto overscroll-contain border-s border-border/70 pe-2 [-webkit-overflow-scrolling:touch]"
      aria-label="Mudanças de etapa do lead, da mais recente para a mais antiga"
    >
      {state.items.map((item) => (
        <li key={item.id} className="relative pb-4 ps-4 last:pb-0">
          <span
            className="absolute -start-1 top-1.5 size-2 rounded-full bg-muted-foreground ring-4 ring-background"
            aria-hidden
          />
          <p className="break-words text-sm font-medium leading-snug text-foreground">
            {getLeadHistoryTransitionLabel(item)}
          </p>
          <time
            dateTime={item.occurredAt}
            className="mt-1 block text-xs tabular-nums text-muted-foreground"
          >
            {formatLeadHistoryTimestamp(item.occurredAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function InlineFact({ icon, label, value }: { icon: ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex min-w-32 items-start gap-2">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-3.5" aria-hidden>{icon}</span>
      <p className="grid gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-sm">{value && value !== "-" ? value : "—"}</span>
      </p>
    </div>
  );
}

function DetailRow({ icon, label, value, href }: { icon?: ReactNode; label: string; value: string | null | undefined; href?: string }) {
  const filled = Boolean(value && value !== "-" && value !== "—");
  return (
    <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="mt-0.5 flex size-5 items-center justify-center text-muted-foreground [&_svg]:size-3.5" aria-hidden>
        {icon ?? <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
      </span>
      <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="col-start-2 min-w-0 truncate text-sm">
        {!filled ? (
          "—"
        ) : href ? (
          <Link href={href} className="text-primary underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
