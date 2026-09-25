import { cn } from "@/lib/utils";

// Iniciais do contato para varredura visual em lista/kanban.
//
// Tom ÚNICO e neutro de propósito: no funil a cor significa etapa. Dar uma cor
// por pessoa (hash do nome) injetaria matiz sem significado e competiria com a
// leitura da etapa — ver UI.md §Anti-padrões, "matiz decorativo".
const sizeClasses = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  // Emoji e símbolos viram "?" em vez de um quadrado cortado.
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const raw = parts.length === 1 ? first.slice(0, 2) : `${first[0] ?? ""}${last[0] ?? ""}`;
  const letters = raw.replace(/[^\p{L}\p{N}]/gu, "");
  return letters ? letters.toUpperCase() : "?";
}

export function AvatarInitials({
  name,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
        sizeClasses[size],
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
