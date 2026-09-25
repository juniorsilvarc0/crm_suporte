"use client";

import { useEffect, useRef, useState } from "react";
import { FileTextIcon, Loader2Icon, MicIcon, PauseIcon, PlayIcon, UserRoundIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/features/chat/types";

type AudioMessageProps = {
  message: ChatMessage;
  isOutbound: boolean;
};

const RATES = [1, 1.5, 2] as const;

function fmt(t: number): string {
  if (!t || !isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function AudioMessage({ message, isOutbound }: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);

  /**
   * O <audio> vive só enquanto a bolha está perto da viewport.
   *
   * Antes ele montava ao chegar perto e **nunca mais saía**. Numa conversa com
   * 21 áudios (existe em produção, e são 1.521 no total) isso deixava 21
   * elementos de mídia vivos, cada um com seu carregador, num processo que no
   * iPhone morre por volta de 100 MB.
   *
   * Sair da tela agora desmonta — MENOS enquanto o áudio está tocando ou
   * pausado no meio: cortar ali interromperia a reprodução, e ouvir enquanto se
   * rola a conversa é justamente o uso normal. Quando o áudio **acaba**, o
   * elemento é liberado de novo; sem isso, ouvir os 21 áudios de uma conversa
   * deixava os 21 presos, que é o estado que esta otimização evita.
   *
   * A duração medida fica no estado do componente, que não desmonta junto: o
   * rótulo continua na tela mesmo com o elemento fora do DOM.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  /** Está tocando agora: enquanto durar, o elemento não sai do DOM. */
  const pinned = useRef(false);
  /** Play pedido com o elemento fora do DOM — toca assim que ele montar. */
  const autoPlay = useRef(false);

  useEffect(() => {
    const node = rootRef.current;
    // Sem IntersectionObserver (jsdom nos testes, navegador antigo): monta logo,
    // que é o comportamento de antes desta otimização.
    if (!node || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }

    // ⚠️ DOIS limiares, de propósito. Com um só, montar e desmontar acontecem
    // na MESMA linha: rolar até o topo de uma conversa com 21 áudios e voltar
    // custava ~42 requisições de metadata, contra 21 uma única vez antes desta
    // otimização — pior que o problema que ela resolve. A faixa morta de
    // 1200px entre montar e desmontar mata o repique.
    const mountObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setMounted(true);
      },
      { rootMargin: "600px 0px" }
    );
    const unmountObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) return;
        if (pinned.current) return;
        setMounted(false);
      },
      { rootMargin: "1800px 0px" }
    );
    mountObserver.observe(node);
    unmountObserver.observe(node);
    return () => {
      mountObserver.disconnect();
      unmountObserver.disconnect();
    };
  }, []);

  // Transcription
  const existing = (message.metadata as { transcription?: string })?.transcription;
  const [transcription, setTranscription] = useState<string | null>(existing ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const togglePlay = () => {
    const a = audioRef.current;
    // Fora da tela o elemento nem existe. Monta e toca quando ele chegar.
    if (!a) {
      pinned.current = true;
      autoPlay.current = true;
      setMounted(true);
      return;
    }
    if (playing) a.pause();
    else void a.play().catch(() => setPlaying(false));
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const seek = (value: number) => {
    // Antes da guarda: arrastar a barra é mexer no player, e o `pinned` tem de
    // valer mesmo no caso em que o elemento ainda não montou.
    pinned.current = true;
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = value;
    setCurrent(a.currentTime);
  };

  const transcribe = async () => {
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await fetch(`/api/chat/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      const json = (await res.json()) as { transcription?: string; error?: string };
      if (!res.ok || !json.transcription) {
        throw new Error(json.error ?? "Falha na transcrição");
      }
      setTranscription(json.transcription);
    } catch (err) {
      setTranscribeError(
        err instanceof Error ? err.message : "Não foi possível transcrever."
      );
    } finally {
      setTranscribing(false);
    }
  };

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div
      ref={rootRef}
      // Foco monta o elemento. O `onFocus` do React borbulha (é `focusin`), então
      // cobre o botão de tocar E a barra de posição: chegar neles pelo Tab com a
      // bolha fora da tela deixava o clique sem efeito e o arraste voltando
      // sozinho, porque o `<audio>` não estava no DOM.
      onFocus={() => setMounted(true)}
      className="flex w-[15.5rem] max-w-full flex-col gap-1.5 sm:w-[18rem]"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pausar" : "Reproduzir"}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40 sm:size-10",
            isOutbound
              ? "bg-[var(--wa-out-text)]/15 text-[var(--wa-out-text)]"
              : "bg-[var(--wa-meta)]/20 text-[var(--wa-in-text)]"
          )}
        >
          {playing ? (
            <PauseIcon className="size-4" />
          ) : (
            <PlayIcon className="size-4 translate-x-px" />
          )}
        </button>

        <div className="min-w-0 flex-1 pt-1">
          <div className="relative flex h-8 items-center gap-0.5 rounded focus-within:ring-2 focus-within:ring-[var(--wa-tick)]/50">
            {waveformBars.map((height, index) => (
              <span
                key={index}
                className={cn("w-0.5 flex-1 rounded-full", index / waveformBars.length * 100 <= pct ? "bg-[var(--wa-tick)]" : "bg-current/35")}
                style={{ height }}
                aria-hidden
              />
            ))}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(current, duration || 1)}
              onChange={(event) => seek(Number(event.target.value))}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label="Posição do áudio"
              aria-valuetext={`${fmt(current)} de ${fmt(duration)}`}
            />
          </div>
          <div className="flex justify-between text-[10px] tabular-nums opacity-70">
            <span>{fmt(playing || current ? current : duration)}</span>
            <button
              type="button"
              onClick={cycleRate}
              className="rounded px-1 font-semibold hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
              aria-label={`Velocidade ${rate}x`}
            >
              {rate}×
            </button>
          </div>
        </div>

        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-current/10" aria-hidden>
          <UserRoundIcon className="size-5 opacity-60" />
          <span className="absolute -bottom-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--wa-tick)] text-white">
            <MicIcon className="size-2.5" />
          </span>
        </div>
      </div>

      {/* O <audio> entra no DOM perto da tela e SAI quando ela passa — ver o
          comentário do observer acima. `preload="metadata"` é uma requisição
          por áudio: numa conversa longa são dezenas disparando juntas. */}
      {mounted && (
      <audio
        ref={audioRef}
        src={message.media_url ?? undefined}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d)) setDuration(d);
          // Remontagem zera a velocidade escolhida; devolve a que está na tela.
          e.currentTarget.playbackRate = rate;
          if (autoPlay.current) {
            autoPlay.current = false;
            void e.currentTarget.play().catch(() => setPlaying(false));
          }
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => {
          pinned.current = true;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          // ⚠️ Solta o elemento quando o áudio ACABA. Sem isto, ouvir os 21
          // áudios de uma conversa deixava os 21 presos no DOM — exatamente o
          // estado que esta otimização existe para evitar, e no uso mais comum
          // que há. Pausado continua preso: quem pausou vai voltar.
          pinned.current = false;
          setPlaying(false);
        }}
      />
      )}

      {/* Transcription */}
      {transcription ? (
        <div className="rounded-lg bg-current/8 px-2.5 py-1.5">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold opacity-60">
            <FileTextIcon className="size-2.5" /> Transcrição
          </p>
          <p className="text-[13px] leading-snug opacity-90">{transcription}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={transcribe}
          disabled={transcribing}
          className="flex min-h-9 items-center gap-1 self-start text-[11px] font-medium text-[var(--wa-tick)] hover:underline disabled:opacity-60"
        >
          {transcribing ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <FileTextIcon className="size-3" />
          )}
          {transcribing ? "Transcrevendo..." : "Transcrever áudio"}
        </button>
      )}
      {transcribeError && (
        <p className="text-[10px] text-red-400">{transcribeError}</p>
      )}
    </div>
  );
}

const waveformBars = [12, 18, 9, 24, 16, 28, 13, 20, 8, 25, 17, 30, 14, 22, 10, 26, 18, 29, 12, 21, 15, 27, 9, 23, 16, 28, 11, 20, 14, 24, 10, 18];
