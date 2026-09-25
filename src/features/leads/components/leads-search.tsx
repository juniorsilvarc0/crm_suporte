"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";

import { DataToolbar, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import {
  leadSearchColumns,
  type LeadSearchColumn,
} from "@/features/leads/lib/leads-search";

export type { LeadSearchColumn } from "@/features/leads/lib/leads-search";

export function LeadsSearch({
  column,
  query,
  onColumnChange,
  onQueryChange,
  filters,
}: {
  column: LeadSearchColumn;
  query: string;
  onColumnChange: (column: LeadSearchColumn) => void;
  onQueryChange: (query: string) => void;
  /** Slot para o botão de filtros de quem renderiza a tabela. */
  filters?: ReactNode;
}) {
  const columnLabel =
    leadSearchColumns.find((option) => option.value === column)?.label ?? "Lead";

  return (
    <DataToolbar className="px-3">
      <FormSelect value={column} onValueChange={(value) => onColumnChange(value as LeadSearchColumn)} aria-label="Buscar na coluna" className="w-full sm:w-40" options={leadSearchColumns} />
      <ToolbarSearch value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`Buscar por ${columnLabel.toLowerCase()}…`} aria-label={`Buscar por ${columnLabel.toLowerCase()}`} />
      {query ? <Button type="button" variant="ghost" size="sm" onClick={() => onQueryChange("")} className="h-11 sm:h-9"><XIcon data-icon="inline-start" />Limpar</Button> : null}
      {filters ? <div className="sm:ml-auto">{filters}</div> : null}
    </DataToolbar>
  );
}
