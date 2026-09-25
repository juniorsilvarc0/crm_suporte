"use client";

import { useState, type ReactNode } from "react";
import {
  BanIcon,
  BuildingIcon,
  CalendarOffIcon,
  Clock3Icon,
  Loader2Icon,
  MapPinIcon,
  PlusIcon,
  SettingsIcon,
  StethoscopeIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BLOCK_REASON_PRESETS,
  blockLabel,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";
import { formatDateTime, formatLongDate, getTodayAppDateKey } from "@/lib/formatters/date";
import {
  WEEKDAY_LABELS,
  emptyAgendaConfig,
  isValidTime,
  normalizeTimes,
  type AgendaConfig,
  type AgendaHours,
  type AppointmentType,
  type ClinicUnit,
} from "@/features/appointments/lib/agenda-config";
import { cn } from "@/lib/utils";

/**
 * Configurações da Agenda: grade de horários, unidades e tipos de atendimento.
 *
 * As três coisas viviam no código — a grade era um objeto literal, os tipos
 * eram uma constante de UI e a unidade não existia. Mudar o expediente da
 * clínica exigia deploy.
 */
export function AgendaSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AgendaConfig>(emptyAgendaConfig);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    setLoading(true);
    try {
      const response = await fetch("/api/agenda/config");
      const result = (await response.json()) as Partial<AgendaConfig> & { ok?: boolean };
      if (!response.ok || !result.ok) {
        toast.error("Não foi possível carregar as configurações da agenda.");
        return;
      }
      setConfig({
        types: result.types ?? [],
        units: result.units ?? [],
        hours: result.hours ?? emptyAgendaConfig().hours,
        blocks: result.blocks ?? [],
      });
    } catch {
      toast.error("Não foi possível carregar as configurações da agenda.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleOpenChange(true)}
        aria-label="Configurações da agenda"
        title="Configurações da agenda"
        // `min-w-11`: no telefone o rótulo some e sobra só o ícone — sem o piso
        // de largura o botão cai para 34px, abaixo do alvo de toque.
        className="h-11 min-w-11 shrink-0 sm:h-9 sm:min-w-0"
      >
        <SettingsIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Configurar</span>
      </Button>

      <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
        {open ? (
          <ModalShell
            size="medium"
            title="Configurações da agenda"
            description="Expediente, unidades de atendimento e tipos de consulta. Vale para todo mundo da equipe."
            footer={
              <ModalFooterActions>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="h-11 sm:h-9"
                >
                  Fechar
                </Button>
              </ModalFooterActions>
            }
          >
            {loading ? (
              <div
                className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2Icon className="size-4 animate-spin" />
                Carregando configurações...
              </div>
            ) : (
              <Tabs defaultValue="horarios">
                <TabsList className="w-full">
                  <TabsTrigger value="horarios" className="flex-1 gap-1.5">
                    <Clock3Icon className="size-4" aria-hidden />
                    Horários
                  </TabsTrigger>
                  <TabsTrigger value="unidades" className="flex-1 gap-1.5">
                    <BuildingIcon className="size-4" aria-hidden />
                    Unidades
                  </TabsTrigger>
                  <TabsTrigger value="tipos" className="flex-1 gap-1.5">
                    <StethoscopeIcon className="size-4" aria-hidden />
                    Tipos
                  </TabsTrigger>
                  <TabsTrigger value="bloqueios" className="flex-1 gap-1.5">
                    <CalendarOffIcon className="size-4" aria-hidden />
                    Bloqueios
                    {config.blocks.length > 0 ? (
                      <span
                        className="ms-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums text-primary"
                        aria-hidden
                      >
                        {config.blocks.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="horarios" className="pt-2">
                  <HoursEditor
                    hours={config.hours}
                    onChange={(hours) => setConfig((prev) => ({ ...prev, hours }))}
                  />
                </TabsContent>

                <TabsContent value="unidades" className="pt-2">
                  <UnitsEditor
                    units={config.units}
                    onChange={(units) => setConfig((prev) => ({ ...prev, units }))}
                  />
                </TabsContent>

                <TabsContent value="tipos" className="pt-2">
                  <TypesEditor
                    types={config.types}
                    onChange={(types) => setConfig((prev) => ({ ...prev, types }))}
                  />
                </TabsContent>

                <TabsContent value="bloqueios" className="pt-2">
                  <BlocksEditor
                    blocks={config.blocks}
                    onChange={(blocks) => setConfig((prev) => ({ ...prev, blocks }))}
                  />
                </TabsContent>
              </Tabs>
            )}
          </ModalShell>
        ) : null}
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Grade de horários                                                          */
/* -------------------------------------------------------------------------- */

function HoursEditor({
  hours,
  onChange,
}: {
  hours: AgendaHours;
  onChange: (hours: AgendaHours) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function setDay(weekday: number, times: string[]) {
    const next = hours.map((day, index) => (index === weekday ? normalizeTimes(times) : day));
    onChange(next);
    setDirty(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/agenda/hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar a grade.");
        return;
      }
      toast.success(result.message ?? "Grade de horários salva.");
      setDirty(false);
    } catch {
      toast.error("Não foi possível salvar a grade.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Os horários abaixo viram os atalhos do modal de agendamento. Dia sem
        horário nenhum não bloqueia nada — apenas não sugere.
      </p>

      <div className="grid gap-2">
        {WEEKDAY_LABELS.map((label, weekday) => (
          <WeekdayRow
            key={label}
            label={label}
            times={hours[weekday] ?? []}
            onChange={(times) => setDay(weekday, times)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-3">
        {dirty ? (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Alterações não salvas
          </span>
        ) : null}
        <Button type="button" onClick={() => void save()} disabled={saving || !dirty} className="h-10">
          {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Salvar grade
        </Button>
      </div>
    </div>
  );
}

function WeekdayRow({
  label,
  times,
  onChange,
}: {
  label: string;
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    if (!isValidTime(draft)) return;
    onChange([...times, draft]);
    setDraft("");
  }

  return (
    <section className="grid gap-2 rounded-lg border border-border/70 p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{label}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            type="time"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter dentro de um modal com <form> em volta submeteria o
              // formulário. Aqui não há form, mas a intenção é local mesmo.
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
            aria-label={`Novo horário para ${label}`}
            className="h-9 w-[7.5rem]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={add}
            disabled={!isValidTime(draft)}
            aria-label={`Adicionar horário em ${label}`}
            className="size-9 shrink-0"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {times.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem atendimento neste dia.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {times.map((time) => (
            <li key={time}>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pe-1 ps-2.5 text-xs font-medium tabular-nums">
                {time}
                <button
                  type="button"
                  onClick={() => onChange(times.filter((item) => item !== time))}
                  aria-label={`Remover ${time} de ${label}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Unidades                                                                   */
/* -------------------------------------------------------------------------- */

function UnitsEditor({
  units,
  onChange,
}: {
  units: ClinicUnit[];
  onChange: (units: ClinicUnit[]) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agenda/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        unit?: ClinicUnit;
      };
      if (!response.ok || !result.ok || !result.unit) {
        toast.error(result.message ?? "Não foi possível criar a unidade.");
        return;
      }
      onChange(
        [...units, result.unit].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      );
      setName("");
      setAddress("");
      toast.success(result.message ?? "Unidade criada.");
    } catch {
      toast.error("Não foi possível criar a unidade.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(unit: ClinicUnit) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agenda/units/${unit.id}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover a unidade.");
        return;
      }
      onChange(units.filter((item) => item.id !== unit.id));
      setRemovingId(null);
      toast.success(`"${unit.name}" saiu da lista.`);
    } catch {
      toast.error("Não foi possível remover a unidade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Onde o atendimento acontece. Aparecem como opção no modal de
        agendamento; remover uma unidade não apaga o histórico de quem já foi
        atendido nela.
      </p>

      <div className="grid gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <SettingsField label="Nome" htmlFor="unit-name">
          <Input
            id="unit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Unidade Centro"
            maxLength={120}
            className="h-10"
          />
        </SettingsField>
        <SettingsField label="Endereço" htmlFor="unit-address">
          <Input
            id="unit-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Rua Exemplo, 123 — sala 4"
            maxLength={240}
            className="h-10"
          />
        </SettingsField>
        <Button
          type="button"
          onClick={() => void create()}
          disabled={busy || !name.trim()}
          className="h-10 sm:w-auto"
        >
          {busy ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <PlusIcon data-icon="inline-start" />
          )}
          Adicionar
        </Button>
      </div>

      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma unidade cadastrada ainda.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {units.map((unit) => (
            <li key={unit.id} className="flex min-w-0 items-start gap-3 p-3">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{unit.name}</p>
                {unit.address ? (
                  <p className="truncate text-xs text-muted-foreground">{unit.address}</p>
                ) : (
                  <p className="text-xs text-muted-foreground/70">Sem endereço informado</p>
                )}
              </div>
              {removingId === unit.id ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setRemovingId(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() => void remove(unit)}
                    disabled={busy}
                  >
                    Remover
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setRemovingId(unit.id)}
                  aria-label={`Remover ${unit.name}`}
                  className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tipos de atendimento                                                       */
/* -------------------------------------------------------------------------- */

function TypesEditor({
  types,
  onChange,
}: {
  types: AppointmentType[];
  onChange: (types: AppointmentType[]) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function create() {
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agenda/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        appointmentType?: AppointmentType;
      };
      if (!response.ok || !result.ok || !result.appointmentType) {
        toast.error(result.message ?? "Não foi possível criar o tipo.");
        return;
      }
      onChange(
        [...types, result.appointmentType].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR")
        )
      );
      setName("");
      toast.success("Tipo de atendimento criado.");
    } catch {
      toast.error("Não foi possível criar o tipo.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(type: AppointmentType) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agenda/types/${type.id}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover o tipo.");
        return;
      }
      onChange(types.filter((item) => item.id !== type.id));
      setRemovingId(null);
      toast.success(`"${type.name}" saiu da lista.`);
    } catch {
      toast.error("Não foi possível remover o tipo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        O que aparece no campo &ldquo;Tipo de atendimento&rdquo;. Também dá para
        criar direto pelo modal de agendamento, digitando um nome novo. Remover
        aqui não altera os agendamentos já gravados.
      </p>

      <div className="flex items-end gap-2 rounded-lg border border-border/70 p-3">
        <SettingsField label="Nome" htmlFor="type-name" className="min-w-0 flex-1">
          <Input
            id="type-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Primeira consulta"
            maxLength={120}
            className="h-10"
          />
        </SettingsField>
        <Button
          type="button"
          onClick={() => void create()}
          disabled={busy || name.trim().length < 2}
          className="h-10 shrink-0"
        >
          {busy ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <PlusIcon data-icon="inline-start" />
          )}
          Adicionar
        </Button>
      </div>

      {types.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum tipo cadastrado ainda.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {types.map((type) => (
            <li key={type.id} className="flex min-w-0 items-center gap-3 p-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{type.name}</span>
              {removingId === type.id ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setRemovingId(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() => void remove(type)}
                    disabled={busy}
                  >
                    Remover
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setRemovingId(type.id)}
                  aria-label={`Remover ${type.name}`}
                  className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bloqueios                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Datas e horários sem atendimento — férias, feriado, congresso, cirurgia.
 *
 * ⚠️ **Não é recorrência.** Recorrência já é a grade de horários: dia da semana
 * sem horário nenhum é dia sem expediente. Aqui é sempre um intervalo concreto,
 * com começo e fim. Duas formas de dizer a mesma coisa divergiriam na primeira
 * mudança de expediente.
 */
function BlocksEditor({
  blocks,
  onChange,
}: {
  blocks: AgendaBlock[];
  onChange: (blocks: AgendaBlock[]) => void;
}) {
  const today = getTodayAppDateKey();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function create() {
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const response = await fetch("/api/agenda/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          all_day: allDay,
          start_time: allDay ? undefined : startTime,
          end_time: allDay ? undefined : endTime,
          reason,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        block?: AgendaBlock;
        errors?: Record<string, string[]>;
      };
      if (!response.ok || !result.ok || !result.block) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível criar o bloqueio.");
        return;
      }
      onChange(
        [...blocks, result.block].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      );
      setReason("");
      toast.success(result.message ?? "Bloqueio criado.");
    } catch {
      toast.error("Não foi possível criar o bloqueio.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(block: AgendaBlock) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agenda/blocks/${block.id}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover o bloqueio.");
        return;
      }
      onChange(blocks.filter((item) => item.id !== block.id));
      setRemovingId(null);
      toast.success("Bloqueio removido.");
    } catch {
      toast.error("Não foi possível remover o bloqueio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Períodos sem atendimento. Eles somem dos horários rápidos, aparecem
        marcados na agenda e avisam quem tentar marcar em cima —{" "}
        <strong className="font-medium text-foreground">sem impedir</strong>, para
        o encaixe continuar possível.
      </p>

      <div className="grid gap-3 rounded-lg border border-border/70 p-3">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Duração do bloqueio</legend>
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={allDay}
              onClick={() => setAllDay(true)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                allDay
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Dia inteiro
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!allDay}
              onClick={() => setAllDay(false)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                !allDay
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Faixa de horário
            </button>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsField label="De" htmlFor="block-start-date">
            <Input
              id="block-start-date"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                // O fim acompanha o início quando ficaria antes dele — evita o
                // erro mais comum do formulário sem obrigar a corrigir depois.
                if (event.target.value > endDate) setEndDate(event.target.value);
              }}
              aria-invalid={Boolean(errors.start_date?.[0])}
              className="h-11 sm:h-10"
            />
          </SettingsField>
          <SettingsField label="Até" htmlFor="block-end-date">
            <Input
              id="block-end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-invalid={Boolean(errors.end_date?.[0])}
              className="h-11 sm:h-10"
            />
          </SettingsField>
        </div>

        {allDay ? null : (
          <div className="grid gap-3 sm:grid-cols-2">
            <SettingsField label="Das" htmlFor="block-start-time">
              <Input
                id="block-start-time"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                aria-invalid={Boolean(errors.start_time?.[0])}
                className="h-11 tabular-nums sm:h-10"
              />
            </SettingsField>
            <SettingsField label="Às" htmlFor="block-end-time">
              <Input
                id="block-end-time"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="h-11 tabular-nums sm:h-10"
              />
            </SettingsField>
          </div>
        )}

        <SettingsField label="Motivo (opcional)" htmlFor="block-reason">
          <Input
            id="block-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Congresso"
            maxLength={120}
            className="h-11 sm:h-10"
          />
        </SettingsField>

        {/* Atalhos para o caso comum. O campo continua livre. */}
        <ul className="flex flex-wrap gap-1.5">
          {BLOCK_REASON_PRESETS.map((preset) => (
            <li key={preset}>
              <button
                type="button"
                onClick={() => setReason(preset)}
                aria-pressed={reason === preset}
                className={cn(
                  "min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  reason === preset
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:text-foreground"
                )}
              >
                {preset}
              </button>
            </li>
          ))}
        </ul>

        {errors.start_time?.[0] || errors.end_date?.[0] ? (
          <p className="text-xs font-medium text-destructive">
            {errors.start_time?.[0] ?? errors.end_date?.[0]}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="h-11 justify-self-end sm:h-10"
        >
          {busy ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <BanIcon data-icon="inline-start" />
          )}
          Bloquear período
        </Button>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum bloqueio ativo. A agenda segue o expediente normal.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {blocks.map((block) => (
            <li key={block.id} className="flex min-w-0 items-start gap-3 p-3">
              <CalendarOffIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{blockLabel(block)}</p>
                <p className="text-xs text-muted-foreground">{describeBlock(block)}</p>
              </div>
              {removingId === block.id ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setRemovingId(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() => void remove(block)}
                    disabled={busy}
                  >
                    Remover
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setRemovingId(block.id)}
                  aria-label={`Remover bloqueio ${blockLabel(block)}`}
                  className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Descrição legível do intervalo.
 *
 * Dia inteiro mostra só as datas — exibir "00:00 às 00:00" seria tecnicamente
 * correto e completamente inútil para quem lê.
 */
function describeBlock(block: AgendaBlock): string {
  if (block.allDay) {
    // O fim é exclusivo (meia-noite seguinte), então o último dia coberto é o
    // anterior — mostrar o fim cru anunciaria um dia a mais de férias.
    const lastDay = new Date(new Date(block.endsAt).getTime() - 60_000).toISOString();
    const from = formatLongDate(block.startsAt);
    const to = formatLongDate(lastDay);
    return from === to ? `${from} · dia inteiro` : `${from} até ${to} · dia inteiro`;
  }
  return `${formatDateTime(block.startsAt)} até ${formatDateTime(block.endsAt)}`;
}
