"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2Icon, PlusIcon, SearchIcon, CheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/forms/form-select";
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
import type { BoardColumn } from "@/features/board/types";
import {
  getLeadStatusLabel,
  leadStatusLabel,
  leadStatusOrder,
  tipoServicoOptions,
} from "@/features/leads/schemas/status";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type LeadHit = { id: string; name: string | null; phone: string | null };

// Diálogo "Novo card": adiciona um deal (card do funil) a um lead existente.
// É o caminho para o cliente recorrente ganhar um card por agendamento.
export function CreateDealDialog({
  columns,
  defaultStage,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: {
  columns?: BoardColumn[];
  defaultStage?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const router = useRouter();
  const [pending, setPending] = useState(false);

  const stageOptions =
    columns && columns.length > 0
      ? columns.map((c) => ({ key: c.key, label: c.label }))
      : leadStatusOrder.map((k) => ({ key: k, label: leadStatusLabel[k] ?? k }));
  const entryStage = defaultStage ?? stageOptions[0]?.key ?? "novo";

  // Busca de lead (typeahead) — /api/leads/search.
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState<LeadHit | null>(null);

  useEffect(() => {
    if (!open) return;
    if (lead) return; // já escolhido — não fica buscando
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(term)}`);
        const json = (await res.json()) as { ok: boolean; items?: LeadHit[] };
        setHits(json.items ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [term, open, lead]);

  const formRef = useRef<HTMLFormElement>(null);

  // Fecha e limpa o estado (no handler, não em effect — evita cascata de render).
  function closeAndReset() {
    setTerm("");
    setHits([]);
    setLead(null);
    setPending(false);
    setOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lead) {
      toast.error("Escolha um cliente para o card.");
      return;
    }
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      leadId: lead.id,
      stage: String(formData.get("stage") || entryStage),
    };
    const tipo = String(formData.get("tipo_ensaio") || "").trim();
    const valor = String(formData.get("valor") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    if (tipo) payload.tipo_ensaio = tipo;
    if (valor) payload.valor = Number(valor);
    if (notes) payload.notes = notes;

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível criar o card.");
        return;
      }
      toast.success("Card criado.");
      closeAndReset();
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o card.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {!hideTrigger ? (
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Novo card
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeAndReset())}>
        <DialogContent className="flex h-[95dvh] w-[97vw] max-w-[97vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b border-border/70 px-5 pt-5 pb-4">
            <DialogTitle>Novo card no funil</DialogTitle>
            <DialogDescription>
              Adiciona um agendamento/oportunidade para um cliente existente
              {defaultStage ? ` · ${getLeadStatusLabel(defaultStage)}` : ""}. O
              contato não é duplicado.
            </DialogDescription>
          </DialogHeader>

          <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-5 overflow-y-auto px-5 py-5">
              {/* Cliente */}
              <div className="grid gap-2">
                <Label>
                  Cliente <span className="text-primary">*</span>
                </Label>
                {lead ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {lead.name ?? "Sem nome"}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground tabular-nums">
                        {formatPhone(lead.phone)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLead(null)}
                    >
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        placeholder="Buscar por nome ou telefone…"
                        className="h-11 pl-9"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60">
                      {searching ? (
                        <p className="px-3 py-2.5 text-sm text-muted-foreground">Buscando…</p>
                      ) : hits.length === 0 ? (
                        <p className="px-3 py-2.5 text-sm text-muted-foreground">
                          Nenhum cliente. Crie o lead primeiro (botão “Novo lead”).
                        </p>
                      ) : (
                        hits.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => setLead(h)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">{h.name ?? "Sem nome"}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground tabular-nums">
                                {formatPhone(h.phone)}
                              </span>
                            </span>
                            <CheckIcon className="size-4 shrink-0 opacity-0" />
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Etapa</Label>
                  <FormSelect name="stage" defaultValue={entryStage} aria-label="Etapa do funil" options={stageOptions.map((stage) => ({ value: stage.key, label: stage.label }))} />
                </div>

                <div className="grid gap-2">
                  <Label>Tipo de serviço</Label>
                  <FormSelect name="tipo_ensaio" defaultValue="" emptyLabel="Não informado" aria-label="Tipo de serviço" options={tipoServicoOptions} />
                </div>

                <div className="grid gap-2">
                  <Label>Valor (R$)</Label>
                  <Input
                    name="valor"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Ex.: 1200"
                    className="h-11"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Notas</Label>
                <Textarea
                  name="notes"
                  placeholder="Contexto do agendamento."
                  className="min-h-20 resize-none"
                />
              </div>
            </div>

            <DialogFooter className="shrink-0 m-0 flex-col-reverse gap-2 rounded-b-xl border-t border-border/70 bg-card/95 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={closeAndReset}
                disabled={pending}
                className="h-11 sm:h-9"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !lead} className={cn("h-11 sm:h-9")}>
                {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Criar card
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
