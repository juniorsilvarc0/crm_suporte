"use client";

import { useState } from "react";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";

import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { cn } from "@/lib/utils";
import type { ColorName } from "@/features/tags/schemas/colors";

/** Cor inicial de etiqueta nova — a mesma do editor de tags do lead. */
export const DEFAULT_TAG_COLOR: ColorName = "violet";
const MAX_NAME = 30;

/**
 * Nome + cor de uma etiqueta. Serve para criar e para editar.
 *
 * Um formulário só para os três usos (criar no seletor da conversa, criar e
 * editar na tela de etiquetas): três cópias divergiriam no primeiro ajuste, e a
 * validação de nome repetido é justamente o que não pode divergir.
 *
 * Sem fundo próprio — herda a superfície de quem monta, para funcionar tanto na
 * gaveta quanto no sheet.
 */
export function TagForm({
  id,
  mode,
  initialName = "",
  initialColor = DEFAULT_TAG_COLOR,
  /** Nomes já em uso, para avisar antes de bater na rota. */
  takenNames,
  submitting,
  onSubmit,
}: {
  id: string;
  mode: "create" | "edit";
  initialName?: string;
  initialColor?: ColorName;
  takenNames: readonly string[];
  submitting: boolean;
  onSubmit: (name: string, color: ColorName) => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<ColorName>(initialColor);

  const trimmed = name.trim();
  // O próprio nome não conta como repetido ao editar — senão salvar só a cor
  // seria impossível.
  const duplicate =
    trimmed.length > 0 &&
    trimmed.toLowerCase() !== initialName.trim().toLowerCase() &&
    takenNames.some((taken) => taken.toLowerCase() === trimmed.toLowerCase());

  const blocked = submitting || trimmed.length === 0 || duplicate;

  const submit = () => {
    if (blocked) return;
    onSubmit(trimmed, color);
    if (mode === "create") {
      setName("");
      setColor(DEFAULT_TAG_COLOR);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {mode === "create" ? "Nome da etiqueta nova" : "Nome da etiqueta"}
        </label>
        <input
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
          maxLength={MAX_NAME}
          disabled={submitting}
          placeholder="Nome da etiqueta"
          // `text-base` no celular: abaixo de 16px o iOS dá zoom ao focar.
          className="min-h-11 w-full min-w-0 flex-1 rounded-lg border-0 bg-black/5 px-3 text-base text-foreground outline-none placeholder:text-[var(--wa-meta)] focus:ring-1 focus:ring-[var(--wa-green-deep)]/30 disabled:opacity-50 sm:text-[15px] dark:bg-white/10"
        />
        <button
          type="button"
          onClick={submit}
          disabled={blocked}
          aria-label={mode === "create" ? "Criar etiqueta" : "Salvar etiqueta"}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg",
            "bg-[var(--wa-green-deep)] text-white transition-opacity",
            "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          )}
        >
          {submitting ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : mode === "create" ? (
            <PlusIcon className="size-5" />
          ) : (
            <CheckIcon className="size-5" />
          )}
        </button>
      </div>

      {/* Avisa antes de enviar, não depois: a rota devolve 409 para nome
          repetido, e deixar apertar para só então descobrir é uma ida ao
          servidor inteira para dizer o que já dava para ver na tela. */}
      {duplicate ? (
        <p role="alert" className="pt-1.5 text-[13px] text-destructive">
          Já existe uma etiqueta com esse nome.
        </p>
      ) : null}

      <ColorSwatchPicker value={color} onChange={setColor} className="pt-3" />
    </div>
  );
}
