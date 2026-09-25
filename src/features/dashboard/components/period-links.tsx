import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const periods = [
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "90 dias", value: "90d" },
  { label: "Tudo", value: "all" },
] as const;

export function PeriodLinks({ activePeriod }: { activePeriod?: string }) {
  const selected = activePeriod ?? "all";

  return (
    <div className="flex items-center gap-2">
      {periods.map((period) => (
        <Link
          key={period.value}
          href={period.value === "all" ? "/app" : `/app?period=${period.value}`}
          className={cn(
            buttonVariants({
              variant: selected === period.value ? "default" : "outline",
              size: "sm",
            })
          )}
        >
          {period.label}
        </Link>
      ))}
    </div>
  );
}
