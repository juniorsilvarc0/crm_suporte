"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ReconcileContractsReport } from "@/features/customers/types";

type Totals = Pick<
  ReconcileContractsReport,
  "processed" | "ok" | "notFound" | "unavailable" | "ambiguous" | "skipped" | "contractsUpserted"
>;
const ZERO: Totals = {
  processed: 0,
  ok: 0,
  notFound: 0,
  unavailable: 0,
  ambiguous: 0,
  skipped: 0,
  contractsUpserted: 0,
};

/**
 * Reconciliação em massa dos contratos da TCBX (só admin): para cada empresa com
 * CNPJ, consulta a fonte e espelha os contratos no banco (read-only). Roda em
 * levas por cursor (a rota é idempotente): repete `POST` até `done`. O passo de
 * confirmação evita disparar sem querer. Aborta se a integração estiver
 * desligada (not_configured).
 */
export function SyncContractsButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done">("idle");
  const [totals, setTotals] = useState<Totals>(ZERO);

  async function run() {
    setPhase("running");
    setTotals(ZERO);
    let acc = { ...ZERO };
    let after: string | null = null;
    try {
      for (let guard = 0; guard < 500; guard += 1) {
        const response = await fetch("/api/customers/sync-contracts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 50, after }),
        });
        const body = (await response.json()) as {
          ok: boolean;
          message?: string;
          report?: ReconcileContractsReport;
        };
        if (!body.ok || !body.report) {
          toast.error(body.message ?? "Falha ao sincronizar os contratos.");
          setPhase("idle");
          return;
        }
        const r = body.report;
        acc = {
          processed: acc.processed + r.processed,
          ok: acc.ok + r.ok,
          notFound: acc.notFound + r.notFound,
          unavailable: acc.unavailable + r.unavailable,
          ambiguous: acc.ambiguous + r.ambiguous,
          skipped: acc.skipped + r.skipped,
          contractsUpserted: acc.contractsUpserted + r.contractsUpserted,
        };
        setTotals(acc);
        after = r.cursor;
        if (r.notConfigured) {
          toast.error("A integração com a TCBX está desligada (configure a fonte em Ajustes).");
          setPhase("idle");
          return;
        }
        if (r.done) break;
      }
      setPhase("done");
      router.refresh();
      toast.success(
        `Concluído: ${acc.contractsUpserted} contrato(s) em ${acc.ok} empresa(s) sincronizada(s).`
      );
    } catch {
      toast.error("Falha de rede ao sincronizar os contratos.");
      setPhase("idle");
    }
  }

  if (phase === "confirm") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Consultar a TCBX e espelhar os contratos de todas as empresas com CNPJ?
        </span>
        <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPhase("idle")}>
          Cancelar
        </Button>
        <Button className="h-11 sm:h-9" onClick={run}>
          Sincronizar
        </Button>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Button disabled className="h-11 sm:h-9">
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
        Sincronizando… {totals.contractsUpserted} contrato(s)
      </Button>
    );
  }

  return (
    <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPhase("confirm")}>
      {phase === "done" ? "Sincronizar contratos de novo" : "Sincronizar contratos (TCBX)"}
    </Button>
  );
}
