export const GRID_START_HOUR = 7;
export const GRID_END_HOUR = 21;

/**
 * **1 px por minuto.** `top` e `height` passam a ser o próprio horário, sem
 * conversão no meio do caminho.
 *
 * Antes eram 52 px/hora, o que dava 26 px para meia hora — espaço para uma
 * linha só. Como o card gastava a primeira linha com o horário, um agendamento
 * de 30 minutos aparecia como "10:30" e nada mais.
 */
export const MINUTE_HEIGHT = 1;
export const HOUR_HEIGHT = 60 * MINUTE_HEIGHT;
export const GRID_MINUTES = (GRID_END_HOUR - GRID_START_HOUR) * 60;
export const GRID_HEIGHT = GRID_MINUTES * MINUTE_HEIGHT;

/** Abaixo disto o card não caberia nem uma linha de texto. */
export const MIN_BLOCK_HEIGHT = 22;

/**
 * Altura a partir da qual cabe a segunda linha (serviço).
 *
 * 40 px deixa 45 minutos com duas linhas e 30 minutos com uma. Duas linhas de
 * 11px/10px em `leading-tight` pedem ~26 px, então sobra folga — o corte é
 * conservador de propósito, para o card nunca ficar espremido.
 */
export const TWO_LINE_HEIGHT = 40;

export type TimeGridInput = {
  id: string;
  /** Minutos desde a meia-noite, no fuso do app. */
  startMinutes: number;
  durationMin: number;
};

export type TimeGridPlacement = {
  id: string;
  top: number;
  height: number;
  /** Porcentagem da largura da coluna do dia. */
  leftPct: number;
  widthPct: number;
  /** Quantas faixas o aglomerado deste bloco ocupa. 1 = sozinho no horário. */
  lanes: number;
};

type Internal = TimeGridInput & { start: number; end: number };

/**
 * Distribui os agendamentos do dia em faixas verticais.
 *
 * O que estava errado: todo bloco era `absolute inset-x-1`, largura cheia da
 * coluna. Dois horários que se cruzam ficavam **um por cima do outro** — e com
 * fundo translúcido o texto de baixo atravessava o card de cima.
 *
 * Aqui os blocos que se cruzam viram colunas paralelas, como em qualquer
 * agenda. O agrupamento é por **aglomerado**: uma corrente de sobreposições
 * divide a largura por igual, para que a mesma consulta não mude de largura
 * conforme a vizinha. É por isso que a contagem de faixas é do aglomerado
 * inteiro, e não do par que se cruza.
 */
export function layoutTimeGrid(items: TimeGridInput[]): TimeGridPlacement[] {
  const sorted: Internal[] = items
    .map((item) => {
      const start = item.startMinutes;
      // Duração inválida ou zerada ainda precisa de um bloco clicável.
      const duration = Number.isFinite(item.durationMin) && item.durationMin > 0
        ? item.durationMin
        : 60;
      return { ...item, start, end: start + duration };
    })
    // Mais cedo primeiro; empatou, o mais longo abre a faixa da esquerda.
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placements: TimeGridPlacement[] = [];
  let cluster: Internal[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;

    // Faixa mais à esquerda que já terminou antes deste começar.
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();

    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      laneOf.set(item.id, lane);
    }

    const lanes = laneEnds.length;
    for (const item of cluster) {
      placements.push({
        id: item.id,
        ...clampToGrid(item.start, item.end),
        leftPct: ((laneOf.get(item.id) ?? 0) / lanes) * 100,
        widthPct: 100 / lanes,
        lanes,
      });
    }

    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const item of sorted) {
    // Começou depois do fim de TODOS do aglomerado atual: abre outro.
    if (item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return placements;
}

function clampToGrid(start: number, end: number): { top: number; height: number } {
  const gridStart = GRID_START_HOUR * 60;
  // Fora da grade o bloco encosta na borda em vez de sumir: o agendamento
  // existe, e some-lo da tela seria esconder informação do banco.
  const top = Math.min(
    Math.max(0, start - gridStart) * MINUTE_HEIGHT,
    GRID_HEIGHT - MIN_BLOCK_HEIGHT
  );
  const rawHeight = Math.max(0, end - Math.max(start, gridStart)) * MINUTE_HEIGHT;
  const height = Math.max(MIN_BLOCK_HEIGHT, Math.min(rawHeight, GRID_HEIGHT - top));
  return { top, height };
}
