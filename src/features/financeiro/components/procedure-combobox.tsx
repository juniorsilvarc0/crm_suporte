"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  buildProcedureOptions,
  type Procedure,
  type ProcedureOption,
} from "@/features/financeiro/lib/procedure-options";
import { formatMoneyExact } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

/**
 * Campo "o que foi vendido": escolhe um procedimento do catálogo, cria um novo
 * na hora, ou arquiva um que não se usa mais.
 *
 * O catálogo desce por prop do servidor (como `columns` e `tags` no funil) e é
 * revalidado com `router.refresh()` depois de criar ou arquivar — sem estado
 * duplicado no cliente.
 *
 * O valor é o NOME, não o id: a venda guarda texto, então arquivar um
 * procedimento não apaga a escolha de quem está preenchendo (vira uma linha
 * "fora da lista", ver buildProcedureOptions).
 */
export function ProcedureCombobox({
  id,
  value,
  onChange,
  procedures,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (name: string, defaultAmount: number | null) => void;
  procedures: Procedure[];
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const inFlight = useRef(false);

  const options = useMemo(
    () => buildProcedureOptions({ items: procedures, term, selectedName: value }),
    [procedures, term, value]
  );

  function pick(option: ProcedureOption) {
    if (option.kind === "create") {
      void createProcedure(option.name);
      return;
    }
    onChange(option.name, option.defaultAmount);
    setTerm("");
  }

  async function createProcedure(name: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyName(name);
    try {
      const response = await fetch("/api/procedures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        procedure?: { name: string; default_amount: number | null } | null;
      };

      // 409 = alguém criou o mesmo procedimento em outra aba. Não é erro do
      // usuário: seleciona o que já existe e segue.
      if (response.status === 409) {
        onChange(result.procedure?.name ?? name, result.procedure?.default_amount ?? null);
        setTerm("");
        router.refresh();
        return;
      }
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível criar o procedimento.");
        return;
      }

      onChange(result.procedure?.name ?? name, result.procedure?.default_amount ?? null);
      setTerm("");
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o procedimento.");
    } finally {
      inFlight.current = false;
      setBusyName(null);
    }
  }

  async function archiveProcedure(procedureId: string, name: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyName(name);
    try {
      const response = await fetch(`/api/procedures/${procedureId}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover o procedimento.");
        return;
      }
      toast.success(`"${name}" saiu da lista.`);
      setConfirmingId(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível remover o procedimento.");
    } finally {
      inFlight.current = false;
      setBusyName(null);
    }
  }

  // Caminho de teclado do apagar: `option` é papel folha em ARIA, então um
  // botão focável dentro da linha não é anunciado de forma confiável. Delete
  // sobre o item destacado faz o mesmo que o botão do hover.
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
          if (typeof next === "string") onChange(next, null);
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
          placeholder="Busque ou crie um procedimento"
          aria-required="true"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onKeyDown={handleKeyDown}
        />
        <ComboboxTrigger aria-label="Abrir lista de procedimentos">
          <ChevronsUpDownIcon className="size-4" />
        </ComboboxTrigger>

        <ComboboxPopup>
          {options.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {procedures.length === 0
                ? "Nenhum procedimento ainda. Digite para criar o primeiro."
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
                    <ProcedureConfirmRow
                      key={key}
                      name={option.name}
                      busy={busy}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => {
                        if (option.kind === "catalog") {
                          void archiveProcedure(option.id, option.name);
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
                        {option.kind === "catalog" && option.defaultAmount !== null ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatMoneyExact(option.defaultAmount)}
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
                              // No mobile não existe hover: fica sempre visível.
                              // No desktop aparece no hover E no destaque de teclado.
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

// Confirmação NA PRÓPRIA LINHA. Um Dialog dentro do popup do combobox dentro do
// modal da venda seria armadilha de foco garantida.
function ProcedureConfirmRow({
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
