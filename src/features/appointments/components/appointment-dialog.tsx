"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CalendarPlusIcon,
  Clock3Icon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClienteCombobox } from "@/features/leads/components/cliente-combobox";
import { appointmentStatusLabel } from "@/features/appointments/schemas/status";
import { AppointmentTypeCombobox } from "@/features/appointments/components/appointment-type-combobox";
import { durationOptions } from "@/features/appointments/components/agenda-utils";
import { DateTimeFields } from "@/features/appointments/components/date-time-fields";
import {
  blockLabel,
  findBlocksForRange,
  isTimeBlocked,
  localToIso,
} from "@/features/appointments/lib/agenda-blocks";
import {
  emptyAgendaConfig,
  isOutsideAgendaHours,
  modalityOptions,
  timesForDateKey,
  type AgendaConfig,
  type AppointmentType,
} from "@/features/appointments/lib/agenda-config";
import type { ConflictCandidate } from "@/features/appointments/lib/appointment-conflicts";
import {
  defaultDateTimeLocalForDateKey,
  formatLongDate,
  formatTime,
  toAppDateKey,
} from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import type { AppointmentModality, AppointmentStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const statusOptions: AppointmentStatus[] = [
  "agendado",
  "confirmado",
  "compareceu",
  "faltou",
  "cancelado",
];

const sourceOptions = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "agencia", label: "Agência" },
  { value: "anuncio", label: "Anúncio" },
  { value: "particular", label: "Particular" },
  { value: "indicacao", label: "Indicação" },
  { value: "outro", label: "Outro" },
] as const;

type AppointmentDialogTrigger =
  | { kind: "new"; dateKey?: string }
  | {
      kind: "confirm";
      leadId: string;
      leadName: string | null;
      leadPhone: string | null;
      dateKey?: string;
    };

export function AppointmentDialog({
  trigger,
  triggerLabel,
  triggerAriaLabel,
  triggerLabelClassName,
  triggerVariant = "default",
  triggerSize = "default",
  triggerClassName,
  iconOnly = false,
  fullWidth = false,
}: {
  trigger: AppointmentDialogTrigger;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  /**
   * Classe do rótulo visível. Serve para o botão ficar só com o ícone no
   * telefone e voltar a ter texto a partir de `sm` (`"hidden sm:inline"`) —
   * mesmo desenho do gatilho de `AgendaSettingsDialog`. O nome acessível não
   * depende disto: vem sempre do `aria-label`.
   */
  triggerLabelClassName?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerSize?: React.ComponentProps<typeof Button>["size"];
  triggerClassName?: string;
  iconOnly?: boolean;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [scheduledAt, setScheduledAt] = useState(() =>
    defaultDateTimeLocalForDateKey(trigger.dateKey)
  );
  const [durationMin, setDurationMin] = useState("60");
  const [tipoEnsaio, setTipoEnsaio] = useState("");
  const [modality, setModality] = useState<AppointmentModality>("presencial");
  const [unitId, setUnitId] = useState("");
  const [config, setConfig] = useState<AgendaConfig>(emptyAgendaConfig);
  const [conflicts, setConflicts] = useState<ConflictCandidate[]>([]);
  // Enquanto a configuração não chega, "nenhum horário configurado" seria uma
  // afirmação falsa dita com toda a confiança. Melhor não dizer nada ainda.
  const [configLoading, setConfigLoading] = useState(false);
  // "Agendado por": equipe (id+nome) + seleção atual. Carregado ao abrir via
  // /api/app-users (app_users é service_role-only, não dá para ler no client).
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);
  const [agendadoPor, setAgendadoPor] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const lockedLead = trigger.kind === "confirm" ? trigger : null;
  const displayDate = scheduledAt ? formatLongDate(scheduledAt) : "Escolha uma data";
  const displayTime = scheduledAt ? scheduledAt.slice(11, 16) : "--:--";
  const buttonLabel =
    triggerLabel ?? (trigger.kind === "confirm" ? "Confirmar agendamento" : "Novo agendamento");

  // Horários rápidos do dia escolhido, vindos da grade configurada em
  // Configurações da agenda. Vazio = dia sem expediente cadastrado.
  const quickTimes = useMemo(
    () => timesForDateKey(config.hours, scheduledAt.slice(0, 10)),
    [config.hours, scheduledAt]
  );
  const outsideHours = useMemo(
    () => isOutsideAgendaHours(config.hours, scheduledAt),
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

  const leadPreview = useMemo(() => {
    if (!lockedLead) return null;
    return {
      name: lockedLead.leadName ?? "Sem nome",
      phone: formatPhone(lockedLead.leadPhone),
    };
  }, [lockedLead]);

  /**
   * Alerta de conflito.
   *
   * ⚠️ **Avisa, não bloqueia.** Encaixe existe, e recusar a gravação
   * transformaria uma exceção do consultório em parede. O pedido veio depois de
   * dois pacientes caírem às 19:00 no mesmo dia.
   *
   * O debounce de 400 ms existe porque o campo `datetime-local` dispara
   * `change` a cada dígito digitado: sem ele seria uma consulta por tecla.
   */
  useEffect(() => {
    if (!open || scheduledAt.length < 16) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ at: scheduledAt, duration: durationMin });
        const response = await fetch(`/api/appointments/conflicts?${params}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          ok?: boolean;
          conflicts?: ConflictCandidate[];
        };
        if (!response.ok || !result.ok) return;
        setConflicts(result.conflicts ?? []);
      } catch {
        /* alerta é auxílio: falhar aqui não pode atrapalhar o agendamento */
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, scheduledAt, durationMin]);

  // Reset dirigido por evento (abrir/fechar), em vez de useEffect.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setScheduledAt(defaultDateTimeLocalForDateKey(trigger.dateKey));
      setDurationMin("60");
      setTipoEnsaio("");
      setModality("presencial");
      setUnitId("");
      setConflicts([]);
      setClientMode("existing");
      setErrors({});
      void loadTeam();
      void loadConfig();
    } else {
      setErrors({});
      setPending(false);
    }
  }

  async function loadTeam() {
    try {
      const res = await fetch("/api/app-users");
      const data = (await res.json()) as {
        ok: boolean;
        users?: { id: string; name: string }[];
        currentUserId?: string | null;
      };
      if (!res.ok || !data.ok) return;
      setTeam((data.users ?? []).map((user) => ({ value: user.id, label: user.name })));
      if (data.currentUserId) setAgendadoPor(data.currentUserId);
    } catch {
      /* opcional — mantém o campo oculto e o fallback do back-end */
    }
  }

  // Tipos, unidades e grade numa chamada só. Falha silenciosa e resiliente: sem
  // catálogo os campos ficam vazios, mas ainda dá para marcar a consulta.
  async function loadConfig() {
    setConfigLoading(true);
    try {
      const res = await fetch("/api/agenda/config");
      const data = (await res.json()) as Partial<AgendaConfig> & { ok?: boolean };
      if (!res.ok || !data.ok) return;
      setConfig({
        types: data.types ?? [],
        units: data.units ?? [],
        hours: data.hours ?? emptyAgendaConfig().hours,
          blocks: data.blocks ?? [],
      });
    } catch {
      /* segue com a configuração vazia */
    } finally {
      setConfigLoading(false);
    }
  }

  function applyQuickTime(time: string) {
    const date = scheduledAt.slice(0, 10) || toAppDateKey(new Date());
    setScheduledAt(`${date}T${time}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // O campo virou combobox de texto livre e perdeu o `required` do <select>
    // antigo, que sempre tinha um valor padrão. Sem esta guarda o asterisco na
    // etiqueta seria decoração.
    if (!tipoEnsaio.trim()) {
      setErrors({ tipo_ensaio: ["Escolha ou crie um tipo de atendimento."] });
      toast.error("Escolha o tipo de atendimento.");
      return;
    }

    setPending(true);
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar o agendamento.");
        return;
      }

      toast.success(result.message ?? "Agendamento criado.");
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar o agendamento.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        size={fullWidth ? "default" : triggerSize}
        variant={triggerVariant}
        aria-label={triggerAriaLabel ?? buttonLabel}
        className={cn(fullWidth && "h-11 w-full", triggerClassName)}
      >
        {trigger.kind === "new" ? <CalendarPlusIcon data-icon="inline-start" /> : null}
        {iconOnly ? (
          <span className="sr-only">{buttonLabel}</span>
        ) : (
          <span className={triggerLabelClassName}>{buttonLabel}</span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        {open ? (
          <ModalShell
            size="wide"
            title={trigger.kind === "confirm" ? "Confirmar agendamento" : "Novo agendamento"}
            description="Defina o cliente, o atendimento e quando ele acontece."
            formRef={formRef}
            onSubmit={handleSubmit}
            bodyClassName="px-0 py-0 sm:px-0 sm:py-0"
            footer={
              <ModalFooterActions>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={pending}
                  className="h-11 sm:h-10"
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending} className="h-11 sm:h-10">
                  {pending ? (
                    <Loader2Icon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <UserPlusIcon data-icon="inline-start" />
                  )}
                  Salvar
                </Button>
              </ModalFooterActions>
            }
          >
            <input type="hidden" name="client_mode" value={lockedLead ? "existing" : clientMode} />
            <input type="hidden" name="scheduled_at" value={scheduledAt} />
            <input type="hidden" name="tipo_ensaio" value={tipoEnsaio} />
            <input type="hidden" name="modality" value={modality} />
            <input type="hidden" name="unit_id" value={modality === "presencial" ? unitId : ""} />

            {/*
              ⚠️ Duas pilhas de seções, não um grid com `row-span` manual.
              O layout anterior posicionava cada seção com `lg:col-start` +
              `lg:row-start` + `lg:row-span-3` contados à mão: acrescentar uma
              seção desalinhava a coluna da direita e era de onde vinha o
              transbordo. Aqui cada coluna empilha o que é dela.
            */}
            <div className="grid items-start px-5 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)] lg:gap-0">
              <div className="min-w-0 lg:pr-8">
                <FormSection
                  title="Cliente"
                  description="Vincule um lead existente ou faça um cadastro rápido."
                  action={
                    !lockedLead ? (
                      <div
                        className="grid w-full grid-cols-2 rounded-lg bg-muted p-1 sm:w-auto"
                        role="tablist"
                        aria-label="Tipo de cliente"
                      >
                        <ModeButton
                          active={clientMode === "existing"}
                          onClick={() => setClientMode("existing")}
                        >
                          Existente
                        </ModeButton>
                        <ModeButton
                          active={clientMode === "new"}
                          onClick={() => setClientMode("new")}
                        >
                          Novo
                        </ModeButton>
                      </div>
                    ) : null
                  }
                >
                  {lockedLead && leadPreview ? (
                    <>
                      <input type="hidden" name="lead_id" value={lockedLead.leadId} />
                      <div className="min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
                        <div className="truncate font-medium">{leadPreview.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {leadPreview.phone}
                        </div>
                      </div>
                    </>
                  ) : clientMode === "existing" ? (
                    <div className="grid min-w-0 gap-2">
                      <ClienteCombobox allowCreate={false} />
                      {errors.lead_id?.[0] ? (
                        <p className="text-xs font-medium text-destructive">{errors.lead_id[0]}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <Field label="Nome" error={errors.new_client_name?.[0]} required>
                        <Input
                          name="new_client_name"
                          placeholder="Ana Carvalho"
                          className="h-10"
                          autoComplete="name"
                        />
                      </Field>
                      <Field label="Telefone" error={errors.new_client_phone?.[0]} required>
                        <Input
                          name="new_client_phone"
                          placeholder="(86) 99805-3279"
                          className="h-10"
                          inputMode="tel"
                          autoComplete="tel"
                        />
                      </Field>
                      <Field label="Origem">
                        <FormSelect
                          name="new_client_source"
                          defaultValue="whatsapp"
                          aria-label="Origem do novo cliente"
                          options={sourceOptions}
                        />
                      </Field>
                      <Field label="E-mail">
                        <Input
                          name="new_client_email"
                          type="email"
                          placeholder="cliente@email.com"
                          className="h-10"
                          autoComplete="email"
                        />
                      </Field>
                      <Field label="Instagram" className="sm:col-span-2">
                        <Input
                          name="new_client_instagram_user"
                          placeholder="@cliente"
                          className="h-10"
                          autoComplete="off"
                        />
                      </Field>
                    </div>
                  )}
                </FormSection>

                {/*
                  Era "Serviço" com um campo "Serviço" dentro — o mesmo rótulo
                  duas vezes na mesma tela, um deles sem significar nada.
                */}
                <FormSection
                  title="Atendimento"
                  description="O que será feito, onde e em qual situação."
                >
                  <div className="grid min-w-0 gap-3">
                    <Field
                      label="Tipo de atendimento"
                      error={errors.tipo_ensaio?.[0]}
                      required
                      htmlFor="appointment-type"
                    >
                      <AppointmentTypeCombobox
                        id="appointment-type"
                        value={tipoEnsaio}
                        onChange={setTipoEnsaio}
                        types={config.types}
                        onCatalogChange={(types: AppointmentType[]) =>
                          setConfig((prev) => ({ ...prev, types }))
                        }
                        invalid={Boolean(errors.tipo_ensaio?.[0])}
                      />
                    </Field>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <Field label="Modalidade">
                        <div
                          className="grid grid-cols-2 rounded-lg bg-muted p-1"
                          role="tablist"
                          aria-label="Modalidade do atendimento"
                        >
                          {modalityOptions.map((option) => (
                            <ModeButton
                              key={option.value}
                              active={modality === option.value}
                              onClick={() => setModality(option.value)}
                            >
                              {option.label}
                            </ModeButton>
                          ))}
                        </div>
                      </Field>

                      {/*
                        Unidade só faz sentido no presencial. Mostrar o campo na
                        teleconsulta convidaria a gravar um endereço para um
                        atendimento que não acontece em lugar nenhum.
                      */}
                      {modality === "presencial" ? (
                        config.units.length > 0 ? (
                          <Field label="Unidade" error={errors.unit_id?.[0]}>
                            <FormSelect
                              value={unitId}
                              onValueChange={setUnitId}
                              aria-label="Unidade de atendimento"
                              options={[
                                { value: "", label: "Não informada" },
                                ...config.units.map((unit) => ({
                                  value: unit.id,
                                  label: unit.name,
                                })),
                              ]}
                            />
                          </Field>
                        ) : (
                          <Field label="Unidade">
                            <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                              Nenhuma unidade cadastrada. Adicione em Configurar,
                              na barra da agenda.
                            </p>
                          </Field>
                        )
                      ) : (
                        <Field label="Onde">
                          <p className="flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 text-xs text-muted-foreground">
                            <MonitorSmartphoneIcon className="size-4 shrink-0" aria-hidden />
                            Atendimento remoto, sem unidade.
                          </p>
                        </Field>
                      )}
                    </div>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <Field label="Status" error={errors.status?.[0]}>
                        <FormSelect
                          name="status"
                          defaultValue="agendado"
                          aria-label="Status do agendamento"
                          options={statusOptions.map((status) => ({
                            value: status,
                            label: appointmentStatusLabel[status],
                          }))}
                        />
                      </Field>

                      {team.length > 0 ? (
                        <Field label="Agendado por" error={errors.created_by_user_id?.[0]}>
                          <FormSelect
                            name="created_by_user_id"
                            value={agendadoPor}
                            onValueChange={setAgendadoPor}
                            aria-label="Quem fez o agendamento"
                            options={team}
                          />
                        </Field>
                      ) : null}
                    </div>
                  </div>
                </FormSection>

                <FormSection
                  title="Anotações"
                  description="Contexto útil para a equipe antes do atendimento."
                >
                  <Field label="Notas internas">
                    <Textarea
                      name="notes"
                      placeholder="Preferências, valor combinado e observações importantes..."
                      className="min-h-28 resize-y"
                    />
                  </Field>
                </FormSection>
              </div>

              <div className="min-w-0 lg:border-l lg:border-border/70 lg:pl-8">
                <FormSection
                  title="Data e horário"
                  description={`${displayTime} · ${displayDate}`}
                  icon={<Clock3Icon className="size-4" aria-hidden />}
                >
                  <DateTimeFields
                    idPrefix="new-appointment"
                    value={scheduledAt}
                    onChange={setScheduledAt}
                    error={errors.scheduled_at?.[0]}
                  >
                    <Field label="Duração">
                      <FormSelect
                        name="duration_min"
                        value={durationMin}
                        onValueChange={setDurationMin}
                        aria-label="Duração do agendamento"
                        options={durationOptions}
                      />
                    </Field>
                  </DateTimeFields>

                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Horários rápidos
                    </Label>
                    {configLoading ? (
                      <p className="text-xs text-muted-foreground" role="status">
                        Carregando o expediente...
                      </p>
                    ) : quickTimes.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
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
                              // Desabilitado sozinho não explica nada. O motivo
                              // vai no `title` e no rótulo do leitor de tela.
                              title={blocked ? `Bloqueado: ${blockLabel(blocked)}` : undefined}
                              aria-label={
                                blocked ? `${time} — bloqueado: ${blockLabel(blocked)}` : time
                              }
                              className="h-9 min-w-[4.25rem] tabular-nums disabled:line-through"
                            >
                              {time}
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nenhum horário configurado para este dia da semana. Use os
                        campos acima, ou defina o expediente em Configurar.
                      </p>
                    )}
                  </div>

                  {activeBlocks.length > 0 ? (
                    <Notice tone="danger">
                      <span className="font-medium">
                        Período bloqueado: {activeBlocks.map(blockLabel).join(", ")}.
                      </span>{" "}
                      Dá para agendar assim mesmo, se for encaixe.
                    </Notice>
                  ) : null}

                  {outsideHours ? (
                    <Notice tone="warning">
                      Este horário está fora do expediente cadastrado para{" "}
                      {displayDate.toLowerCase()}. Dá para agendar assim mesmo.
                    </Notice>
                  ) : null}

                  {conflicts.length > 0 ? (
                    <Notice tone="danger">
                      <span className="font-medium">
                        {conflicts.length === 1
                          ? "Já existe um agendamento neste horário:"
                          : `Já existem ${conflicts.length} agendamentos neste horário:`}
                      </span>
                      <ul className="mt-1 grid gap-0.5">
                        {conflicts.map((conflict) => (
                          <li key={conflict.id} className="truncate">
                            {formatTime(conflict.scheduledAt)} ·{" "}
                            {conflict.leadName ?? "Sem nome"}
                          </li>
                        ))}
                      </ul>
                    </Notice>
                  ) : null}
                </FormSection>
              </div>
            </div>
          </ModalShell>
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * Aviso dentro do formulário.
 *
 * Ícone + texto, nunca só cor (UI.md §1.4). Os dois casos aqui são avisos, não
 * bloqueios: o conflito de horário e o horário fora do expediente.
 */
function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function FormSection({
  title,
  description,
  action,
  icon,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 gap-4 border-t border-border/70 py-6 first:border-t-0",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-2">
          {icon ? (
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h3 className="font-medium leading-tight">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="grid min-w-0 gap-3">{children}</div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        <span>
          {label}
          {required ? <span className="text-primary"> *</span> : null}
        </span>
      </Label>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      <div className={cn(error && "[&_[data-slot=input]]:border-destructive")}>{children}</div>
    </div>
  );
}
