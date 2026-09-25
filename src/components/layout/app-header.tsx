"use client";

import Link from "next/link";
import { ChevronDownIcon, MenuIcon, SearchIcon, CircleUserRoundIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { LogoMark } from "@/components/ui/logo-mark";
import { LogoutButton } from "@/components/layout/logout-button";
import { buildTopNavigation } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import { ProfileAvatar } from "@/features/settings/components/profile-avatar";
import type { AppUserRole } from "@/features/settings/types";
import { cn } from "@/lib/utils";

export type AppNavigationItem = { title: string; href: string; icon: ComponentType<{ className?: string }> };
export type AppHeaderUser = { displayName: string; email: string; avatarUrl: string | null; avatarColor: string; role: AppUserRole };

/**
 * A barra é o elemento de assinatura da aplicação: uma faixa flutuante em
 * gradiente da marca, sobre o fundo de água. Ela carrega marca, navegação,
 * busca e conta — não existe mais sidebar.
 *
 * ⚠️ A faixa **flutua**: quem reserva o espaço vertical é `--app-chrome-top`
 * (altura + folgas), consumido pelas telas de altura cheia. Mudou a altura
 * aqui? Mude o token, nunca o `calc()` das telas.
 */
export function AppHeader({ currentSection, navigation, viewer, isActive, onOpenMenu }: { currentSection: string; navigation: AppNavigationItem[]; viewer: AppHeaderUser; isActive: (href: string) => boolean; onOpenMenu?: () => void }) {
  const entries = useMemo(() => buildTopNavigation(navigation), [navigation]);

  return (
    // ⚠️ A casca do header PRECISA de fundo próprio. Ela é `sticky`, e as
    // calhas em volta da barra (folga de cima, de baixo, laterais e as margens
    // do `max-w-screen-2xl`) deixariam o conteúdo rolar à vista — no PWA do
    // iOS, por baixo do relógio. O véu translúcido mantém a água aparecendo.
    <header
      data-app-header
      className="sticky top-0 z-30 bg-background/80 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] supports-[backdrop-filter]:bg-background/55 supports-[backdrop-filter]:backdrop-blur-xl sm:px-3"
    >
      <div className="mx-auto flex h-[var(--app-bar-height)] w-full max-w-screen-2xl items-center gap-1 rounded-2xl bg-brand-bar px-2 text-white shadow-[0_18px_45px_-22px_oklch(0.4_0.1_236/70%)] ring-1 ring-white/15 sm:gap-2 sm:px-3 [&_svg]:stroke-[1.75]">
        {/* Marca. No celular divide espaço com o botão de menu; o rótulo da
            seção atual só aparece onde a navegação horizontal não cabe. */}
        {onOpenMenu ? (
          <Button type="button" variant="ghost" onClick={onOpenMenu} aria-label="Abrir menu" className="size-10 shrink-0 px-0 text-white hover:bg-white/15 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden">
            <MenuIcon className="size-[22px]" />
          </Button>
        ) : null}

        {/* O nome acessível vive no link: no celular o nome do produto
            está escondido, e a marca sozinha deixaria o link sem rótulo. */}
        <Link href="/app" aria-label={`${siteConfig.name} — ir para o início`} className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/95 shadow-sm">
            <LogoMark size={22} aria-label="" />
          </span>
          <span className="hidden font-display text-[15px] font-semibold tracking-tight sm:inline">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Navegação principal" className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
          {entries.map((entry) =>
            entry.kind === "link" ? (
              <TopLink key={entry.item.href} item={entry.item} active={isActive(entry.item.href)} />
            ) : (
              <TopMenu key={entry.title} title={entry.title} items={entry.items} isActive={isActive} active={entry.hrefs.some(isActive)} />
            )
          )}
        </nav>

        {/* Seção atual: no celular a barra não tem navegação visível, então é
            ela quem responde "onde estou". */}
        <p className="min-w-0 flex-1 truncate px-1 font-display text-sm font-medium lg:hidden">{currentSection}</p>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          {navigation.length > 1 ? <NavigationSearch navigation={navigation} /> : null}
          <AnimatedThemeToggler
            variant="circle"
            className="inline-flex size-10 min-w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 lg:size-9 lg:min-w-9 [&_svg]:size-[18px]"
            aria-label="Alternar tema"
          />
          <ProfileMenu viewer={viewer} />
        </div>
      </div>
    </header>
  );
}

function TopLink({ item, active }: { item: AppNavigationItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2 rounded-full px-3 font-display text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        active ? "bg-white text-[oklch(0.38_0.09_236)] shadow-sm" : "text-white hover:bg-white/15"
      )}
    >
      <Icon className="size-[18px]" />
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

function TopMenu({ title, items, isActive, active }: { title: string; items: AppNavigationItem[]; isActive: (href: string) => boolean; active: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            className={cn(
              "group/menu flex h-9 items-center gap-1.5 rounded-full px-3 font-display text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              active ? "bg-white/95 text-[oklch(0.38_0.09_236)] shadow-sm" : "text-white hover:bg-white/15"
            )}
          />
        }
      >
        {title}
        <ChevronDownIcon className="size-4 transition-transform group-data-[popup-open]/menu:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={10} className="w-60 p-1.5">
        <DropdownMenuGroup>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.href} render={<Link href={item.href} aria-current={isActive(item.href) ? "page" : undefined} />} className="h-11 gap-3 px-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-[18px] [&_svg]:stroke-[1.75]">
                  <Icon />
                </span>
                <span className="font-display font-medium">{item.title}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavigationSearch({ navigation }: { navigation: AppNavigationItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const filtered = useMemo(() => {
    const value = normalize(query);
    return value ? navigation.filter((item) => normalize(item.title).includes(value)) : navigation;
  }, [navigation, query]);
  function changeOpen(next: boolean) { setOpen(next); if (!next) setQuery(""); }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Buscar módulo"
            className="inline-flex size-10 items-center justify-center gap-2 rounded-full bg-black/20 px-0 text-white transition-colors hover:bg-black/30 focus-visible:ring-2 focus-visible:ring-white/70 lg:size-9 xl:w-64 xl:justify-start xl:px-3"
          />
        }
      >
        <SearchIcon className="size-4" />
        <span className="hidden truncate text-sm xl:inline">Buscar módulo</span>
        <kbd className="ml-auto hidden rounded-md bg-white/90 px-1.5 py-0.5 font-sans text-[10px] text-[oklch(0.38_0.09_236)] xl:inline">⌘ K</kbd>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[min(22rem,calc(100vw-1.5rem))] gap-2 p-2">
        <PopoverTitle className="sr-only">Buscar módulo</PopoverTitle>
        <div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar módulo…" aria-label="Buscar módulo" className="h-10 rounded-full pl-9" /></div>
        <nav aria-label="Resultados da busca" className="max-h-72 overflow-y-auto"><ul className="space-y-0.5">{filtered.map((item) => { const Icon = item.icon; return <li key={item.href}><Link href={item.href} onClick={() => changeOpen(false)} className="flex h-11 items-center gap-3 rounded-xl px-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-[18px] [&_svg]:stroke-[1.75]"><Icon /></span>{item.title}</Link></li>; })}</ul>{filtered.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum módulo encontrado.</p> : null}</nav>
      </PopoverContent>
    </Popover>
  );
}

function ProfileMenu({ viewer }: { viewer: AppHeaderUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" aria-label={`Abrir menu de ${viewer.displayName}`} className="inline-flex size-10 items-center justify-center rounded-full ring-1 ring-white/30 outline-none transition hover:ring-white/70 focus-visible:ring-[3px] focus-visible:ring-white lg:size-9" />}>
        <ProfileAvatar name={viewer.displayName} avatarUrl={viewer.avatarUrl} avatarColor={viewer.avatarColor} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-64 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 py-2 font-normal text-foreground">
            <span className="block truncate font-display text-sm font-semibold">{viewer.displayName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{viewer.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/app/perfil" />} className="h-11 gap-3 px-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><CircleUserRoundIcon className="size-[18px] stroke-[1.75]" /></span>Meu perfil</DropdownMenuItem>
          {viewer.role === "admin" ? <DropdownMenuItem render={<Link href="/app/equipe" />} className="h-11 gap-3 px-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UsersRoundIcon className="size-[18px] stroke-[1.75]" /></span>Gerenciar equipe</DropdownMenuItem> : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <LogoutButton variant="menu" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR"); }
