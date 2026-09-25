"use client";

import { useMemo, useState } from "react";
import { CircleAlertIcon, WalletIcon } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ariaSort,
  SortButton,
  type SortDirection,
} from "@/features/meta/components/sort-button";
import {
  buildCostRows,
  sumCostRows,
  UNKNOWN_ROW_ID,
  type CostLevel,
  type CostRow,
} from "@/features/meta/costs";
import type { MetaAdInsight } from "@/features/meta/insights";
import type { MetaCohortLead } from "@/features/meta/report";
import { formatMoneyExact } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

type SortKey = "name" | "spend" | "contacts" | "costPerContact" | "patients";

const levels: Array<{ value: CostLevel; label: string; unit: string }> = [
  { value: "campaign", label: "Campanha", unit: "campanha" },
  { value: "adset", label: "Conjunto", unit: "conjunto" },
  { value: "ad", label: "Anúncio", unit: "anúncio" },
];

const numericColumns = [
  { key: "spend", label: "Investido" },
  { key: "contacts", label: "Contatos" },
  { key: "costPerContact", label: "Por contato" },
  { key: "patients", label: "Pacientes" },
] as const;

/** `null` no fim em qualquer direção: ausência não compete por posição. */
function compare(a: CostRow, b: CostRow, key: SortKey) {
  if (key === "name") return a.name.localeCompare(b.name, "pt-BR");
  const left = a[key];
  const right = b[key];
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function money(value: number | null) {
  return value === null ? "—" : formatMoneyExact(value);
}

/**
 * Onde a verba foi e o que voltou, por campanha, conjunto ou anúncio.
 *
 * ⚠️ **A tabela mostra o que é feio de propósito.** Anúncio que gastou e não
 * trouxe ninguém aparece como linha, com contato zero e custo `—`; é exatamente
 * a linha que justifica cortar verba, e montar a tabela a partir dos leads a
 * faria sumir. No sentido inverso, contato vindo de anúncio que não estava no
 * ar entra marcado, porque senão a soma dos contatos aqui não bateria com a da
 * Visão geral e ninguém saberia por quê.
 *
 * ⚠️ **O total do rodapé inclui o gasto sem contato.** É por isso que o custo
 * por contato daqui é maior que o da Visão geral: lá o denominador é o gasto que
 * gerou contato, aqui é a verba inteira do período. As duas leituras são certas
 * e respondem perguntas diferentes — a nota abaixo da tabela diz qual é qual.
 */
export function CostTable({
  cohort,
  insights,
  hasSpend,
}: {
  cohort: MetaCohortLead[];
  insights: MetaAdInsight[];
  /** `false` quando a Meta não respondeu: sem gasto a tabela perde o assunto. */
  hasSpend: boolean;
}) {
  const [level, setLevel] = useState<CostLevel>("campaign");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const rows = useMemo(
    () => buildCostRows(cohort, insights, level),
    [cohort, insights, level]
  );
  const totals = useMemo(() => sumCostRows(rows), [rows]);
  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b, sortKey) * factor);
  }, [rows, sortKey, direction]);

  const current = levels.find((entry) => entry.value === level) ?? levels[0];
  const unit = current.unit;
  const withoutContact = rows.filter(
    (row) => row.contacts === 0 && (row.spend ?? 0) > 0
  ).length;
  const withoutSpend = rows.filter((row) => row.spendMissing).length;
  // Contado à parte do `withoutSpend`: "não sabemos de onde veio" não é a mesma
  // informação que "o anúncio existe e não estava no ar".
  const unidentified =
    rows.find((row) => row.id === UNKNOWN_ROW_ID)?.contacts ?? 0;

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection(key === "name" ? "asc" : "desc");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Trocar o recorte de uma tabela é a pílula em `bg-muted`, o mesmo
          controle de `dashboard/components/by-source-card.tsx`. A faixa com
          sublinhado é a navegação da tela — usar as duas iguais confundiria
          "mudei de assunto" com "mudei o agrupamento". */}
      <Tabs
        value={level}
        onValueChange={(value) => setLevel(value as CostLevel)}
        className="gap-0"
      >
        <TabsList className="h-11 sm:h-9" aria-label="Agrupar custos por">
          {levels.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="px-3">
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nada para mostrar"
              : `${rows.length} ${rows.length === 1 ? unit : `${unit}s`}`}
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState hasSpend={hasSpend} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead
                      aria-sort={ariaSort(sortKey === "name", direction)}
                      className="h-11 w-full px-4"
                    >
                      <SortButton
                        label={current.label}
                        active={sortKey === "name"}
                        direction={direction}
                        onClick={() => toggleSort("name")}
                      />
                    </TableHead>
                    {numericColumns.map((column) => (
                      <TableHead
                        key={column.key}
                        aria-sort={ariaSort(sortKey === column.key, direction)}
                        className="h-11 px-4 text-right"
                      >
                        <SortButton
                          label={column.label}
                          align="end"
                          active={sortKey === column.key}
                          direction={direction}
                          onClick={() => toggleSort(column.key)}
                        />
                      </TableHead>
                    ))}
                    <TableHead className="h-11 px-4 text-right text-xs font-medium text-muted-foreground">
                      Por paciente
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {sorted.map((row) => (
                    <TableRow key={row.id} className="border-border/60">
                      <TableCell className="whitespace-normal px-4 py-3 align-top text-sm">
                        <span className="block font-medium">{row.name}</span>
                        <RowNote row={row} />
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right align-top text-sm font-medium tabular-nums">
                        {row.spend === null ? "—" : formatMoneyExact(row.spend)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-3 text-right align-top text-sm font-medium tabular-nums",
                          row.contacts === 0 && "text-muted-foreground"
                        )}
                      >
                        {row.contacts}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right align-top text-sm tabular-nums">
                        {money(row.costPerContact)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-3 text-right align-top text-sm font-medium tabular-nums",
                          row.patients === 0 && "text-muted-foreground"
                        )}
                      >
                        {row.patients}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right align-top text-sm tabular-nums">
                        {money(row.costPerPatient)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>

                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="px-4 py-3 text-sm font-medium">Total</TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                      {formatMoneyExact(totals.spend)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                      {totals.contacts}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                      {money(totals.costPerContact)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                      {totals.patients}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                      {money(totals.costPerPatient)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {/* Seis colunas não cabem em 320 px: no celular cada linha vira um
                cartão, o mesmo par da tabela de campanhas. */}
            <ul className="divide-y divide-border/60 md:hidden">
              {sorted.map((row) => (
                <li key={row.id} className="px-4 py-3.5">
                  <p className="text-sm font-medium">{row.name}</p>
                  <RowNote row={row} />
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                    <MobileStat
                      label="Investido"
                      value={row.spend === null ? "—" : formatMoneyExact(row.spend)}
                    />
                    <MobileStat label="Contatos" value={String(row.contacts)} />
                    <MobileStat label="Por contato" value={money(row.costPerContact)} />
                    <MobileStat
                      label="Pacientes"
                      value={
                        row.patients === 0
                          ? "0"
                          : `${row.patients} · ${money(row.costPerPatient)}`
                      }
                    />
                  </dl>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium">Total</span>
                <span className="text-sm tabular-nums">
                  <strong className="font-semibold">
                    {formatMoneyExact(totals.spend)}
                  </strong>{" "}
                  <span className="text-muted-foreground">
                    · {totals.contacts} contatos
                  </span>
                </span>
              </li>
            </ul>
          </>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-1.5 px-1">
          <p className="text-[11px] leading-4 text-muted-foreground">
            O total soma <strong className="font-medium">toda</strong> a verba do
            período, inclusive a de quem não trouxe ninguém — por isso o custo por
            contato daqui é maior que o da Visão geral, onde o divisor é só o gasto
            que gerou contato.
          </p>
          {withoutContact > 0 ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {withoutContact}{" "}
              {withoutContact === 1
                ? `${unit} consumiu verba e não trouxe`
                : `${unit}s consumiram verba e não trouxeram`}{" "}
              ninguém no período.
            </p>
          ) : null}
          {withoutSpend > 0 ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {withoutSpend}{" "}
              {withoutSpend === 1
                ? `${unit} trouxe contato sem`
                : `${unit}s trouxeram contato sem`}{" "}
              veiculação no período — essas pessoas clicaram antes.
            </p>
          ) : null}
          {unidentified > 0 ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {unidentified}{" "}
              {unidentified === 1 ? "pessoa chegou" : "pessoas chegaram"} por anúncio
              sem identificação — não dá para dizer de qual {unit} vieram, então
              nenhuma delas foi somada a uma linha real.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** O motivo de uma linha estar torta, na própria linha. */
function RowNote({ row }: { row: CostRow }) {
  if (row.spendMissing) {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
        Sem veiculação no período
      </span>
    );
  }
  if (row.contacts === 0) {
    return (
      <span className="mt-0.5 block text-xs text-muted-foreground">
        Nenhum contato no período
      </span>
    );
  }
  return null;
}

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function EmptyState({ hasSpend }: { hasSpend: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden
      >
        <WalletIcon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-1 text-sm font-medium">
        {hasSpend
          ? "Nenhuma verba e nenhum contato no período"
          : "Não dá para mostrar o custo agora"}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {hasSpend
          ? "Nenhum anúncio veiculou e ninguém chegou por anúncio no intervalo escolhido. Tente um período maior."
          : "O investimento vem da Meta, e ela não respondeu. Os contatos e o funil continuam valendo na Visão geral."}
      </p>
    </div>
  );
}
