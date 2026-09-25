"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, UserPlusIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ClienteOption = { id: string; name: string | null; phone: string | null };

export type ClienteSelection =
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string }
  | null;

/**
 * Combobox de leads com busca incremental no servidor (máx. 20 resultados por consulta).
 * Substitui o <select> que carregava os ~3 mil clientes de uma vez.
 * Permite criar um cliente novo na hora quando a busca não encontra ninguém.
 */
export function ClienteCombobox({
  defaultClientId,
  defaultClientName,
  onChange,
  inputId,
  allowCreate = true,
}: {
  defaultClientId?: string | null;
  defaultClientName?: string | null;
  onChange?: (selection: ClienteSelection) => void;
  inputId?: string;
  allowCreate?: boolean;
}) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [selection, setSelection] = useState<ClienteSelection>(
    defaultClientId && defaultClientName
      ? { kind: "existing", id: defaultClientId, name: defaultClientName }
      : null,
  );
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<ClienteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  function emit(next: ClienteSelection) {
    setSelection(next);
    onChange?.(next);
  }

  // Busca debounced sempre que o termo muda e o painel está aberto.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        setItems(Array.isArray(json.items) ? json.items : []);
        setHighlight(0);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, open]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const trimmed = term.trim();
  const hasExactMatch = items.some(
    (item) => (item.name ?? "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const showCreate = allowCreate && trimmed.length >= 2 && !hasExactMatch;
  // Índice virtual da opção "criar" (fica após a lista).
  const createIndex = items.length;
  const optionCount = items.length + (showCreate ? 1 : 0);

  function selectExisting(item: ClienteOption) {
    emit({ kind: "existing", id: item.id, name: item.name ?? "Sem nome" });
    setOpen(false);
  }

  function selectCreate() {
    emit({ kind: "new", name: trimmed });
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, optionCount - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlight === createIndex && showCreate) selectCreate();
      else if (items[highlight]) selectExisting(items[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Cliente</Label>

      {/* Campos enviados no FormData do contrato. */}
      <input type="hidden" name="lead_id" value={selection?.kind === "existing" ? selection.id : ""} />
      <input type="hidden" name="new_client_name" value={selection?.kind === "new" ? selection.name : ""} />

      <div ref={wrapperRef} className="relative">
        {selection ? (
          <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {selection.kind === "new" ? (
                <UserPlusIcon className="size-4 shrink-0 text-primary" />
              ) : (
                <CheckIcon className="size-4 shrink-0 text-emerald-600" />
              )}
              <span className="truncate">{selection.name}</span>
              {selection.kind === "new" ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  novo
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => {
                emit(null);
                setTerm("");
                setOpen(true);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Trocar cliente"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              id={id}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-listbox`}
              autoComplete="off"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Digite o nome do cliente…"
              className="h-10 pr-9"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              {loading ? <Loader2Icon className="size-4 animate-spin" /> : <ChevronsUpDownIcon className="size-4" />}
            </span>
          </div>
        )}

        {open && !selection ? (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
          >
            {items.map((item, index) => (
              <li key={item.id} role="option" aria-selected={highlight === index}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => selectExisting(item)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    highlight === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <span className="truncate">{item.name ?? "Sem nome"}</span>
                  {item.phone ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.phone}</span>
                  ) : null}
                </button>
              </li>
            ))}

            {showCreate ? (
              <li role="option" aria-selected={highlight === createIndex}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(createIndex)}
                  onClick={selectCreate}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    highlight === createIndex ? "bg-primary/10 text-primary" : "text-primary hover:bg-primary/10",
                  )}
                >
                  <UserPlusIcon className="size-4 shrink-0" />
                  <span className="truncate">
                    Criar cliente “<span className="font-medium">{trimmed}</span>”
                  </span>
                </button>
              </li>
            ) : null}

            {!loading && items.length === 0 && !showCreate ? (
              <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                {trimmed ? "Nenhum cliente encontrado." : "Digite para buscar um cliente."}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {allowCreate
          ? "Busque pelo nome. Se o cliente não existir, crie na hora ao registrar a venda."
          : "Busque pelo nome ou use a aba de novo cliente para cadastrar com telefone."}
      </p>
    </div>
  );
}
