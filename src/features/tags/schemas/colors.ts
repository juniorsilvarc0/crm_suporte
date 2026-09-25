// Paleta de cores compartilhada por colunas do kanban e tags.
// Classes Tailwind ESTÁTICAS (literais) para o build detectar — nunca gerar
// classe por interpolação. Cada cor tem variações para dot/barra/tinta/badge/etc.

export type ColorName =
  | "slate"
  | "gray"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose";

export type ColorStyle = {
  /** ponto sólido */
  dot: string;
  /** barra/realce sólido (faixa lateral do card, topo da coluna) */
  bar: string;
  /** tinta suave de fundo (header da coluna) */
  tint: string;
  /** superfície da coluna inteira do kanban: borda + fundo, claro e escuro */
  panel: string;
  /** badge/pill completo: borda + fundo + texto */
  badge: string;
  /** texto colorido */
  text: string;
  /** ring de realce */
  ring: string;
  /** botão/realce sólido com texto claro */
  solid: string;
};

export const colorStyle: Record<ColorName, ColorStyle> = {
  slate: {
    dot: "bg-slate-400", bar: "bg-slate-400", tint: "bg-slate-500/10",
    panel: "border-slate-500/20 bg-slate-500/[0.05] dark:border-slate-400/15 dark:bg-slate-500/[0.09]",
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    text: "text-slate-600 dark:text-slate-300", ring: "ring-slate-400/50",
    solid: "bg-slate-500 text-white",
  },
  gray: {
    dot: "bg-gray-400", bar: "bg-gray-400", tint: "bg-gray-500/10",
    panel: "border-gray-500/20 bg-gray-500/[0.05] dark:border-gray-400/15 dark:bg-gray-500/[0.09]",
    badge: "border-gray-500/30 bg-gray-500/10 text-gray-600 dark:text-gray-300",
    text: "text-gray-600 dark:text-gray-300", ring: "ring-gray-400/50",
    solid: "bg-gray-500 text-white",
  },
  red: {
    dot: "bg-red-500", bar: "bg-red-500", tint: "bg-red-500/10",
    panel: "border-red-500/20 bg-red-500/[0.05] dark:border-red-400/15 dark:bg-red-500/[0.09]",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    text: "text-red-700 dark:text-red-300", ring: "ring-red-500/50",
    solid: "bg-red-500 text-white",
  },
  orange: {
    dot: "bg-orange-500", bar: "bg-orange-500", tint: "bg-orange-500/10",
    panel: "border-orange-500/20 bg-orange-500/[0.05] dark:border-orange-400/15 dark:bg-orange-500/[0.09]",
    badge: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    text: "text-orange-700 dark:text-orange-300", ring: "ring-orange-500/50",
    solid: "bg-orange-500 text-white",
  },
  amber: {
    dot: "bg-amber-500", bar: "bg-amber-500", tint: "bg-amber-500/10",
    panel: "border-amber-500/20 bg-amber-500/[0.05] dark:border-amber-400/15 dark:bg-amber-500/[0.09]",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-300", ring: "ring-amber-500/50",
    solid: "bg-amber-500 text-white",
  },
  yellow: {
    dot: "bg-yellow-500", bar: "bg-yellow-500", tint: "bg-yellow-500/10",
    panel: "border-yellow-500/20 bg-yellow-500/[0.05] dark:border-yellow-400/15 dark:bg-yellow-500/[0.09]",
    badge: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
    text: "text-yellow-700 dark:text-yellow-300", ring: "ring-yellow-500/50",
    solid: "bg-yellow-500 text-white",
  },
  lime: {
    dot: "bg-lime-500", bar: "bg-lime-500", tint: "bg-lime-500/10",
    panel: "border-lime-500/20 bg-lime-500/[0.05] dark:border-lime-400/15 dark:bg-lime-500/[0.09]",
    badge: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-300",
    text: "text-lime-700 dark:text-lime-300", ring: "ring-lime-500/50",
    solid: "bg-lime-500 text-white",
  },
  green: {
    dot: "bg-green-500", bar: "bg-green-500", tint: "bg-green-500/10",
    panel: "border-green-500/20 bg-green-500/[0.05] dark:border-green-400/15 dark:bg-green-500/[0.09]",
    badge: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
    text: "text-green-700 dark:text-green-300", ring: "ring-green-500/50",
    solid: "bg-green-500 text-white",
  },
  emerald: {
    dot: "bg-emerald-500", bar: "bg-emerald-500", tint: "bg-emerald-500/10",
    panel: "border-emerald-500/20 bg-emerald-500/[0.05] dark:border-emerald-400/15 dark:bg-emerald-500/[0.09]",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500/50",
    solid: "bg-emerald-500 text-white",
  },
  teal: {
    dot: "bg-teal-500", bar: "bg-teal-500", tint: "bg-teal-500/10",
    panel: "border-teal-500/20 bg-teal-500/[0.05] dark:border-teal-400/15 dark:bg-teal-500/[0.09]",
    badge: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    text: "text-teal-700 dark:text-teal-300", ring: "ring-teal-500/50",
    solid: "bg-teal-500 text-white",
  },
  cyan: {
    dot: "bg-cyan-500", bar: "bg-cyan-500", tint: "bg-cyan-500/10",
    panel: "border-cyan-500/20 bg-cyan-500/[0.05] dark:border-cyan-400/15 dark:bg-cyan-500/[0.09]",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    text: "text-cyan-700 dark:text-cyan-300", ring: "ring-cyan-500/50",
    solid: "bg-cyan-500 text-white",
  },
  sky: {
    dot: "bg-sky-500", bar: "bg-sky-500", tint: "bg-sky-500/10",
    panel: "border-sky-500/20 bg-sky-500/[0.05] dark:border-sky-400/15 dark:bg-sky-500/[0.09]",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    text: "text-sky-700 dark:text-sky-300", ring: "ring-sky-500/50",
    solid: "bg-sky-500 text-white",
  },
  blue: {
    dot: "bg-blue-500", bar: "bg-blue-500", tint: "bg-blue-500/10",
    panel: "border-blue-500/20 bg-blue-500/[0.05] dark:border-blue-400/15 dark:bg-blue-500/[0.09]",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    text: "text-blue-700 dark:text-blue-300", ring: "ring-blue-500/50",
    solid: "bg-blue-500 text-white",
  },
  indigo: {
    dot: "bg-indigo-500", bar: "bg-indigo-500", tint: "bg-indigo-500/10",
    panel: "border-indigo-500/20 bg-indigo-500/[0.05] dark:border-indigo-400/15 dark:bg-indigo-500/[0.09]",
    badge: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    text: "text-indigo-700 dark:text-indigo-300", ring: "ring-indigo-500/50",
    solid: "bg-indigo-500 text-white",
  },
  violet: {
    dot: "bg-violet-500", bar: "bg-violet-500", tint: "bg-violet-500/10",
    panel: "border-violet-500/20 bg-violet-500/[0.05] dark:border-violet-400/15 dark:bg-violet-500/[0.09]",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    text: "text-violet-700 dark:text-violet-300", ring: "ring-violet-500/50",
    solid: "bg-violet-500 text-white",
  },
  purple: {
    dot: "bg-purple-500", bar: "bg-purple-500", tint: "bg-purple-500/10",
    panel: "border-purple-500/20 bg-purple-500/[0.05] dark:border-purple-400/15 dark:bg-purple-500/[0.09]",
    badge: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    text: "text-purple-700 dark:text-purple-300", ring: "ring-purple-500/50",
    solid: "bg-purple-500 text-white",
  },
  fuchsia: {
    dot: "bg-fuchsia-500", bar: "bg-fuchsia-500", tint: "bg-fuchsia-500/10",
    panel: "border-fuchsia-500/20 bg-fuchsia-500/[0.05] dark:border-fuchsia-400/15 dark:bg-fuchsia-500/[0.09]",
    badge: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    text: "text-fuchsia-700 dark:text-fuchsia-300", ring: "ring-fuchsia-500/50",
    solid: "bg-fuchsia-500 text-white",
  },
  pink: {
    dot: "bg-pink-500", bar: "bg-pink-500", tint: "bg-pink-500/10",
    panel: "border-pink-500/20 bg-pink-500/[0.05] dark:border-pink-400/15 dark:bg-pink-500/[0.09]",
    badge: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
    text: "text-pink-700 dark:text-pink-300", ring: "ring-pink-500/50",
    solid: "bg-pink-500 text-white",
  },
  rose: {
    dot: "bg-rose-500", bar: "bg-rose-500", tint: "bg-rose-500/10",
    panel: "border-rose-500/20 bg-rose-500/[0.05] dark:border-rose-400/15 dark:bg-rose-500/[0.09]",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    text: "text-rose-700 dark:text-rose-300", ring: "ring-rose-500/50",
    solid: "bg-rose-500 text-white",
  },
};

// Swatches oferecidos no seletor de cor (ordem agradável).
export const BOARD_COLOR_NAMES: ColorName[] = [
  "slate", "gray", "red", "orange", "amber", "yellow", "lime", "green",
  "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple",
  "fuchsia", "pink", "rose",
];

const fallbackColor: ColorStyle = colorStyle.slate;

export function getColorStyle(name: string | null | undefined): ColorStyle {
  if (!name || !isColorName(name)) return fallbackColor;
  return colorStyle[name];
}

// `Object.hasOwn`, não `in`: `in` aceita chaves do protótipo ("constructor",
// "toString"), que passam no check de formato do banco (`^[a-z]{3,20}$`) e
// fariam getColorStyle devolver uma função no lugar do estilo.
export function isColorName(value: string): value is ColorName {
  return Object.hasOwn(colorStyle, value);
}
