import { CircleAlertIcon, UsersIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";

type PipelineNowProps = {
  awaiting: number;
  inStage: number;
};

type Tile = {
  value: number;
  title: string;
  subtitle: string;
  icon: typeof UsersIcon;
  className: string;
};

export function PipelineNow({ awaiting, inStage }: PipelineNowProps) {
  const tiles: Tile[] = [
    {
      value: awaiting,
      title: "Aguardando contato",
      subtitle: "leads sem etapa de pipeline",
      icon: UsersIcon,
      className: "text-primary bg-primary/10",
    },
    {
      value: inStage,
      title: "Em etapa",
      subtitle: "leads em etapa de pipeline",
      icon: CircleAlertIcon,
      className: "text-amber-600 bg-amber-500/10",
    },
  ];

  return (
    <Card className="rounded-xl border-border/70 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Pipeline atual</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Tempo real
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.title}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-4"
              >
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-lg [&_svg]:size-5",
                    tile.className,
                  )}
                >
                  <Icon />
                </span>
                <div>
                  <p className="text-3xl font-semibold tabular-nums">
                    {formatNumber(tile.value)}
                  </p>
                  <p className="text-sm font-medium">{tile.title}</p>
                  <p className="text-xs text-muted-foreground">{tile.subtitle}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
