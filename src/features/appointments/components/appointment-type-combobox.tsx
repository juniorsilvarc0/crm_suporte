"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronsUpDownIcon, Loader2Icon, PlusIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import type { AppointmentType } from "@/features/appointments/lib/agenda-config";
import {
  buildAppointmentTypeOptions,
  type AppointmentTypeOption,
} from "@/features/appointments/lib/appointment-type-options";
import { cn } from "@/lib/utils";

/**
 * Campo "tipo de atendimento": escolhe do catálogo, cria na hora, ou arquiva o
 * que não se usa mais. Mesmo desenho do combobox de procedimentos da venda.
 *
 * ⚠️ **Não usa `router.refresh()`, diferente do irmão do financeiro.** Lá o
 * catálogo desce por prop de um Server Component; aqui ele é buscado quando o
 * modal abre, então revalidar a rota não traria a lista nova. Quem manda a
 * mudança de volta é `onCatalogChange`.
 */
export function AppointmentTypeCombobox({
  id,
  value,
  onChange,
  types,
  onCatalogChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (name: string) => void;
  types: AppointmentType[];
  onCatalogChange: (types: AppointmentType[]) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const inFlight = useRef(false);

  const options = useMemo(
    () => buildAppointmentTypeOptions({ items: types, term, selectedName: value }),
    [types, term, value]
  );

  function pick(option: AppointmentTypeOption) {
    if (option.kind === "create") {
      void createType(option.name);
      return;
    }
    onChange(option.name);
    setTerm("");
  }

  async function createType(name: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyName(name);
    try {
      const response = await fetch("/api/agenda/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        appointmentType?: AppointmentType | null;
      };

      // 409 = criado em outra aba enquanto isto estava aberto. Não é erro de
      // quem digitou: seleciona o que já existe e segue.
      if (response.status === 409) {
        const existing = result.appointmentType;
        if (existing) {
          onCatalogChange(mergeType(types, existing));
          onChange(existing.name);
        } else {
          onChange(name);
        }
        setTerm("");
        return;
      }
      if (!response.ok || !result.ok || !result.appointmentType) {
        toast.error(result.message ?? "Não foi possível criar o tipo de atendimento.");
        return;
      }

      onCatalogChange(mergeType(types, result.appointmentType));
      onChange(result.appointmentType.name);
      setTerm("");
    } catch {
      toast.error("Não foi possível criar o tipo de atendimento.");
    } finally {
      inFlight.current = false;
      setBusyName(null);
    }
  }

  async function archiveType(typeId: string, name: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyName(name);
    try {
      const response = await fetch(`/api/agenda/types/${typeId}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover o tipo.");
        return;
      }
      toast.success(`"${name}" saiu da lista.`);
      setConfirmingId(null);
      onCatalogChange(types.filter((type) => type.id !== typeId));
    } catch {
      toast.error("Não foi possível remover o tipo.");
    } finally {
      inFlight.current = false;
      setBusyName(null);
    }
  }

  // Caminho de teclado do apagar: `option` é papel folha em ARIA, então botão
  // focável dentro da linha não é anunciado de forma confiável.
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Delete") return;
    const target = options.find(
      (option) => option.kind === "catalog" && option.name === highlighted
    );
    if (!target || target.kind !== "catalog") return;
    event.preventDefault();
    setConfirmingId(target.id);
  }

  return (
    <div className="relative">
      <Combobox<string>
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
        inputValue={term || value}
        onInputValueChange={(next) => setTerm(next)}
        onItemHighlighted={(item) =>
          setHighlighted(typeof item === "string" ? item : null)
        }
        openOnInputClick
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          className="pe-9"
          placeholder="Busque ou crie um tipo de atendimento"
          aria-required="true"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onKeyDown={handleKeyDown}
        />
        <ComboboxTrigger aria-label="Abrir lista de tipos de atendimento">
          <ChevronsUpDownIcon className="size-4" />
        </ComboboxTrigger>

        <ComboboxPopup>
          {options.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {types.length === 0
                ? "Nenhum tipo ainda. Digite para criar o primeiro."
                : "Nada encontrado. Digite ao menos 2 letras para criar."}
            </p>
          ) : (
            <ComboboxList>
              {options.map((option) => {
                const key = option.id ?? `${option.kind}:${option.name}`;
                const confirming = option.kind === "catalog" && confirmingId === option.id;
                const busy = busyName === option.name;

                if (confirming) {
                  return (
                    <TypeConfirmRow
                      key={key}
                      name={option.name}
                      busy={busy}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => {
                        if (option.kind === "catalog") {
                          void archiveType(option.id, option.name);
                        }
                      }}
                    />
                  );
                }

                return (
                  <ComboboxItem
                    key={key}
                    value={option.name}
                    onClick={() => pick(option)}
                    className={cn(option.kind === "create" && "text-primary")}
                  >
                    {option.kind === "create" ? (
                      <>
                        {busy ? (
                          <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden />
                        ) : (
                          <PlusIcon className="size-4 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          Criar &ldquo;{option.name}&rdquo;
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        {option.kind === "orphan" ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            fora da lista
                          </span>
                        ) : null}
                        {option.kind === "catalog" ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden
                            title={`Remover ${option.name} da lista`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              setConfirmingId(option.id);
                            }}
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
                              // No toque não existe hover: fica sempre visível.
                              "opacity-100 sm:opacity-0 sm:group-hover/combobox-item:opacity-100 sm:group-data-[highlighted]/combobox-item:opacity-100"
                            )}
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        ) : null}
                      </>
                    )}
                  </ComboboxItem>
                );
              })}
            </ComboboxList>
          )}
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

function mergeType(types: AppointmentType[], added: AppointmentType): AppointmentType[] {
  const rest = types.filter((type) => type.id !== added.id);
  return [...rest, added].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Confirmação NA PRÓPRIA LINHA. Um Dialog dentro do popup do combobox dentro do
// modal seria armadilha de foco garantida (UI.md §5.6).
function TypeConfirmRow({
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex min-h-11 items-center gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-sm"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="min-w-0 flex-1 truncate text-xs">
        Remover &ldquo;{name}&rdquo; da lista?
      </span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={onCancel}
        disabled={busy}
        className="shrink-0"
      >
        Cancelar
      </Button>
      <Button
        type="button"
        size="xs"
        variant="destructive"
        onClick={onConfirm}
        disabled={busy}
        autoFocus
        className="shrink-0"
      >
        {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
        Remover
      </Button>
    </div>
  );
}
