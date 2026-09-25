"use client";

import { CheckIcon } from "lucide-react";

import { BOARD_COLOR_NAMES, colorStyle, type ColorName } from "@/features/leads/schemas/colors";
import { cn } from "@/lib/utils";

export function ColorSwatchPicker({
  value,
  onChange,
  className,
}: {
  value: ColorName;
  onChange: (color: ColorName) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="radiogroup" aria-label="Cor">
      {BOARD_COLOR_NAMES.map((name) => {
        const active = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={name}
            onClick={() => onChange(name)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full ring-2 ring-offset-1 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-ring",
              colorStyle[name].solid,
              active ? "ring-foreground/40" : "ring-transparent"
            )}
          >
            {active ? <CheckIcon className="size-3.5 text-white" /> : null}
          </button>
        );
      })}
    </div>
  );
}
