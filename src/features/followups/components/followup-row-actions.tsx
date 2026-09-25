"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CalendarClockIcon,
  CheckIcon,
  Clock3Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  UserRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
} from "@/components/ui/dialog";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Followup } from "@/features/followups/types";
import { formatDateTimeLocalInput } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

export function FollowupRowActions({ followup }: { followup: Followup }) {
  const router = useRouter();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(() =>
    formatDateTimeLocalInput(followup.scheduled_for)
  );
  const [message, setMessage] = useState(followup.message ?? "");

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setPending(true);
    try {
      const res = await fetch(`/api/followups/${followup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível atualizar.");
        return false;
      }
      toast.success(result.message ?? successMessage);
      router.refresh();
      return true;
    } catch {
      toast.error("Não foi possível atualizar.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function handleReschedule(event: FormEvent) {
    event.preventDefault();
    const ok = await patch({ scheduled_for: scheduledFor, message }, "Follow-up reagendado.");
    if (ok) setRescheduleOpen(false);
  }

  function openReschedule() {
    setScheduledFor(formatDateTimeLocalInput(followup.scheduled_for));
    setMessage(followup.message ?? "");
    setRescheduleOpen(true);
  }

  function applyQuickDate(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(9, 0, 0, 0);
    setScheduledFor(formatDateTimeLocalInput(date));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11 sm:size-8")}
          aria-label="Ações do follow-up"
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={openReschedule}>
            <CalendarClockIcon data-icon="inline-start" />
            Reagendar
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            variant="destructive"
            onClick={() => patch({ status: "cancelado" }, "Follow-up cancelado.")}
          >
            <XCircleIcon data-icon="inline-start" />
            Cancelar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <ModalShell
          size="medium"
          title="Reagendar follow-up"
          description="Defina quando este contato deve voltar para a fila."
          headerExtra={<CalendarClockIcon className="size-5 text-muted-foreground" aria-hidden />}
          onSubmit={handleReschedule}
          footer={
            <ModalFooterActions>
              <Button type="button" variant="outline" onClick={() => setRescheduleOpen(false)} disabled={pending} className="h-11 sm:h-9">Cancelar</Button>
              <Button type="submit" disabled={pending || !scheduledFor} className="h-11 sm:h-9">
                {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                Salvar reagendamento
              </Button>
            </ModalFooterActions>
          }
        >
          <div className="grid gap-6">
            <div className="flex items-center gap-3 border-b border-border/70 pb-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><UserRoundIcon className="size-4" aria-hidden /></span>
              <div className="min-w-0"><p className="truncate text-sm font-medium">{followup.leads?.name ?? "Lead sem nome"}</p><p className="truncate text-xs text-muted-foreground">{formatPhone(followup.leads?.phone ?? null)}</p></div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`reschedule-${followup.id}`}>Nova data e horário</Label>
              <Input
                id={`reschedule-${followup.id}`}
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => applyQuickDate(1)}><Clock3Icon data-icon="inline-start" />Amanhã, 09:00</Button>
                <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => applyQuickDate(3)}>Em 3 dias</Button>
                <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => applyQuickDate(7)}>Em 7 dias</Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={`reschedule-msg-${followup.id}`}>Contexto do próximo contato</Label>
              <Textarea
                id={`reschedule-msg-${followup.id}`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                placeholder="Ex.: Retomar orçamento e confirmar disponibilidade."
                className="min-h-28 resize-y"
              />
            </div>
          </div>
        </ModalShell>
      </Dialog>
    </>
  );
}
