"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, Clock3Icon, Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/forms/form-select";
import { durationOptions } from "@/features/appointments/components/agenda-utils";
import { AppointmentTypeCombobox } from "@/features/appointments/components/appointment-type-combobox";
import { DateTimeFields } from "@/features/appointments/components/date-time-fields";
import {
  blockLabel,
  findBlocksForRange,
  isTimeBlocked,
  localToIso,
} from "@/features/appointments/lib/agenda-blocks";
import type { ConflictCandidate } from "@/features/appointments/lib/appointment-conflicts";
import {
  emptyAgendaConfig,
  modalityOptions,
  timesForDateKey,
  type AgendaConfig,
  type AppointmentType,
} from "@/features/appointments/lib/agenda-config";
import type { AppointmentModality } from "@/lib/supabase/types";
import type { Appointment } from "@/features/appointments/types";
import { formatLongDate, formatTime, toAppDateKey } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

/**
 * Edição de um agendamento existente, para viver **dentro** do modal de
 * detalhes — por isso é painel, não diálogo: quem já está num modal troca o
 * conteúdo (UI.md §9).
 *
 * ⚠️ **Não edita status nem cliente**, de propósito. Status tem cascata
 * (carimba o lead e move o card no funil) e vive no botão "Marcar compareceu",
 * que é o único caminho que faz a cascata inteira. Trocar o cliente mexeria no
 * lead antigo e no novo. A rota `PATCH` recusa os dois pelo schema.
 */
export function AppointmentEditPanel({
  appointment,
  onSaved,
  onCancel,
}: {
  appointment: Appointment;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [scheduledAt, setScheduledAt] = useState(() =>
    toDateTimeLocal(appointment.scheduled_at)
  );
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);
  const [agendadoPor, setAgendadoPor] = useState(appointment.created_by_user_id ?? "");
  const [config, setConfig] = useState<AgendaConfig>(emptyAgendaConfig);
  const [tipoEnsaio, setTipoEnsaio] = useState(appointment.tipo_ensaio ?? "");
  const [modality, setModality] = useState<AppointmentModality>(
    appointment.modality ?? "presencial"
  );
  const [unitId, setUnitId] = useState(appointment.unit_id ?? "");
  const [durationMin, setDurationMin] = useState(String(appointment.duration_min ?? 60));
  const [conflicts, setConflicts] = useState<ConflictCandidate[]>([]);
  // `pending` é estado: entre o clique e o re-render dá tempo de um segundo
  // submit. O ref trava na hora — mesmo padrão do SaleDialog (UI.md §5.5).
  const submitting = useRef(false);

  const quickTimes = useMemo(
    () => timesForDateKey(config.hours, scheduledAt.slice(0, 10)),
    [config.hours, scheduledAt]
  );
  const activeBlocks = useMemo(
    () =>
      findBlocksForRange({
        blocks: config.blocks,
        startIso: localToIso(scheduledAt.slice(0, 10), scheduledAt.slice(11, 16)),
        durationMin: Number(durationMin) || 60,
      }),
    [config.blocks, scheduledAt, durationMin]
  );

  // A equipe é opcional: sem a lista o campo some e o back-end mantém quem já
  // estava. Falha silenciosa de propósito — não é motivo para travar a edição.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/app-users");
        const data = (await res.json()) as {
          ok: boolean;
          users?: { id: string; name: string }[];
        };
        if (!alive || !res.ok || !data.ok) return;
        setTeam((data.users ?? []).map((user) => ({ value: user.id, label: user.name })));
      } catch {
        /* campo fica oculto */
      }
    })();
    // Tipos, unidades e grade de horários. Resiliente: sem eles o painel ainda
    // remarca, só não sugere horário nem oferece catálogo.
    void (async () => {
      try {
        const res = await fetch("/api/agenda/config");
        const data = (await res.json()) as Partial<AgendaConfig> & { ok?: boolean };
        if (!alive || !res.ok || !data.ok) return;
        setConfig({
          types: data.types ?? [],
          units: data.units ?? [],
          hours: data.hours ?? emptyAgendaConfig().hours,
          blocks: data.blocks ?? [],
        });
      } catch {
        /* segue com a configuração vazia */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Remarcar para cima de outro paciente é o mesmo erro de criar em cima —
   * `ignore` tira este agendamento da conta, senão ele conflitaria consigo.
   */
  useEffect(() => {
    if (scheduledAt.length < 16) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          at: scheduledAt,
          duration: durationMin,
          ignore: appointment.id,
        });
        const res = await fetch(`/api/appointments/conflicts?${params}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { ok?: boolean; conflicts?: ConflictCandidate[] };
        if (!res.ok || !data.ok) return;
        setConflicts(data.conflicts ?? []);
      } catch {
        /* aviso é auxílio: falhar aqui não pode travar a remarcação */
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [scheduledAt, durationMin, appointment.id]);

  function applyQuickTime(time: string) {
    const date = scheduledAt.slice(0, 10) || toAppDateKey(new Date());
    setScheduledAt(`${date}T${time}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = {
      ...Object.fromEntries(formData),
      scheduled_at: scheduledAt,
      tipo_ensaio: tipoEnsaio,
      modality,
      unit_id: modality === "presencial" ? unitId : "",
    };

    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok || !result.ok) {
        if (result.errors) setErrors(result.errors);
        toast.error(result.message ?? "Não foi possível salvar o agendamento.");
        return;
      }

      toast.success(result.message ?? "Agendamento atualizado.");
      router.refresh();
      onSaved();
    } catch {
      toast.error("Não foi possível salvar o agendamento.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const displayDate = scheduledAt ? formatLongDate(scheduledAt) : "Escolha uma data";
  const displayTime = scheduledAt ? scheduledAt.slice(11, 16) : "--:--";

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section className="grid content-start gap-4">
          <header className="flex items-center gap-2">
            <Clock3Icon className="size-4 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-medium">Data e horário</p>
              <p className="text-xs text-muted-foreground">
                {displayTime} · {displayDate}
              </p>
            </div>
          </header>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <DateTimeFields
              idPrefix={`${fieldId}-when`}
              value={scheduledAt}
              onChange={setScheduledAt}
              error={errors.scheduled_at?.[0]}
            >
              <PanelField id={`${fieldId}-duration`} label="Duração">
                <FormSelect
                  name="duration_min"
                  value={durationMin}
                  onValueChange={setDurationMin}
                  aria-label="Duração do agendamento"
                  options={durationOptions}
                />
              </PanelField>
            </DateTimeFields>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Horários rápidos
            </Label>
            {quickTimes.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
                {quickTimes.map((time) => {
                  const blocked = isTimeBlocked({
                    blocks: config.blocks,
                    dateKey: scheduledAt.slice(0, 10),
                    time,
                  });
                  return (
                    <Button
                      key={time}
                      type="button"
                      variant={scheduledAt.endsWith(time) ? "default" : "outline"}
                      size="sm"
                      disabled={Boolean(blocked)}
                      onClick={() => applyQuickTime(time)}
                      title={blocked ? `Bloqueado: ${blockLabel(blocked)}` : undefined}
                      aria-label={blocked ? `${time} — bloqueado: ${blockLabel(blocked)}` : time}
                      className="h-11 disabled:line-through sm:h-9"
                    >
                      {time}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhum horário configurado para este dia da semana. Use o campo
                acima para remarcar mesmo assim.
              </p>
            )}

            {activeBlocks.length > 0 ? (
              <div
                role="status"
                className="flex min-w-0 gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <span className="font-medium">
                    Período bloqueado: {activeBlocks.map(blockLabel).join(", ")}.
                  </span>{" "}
                  Dá para remarcar assim mesmo, se for encaixe.
                </div>
              </div>
            ) : null}

            {conflicts.length > 0 ? (
              <div
                role="status"
                className="flex min-w-0 gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <span className="font-medium">
                    {conflicts.length === 1
                      ? "Já existe um agendamento neste horário:"
                      : `Já existem ${conflicts.length} agendamentos neste horário:`}
                  </span>
                  <ul className="mt-1 grid gap-0.5">
                    {conflicts.map((conflict) => (
                      <li key={conflict.id} className="truncate">
                        {formatTime(conflict.scheduledAt)} · {conflict.leadName ?? "Sem nome"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid content-start gap-4 lg:border-l lg:border-border/70 lg:pl-6">
          <PanelField
            id={`${fieldId}-service`}
            label="Tipo de atendimento"
            error={errors.tipo_ensaio?.[0]}
          >
            <AppointmentTypeCombobox
              id={`${fieldId}-service`}
              value={tipoEnsaio}
              onChange={setTipoEnsaio}
              types={config.types}
              onCatalogChange={(types: AppointmentType[]) =>
                setConfig((prev) => ({ ...prev, types }))
              }
              invalid={Boolean(errors.tipo_ensaio?.[0])}
            />
          </PanelField>

          <PanelField id={`${fieldId}-modality`} label="Modalidade">
            <div
              className="grid grid-cols-2 rounded-lg bg-muted p-1"
              role="tablist"
              aria-label="Modalidade do atendimento"
            >
              {modalityOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={modality === option.value}
                  onClick={() => setModality(option.value)}
                  className={cn(
                    "min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    modality === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PanelField>

          {modality === "presencial" && config.units.length > 0 ? (
            <PanelField id={`${fieldId}-unit`} label="Unidade">
              <FormSelect
                value={unitId}
                onValueChange={setUnitId}
                aria-label="Unidade de atendimento"
                options={[
                  { value: "", label: "Não informada" },
                  ...config.units.map((unit) => ({ value: unit.id, label: unit.name })),
                ]}
              />
            </PanelField>
          ) : null}

          {team.length > 0 ? (
            <PanelField
              id={`${fieldId}-owner`}
              label="Agendado por"
              error={errors.created_by_user_id?.[0]}
            >
              <FormSelect
                name="created_by_user_id"
                value={agendadoPor}
                onValueChange={setAgendadoPor}
                aria-label="Quem fez o agendamento"
                options={team}
              />
            </PanelField>
          ) : null}

          <PanelField id={`${fieldId}-notes`} label="Observações">
            <Textarea
              id={`${fieldId}-notes`}
              name="notes"
              defaultValue={appointment.notes ?? ""}
              placeholder="Preferências, valor combinado e observações importantes..."
              className="min-h-28 resize-y"
            />
          </PanelField>

          {/* O status não é editável aqui — ver o cabeçalho do componente. */}
          <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            O status continua sendo alterado pelo botão{" "}
            <strong className="font-medium text-foreground">Marcar compareceu</strong>,
            que também atualiza o lead e o card no funil.
          </p>
        </section>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
          className="h-11 sm:h-9"
        >
          Voltar ao agendamento
        </Button>
        <Button type="submit" disabled={pending} className="h-11 sm:h-9">
          {pending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <SaveIcon data-icon="inline-start" />
          )}
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

/**
 * Rótulo + erro. Versão enxuta e local: o `Field` do diálogo de criar é
 * desenhado para a grade de duas colunas com bordas daquela tela, e o AGENTS
 * §0.2 manda duplicar no segundo uso em vez de abstrair cedo.
 */
function PanelField({
  id,
  label,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p className={cn("text-xs text-destructive")} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * ISO do banco → valor de `datetime-local`, **no fuso do app**.
 *
 * ⚠️ Não use `getHours()` e companhia: aquilo lê o fuso do NAVEGADOR, e o app
 * inteiro trabalha em `America/Sao_Paulo` (`parseAppDate` interpreta o campo
 * assim ao salvar). Fora desse fuso, abrir e salvar sem tocar em nada
 * deslocaria o horário do agendamento.
 */
function toDateTimeLocal(iso: string): string {
  const dateKey = toAppDateKey(iso);
  const time = formatTime(iso);
  if (!dateKey || time === "-") return "";
  return `${dateKey}T${time}`;
}
