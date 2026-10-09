"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FollowupDialog } from "@/features/followups/components/followup-dialog";
import { followupKindColor, followupKindLabel } from "@/features/followups/lib/followup-kind";
import {
  followupStatusColor,
  followupStatusLabel,
  type FollowupStatus,
} from "@/features/followups/lib/followup-status";
import type { FollowupListItem } from "@/features/followups/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatDateTime } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

export function TicketFollowups({
  ticketId,
  followups,
  editable,
  now,
}: {
  ticketId: string;
  followups: FollowupListItem[];
  editable: boolean;
  /** O relógio da tela (useNow): seguro para hidratação, avança sozinho. */
  now: Date;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FollowupListItem | null>(null);
  const [deleting, setDeleting] = useState<FollowupListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const nowMs = now.getTime();

  async function patchStatus(followup: FollowupListItem, status: FollowupStatus) {
    if (busyId) return;
    setBusyId(followup.id);
    try {
      const response = await fetch(`/api/followups/${followup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        toast.error(result.message ?? "Não foi possível atualizar o retorno.");
        return;
      }
      toast.success(
        status === "concluido" ? "Retorno concluído." : status === "cancelado" ? "Retorno cancelado." : "Retorno reaberto."
      );
      router.refresh();
    } catch {
      toast.error("Não foi possível atualizar o retorno.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Retornos</h3>
        {editable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)} className="h-9">
            <PlusIcon data-icon="inline-start" />
            Novo retorno
          </Button>
        ) : null}
      </div>

      {followups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum retorno agendado.</p>
      ) : (
        <ul className="grid gap-2">
          {followups.map((followup) => {
            const overdue =
              followup.status === "pendente" && new Date(followup.due_at).getTime() < nowMs;
            const pending = followup.status === "pendente";
            const rowBusy = busyId === followup.id;
            return (
              <li
                key={followup.id}
                className={cn(
                  "grid gap-2 rounded-lg border p-3",
                  overdue ? "border-destructive/40 bg-destructive/[0.04]" : "border-border/60"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={getColorStyle(followupKindColor[followup.kind]).badge}>
                    {followupKindLabel[followup.kind]}
                  </Badge>
                  <Badge variant="outline" className={getColorStyle(followupStatusColor[followup.status]).badge}>
                    {followupStatusLabel[followup.status]}
                  </Badge>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs tabular-nums",
                      overdue ? "font-medium text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {overdue ? <TriangleAlertIcon className="size-3.5" aria-hidden /> : <CalendarClockIcon className="size-3.5" aria-hidden />}
                    {formatDateTime(followup.due_at)}
                    {overdue ? " · vencido" : ""}
                  </span>
                </div>

                {followup.notes?.trim() ? (
                  <p className="whitespace-pre-wrap break-words text-sm">{followup.notes.trim()}</p>
                ) : null}

                {editable ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {pending ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => void patchStatus(followup, "concluido")}
                          className="h-8 text-primary"
                        >
                          {rowBusy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                          Concluir
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => void patchStatus(followup, "cancelado")}
                          className="h-8 text-muted-foreground"
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rowBusy}
                        onClick={() => void patchStatus(followup, "pendente")}
                        className="h-8 text-muted-foreground"
                      >
                        {rowBusy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                        Reabrir
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Editar retorno"
                      disabled={rowBusy}
                      onClick={() => setEditing(followup)}
                      className="ms-auto size-8"
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir retorno"
                      disabled={rowBusy}
                      onClick={() => setDeleting(followup)}
                      className="size-8"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Criar e editar: o mesmo diálogo, controlado por estado. */}
      <FollowupDialog ticketId={ticketId} open={creating} onOpenChange={setCreating} />
      <FollowupDialog
        ticketId={ticketId}
        followup={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DeleteFollowupDialog followup={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function DeleteFollowupDialog({
  followup,
  onClose,
}: {
  followup: FollowupListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!followup || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/followups/${followup.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        toast.error(result.message ?? "Não foi possível excluir o retorno.");
        return;
      }
      toast.success("Retorno excluído.");
      onClose();
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir o retorno.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={followup !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {followup ? (
        <ModalShell
          size="compact"
          title="Excluir retorno?"
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
            {followupKindLabel[followup.kind]} de {formatDateTime(followup.due_at)}.
          </p>
        </ModalShell>
      ) : null}
    </Dialog>
  );
}
