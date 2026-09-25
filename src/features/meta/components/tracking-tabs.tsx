"use client";

import { useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_TRACKING_TAB,
  parseTrackingTab,
  trackingTabLabels,
  trackingTabs,
  type TrackingTab,
} from "@/features/meta/tracking-tabs";

/**
 * As quatro operações da tela, uma por aba.
 *
 * ⚠️ **A aba troca sem ir ao servidor.** A página é `force-dynamic`: com
 * `router.replace`, cada clique numa aba refaria as quatro consultas e a Meta
 * junto, e a troca ganharia a mesma latência sem feedback que a Agenda já pagou.
 * Os quatro painéis já vêm renderizados do mesmo request — a troca é local, e o
 * `history.replaceState` só espelha o estado na URL, integrado ao router do Next
 * (`docs/01-app/01-getting-started/04-linking-and-navigating.md`).
 *
 * ⚠️ **A URL importa aqui, diferente de Configurações.** O período já está nela;
 * um link colado no WhatsApp tem que cair no mesmo período **e** na mesma aba.
 * Por isso a aba é controlada, e não `defaultValue`.
 */
export function TrackingTabs({
  initialTab,
  alerts,
  visao,
  custos,
  campanhas,
  entrega,
}: {
  initialTab: TrackingTab;
  /** Abas que precisam chamar atenção. Hoje só "entrega", quando a CAPI falha. */
  alerts?: Partial<Record<TrackingTab, string>>;
  visao: ReactNode;
  custos: ReactNode;
  campanhas: ReactNode;
  entrega: ReactNode;
}) {
  const [tab, setTab] = useState<TrackingTab>(initialTab);
  const panels: Record<TrackingTab, ReactNode> = { visao, custos, campanhas, entrega };

  function handleChange(value: unknown) {
    const next = parseTrackingTab(typeof value === "string" ? value : undefined);
    setTab(next);

    const url = new URL(window.location.href);
    if (next === DEFAULT_TRACKING_TAB) url.searchParams.delete("aba");
    else url.searchParams.set("aba", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <Tabs value={tab} onValueChange={handleChange} className="min-w-0 gap-5">
      <div className="overflow-x-auto overscroll-x-contain">
        <TabsList className="h-auto min-w-max gap-1 rounded-full bg-muted/60 p-1">
          {trackingTabs.map((value) => {
            const alert = alerts?.[value];
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="h-10 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground data-active:shadow-sm sm:h-9"
                // O ponto não é o único sinal: quem usa leitor de tela ouve o
                // motivo no nome da aba (UI.md §1.4).
                aria-label={alert ? `${trackingTabLabels[value]} — ${alert}` : undefined}
              >
                {trackingTabLabels[value]}
                {alert ? (
                  <span
                    aria-hidden
                    className="ms-0.5 size-1.5 shrink-0 rounded-full bg-destructive"
                  />
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {trackingTabs.map((value) => (
        <TabsContent key={value} value={value} className="min-w-0">
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
