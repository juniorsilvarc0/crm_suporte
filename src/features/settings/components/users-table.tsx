"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ActiveFilters, DataToolbar, FilterButton, FilterField, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProfileAvatar } from "@/features/settings/components/profile-avatar";
import { UserRowActions } from "@/features/settings/components/user-row-actions";
import {
  APP_USER_ROLES,
  appUserRoleLabel,
  type AppUser,
} from "@/features/settings/types";
import { formatDate } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "inactive";
type RoleFilter = "all" | AppUser["role"];

export function UsersTable({ users, currentUserId, actions }: { users: AppUser[]; currentUserId: string | null; actions?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [role, setRole] = useState<RoleFilter>("all");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return users.filter((user) => {
      const matchesQuery = !normalized || `${user.name} ${user.email}`.toLocaleLowerCase("pt-BR").includes(normalized);
      const matchesStatus = status === "all" || (status === "active" ? user.is_active : !user.is_active);
      return matchesQuery && matchesStatus && (role === "all" || user.role === role);
    });
  }, [query, role, status, users]);
  const activeCount = Number(status !== "all") + Number(role !== "all");

  return (
    <section aria-labelledby="team-title" className="space-y-3">
      <div>
        <h1 id="team-title" className="font-display text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="text-sm text-muted-foreground">{filtered.length === users.length ? `${users.length} ${users.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}` : `${filtered.length} de ${users.length} usuários`}</p>
      </div>
      <DataToolbar>
        <ToolbarSearch aria-label="Buscar usuário" placeholder="Buscar por nome ou e-mail…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FilterButton activeCount={activeCount}>
            <FilterField label="Papel">
              <FormSelect value={role} onValueChange={(value) => setRole((value || "all") as RoleFilter)} options={[{ value: "all", label: "Todos" }, ...APP_USER_ROLES.map((value) => ({ value, label: appUserRoleLabel[value] }))]} />
            </FilterField>
            <FilterField label="Acesso">
              <FormSelect value={status} onValueChange={(value) => setStatus((value || "all") as StatusFilter)} options={[{ value: "all", label: "Todos" }, { value: "active", label: "Ativos" }, { value: "inactive", label: "Inativos" }]} />
            </FilterField>
          </FilterButton>
          <ActiveFilters count={activeCount + Number(Boolean(query))} onClear={() => { setQuery(""); setRole("all"); setStatus("all"); }} />
          {actions}
        </div>
      </DataToolbar>

      {users.length === 0 ? <EmptyState>Nenhum usuário cadastrado.</EmptyState> : (
        // Linha = cartão, como nas listas de leads e follow-ups (UI.md §3.3).
        <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft">
          <Table variant="cards" className="table-fixed">
            <TableHeader><TableRow variant="cards-header"><TableHead className="pl-3 sm:pl-4">Usuário</TableHead><TableHead className="hidden w-36 md:table-cell">Papel</TableHead><TableHead className="hidden w-28 sm:table-cell">Acesso</TableHead><TableHead className="hidden w-36 lg:table-cell">Desde</TableHead><TableHead className="w-12"><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map((user) => {
                const isCurrent = user.id === currentUserId;
                return (
                  <TableRow key={user.id} variant="card" className={cn(!user.is_active && "opacity-60")}>
                    <TableCell className="max-w-0 py-3 pl-3 sm:pl-4"><div className="flex min-w-0 items-center gap-3"><ProfileAvatar name={user.name} avatarUrl={user.avatar_url} avatarColor={user.avatar_color} /><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-medium">{user.name}</span>{isCurrent ? <Badge variant="secondary" className="h-5">Você</Badge> : null}</div><p className="truncate text-xs text-muted-foreground">{user.email}</p><div className="mt-1.5 flex gap-1.5 md:hidden"><Badge variant="outline">{appUserRoleLabel[user.role]}</Badge><Badge variant={user.is_active ? "secondary" : "outline"} className="sm:hidden">{user.is_active ? "Ativo" : "Inativo"}</Badge></div></div></div></TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="outline">{appUserRoleLabel[user.role]}</Badge></TableCell>
                    <TableCell className="hidden sm:table-cell"><span className="inline-flex items-center gap-2 text-sm"><span className={`size-2 rounded-full ${user.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />{user.is_active ? "Ativo" : "Inativo"}</span></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDate(user.created_at)}</TableCell>
                    <TableCell className="text-right"><UserRowActions user={user} isCurrent={isCurrent} /></TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 ? <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Nenhum usuário encontrado. Ajuste a busca ou os filtros.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
