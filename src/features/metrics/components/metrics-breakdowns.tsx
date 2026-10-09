import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMetricDuration } from "@/features/metrics/lib/summarize";
import type { BreakdownRow, SupportBreakdowns } from "@/features/metrics/types";
import { formatNumber } from "@/lib/formatters/numbers";

/**
 * Os recortes da janela: por fila, por analista (o responsável atual) e os
 * clientes que mais abriram. Tabelas, não gráficos: são muitas classes, e o
 * gestor compara número com número (skill dataviz: mais de ~7 classes = tabela).
 */
export function MetricsBreakdowns({ breakdowns, days }: { breakdowns: SupportBreakdowns; days: number }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <BreakdownTable
        title="Por fila"
        description={`Últimos ${days} dias · em aberto é agora`}
        firstColumn="Fila"
        rows={breakdowns.byProduct}
      />
      <BreakdownTable
        title="Por analista"
        description="Pelo responsável atual do ticket"
        firstColumn="Analista"
        rows={breakdowns.byAssignee}
      />
      <div className="xl:col-span-2">
        <BreakdownTable
          title="Clientes que mais abriram"
          description={customerDescription(breakdowns)}
          firstColumn="Cliente"
          rows={breakdowns.byCustomer}
        />
      </div>
    </div>
  );
}

/** O subtítulo diz se o ranking mostra todos os clientes ou só os primeiros. */
function customerDescription({ byCustomer, customerCount }: SupportBreakdowns): string {
  if (customerCount === 0) return "Nenhum ticket de empresa cadastrada no período";
  if (customerCount === 1) return "O único cliente com ticket aberto no período";
  if (byCustomer.length >= customerCount) return `Os ${formatNumber(customerCount)} clientes com ticket aberto no período`;
  return `Os ${formatNumber(byCustomer.length)} com mais tickets abertos, de ${formatNumber(customerCount)} clientes no período`;
}

function BreakdownTable({
  title,
  description,
  firstColumn,
  rows,
}: {
  title: string;
  description: string;
  firstColumn: string;
  rows: BreakdownRow[];
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-border/60 bg-card p-5 shadow-soft">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum ticket no período.</p>
      ) : (
        // A tabela rola dentro do cartão; a página nunca rola na horizontal.
        <div className="mt-3 overflow-x-auto overscroll-contain">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{firstColumn}</TableHead>
                <TableHead className="text-right">Abertos</TableHead>
                <TableHead className="text-right">Resolvidos</TableHead>
                <TableHead className="text-right">Em aberto agora</TableHead>
                <TableHead className="text-right">1ª resposta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id ?? "sem"}>
                  <TableCell className={row.id ? "max-w-56 truncate" : "max-w-56 truncate text-muted-foreground"}>
                    {row.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.opened)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.resolved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.openNow)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMetricDuration(row.firstResponse.medianMs)}
                    {row.firstResponse.sample > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatNumber(row.firstResponse.sample)}
                        <span className="sr-only"> respondidos</span>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
