"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AppHeader, type AppHeaderUser } from "@/components/layout/app-header";
import { NavigationDrawer } from "@/components/layout/navigation-drawer";
import { InstallPwaBanner } from "@/components/pwa/install-pwa-banner";
import { getDashboardNavigation, getMobileTabs, type NavItem } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Casca 3.0 — **não há sidebar**. A navegação inteira vive na barra superior
 * flutuante (desktop), na barra inferior (celular) e na gaveta (o menu
 * completo). Isso devolve a largura inteira da tela ao conteúdo, que é o que
 * uma tela de operação — tabela, kanban, agenda — precisa.
 */
export function DashboardShell({ children, viewer }: { children: React.ReactNode; viewer: AppHeaderUser }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = useMemo<NavItem[]>(() => {
    const profile: NavItem = {
      title: "Perfil",
      href: "/app/perfil",
      icon: CircleUserRoundIcon,
      group: "Administração",
      allowedRoles: ["admin", "member"],
    };
    const visible = getDashboardNavigation(viewer.role);
    // Tráfego pago não recebe Perfil: essa role acessa somente Rastreamento.
    if (viewer.role === "paid_traffic") return visible;
    // Perfil entra antes das áreas administrativas para admin, ou no fim para membro.
    const equipeIdx = visible.findIndex((item) => item.href === "/app/equipe");
    return equipeIdx === -1
      ? [...visible, profile]
      : [...visible.slice(0, equipeIdx), profile, ...visible.slice(equipeIdx)];
  }, [viewer.role]);
  // A barra inferior é uma escolha explícita (config/navigation.ts), não os
  // quatro primeiros da lista. Ver o comentário de `mobileTabHrefs`.
  const mobileTabs = useMemo(() => getMobileTabs(viewer.role), [viewer.role]);
  const showMobileNavigation = mobileTabs.length > 1;
  const isActive = (href: string) => pathname === href || (href !== "/app" && pathname.startsWith(href));
  const currentSection = [...navItems].sort((a, b) => b.href.length - a.href.length).find((item) => isActive(item.href))?.title ?? siteConfig.name;
  // O menu completo lista tudo menos o Perfil, que tem lugar próprio no rodapé
  // da gaveta, junto de "Sair".
  const menuItems = navItems.filter((item) => item.href !== "/app/perfil");

  return (
    <div className="min-h-dvh bg-transparent">
      <AppHeader
        currentSection={currentSection}
        navigation={navItems}
        viewer={viewer}
        isActive={isActive}
        onOpenMenu={showMobileNavigation ? () => setMenuOpen(true) : undefined}
      />

      <div
        data-shell-content
        className={cn(
          showMobileNavigation
            ? "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom))] lg:pb-0"
            : "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        {children}
      </div>

      {/*
        Cinco destinos, nenhum "Mais". A barra é uma lâmina de vidro colada na
        base: cantos superiores arredondados e desfoque deixam o fundo de água
        atravessar, em vez de fechar a tela com uma faixa opaca.
      */}
      {showMobileNavigation ? <nav data-mobile-nav aria-label="Navegação principal móvel" className="glass fixed inset-x-0 bottom-0 z-30 rounded-t-3xl pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_40px_-24px_oklch(0.45_0.1_236/60%)] ring-1 ring-white/40 dark:ring-white/10 lg:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, minmax(0, 1fr))` }}>
          {mobileTabs.map((item) => { const Icon = item.icon; const active = isActive(item.href); return <li key={item.href} className="flex min-w-0"><Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-[var(--mobile-nav-height)] w-full min-w-0 flex-col items-center justify-center gap-1 px-1 font-display text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset", active ? "text-primary" : "text-muted-foreground")}><span className={cn("flex h-7 w-11 items-center justify-center rounded-full transition-colors [&_svg]:stroke-[1.75]", active && "bg-brand-gradient text-primary-foreground shadow-sm")}><Icon className="size-[18px]" /></span><span className="max-w-full truncate">{item.title}</span></Link></li>; })}
        </ul>
      </nav> : null}

      {showMobileNavigation ? (
        <NavigationDrawer
          open={menuOpen}
          onOpenChange={setMenuOpen}
          items={menuItems}
          role={viewer.role}
          isActive={isActive}
        />
      ) : null}
      <InstallPwaBanner />
    </div>
  );
}
