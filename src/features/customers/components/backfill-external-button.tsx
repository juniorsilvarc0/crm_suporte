"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { BackfillReport } from "@/features/customers/types";

type Totals = Pick<
  BackfillReport,
  "processed" | "created" | "reused" | "linked" | "notFound" | "skippedPf" | "errors"
>;
const ZERO: Totals = {
  processed: 0,
  created: 0,
  reused: 0,
  linked: 0,
  notFound: 0,
  skippedPf: 0,
  errors: 0,
};

/**
 * Cadastro em massa de empresas a partir da TCBX (só admin). Consulta a fonte
 * pelo TELEFONE de cada contato sem empresa e cadastra/vincula os clientes.
 * Roda em levas (a rota é idempotente): repete `POST` até `remaining` zerar. O
 * passo de confirmação evita disparar sem querer.
 */
export function BackfillExternalButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done">("idle");
  const [totals, setTotals] = useState<Totals>(ZERO);

  async function run() {
    setPhase("running");
    setTotals(ZERO);
    let acc = { ...ZERO };
    try {
      // Teto de levas: evita laço infinito se a rota devolvesse `remaining` > 0 sempre.
      for (let guard = 0; guard < 200; guard += 1) {
        const response = await fetch("/api/customers/backfill-external", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apply: true, limit: 50 }),
        });
        const body = (await response.json()) as { ok: boolean; message?: string; report?: BackfillReport };
        if (!body.ok || !body.report) {
          toast.error(body.message ?? "Falha no cadastro em massa.");
          setPhase("idle");
          return;
        }
        const r = body.report;
        acc = {
          processed: acc.processed + r.processed,
          created: acc.created + r.created,
          reused: acc.reused + r.reused,
          linked: acc.linked + r.linked,
          notFound: acc.notFound + r.notFound,
          skippedPf: acc.skippedPf + r.skippedPf,
          errors: acc.errors + r.errors,
        };
        setTotals(acc);
        if (r.remaining === 0) break;
      }
      setPhase("done");
      router.refresh();
      toast.success(`Concluído: ${acc.created} empresa(s) criada(s), ${acc.linked} contato(s) vinculado(s).`);
    } catch {
      toast.error("Falha de rede no cadastro em massa.");
      setPhase("idle");
    }
  }

  if (phase === "confirm") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Consultar a TCBX pelo telefone dos contatos sem empresa e cadastrar os clientes?
        </span>
        <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPhase("idle")}>
          Cancelar
        </Button>
        <Button className="h-11 sm:h-9" onClick={run}>
          Importar
        </Button>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Button disabled className="h-11 sm:h-9">
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
        Importando… {totals.created} criada(s) · {totals.linked} vinculada(s)
      </Button>
    );
  }

  return (
    <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPhase("confirm")}>
      {phase === "done" ? "Importar da TCBX de novo" : "Importar da TCBX"}
    </Button>
  );
}
