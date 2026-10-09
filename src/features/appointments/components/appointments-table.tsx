"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { appointmentKindColor, appointmentKindLabel } from "@/features/appointments/lib/appointment-kind";
import {
  appointmentStatusColor,
  appointmentStatusLabel,
} from "@/features/appointments/lib/appointment-status";
import type { AppointmentListItem } from "@/features/appointments/types";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { formatDateTime } from "@/lib/formatters/date";

export function AppointmentsTable({ appointments }: { appointments: AppointmentListItem[] }) {
  const [editing, setEditing] = useState<AppointmentListItem | null>(null);
  const [deleting, setDeleting] = useState<AppointmentListItem | null>(null);

  return (
    // A contagem e o "Novo agendamento" moram na faixa da Agenda (AgendaToolbar).
    <div className="grid gap-3">
      {appointments.length === 0 ? (
        <EmptyState>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Nenhum agendamento neste mês</p>
            <p>Agende uma visita técnica, treinamento, implantação ou acesso remoto.</p>
          </div>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Assunto</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appointment) => {
                const empresa = appointment.customer
                  ? customerDisplayName(appointment.customer)
                  : (appointment.contact?.name ?? null);
                return (
                  <TableRow key={appointment.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(appointment.scheduled_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getColorStyle(appointmentKindColor[appointment.kind]).badge}>
                        {appointmentKindLabel[appointment.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-56">
                      <span className="block max-w-56 truncate">
                        {appointment.title?.trim() || <span className="text-muted-foreground">—</span>}
                      </span>
                      {appointment.ticket ? (
                        <Link
                          href={`/app/tickets/${appointment.ticket.number}`}
                          className="rounded-sm text-xs font-medium tabular-nums text-primary outline-none underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {formatProtocol(appointment.ticket.number)}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {empresa || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-32 truncate">
                      {appointment.assignee?.name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getColorStyle(appointmentStatusColor[appointment.status]).badge}
                      >
                        {appointmentStatusLabel[appointment.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Editar agendamento"
                          onClick={() => setEditing(appointment)}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir agendamento"
                          onClick={() => setDeleting(appointment)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Editar: o mesmo dialog, controlado por estado. */}
      <AppointmentDialog
        appointment={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />

      <DeleteAppointmentDialog appointment={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function DeleteAppointmentDialog({
  appointment,
  onClose,
}: {
  appointment: AppointmentListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!appointment || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        toast.error(result.message ?? "Não foi possível excluir o agendamento.");
        return;
      }
      toast.success("Agendamento excluído.");
      onClose();
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir o agendamento.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={appointment !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {appointment ? (
        <ModalShell
          size="compact"
          title="Excluir agendamento?"
          description="Esta ação não pode ser desfeita."
          footer={
            <ModalFooterActions>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 sm:h-9">
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirm()}
                disabled={pending}
                className="h-11 sm:h-9"
              >
                {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Excluir
              </Button>
            </ModalFooterActions>
          }
        >
          <p className="text-sm text-muted-foreground">
            {appointmentKindLabel[appointment.kind]}
            {appointment.title?.trim() ? ` — ${appointment.title.trim()}` : ""} em{" "}
            {formatDateTime(appointment.scheduled_at)}.
          </p>
        </ModalShell>
      ) : null}
    </Dialog>
  );
}
