import type { SpendSummary } from "@/features/meta/funnel";
import type { MetaInsightsFailure } from "@/features/meta/insights";
import { formatMoney, formatMoneyExact } from "@/lib/formatters/money";

/**
 * O resumo do período: um número protagonista e três de apoio.
 *
 * ⚠️ **Substituiu cinco cartões de peso igual.** A banda anterior dava a mesma
 * moldura, o mesmo tamanho e o mesmo ícone para o investimento e para uma
 * divisão dele — e ainda soletrava a conta ("R$ 1.172 ÷ 141 contatos") num
 * parágrafo de 11 px embaixo de cada um. Cinco caixas iguais com quatro
 * rodapés cinza não têm hierarquia: é a leitura que faz uma tela parecer
 * preenchida em vez de decidida.
 *
 * Agora a hierarquia é por **tamanho** (32 px → 20 px), não por peso nem por
 * cor, e a conta aparece uma vez só, embaixo do bloco inteiro.
 *
 * ⚠️ **Custo sem denominador é `—`, nunca `R$ 0`.** Zero paciente com R$ 1.200
 * gastos não significa paciente de graça — significa que ainda não há paciente.
 * Ver `costPer` em `features/meta/funnel.ts`.
 */
export function PeriodSummary({
  spend,
  contacts,
  patients,
  costPerContact,
  costPerPatient,
  insightsFailure,
}: {
  spend: SpendSummary | null;
  contacts: number;
  patients: number;
  costPerContact: number | null;
  costPerPatient: number | null;
  insightsFailure: MetaInsightsFailure | null;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
      <div className="flex items-stretch gap-3 p-4 sm:p-5">
        {/* Barra de estado no lugar de um ícone: marca o número que manda na
            seção sem introduzir um desenho que não significa nada. */}
        <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            Investido no período
          </p>
          <p className="mt-1 truncate text-3xl font-semibold leading-none tracking-tight tabular-nums">
            {spend ? formatMoney(spend.attributedSpend) : "—"}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
        <Stat label="Novos contatos" value={String(contacts)} />
        <Stat label="Custo por contato" value={money(costPerContact)} />
        <Stat label="Custo por paciente" value={money(costPerPatient)} />
      </dl>

      <p className="border-t border-border/60 bg-muted/30 px-4 py-3 text-[11px] leading-4 text-muted-foreground sm:px-5">
        {buildNote({ spend, contacts, patients, insightsFailure })}
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        {value}
      </dd>
    </div>
  );
}

function money(value: number | null) {
  return value === null ? "—" : formatMoneyExact(value);
}

/**
 * Uma linha de método para o bloco inteiro, em vez de uma dica por cartão.
 *
 * Quando o custo é `—`, a linha diz **por quê** — sem isso o traço vira defeito
 * aparente. Investimento indisponível não derruba a tela: o funil e a tabela
 * seguem, e o motivo aparece aqui.
 */
function buildNote({
  spend,
  contacts,
  patients,
  insightsFailure,
}: {
  spend: SpendSummary | null;
  contacts: number;
  patients: number;
  insightsFailure: MetaInsightsFailure | null;
}) {
  if (insightsFailure === "nao_configurado") {
    return "Falta configurar o acesso à Meta no servidor, então o investimento não aparece. Os contatos e o funil continuam valendo.";
  }
  if (!spend) {
    return "A Meta não respondeu agora, então o investimento não aparece. Os contatos e o funil continuam valendo.";
  }
  if (contacts === 0) {
    return "Ninguém falou com a clínica por anúncio neste período — sem contato não há custo por contato.";
  }

  const base = `${formatMoney(spend.attributedSpend)} gastos nos anúncios que trouxeram os ${contacts} contatos do período.`;
  if (patients === 0) {
    return `${base} Ninguém virou paciente ainda: quem chegou agora leva tempo para fechar.`;
  }
  return `${base} Destes, ${patients} ${patients === 1 ? "virou paciente" : "viraram pacientes"}.`;
}
