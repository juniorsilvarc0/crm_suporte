"use client";

import { type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Data e hora do agendamento, em dois campos.
 *
 * ⚠️ **Não use `input[type=datetime-local]` aqui.** Ele tem largura intrínseca
 * própria — os segmentos internos (dd/mm/aaaa, hh:mm) são desenhados pelo
 * navegador num tamanho que `w-full min-w-0` não encolhe. Numa coluna estreita
 * o conteúdo escapava da moldura, e era isso que aparecia como transbordo.
 *
 * Separado também é melhor no toque: o celular abre o seletor de calendário e o
 * de relógio, cada um com a roda certa, em vez de um controle combinado que no
 * iOS vira uma lista longa.
 *
 * O valor de fora continua sendo `"AAAA-MM-DDTHH:MM"`, que é o que a rota
 * espera — a divisão é de apresentação, não de contrato.
 */
export function DateTimeFields({
  value,
  onChange,
  error,
  idPrefix,
  children,
}: {
  /** `"AAAA-MM-DDTHH:MM"`. */
  value: string;
  onChange: (next: string) => void;
  error?: string;
  idPrefix: string;
  /** Campo extra na mesma linha da hora (duração, normalmente). */
  children?: ReactNode;
}) {
  const dateValue = value.slice(0, 10);
  const timeValue = value.slice(11, 16);

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${idPrefix}-date`}>
            <span>
              Data<span className="text-primary"> *</span>
            </span>
          </Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={dateValue}
            // Hora ausente vira 09:00 em vez de string quebrada: escolher a data
            // primeiro é o caminho natural, e um valor pela metade faria o
            // formulário recusar sem explicar o motivo.
            onChange={(event) => onChange(`${event.target.value}T${timeValue || "09:00"}`)}
            aria-invalid={Boolean(error)}
            className={cn("h-11 sm:h-10", error && "border-destructive")}
          />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${idPrefix}-time`}>
            <span>
              Hora<span className="text-primary"> *</span>
            </span>
          </Label>
          <Input
            id={`${idPrefix}-time`}
            type="time"
            value={timeValue}
            onChange={(event) => onChange(`${dateValue}T${event.target.value}`)}
            aria-invalid={Boolean(error)}
            className={cn("h-11 tabular-nums sm:h-10", error && "border-destructive")}
          />
        </div>
      </div>

      {children}

      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
