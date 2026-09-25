"use client";

import type { ComponentProps, ReactNode } from "react";
import { FilterIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DataToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 border-b border-border/70 py-3 sm:flex-row sm:items-center", className)}>
      {children}
    </div>
  );
}

export function ToolbarSearch({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <label className={cn("relative min-w-0 flex-1 sm:max-w-sm", className)}>
      <span className="sr-only">{props["aria-label"] ?? "Buscar"}</span>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input {...props} className="h-11 rounded-full pl-9 sm:h-9" />
    </label>
  );
}

export function FilterButton({
  activeCount = 0,
  children,
}: {
  activeCount?: number;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="h-11 sm:h-9" />}
      >
        <FilterIcon data-icon="inline-start" />
        Filtros{activeCount ? ` (${activeCount})` : ""}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-4 p-4">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ActiveFilters({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onClear} className="h-11 sm:h-9">
      <XIcon data-icon="inline-start" />
      Limpar filtros
    </Button>
  );
}
