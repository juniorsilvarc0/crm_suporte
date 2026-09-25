"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3Icon, CopyIcon, EyeIcon, MoreHorizontalIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppointmentDetailsDialog } from "@/features/appointments/components/appointment-details-dialog";
import { MarkAttendedButton } from "@/features/appointments/components/mark-attended-button";
import { appointmentStatusLabel } from "@/features/appointments/schemas/status";
import type { Appointment } from "@/features/appointments/types";
import { formatDateTime, formatTime } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import type { AppointmentStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import {
  appointmentDotClass,
  appointmentStatusClass,
  canMarkAppointmentAttended,
  extractNoteLine,
  formatTipoEnsaio,
  getEndTime,
} from "@/features/appointments/components/agenda-utils";

export function AppointmentCard({ appointment }: { appointment: Appointment }) {
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canMarkAttended = canMarkAppointmentAttended(appointment.status);
  const endTime = getEndTime(appointment);
  const packageLine = extractNoteLine(appointment.notes, "Serviço/valor");

  async function copyPhone() {
    const phone = appointment.leads?.phone;
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Não foi possível copiar o telefone.");
    }
  }

  function openChat() {
    const phone = (appointment.leads?.phone ?? "").replace(/\D/g, "");
    router.push(phone ? `/app/chat?lead=${appointment.lead_id ?? ""}&phone=${phone}` : "/app/chat");
  }

  return (
    <article className="relative grid min-w-0 gap-3 overflow-hidden rounded-xl border border-border/70 bg-muted/30 p-3.5 transition-colors hover:border-border hover:bg-muted/20">
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          appointmentDotClass(appointment.status)
        )}
        aria-hidden
      />
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="size-11 bg-background/90 text-muted-foreground sm:size-8" aria-label="Ações do agendamento" />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => setDetailsOpen(true)}>
              <EyeIcon />
              Ver detalhes
            </DropdownMenuItem>
            {appointment.leads?.phone ? (
              <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={copyPhone}>
                <CopyIcon />
                Copiar telefone
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={openChat}>
              <WhatsAppIcon className="size-4" brand />
              Abrir conversa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AppointmentDetailsDialog
        appointment={appointment}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        triggerClassName="grid min-w-0 gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <time
            dateTime={appointment.scheduled_at}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-semibold tabular-nums"
          >
            <Clock3Icon className="size-3 text-muted-foreground" aria-hidden />
            {formatTime(appointment.scheduled_at)}
            {endTime ? `–${endTime}` : null}
          </time>
          <span className="mr-8"><StatusPill status={appointment.status} /></span>
        </span>

        <span className="block min-w-0">
          <LeadIdentity
            name={appointment.leads?.name ?? null}
            phone={appointment.leads?.phone ?? null}
          />
          <span className="mt-1.5 block truncate text-sm font-medium">
            {formatTipoEnsaio(appointment.tipo_ensaio)}
          </span>
          <time
            dateTime={appointment.scheduled_at}
            className="mt-0.5 block text-xs text-muted-foreground"
          >
            {formatDateTime(appointment.scheduled_at)}
          </time>
          {packageLine ? (
            <span className="mt-2 block line-clamp-2 text-xs text-muted-foreground">
              {packageLine}
            </span>
          ) : null}
        </span>
      </AppointmentDetailsDialog>

      <div className="flex flex-wrap items-center gap-2">
        {appointment.google_event_id ? (
          <Badge variant="outline" className="rounded-full text-[11px]">
            Google Agenda
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="rounded-full border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300"
          >
            Manual no CRM
          </Badge>
        )}
        {appointment.duration_min ? (
          <span className="text-xs text-muted-foreground">{appointment.duration_min} min</span>
        ) : null}
      </div>

      {canMarkAttended ? <MarkAttendedButton appointmentId={appointment.id} fullWidth /> : null}
    </article>
  );
}

function LeadIdentity({ name, phone }: { name: string | null; phone: string | null }) {
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <UserRoundIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm font-medium">{name ?? "Sem nome"}</span>
      </span>
      <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
        {formatPhone(phone)}
      </span>
    </span>
  );
}

export function StatusPill({ status }: { status: AppointmentStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full border px-2 py-0 text-[11px] font-medium",
        appointmentStatusClass(status)
      )}
    >
      <span className={cn("size-1.5 rounded-full", appointmentDotClass(status))} aria-hidden />
      {appointmentStatusLabel[status]}
    </Badge>
  );
}
