"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import type { ConnectionStatus } from "@/features/connection/types";
import { formatDateTime } from "@/lib/formatters/date";

const POLL_MS = 60_000;

/**
 * Aviso no topo de todas as telas enquanto o WhatsApp estiver desconectado,
 * segundo o monitor (worker). Em 2026-10-08 a sessão caiu às 16:06 e ninguém
 * soube por 15 horas — os clientes escreviam e nada chegava ao CRM.
 *
 * Busca o estado sozinho (ao montar, a cada minuto e ao voltar para a aba): o
 * layout não roda de novo na navegação pelo cliente, e o aviso precisa sumir
 * assim que a conexão voltar. A rota só lê o banco, nunca o provedor.
 *
 * Só "desconectado" e "conectando" (esperando o QR) acendem o aviso. Provedor
 * sem resposta (`unknown`) não: não dá para afirmar que a sessão caiu.
 */
export function WhatsappConnectionBanner({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetch("/api/connection/status", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { status?: ConnectionStatus } | null) => {
          // Falha de leitura não apaga o último estado conhecido nem inventa um.
          if (active && data?.status) setStatus(data.status);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const current = status?.configured ? status.current : null;
  const visible = current !== null && (current.state === "close" || current.state === "connecting");

  // As telas de altura cheia (chat, agenda) descontam `--app-chrome-top`: o
  // aviso publica a própria altura em `--app-alert-height` enquanto aparece,
  // senão ele empurraria a tela e a página ganharia rolagem.
  useEffect(() => {
    const root = document.documentElement;
    const element = ref.current;
    if (!visible || !element) {
      root.style.removeProperty("--app-alert-height");
      return;
    }
    const apply = () => root.style.setProperty("--app-alert-height", `${element.offsetHeight}px`);
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--app-alert-height");
    };
  }, [visible]);

  if (!visible || !current) return null;

  return (
    <div
      ref={ref}
      role="alert"
      className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-foreground sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-x-3 gap-y-1">
        <TriangleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">WhatsApp desconectado desde {formatDateTime(current.occurredAt)}.</span>{" "}
          As mensagens dos clientes não estão chegando ao CRM.
          {current.reason ? <span className="text-muted-foreground"> Motivo informado: {current.reason}.</span> : null}
        </p>
        {isAdmin ? (
          <Link
            href="/app/conexao"
            className="shrink-0 rounded-sm font-medium text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Reconectar em Integrações
          </Link>
        ) : (
          <span className="shrink-0 text-muted-foreground">Avise um administrador.</span>
        )}
      </div>
    </div>
  );
}
