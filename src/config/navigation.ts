import type { ComponentType } from "react";
import {
  BookUserIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChartColumnIcon,
  HeadsetIcon,
  HouseIcon,
  ListChecksIcon,
  MessageCircleIcon,
  PlugZapIcon,
  SettingsIcon,
  TicketIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { AppUserRole } from "@/features/settings/types";

const OPERATION_ROLES: ReadonlyArray<AppUserRole> = ["admin", "member"];
const ADMIN_ROLES: ReadonlyArray<AppUserRole> = ["admin"];

/**
 * Grupo do item no menu completo. Existe só para dar título de seção à gaveta
 * do celular e à busca — a fronteira de acesso continua sendo `allowedRoles`
 * mais o guard no servidor.
 */
export type NavGroup = "Operação" | "Análise" | "Administração";

export const navGroupOrder: ReadonlyArray<NavGroup> = [
  "Operação",
  "Análise",
  "Administração",
];

export type NavItem = {
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: NavGroup;
  // A lista é explícita para uma role nova nunca ganhar acesso por omissão.
  // O guard server-side continua sendo a fronteira de segurança.
  allowedRoles: ReadonlyArray<AppUserRole>;
};

/**
 * O núcleo que sobrou da poda do CRM de origem, mais os cadastros da Fase 3
 * (Clientes e Contatos) e, da Fase 4, os Tickets e o Atendimento (filas,
 * categorias, SLA e status, só admin). Quadro, agenda, financeiro e métricas de
 * suporte entram com as páginas deles, nas fases seguintes de
 * `docs/PLANO-IMPLANTACAO.md`.
 *
 * Ícones só de traço, no mesmo peso: o WhatsApp entra na navegação como um
 * balão de contorno (o logo preenchido dele virava uma mancha no meio da
 * barra). O ícone da marca WhatsApp continua nas telas de conteúdo.
 */
export const dashboardNavigation: NavItem[] = [
  { title: "Início", href: "/app", icon: HouseIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Tickets", href: "/app/tickets", icon: TicketIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "WhatsApp", href: "/app/chat", icon: MessageCircleIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Clientes", href: "/app/clientes", icon: Building2Icon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Contatos", href: "/app/contatos", icon: BookUserIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Agenda", href: "/app/agendamentos", icon: CalendarDaysIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Retornos", href: "/app/follow-ups", icon: ListChecksIcon, group: "Operação", allowedRoles: OPERATION_ROLES },
  { title: "Métricas", href: "/app/metricas", icon: ChartColumnIcon, group: "Análise", allowedRoles: ADMIN_ROLES },
  { title: "Integrações", href: "/app/conexao", icon: PlugZapIcon, group: "Administração", allowedRoles: ADMIN_ROLES },
  { title: "Equipe", href: "/app/equipe", icon: UsersRoundIcon, group: "Administração", allowedRoles: ADMIN_ROLES },
  { title: "Atendimento", href: "/app/configuracoes/atendimento", icon: HeadsetIcon, group: "Administração", allowedRoles: ADMIN_ROLES },
];

/**
 * As abas da barra inferior do celular, em ordem.
 *
 * ⚠️ **WhatsApp está aqui de propósito.** Antes a barra pegava os 4 primeiros
 * itens da lista e o resto caía num "Mais": num CRM de WhatsApp, o WhatsApp
 * ficava escondido atrás de dois toques. A barra agora é uma escolha explícita,
 * não um `slice`.
 *
 * O que não está aqui não desaparece — vive no menu completo, que é uma gaveta
 * de tela cheia com seções, não um popover apertado em cima da barra (é onde
 * Contatos mora no celular).
 */
export const mobileTabHrefs: ReadonlyArray<string> = [
  "/app",
  "/app/tickets",
  "/app/chat",
  "/app/clientes",
];

export function getDashboardNavigation(role: AppUserRole): NavItem[] {
  return dashboardNavigation.filter((item) => item.allowedRoles.includes(role));
}

/** Abas da barra inferior visíveis para o papel, na ordem de `mobileTabHrefs`. */
export function getMobileTabs(role: AppUserRole): NavItem[] {
  const visible = getDashboardNavigation(role);
  return mobileTabHrefs.flatMap((href) => {
    const item = visible.find((candidate) => candidate.href === href);
    return item ? [item] : [];
  });
}

/**
 * A barra superior do desktop deixa a um clique o que se usa o dia inteiro e
 * agrupa o resto em menus. Sem isso, cada módulo novo vira mais um rótulo lado
 * a lado, até a barra virar uma régua de texto que ninguém varre.
 */
export type TopNavEntry<T = NavItem> =
  | { kind: "link"; item: T }
  | { kind: "menu"; title: string; icon: NavItem["icon"]; hrefs: ReadonlyArray<string>; items: T[] };

/** Itens que moram no menu da conta (avatar), não na navegação. */
const ACCOUNT_HREFS: ReadonlyArray<string> = ["/app/perfil"];

/**
 * Ordem da barra. `menu` agrupa; qualquer href não citado aqui entra como link
 * solto no fim — item novo aparece por padrão em vez de sumir em silêncio.
 */
const TOP_NAV_SPEC: ReadonlyArray<
  { kind: "link"; href: string } | { kind: "menu"; title: string; icon: NavItem["icon"]; hrefs: ReadonlyArray<string> }
> = [
  { kind: "link", href: "/app" },
  { kind: "link", href: "/app/tickets" },
  { kind: "link", href: "/app/chat" },
  { kind: "link", href: "/app/clientes" },
  { kind: "link", href: "/app/contatos" },
  // Agenda e Retornos num menu: a barra já está no limite de largura no lg.
  { kind: "menu", title: "Agenda", icon: CalendarDaysIcon, hrefs: ["/app/agendamentos", "/app/follow-ups"] },
  // Só admin vê: a faixa do membro não muda.
  { kind: "link", href: "/app/metricas" },
  { kind: "menu", title: "Ajustes", icon: SettingsIcon, hrefs: ["/app/conexao", "/app/equipe", "/app/configuracoes/atendimento"] },
];

/**
 * Monta a barra a partir da lista **já filtrada por papel** — grupo sem item
 * visível simplesmente não aparece, sem repetir regra de acesso aqui.
 */
export function buildTopNavigation<T extends { href: string }>(visible: ReadonlyArray<T>): TopNavEntry<T>[] {
  const claimed = new Set<string>(ACCOUNT_HREFS);
  const entries: TopNavEntry<T>[] = [];

  for (const spec of TOP_NAV_SPEC) {
    if (spec.kind === "link") {
      claimed.add(spec.href);
      const item = visible.find((candidate) => candidate.href === spec.href);
      if (item) entries.push({ kind: "link", item });
      continue;
    }
    spec.hrefs.forEach((href) => claimed.add(href));
    const items = spec.hrefs.flatMap((href) => visible.filter((candidate) => candidate.href === href));
    if (items.length === 1) entries.push({ kind: "link", item: items[0] });
    else if (items.length > 1) entries.push({ kind: "menu", title: spec.title, icon: spec.icon, hrefs: spec.hrefs, items });
  }

  for (const item of visible) {
    if (!claimed.has(item.href)) entries.push({ kind: "link", item });
  }

  return entries;
}
