"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOffIcon, Clock3Icon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  blockLabel,
  describeAgendaBlockPeriod,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";
import { getTodayAppDateKey } from "@/lib/formatters/date";

type TeamMember = { id: string; name: string };

type MutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

/**
 * Bloqueios da agenda (UI.md §5.17): cadastrar um intervalo em que a agenda
 * não deve receber compromisso — de um técnico ou de todos — e excluir. Sem
 * edição: mudar é excluir e cadastrar de novo (nada aponta para um bloqueio).
 *
 * A lista é a dos bloqueios daqui em diante, buscada ao abrir: a página só tem
 * os do período em tela.
 */
export function AgendaBlocksDialog() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setSession((current) => current + 1);
          setOpen(true);
        }}
        aria-label="Bloqueios da agenda"
        className="h-11 min-w-11 shrink-0 text-muted-foreground hover:text-foreground sm:h-9 sm:min-w-0"
      >
        <CalendarOffIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Bloqueios</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Remonta a cada abertura: formulário limpo e lista fresca. */}
        {open ? <AgendaBlocksPanel key={session} /> : null}
      </Dialog>
    </>
  );
}

function AgendaBlocksPanel() {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const today = getTodayAppDateKey();

  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [fromTime, setFromTime] = useState("12:00");
  const [toTime, setToTime] = useState("13:00");
  const [reason, setReason] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const [team, setTeam] = useState<TeamMember[]>([]);
  // `null` = carregando; `false` = falhou.
  const [blocks, setBlocks] = useState<AgendaBlock[] | null | false>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    let active = true;
    void fetch(`/api/agenda-blocks?from=${encodeURIComponent(new Date().toISOString())}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { blocks?: AgendaBlock[] } | null) => {
        if (active) setBlocks(data?.blocks ?? false);
      })
      .catch(() => {
        if (active) setBlocks(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;

    const body = allDay
      ? { all_day: true, start_date: startDate, end_date: endDate, reason, assignee_id: assigneeId }
      : {
          all_day: false,
          starts_at: `${startDate}T${fromTime}`,
          ends_at: `${startDate}T${toTime}`,
          reason,
          assignee_id: assigneeId,
        };

    submitting.current = true;
    setPending(true);
    setErrors({});
    try {
      const response = await fetch("/api/agenda-blocks", {
        method: "POST",
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
        else toast.error(result.message ?? "Não foi possível salvar o bloqueio.");
        return;
      }
      toast.success("Bloqueio cadastrado.");
      setReason("");
      setReloadKey((current) => current + 1);
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar o bloqueio.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function remove(block: AgendaBlock) {
    if (deletingId) return;
    setDeletingId(block.id);
    try {
      const response = await fetch(`/api/agenda-blocks/${block.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        toast.error(result.message ?? "Não foi possível excluir o bloqueio.");
        return;
      }
      toast.success("Bloqueio excluído.");
      setReloadKey((current) => current + 1);
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir o bloqueio.");
    } finally {
      setDeletingId(null);
    }
  }

  const teamOptions = team.map((member) => ({ value: member.id, label: member.name }));
  // O erro do intervalo volta em `ends_at`; o do dia inteiro, em `end_date`.
  const endError = errors.end_date ?? errors.ends_at;
  const startError = errors.start_date ?? errors.starts_at;

  return (
    <ModalShell
      size="medium"
      title="Bloqueios da agenda"
      description="Férias, feriados e outros períodos sem atendimento. O bloqueio avisa ao agendar; não impede."
    >
      <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
        <FieldGroup>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <Checkbox checked={allDay} onCheckedChange={(checked) => setAllDay(Boolean(checked))} />
            Dia inteiro
          </label>

          {allDay ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={id("start")}>Primeiro dia</FieldLabel>
                <Input
                  id={id("start")}
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                  aria-invalid={startError ? true : undefined}
                  className="h-11 sm:h-10"
                />
                {startError ? <FieldError className="text-xs">{startError}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={id("end")}>Último dia</FieldLabel>
                <Input
                  id={id("end")}
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  aria-invalid={endError ? true : undefined}
                  className="h-11 sm:h-10"
                />
                {endError ? <FieldError className="text-xs">{endError}</FieldError> : null}
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor={id("day")}>Dia</FieldLabel>
                <Input
                  id={id("day")}
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  aria-invalid={startError ? true : undefined}
                  className="h-11 sm:h-10"
                />
                {startError ? <FieldError className="text-xs">{startError}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={id("from")}>Das</FieldLabel>
                <Input
                  id={id("from")}
                  type="time"
                  value={fromTime}
                  onChange={(event) => setFromTime(event.target.value)}
                  className="h-11 tabular-nums sm:h-10"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={id("to")}>Até</FieldLabel>
                <Input
                  id={id("to")}
                  type="time"
                  value={toTime}
                  onChange={(event) => setToTime(event.target.value)}
                  aria-invalid={endError ? true : undefined}
                  className="h-11 tabular-nums sm:h-10"
                />
                {endError ? <FieldError className="text-xs">{endError}</FieldError> : null}
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={id("reason")}>Motivo</FieldLabel>
              <Input
                id={id("reason")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                placeholder="Ex.: Férias, Feriado"
                className="h-11 sm:h-10"
              />
              {errors.reason ? <FieldError className="text-xs">{errors.reason}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={id("assignee")}>Técnico</FieldLabel>
              <FormSelect
                id={id("assignee")}
                value={assigneeId}
                onValueChange={setAssigneeId}
                options={teamOptions}
                emptyLabel="Todos os técnicos"
              />
              {errors.assignee_id ? <FieldError className="text-xs">{errors.assignee_id}</FieldError> : null}
            </Field>
          </div>
        </FieldGroup>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending} className="h-11 sm:h-9">
            {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Bloquear
          </Button>
        </div>
      </form>

      <section aria-labelledby={id("list")} className="mt-6 grid gap-2">
        <h3 id={id("list")} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Próximos bloqueios
        </h3>
        {blocks === null ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : blocks === false ? (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Não foi possível carregar os bloqueios.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)} className="h-11 sm:h-8">
              Tentar de novo
            </Button>
          </div>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum bloqueio daqui em diante.</p>
        ) : (
          <ul className="grid gap-2">
            {blocks.map((block) => {
              const Icon = block.allDay ? CalendarOffIcon : Clock3Icon;
              return (
                <li key={block.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{blockLabel(block)}</p>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">{describeAgendaBlockPeriod(block)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir bloqueio ${blockLabel(block)}, ${describeAgendaBlockPeriod(block)}`}
                    disabled={deletingId !== null}
                    onClick={() => void remove(block)}
                    className="size-11 shrink-0 sm:size-8"
                  >
                    {deletingId === block.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </ModalShell>
  );
}
