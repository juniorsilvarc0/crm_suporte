"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  AtSignIcon,
  BanknoteIcon,
  BuildingIcon,
  CalendarClockIcon,
  Clock3Icon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  MonitorSmartphoneIcon,
  NotebookPenIcon,
  PencilIcon,
  PhoneIcon,
  SaveIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Textarea } from "@/components/ui/textarea";
import { AppointmentEditPanel } from "@/features/appointments/components/appointment-edit-panel";
import { MarkAttendedButton } from "@/features/appointments/components/mark-attended-button";
import { canMarkAppointmentAttended } from "@/features/appointments/components/agenda-utils";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import {
  modalityLabel,
  type ClinicUnit,
} from "@/features/appointments/lib/agenda-config";
import { appointmentStatusLabel } from "@/features/appointments/schemas/status";
import { SaleDialog } from "@/features/financeiro/components/sale-dialog";
import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import { LeadEditPanel } from "@/features/leads/components/lead-edit-panel";
import { getTipoEnsaioLabel } from "@/features/leads/schemas/status";
import { getLeadSourceLabel, getLeadStatusLabel } from "@/features/leads/schemas/status";
import type { Appointment } from "@/features/appointments/types";
import {
  formatDateTime,
  formatLongDate,
  formatTime,
  toAppDate,
} from "@/lib/formatters/date";
import { formatPhoneLocation } from "@/lib/formatters/location";
import { formatPhone } from "@/lib/formatters/phone";
import type { AppointmentStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

/**
 * O corpo do modal tem quatro modos. Um modal só — quem já está dentro de um
 * troca o conteúdo, nunca abre outro por cima (UI.md §9).
 */
type Mode = "details" | "edit" | "lead" | "sale";

export function AppointmentDetailsDialog({
  appointment,
  children,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  appointment: Appointment;
  children?: ReactNode;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { startConversation, checkingPhone } = useStartConversation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [leadNotes, setLeadNotes] = useState(appointment.leads?.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const open = controlledOpen ?? internalOpen;
  // O catálogo de procedimentos é buscado SOB DEMANDA, ao abrir a venda.
  //
  // A alternativa era arrastá-lo por prop da página da agenda até aqui — 6
  // arquivos e 4 níveis, em 3 ramos de visualização — e carregá-lo em toda
  // renderização da agenda por causa de uma ação ocasional. Este mesmo modal já
  // busca `/api/app-users` assim.
  const [procedures, setProcedures] = useState<Procedure[] | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);

  /**
   * Nome da unidade, resolvido sob demanda.
   *
   * ⚠️ **Não é `clinic_units(name)` embutido na query da agenda.** A embutida
   * depende da FK existir; se o código subir antes da migration, a listagem
   * inteira quebra em vez de faltar um rótulo. Aqui, no pior caso, a linha da
   * unidade simplesmente não aparece.
   */
  useEffect(() => {
    const unitId = appointment.unit_id;
    if (!open || !unitId) return;

    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/agenda/config");
        const data = (await res.json()) as { ok?: boolean; units?: ClinicUnit[] };
        if (!alive || !res.ok || !data.ok) return;
        setUnitName(data.units?.find((unit) => unit.id === unitId)?.name ?? null);
      } catch {
        /* fica sem o rótulo da unidade */
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, appointment.unit_id]);
  // Venda precisa de um lead: agendamento sem cliente não tem a quem cobrar.
  const canSell = Boolean(appointment.lead_id && appointment.leads);
  const canMarkAttended = canMarkAppointmentAttended(appointment.status);

  async function openSale() {
    setMode("sale");
    if (procedures) return;
    try {
      const res = await fetch("/api/procedures");
      const data = (await res.json()) as { ok: boolean; procedures?: Procedure[] };
      setProcedures(res.ok && data.ok ? data.procedures ?? [] : []);
    } catch {
      setProcedures([]);
    }
  }

  function openChat() {
    const phone = (appointment.leads?.phone ?? "").replace(/\D/g, "");
    if (phone) void startConversation(phone, appointment.leads?.name ?? undefined);
  }

  const endTime = getEndTime(appointment);
  const packageLine = extractNoteLine(appointment.notes, "Serviço/valor");

  // Reset dirigido por evento (fechar o dialog), em vez de useEffect: limpa a
  // confirmação de exclusão para que a próxima abertura comece do zero.
  function handleOpenChange(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setConfirmingDelete(false);
      setPendingDelete(false);
      // Volta para os detalhes: reabrir no formulário de edição surpreenderia
      // quem só queria conferir o agendamento.
      setMode("details");
    }
  }

  async function saveLeadNotes() {
    if (!appointment.lead_id) return;
    setSavingNotes(true);
    try {
      const response = await fetch(`/api/leads/${appointment.lead_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: leadNotes }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar as anotações.");
        return;
      }
      toast.success("Anotações do lead atualizadas.");
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar as anotações.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setPendingDelete(true);

    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { ok: boolean; message?: string };

      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível excluir o agendamento.");
        return;
      }

      toast.success(result.message ?? "Agendamento excluído.");
      handleOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir o agendamento.");
    } finally {
      setPendingDelete(false);
    }
  }

  return (
    <>
      {children ? (
        <button
          type="button"
          onClick={() => handleOpenChange(true)}
          className={cn("block text-left", triggerClassName)}
        >
          {children}
        </button>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <ModalShell
          className="sm:max-w-6xl"
          title={
            mode === "lead"
              ? "Editar lead"
              : appointment.leads?.name ?? "Agendamento sem cliente"
          }
          description={
            mode === "lead"
              ? appointment.leads?.name ?? "Contato sem nome"
              : `${formatLongDate(appointment.scheduled_at)} às ${formatTime(appointment.scheduled_at)}${endTime ? `-${endTime}` : ""}`
          }
          headerExtra={mode === "lead" ? null : <StatusBadge status={appointment.status} />}
          bodyClassName={
            mode === "lead"
              ? "overflow-hidden p-0"
              : "overscroll-contain [-webkit-overflow-scrolling:touch]"
          }
          footer={
            // Os três painéis têm ações próprias. Aqui fica só o rodapé do
            // agendamento em modo de leitura.
            mode === "details" ? (
              <ModalFooterActions>
                <Button type="button" variant="destructive" onClick={handleDelete} disabled={pendingDelete} className="h-11 sm:h-9">
                  {pendingDelete ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
                  {confirmingDelete ? "Confirmar exclusão" : "Excluir"}
                </Button>
                {canSell ? (
                  <Button type="button" variant="outline" onClick={() => void openSale()} className="h-11 sm:h-9">
                    <BanknoteIcon data-icon="inline-start" />
                    Registrar venda
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => setMode("edit")} className="h-11 sm:h-9">
                  <PencilIcon data-icon="inline-start" />
                  Editar agendamento
                </Button>
                {canMarkAttended ? (
                  <MarkAttendedButton
                    appointmentId={appointment.id}
                    fullWidth
                    variant="default"
                    className="sm:h-9 sm:w-auto"
                  />
                ) : null}
              </ModalFooterActions>
            ) : null
          }
        >
          {mode === "lead" && appointment.leads ? (
            <LeadEditPanel
              lead={appointment.leads}
              cancelLabel="Voltar ao agendamento"
              onSaved={({ notes }) => {
                setLeadNotes(notes ?? "");
                setMode("details");
              }}
              onCancel={() => setMode("details")}
            />
          ) : mode === "edit" ? (
            // O formulário NO LUGAR do detalhe, não por cima dele.
            <AppointmentEditPanel
              appointment={appointment}
              onSaved={() => setMode("details")}
              onCancel={() => setMode("details")}
            />
          ) : mode === "sale" ? (
            <div className="mx-auto w-full max-w-2xl">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode("details")}
                className="mb-4 -ms-2"
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Voltar ao agendamento
              </Button>
              {/* O card de destino no funil é resolvido no servidor a partir do
                  lead (POST /api/financeiro/sales) — a agenda não carrega deals. */}
              {procedures === null ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  Carregando procedimentos…
                </div>
              ) : (
                <SaleDialog
                  variant="panel"
                  lead={appointment.leads ?? null}
                  procedures={procedures}
                  onOpenChange={(next) => {
                    if (!next) setMode("details");
                  }}
                />
              )}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
              <section className="grid content-start gap-5 lg:border-r lg:border-border/70 lg:pr-7">
                {appointment.leads ? (
                  <section className="grid min-w-0 gap-3 border-b border-border/70 pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cliente
                      </p>
                      <p className="mt-1 truncate text-base font-semibold">
                        {appointment.leads.name ?? "Sem nome"}
                      </p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                        <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {formatPhone(appointment.leads.phone)}
                        </span>
                      </p>
                    </div>
                    <div
                      className={cn(
                        "grid min-w-0 gap-2 sm:flex sm:items-center",
                        appointment.leads.phone ? "grid-cols-2" : "grid-cols-1"
                      )}
                      role="group"
                      aria-label="Ações do lead"
                    >
                      {appointment.leads.phone ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={openChat}
                          disabled={Boolean(checkingPhone)}
                          className="h-11 min-w-0 sm:h-9"
                          aria-label="Abrir conversa no WhatsApp"
                        >
                          {checkingPhone ? (
                            <Loader2Icon className="animate-spin" data-icon="inline-start" />
                          ) : (
                            <WhatsAppIcon brand />
                          )}
                          WhatsApp
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setMode("lead")}
                        className="h-11 min-w-0 sm:h-9"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Editar lead
                      </Button>
                    </div>
                  </section>
                ) : (
                  <DetailRow icon={UserRoundIcon} label="Cliente" value="Sem nome" />
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <DetailRow
                    icon={CalendarClockIcon}
                    label="Data e horário"
                    value={formatDateTime(appointment.scheduled_at)}
                  />
                  <DetailRow
                    icon={Clock3Icon}
                    label="Duração"
                    value={`${appointment.duration_min ?? 60} min`}
                  />
                  {/*
                    Modalidade lê a coluna direto, sem join: agendamento antigo e
                    importação do Google vêm com `null`, e "Não informado" é a
                    verdade nesse caso — inventar "Presencial" seria o frontend
                    decidindo um dado que ninguém gravou (AGENTS §0.2.5).
                  */}
                  <DetailRow
                    icon={appointment.modality === "teleconsulta" ? MonitorSmartphoneIcon : MapPinIcon}
                    label="Modalidade"
                    value={
                      appointment.modality
                        ? modalityLabel[appointment.modality]
                        : "Não informada"
                    }
                  />
                  {unitName ? (
                    <DetailRow icon={BuildingIcon} label="Unidade" value={unitName} />
                  ) : null}
                </div>

                {appointment.leads ? (
                  <section className="border-t border-border/70 pt-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informações do lead</p>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <DetailRow icon={MailIcon} label="E-mail" value={appointment.leads.email ?? "Não informado"} />
                      <DetailRow icon={AtSignIcon} label="Instagram" value={appointment.leads.instagram_user ? `@${appointment.leads.instagram_user.replace(/^@/, "")}` : "Não informado"} />
                      <DetailRow icon={UserRoundIcon} label="Status do lead" value={getLeadStatusLabel(appointment.leads.status)} />
                      <DetailRow icon={NotebookPenIcon} label="Interesse" value={appointment.leads.interesse ?? "Não informado"} />
                    </div>
                  </section>
                ) : null}

                {appointment.notes ? (
                  <div className="border-t border-border/70 pt-5">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Observações</p>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{appointment.notes}</p>
                  </div>
                ) : null}

                {appointment.google_event_id ? (
                  <Alert><AlertTitle>Evento vindo do Google Agenda</AlertTitle><AlertDescription>A exclusão abaixo remove o registro do CRM. Se precisar liberar o horário no Google Agenda, remova o evento lá também.</AlertDescription></Alert>
                ) : null}
              </section>

              <aside className="grid content-start gap-5">
                <div><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agendamento</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full">
                    {formatTipoEnsaio(appointment.tipo_ensaio)}
                  </Badge>
                  {appointment.google_event_id ? (
                    <Badge variant="outline" className="rounded-full">
                      Google Agenda
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    >
                      Manual no CRM
                    </Badge>
                  )}
                </div>

                {packageLine ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Serviço/valor:</span>{" "}
                    {packageLine}
                  </p>
                ) : null}
                </div>
                <div className="border-t border-border/70 pt-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Origem</p><p className="text-sm">{appointment.google_event_id ? "Google Agenda" : "Cadastro manual no CRM"}</p></div>
                {appointment.leads ? (
                  <div className="border-t border-border/70 pt-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead</p>
                    <dl className="grid gap-3 text-sm">
                      <div><dt className="text-xs text-muted-foreground">Origem</dt><dd className="mt-0.5 font-medium">{appointment.leads.source ? getLeadSourceLabel(appointment.leads.source) : "Não informada"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Local</dt><dd className="mt-0.5 font-medium">{formatPhoneLocation(appointment.leads.phone) ?? "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Serviço</dt><dd className="mt-0.5 font-medium">{appointment.leads.tipo_ensaio ? getTipoEnsaioLabel(appointment.leads.tipo_ensaio) : "—"}</dd></div>
                    </dl>
                  </div>
                ) : null}
                {appointment.lead_id ? (
                  <div className="border-t border-border/70 pt-5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anotações do lead</p>
                      <Button type="button" variant="ghost" size="sm" onClick={saveLeadNotes} disabled={savingNotes} className="h-11 sm:h-8">
                        {savingNotes ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                        Salvar
                      </Button>
                    </div>
                    <Textarea
                      value={leadNotes}
                      onChange={(event) => setLeadNotes(event.target.value)}
                      placeholder="Preferências, restrições e próximos passos..."
                      className="min-h-32 resize-y"
                      aria-label="Anotações do lead"
                    />
                  </div>
                ) : null}
              </aside>
            </div>
          )}
        </ModalShell>
      </Dialog>
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRoundIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
      <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full border px-2 py-0 text-[11px] font-medium",
        statusClass(status)
      )}
    >
      {appointmentStatusLabel[status]}
    </Badge>
  );
}

function statusClass(status: AppointmentStatus) {
  if (status === "compareceu") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "confirmado" || status === "agendado") {
    return "border-primary/30 bg-primary/10 text-primary";
  }
  if (status === "cancelado" || status === "faltou") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted text-foreground";
}

function getEndTime(appointment: Appointment) {
  const start = toAppDate(appointment.scheduled_at);
  if (!start || !appointment.duration_min) return "";

  const end = new Date(start.getTime() + appointment.duration_min * 60_000);
  return formatTime(end.toISOString());
}

function extractNoteLine(notes: string | null, label: string) {
  if (!notes) return "";

  const prefix = `${label}:`;
  const line = notes
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));

  return line ? line.slice(prefix.length).trim() : "";
}

function formatTipoEnsaio(value: string | null) {
  return value ? getTipoEnsaioLabel(value) : "Serviço a definir";
}
