import { badgeVariants } from "@/components/ui/badge";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";

/**
 * Selo READ-ONLY: a empresa tem contrato ATIVO na fonte externa (TCBX). Espelha
 * o ContractStatusBadge (mesmas classes, `<span>` puro, server-renderável), mas
 * em verde e com a origem explícita — é dado de terceiro, não o contrato interno.
 */
export function ExternalContractBadge({ className }: { className?: string }) {
  const label = "Contrato ativo (TCBX)";
  return (
    <span
      data-slot="badge"
      title={label}
      className={cn(
        badgeVariants({ variant: "outline" }),
        getColorStyle("emerald").badge,
        "max-w-full",
        className
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
