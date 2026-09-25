"use client";

import Link from "next/link";
import { UserRoundIcon, XIcon } from "lucide-react";

import { LogoutButton } from "@/components/layout/logout-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { LogoMark } from "@/components/ui/logo-mark";
import { navGroupOrder, type NavItem } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import type { AppUserRole } from "@/features/settings/types";
import { cn } from "@/lib/utils";

/**
 * Menu completo do celular — uma gaveta, não um popover.
 *
 * Substitui o botão "Mais" que ficava na barra inferior. Aquele popover cabia
 * seis destinos num retângulo de 224px encostado no rodapé, sem título de
 * seção e sem indicar onde a pessoa estava. A gaveta é a superfície que o
 * sistema já usa para "escolher um caminho": ocupa a tela, agrupa por área e
 * fecha arrastando.
 *
 * ⚠️ **Não duplica a barra inferior — a completa.** Os destinos que já estão na
 * barra aparecem aqui também, marcados como atuais quando é o caso: um menu
 * "completo" que esconde metade dos itens obriga a pessoa a lembrar em qual das
 * duas superfícies cada coisa mora.
 */
export function NavigationDrawer({
  open,
  onOpenChange,
  items,
  role,
  isActive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
  role: AppUserRole;
  isActive: (href: string) => boolean;
}) {
  const groups = navGroupOrder
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[88dvh]">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 pb-3 pt-2">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <LogoMark size={23} aria-label="" />
          </div>
          <div className="min-w-0 flex-1">
            <DrawerTitle className="truncate text-sm font-semibold">Menu</DrawerTitle>
            <DrawerDescription className="truncate text-[11px] text-muted-foreground">
              {siteConfig.name}
            </DrawerDescription>
          </div>
          {/* `DrawerClose` do vaul não aceita `render` (é Radix por baixo, não
              Base UI): recebe as classes direto, como no chat e no dialog. */}
          <DrawerClose
            aria-label="Fechar menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-[18px]" />
          </DrawerClose>
        </div>

        <nav
          aria-label="Todos os módulos"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 [-webkit-overflow-scrolling:touch]"
        >
          {groups.map((entry) => (
            <div key={entry.group} className="mb-2 last:mb-0">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {entry.group}
              </p>
              <ul>
                {entry.items.map((item) => (
                  <li key={item.href}>
                    <DrawerItem
                      href={item.href}
                      icon={item.icon}
                      title={item.title}
                      active={isActive(item.href)}
                      onNavigate={() => onOpenChange(false)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Tráfego pago não tem perfil próprio: essa role só enxerga
            Rastreamento, e oferecer "Meu perfil" levaria a um 307. */}
        <div className="flex shrink-0 flex-col gap-1 border-t border-border/70 px-2 py-2">
          {role !== "paid_traffic" ? (
            <DrawerItem
              href="/app/perfil"
              icon={UserRoundIcon}
              title="Meu perfil"
              active={isActive("/app/perfil")}
              onNavigate={() => onOpenChange(false)}
            />
          ) : null}
          {/* `variant="menu"` renderiza um `DropdownMenuItem` e exige o contexto
              do menu do Base UI — aqui não existe. `full` é o botão solto. */}
          <LogoutButton variant="full" />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DrawerItem({
  href,
  icon: Icon,
  title,
  active,
  onNavigate,
}: {
  href: string;
  icon: NavItem["icon"];
  title: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-primary"
          : "text-foreground hover:bg-muted active:bg-muted"
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", !active && "text-muted-foreground")} />
      <span className="min-w-0 truncate">{title}</span>
    </Link>
  );
}
