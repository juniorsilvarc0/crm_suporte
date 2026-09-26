import { badgeVariants } from "@/components/ui/badge";
import {
  CONTRACT_STATUS_COLOR,
  contractSealLabel,
  type ContractStatus,
} from "@/features/contracts/lib/contract-status";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";

/**
 * Selo do contrato: "Contrato ativo", "Contrato suspenso", "Contrato encerrado"
 * ou, sem status, "Sem contrato" em texto discreto.
 *
 * O texto está SEMPRE presente — a cor só reforça (UI.md §1.4). Usa as classes
 * do `Badge` (`badgeVariants`) num `<span>` puro, sem o `useRender` do
 * primitivo: assim renderiza igual em server e client component.
 *
 * Largura variável em coluna estreita (UI.md §5.6.1): `max-w-full` no selo e
 * `min-w-0` no texto para o `truncate` agir. Em linha flex, quem chama embrulha
 * num `div min-w-0`. Fica fora do chat qualquer token `--wa-*`: a paleta de
 * domínio já funciona sobre o cartão do painel nos dois temas.
 */
export function ContractStatusBadge({
  status,
  className,
}: {
  status: ContractStatus | null;
  className?: string;
}) {
  const label = contractSealLabel(status);

  if (!status) {
    return (
      <span className={cn("inline-block max-w-full truncate text-xs text-muted-foreground", className)}>
        {label}
      </span>
    );
  }

  return (
    <span
      data-slot="badge"
      title={label}
      className={cn(
        badgeVariants({ variant: "outline" }),
        getColorStyle(CONTRACT_STATUS_COLOR[status]).badge,
        "max-w-full",
        className
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
