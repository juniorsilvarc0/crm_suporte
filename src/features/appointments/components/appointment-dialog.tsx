"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, Loader2Icon, PlusIcon, TicketIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeFields } from "@/features/appointments/components/date-time-fields";
import { appointmentKindOptions } from "@/features/appointments/lib/appointment-kind";
import { appointmentStatusOptions } from "@/features/appointments/lib/appointment-status";
import type { AppointmentListItem } from "@/features/appointments/types";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import {
  defaultDateTimeLocalForDateKey,
  formatDateTimeLocalInput,
  getTodayAppDateKey,
} from "@/lib/formatters/date";

const DURATION_OPTIONS = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
  { value: "180", label: "3 horas" },
  { value: "240", label: "4 horas" },
  { value: "480", label: "Dia inteiro" },
];

type TeamMember = { id: string; name: string };

type MutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  appointment?: { id?: string };
};

/**
 * Quem agenda a partir de um ticket: o compromisso novo nasce ligado ao ticket
 * e ao contato dele, com a empresa do ticket já escolhida (trocável).
 */
export type AppointmentTicketContext = {
  ticket: { id: string; number: number; title: string };
  customer: { id: string; name: string } | null;
  contactId: string;
};

type AppointmentDialogProps = {
  /** Presente = edição. Ausente = novo agendamento. */
  appointment?: AppointmentListItem | null;
  /** Só na criação: o vínculo vem do ticket, não de um seletor. */
  context?: AppointmentTicketContext | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Cadastro e edição de um compromisso — o mesmo formulário serve aos dois. Os
 * campos são controlados (os primitivos DateTimeFields/FormSelect/CustomerPicker
 * não entram no register do react-hook-form), e o schema da rota (zod) é o
 * validador final: erro de campo volta no `errors` e é pintado aqui.
 *
 * O vínculo com ticket/contato não tem seletor: nasce do `context` quando o
 * compromisso é criado a partir de um ticket. Aqui liga-se à EMPRESA e ao TÉCNICO.
 */
export function AppointmentDialog({
  appointment = null,
  context = null,
  open: openProp,
  onOpenChange,
}: AppointmentDialogProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;

  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  function setOpen(next: boolean) {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  }

  return (
    <>
      {controlled ? null : (
        <Button type="button" onClick={() => setOpen(true)} className="h-11 sm:h-9">
          <PlusIcon data-icon="inline-start" />
          Novo agendamento
        </Button>
      )}

      <AppointmentForm
        key={`${appointment?.id ?? "new"}:${session}`}
        appointment={appointment}
        context={appointment ? null : context}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function AppointmentForm({
  appointment,
  context,
  open,
  onOpenChange,
}: {
  appointment: AppointmentListItem | null;
  context: AppointmentTicketContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;

  const [kind, setKind] = useState<string>(appointment?.kind ?? "visita_tecnica");
  const [title, setTitle] = useState(appointment?.title ?? "");
  const [when, setWhen] = useState(
    appointment
      ? formatDateTimeLocalInput(appointment.scheduled_at)
      : defaultDateTimeLocalForDateKey(getTodayAppDateKey())
  );
  const [duration, setDuration] = useState(appointment?.duration_min ? String(appointment.duration_min) : "60");
  const [location, setLocation] = useState(appointment?.location ?? "");
  const [status, setStatus] = useState<string>(appointment?.status ?? "agendado");
  const [assigneeId, setAssigneeId] = useState(appointment?.assignee_id ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    appointment?.customer
      ? { id: appointment.customer.id, name: customerDisplayName(appointment.customer) }
      : (context?.customer ?? null)
  );
  // Só leitura: o ticket não se troca aqui (a edição não manda ticket_id).
  const linkedTicket = appointment?.ticket ?? context?.ticket ?? null;
  const [pickingCustomer, setPickingCustomer] = useState(false);

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  // A equipe (id + nome) para o select de técnico: client não lê app_users direto.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch("/api/app-users")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { users?: TeamMember[] } | null) => {
        if (active && data?.users) setTeam(data.users);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;

    const nextErrors: Record<string, string> = {};
    if (!kind) nextErrors.kind = "Escolha o tipo.";
    if (!when || when.length < 16) nextErrors.scheduled_at = "Informe a data e a hora.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const body: Record<string, unknown> = {
      kind,
      scheduled_at: when,
      title: title.trim() || null,
      duration_min: duration ? Number(duration) : undefined,
      location: location.trim() || null,
      status,
      notes: notes.trim() || null,
      customer_id: customer?.id ?? undefined,
      assignee_id: assigneeId || undefined,
      ticket_id: context?.ticket.id,
      contact_id: context?.contactId,
    };

    submitting.current = true;
    setPending(true);
    setErrors({});

    const failure = appointment
      ? "Não foi possível salvar o agendamento."
      : "Não foi possível criar o agendamento.";

    try {
      const response = await fetch(appointment ? `/api/appointments/${appointment.id}` : "/api/appointments", {
        method: appointment ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as MutationResponse;

      if (!response.ok || !result.ok) {
        const fieldErrors: Record<string, string> = {};
        for (const [field, messages] of Object.entries(result.errors ?? {})) {
          const message = messages?.[0];
          if (message) fieldErrors[field] = message;
        }
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else toast.error(result.message ?? failure);
        return;
      }

      toast.success(appointment ? "Agendamento atualizado." : "Agendamento criado.");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(failure);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const teamOptions = team.map((member) => ({ value: member.id, label: member.name }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="medium"
        title={appointment ? "Editar agendamento" : "Novo agendamento"}
        onSubmit={submit}
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
              {appointment ? "Salvar alterações" : "Criar agendamento"}
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          {linkedTicket ? (
            <p className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <TicketIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-medium tabular-nums">{formatProtocol(linkedTicket.number)}</span>
              <span className="truncate text-muted-foreground">{linkedTicket.title}</span>
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor={id("kind")}>
              <span>
                Tipo<span className="text-primary" aria-hidden> *</span>
              </span>
            </FieldLabel>
            <FormSelect
              id={id("kind")}
              value={kind}
              onValueChange={setKind}
              options={appointmentKindOptions}
              aria-invalid={errors.kind ? true : undefined}
            />
            {errors.kind ? <FieldError className="text-xs">{errors.kind}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor={id("title")}>Título</FieldLabel>
            <Input
              id={id("title")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="Ex.: Implantação do módulo fiscal"
              className="h-11 sm:h-10"
            />
            {errors.title ? <FieldError className="text-xs">{errors.title}</FieldError> : null}
          </Field>

          <DateTimeFields value={when} onChange={setWhen} error={errors.scheduled_at} idPrefix={id("when")}>
            <div className="grid min-w-0 gap-1.5">
              <FieldLabel htmlFor={id("duration")}>Duração</FieldLabel>
              <FormSelect
                id={id("duration")}
                value={duration}
                onValueChange={setDuration}
                options={DURATION_OPTIONS}
                emptyLabel="Sem duração"
              />
            </div>
          </DateTimeFields>

          <Field>
            <FieldLabel htmlFor={id("location")}>Local</FieldLabel>
            <Input
              id={id("location")}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={300}
              placeholder="Endereço, sala ou link de acesso remoto"
              className="h-11 sm:h-10"
            />
            {errors.location ? <FieldError className="text-xs">{errors.location}</FieldError> : null}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={id("status")}>Situação</FieldLabel>
              <FormSelect
                id={id("status")}
                value={status}
                onValueChange={setStatus}
                options={appointmentStatusOptions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={id("assignee")}>Técnico</FieldLabel>
              <FormSelect
                id={id("assignee")}
                value={assigneeId}
                onValueChange={setAssigneeId}
                options={teamOptions}
                emptyLabel="Sem técnico definido"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Empresa</FieldLabel>
            {customer && !pickingCustomer ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                  <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{customer.name}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPickingCustomer(true)} className="h-8">
                  Trocar
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                <CustomerPicker
                  appearance="app"
                  currentCustomerId={customer?.id ?? null}
                  currentCustomerName={customer?.name ?? null}
                  busyId={null}
                  onPick={(picked: CustomerSummary) => {
                    setCustomer({ id: picked.id, name: customerDisplayName(picked) });
                    setPickingCustomer(false);
                  }}
                />
                {customer ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPickingCustomer(false)}
                    className="h-8 justify-start text-muted-foreground"
                  >
                    <XIcon data-icon="inline-start" />
                    Manter {customer.name}
                  </Button>
                ) : null}
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={id("notes")}>Observações</FieldLabel>
            <Textarea
              id={id("notes")}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={5000}
            />
            {errors.notes ? <FieldError className="text-xs">{errors.notes}</FieldError> : null}
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
