"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CalendarPlusIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ClienteCombobox,
  type ClienteSelection,
} from "@/features/leads/components/cliente-combobox";

export function NovoFollowupDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLeadId(null);
      setScheduledFor("");
      setMessage("");
      setErrors({});
      setPending(false);
    }
  }

  function handleCliente(selection: ClienteSelection) {
    setLeadId(selection?.kind === "existing" ? selection.id : null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const res = await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, scheduled_for: scheduledFor, message }),
      });
      const result = (await res.json()) as {
        ok: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!res.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível criar o follow-up.");
        return;
      }

      toast.success(result.message ?? "Follow-up criado.");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o follow-up.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => handleOpenChange(true)} className="h-11 sm:h-9">
        <CalendarPlusIcon data-icon="inline-start" />
        Novo follow-up
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[97vw] max-w-[97vw] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Novo follow-up</DialogTitle>
            <DialogDescription>
              Agende um lembrete de recuperação para um lead.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <ClienteCombobox allowCreate={false} onChange={handleCliente} />
              {errors.lead_id ? (
                <p className="text-xs text-destructive">{errors.lead_id[0]}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="followup-scheduled">Agendar para</Label>
              <Input
                id="followup-scheduled"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
              {errors.scheduled_for ? (
                <p className="text-xs text-destructive">{errors.scheduled_for[0]}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="followup-message">Mensagem (opcional)</Label>
              <Textarea
                id="followup-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ex.: Passar pra saber se conseguimos agendar a visita."
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : null}
                Criar follow-up
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
