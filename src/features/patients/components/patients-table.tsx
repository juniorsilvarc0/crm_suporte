"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArchiveIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";

import { toast } from "sonner";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { DataToolbar, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { PatientFormDialog } from "@/features/patients/components/patient-form-dialog";
import type { Patient } from "@/features/patients/types";
import { EmptyState } from "@/components/data-display/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sanitizeLeadSearch } from "@/features/leads/lib/leads-search";
import { ageFromBirthDate, formatCpf } from "@/features/patients/lib/documents";
import type { PatientListItem } from "@/features/patients/types";
import { formatDate } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

// Busca sem acento e sem caixa: "joao" acha "João".
function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// O que a busca da página varre — o mesmo conjunto que a query do servidor
// filtra, para o resultado local não divergir do paginado.
function patientSearchText(patient: PatientListItem) {
  return [
    patient.full_name,
    patient.social_name,
    patient.phone,
    formatPhone(patient.phone),
    patient.cpf,
    formatCpf(patient.cpf),
  ]
    .filter(Boolean)
    .join(" ");
}

function birthLabel(patient: PatientListItem) {
  if (!patient.birth_date) return null;
  const age = ageFromBirthDate(patient.birth_date);
  return {
    date: formatDate(patient.birth_date),
    age: age == null ? null : `${age} ${age === 1 ? "ano" : "anos"}`,
  };
}

export function PatientsTable({
  patients,
  initialSearchQuery = "",
}: {
  patients: PatientListItem[];
  initialSearchQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // O formulário precisa da ficha COMPLETA para editar: a lista traz um
  // recorte de colunas, e salvar com o recorte apagaria o resto.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function archivePatient(id: string, name: string) {
    // Arquiva, nunca apaga: agendamento e histórico continuam ligados ao mesmo
    // cadastro (mesmo critério de "Arquivar pessoa" em Leads).
    try {
      const response = await fetch(`/api/patients/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("archive");
      toast.success(`${name} foi arquivado.`);
      router.refresh();
    } catch {
      toast.error("Não foi possível arquivar o paciente.");
    }
  }

  async function openPatient(id: string) {
    setLoadingId(id);
    try {
      const response = await fetch(`/api/patients/${id}`);
      const payload = (await response.json()) as { ok: boolean; patient?: Patient; message?: string };
      if (!response.ok || !payload.patient) {
        toast.error(payload.message ?? "Não foi possível abrir o paciente.");
        return;
      }
      setEditing(payload.patient);
      setFormOpen(true);
    } catch {
      toast.error("Não foi possível abrir o paciente.");
    } finally {
      setLoadingId(null);
    }
  }
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);

  // O termo vai para a URL (é o servidor que pagina), mas só depois da pausa de
  // digitação — sem isso cada tecla viraria uma navegação.
  useEffect(() => {
    if (searchQuery.trim() === initialSearchQuery.trim()) return;

    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const query = searchQuery.trim();
      params.delete("page");
      if (query) params.set("q", query);
      else params.delete("q");
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [initialSearchQuery, pathname, router, searchParams, searchQuery]);

  // Filtro local enquanto a navegação não chega: a lista responde à tecla em
  // vez de ficar parada nos 300ms de espera.
  const filteredPatients = useMemo(() => {
    const term = normalizeSearch(searchQuery.trim());
    if (!term) return patients;
    return patients.filter((patient) =>
      normalizeSearch(patientSearchText(patient)).includes(term)
    );
  }, [patients, searchQuery]);

  // ⚠️ Sem retorno antecipado para base vazia: era ele que escondia a barra —
  // e com ela o botão "Novo paciente". Tela vazia é justamente onde a ação de
  // criar precisa estar (UI.md §5.1: vazio é convite para agir).
  const baseEmpty = patients.length === 0 && !initialSearchQuery;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        <DataToolbar className="px-3">
          <ToolbarSearch
            value={searchQuery}
            onChange={(event) => setSearchQuery(sanitizeLeadSearch(event.target.value))}
            placeholder="Buscar por nome, telefone ou CPF…"
            aria-label="Buscar paciente por nome, telefone ou CPF"
          />
          {searchQuery ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSearchQuery("")} className="h-11 sm:h-9">
              <XIcon data-icon="inline-start" />
              Limpar
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="ml-auto h-11 sm:h-9"
          >
            <PlusIcon data-icon="inline-start" />
            Novo paciente
          </Button>
        </DataToolbar>

        {filteredPatients.length === 0 ? (
          <div className="p-8">
            <EmptyState>
              {baseEmpty ? (
                <span className="flex flex-col items-center gap-3">
                  <span>
                    Nenhum paciente cadastrado ainda. Alguém vira paciente ao marcar uma
                    consulta — ou você cadastra aqui mesmo, sem passar por lead.
                  </span>
                  <Button type="button" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <PlusIcon data-icon="inline-start" />
                    Cadastrar paciente
                  </Button>
                </span>
              ) : (
                "Nenhum paciente encontrado para a busca."
              )}
            </EmptyState>
          </div>
        ) : (
          <>
            {/* Casca 3.0 no desktop: cada paciente é um CARTÃO, não linha colada.
                O cartão é desenhado nas células pelo `variant="card"`, e o leito
                tingido é o que faz o cartão branco existir (UI.md §3.3). */}
            <div className="hidden bg-muted/20 px-2 pb-2 md:block">
              <Table variant="cards" className="w-full table-fixed">
                <TableHeader>
                  <TableRow variant="cards-header">
                    <TableHead className="h-9 w-[26%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Paciente
                    </TableHead>
                    <TableHead className="h-9 w-[15%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Nascimento
                    </TableHead>
                    <TableHead className="h-9 w-[16%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Contato
                    </TableHead>
                    <TableHead className="h-9 w-[15%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      CPF
                    </TableHead>
                    <TableHead className="h-9 w-[16%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Convênio
                    </TableHead>
                    <TableHead className="h-9 w-[12%] px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Cadastro
                    </TableHead>
                    <TableHead className="h-9 w-[6%] px-2" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map((patient) => {
                    const birth = birthLabel(patient);
                    return (
                      <TableRow
                        key={patient.id}
                        variant="card"
                        onClick={() => void openPatient(patient.id)}
                        aria-busy={loadingId === patient.id}
                        className="cursor-pointer"
                      >
                        <TableCell className="px-4 py-3">
                          <PatientIdentity patient={patient} />
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {birth ? (
                            <div className="min-w-0">
                              <div className="font-mono text-xs tabular-nums">{birth.date}</div>
                              {birth.age ? (
                                <div className="mt-0.5 text-xs text-muted-foreground">{birth.age}</div>
                              ) : null}
                            </div>
                          ) : (
                            <NoData />
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs tabular-nums">
                          {patient.phone ? formatPhone(patient.phone) : <NoData />}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs tabular-nums">
                          {patient.cpf ? formatCpf(patient.cpf) : <NoData />}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <InsuranceBadge name={patient.insurance_name} />
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatDate(patient.created_at)}
                        </TableCell>
                        <TableCell className="px-2 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <PatientRowMenu
                            patient={patient}
                            onEdit={() => void openPatient(patient.id)}
                            onArchive={() => void archivePatient(patient.id, patient.full_name)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* No celular a lista é uma pilha de cartões de pessoa. O leito
                `bg-muted/25` é o que separa o cartão branco do painel branco. */}
            <div className="grid gap-2 bg-muted/25 p-2 md:hidden">
              {filteredPatients.map((patient) => {
                const birth = birthLabel(patient);
                return (
                  <article
                    onClick={() => void openPatient(patient.id)}
                    aria-busy={loadingId === patient.id}
                    key={patient.id}
                    // ⚠️ Mesmo motivo do cartão de leads: grid sem coluna
                    // declarada gera trilha implícita com piso no min-content,
                    // e o cartão fica mais largo que o celular. Aqui o
                    // `<article>` não tem `overflow-hidden`, então quem recorta
                    // é o painel de fora — o efeito visível é o "Cadastro
                    // dd/mm/aaaa" sumindo na borda. Mesma causa, clipe em outro
                    // lugar, mesmo remédio.
                    className="grid w-full grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-left"
                  >
                    {/* ⚠️ `min-w-0` porque a linha é item de grid: `min-width: auto` só vira 0
                        quando a trilha não tem mínimo `auto`, e depender dessa sutileza
                        deixou o texto estourando no Safari mesmo com o cartão já certo. */}
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <PatientIdentity patient={patient} />
                      <InsuranceBadge name={patient.insurance_name} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <PatientFact label="Nascimento">
                        {birth ? `${birth.date}${birth.age ? ` · ${birth.age}` : ""}` : null}
                      </PatientFact>
                      <PatientFact label="CPF">
                        {patient.cpf ? formatCpf(patient.cpf) : null}
                      </PatientFact>
                    </dl>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {[patient.city, patient.state].filter(Boolean).join(" · ") || "Endereço não informado"}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">
                        Cadastro {formatDate(patient.created_at)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      <PatientFormDialog
        open={formOpen}
        onOpenChange={(next) => { setFormOpen(next); if (!next) setEditing(null); }}
        patient={editing}
      />
    </>
  );
}


function PatientIdentity({ patient }: { patient: PatientListItem }) {
  return (
    // Pessoa antes de dado: a inicial dá âncora para varrer a lista. Tom neutro
    // — matiz por pessoa seria decoração sem significado (UI.md §Anti-padrões).
    <div className="flex min-w-0 items-center gap-2.5">
      <AvatarInitials name={patient.social_name ?? patient.full_name} size="md" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{patient.full_name}</div>
        {patient.social_name ? (
          // É pelo nome social que a recepção chama a pessoa — ele não pode
          // ficar escondido atrás do nome de registro.
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            Chamar de {patient.social_name}
          </div>
        ) : null}
      </div>

    </div>
  );
}

function InsuranceBadge({ name }: { name: string | null }) {
  if (!name) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 rounded-sm border-border bg-background px-2 py-0 text-[11px] font-medium text-muted-foreground"
      >
        Sem convênio
      </Badge>
    );
  }

  return (
    // `max-w-full` + `min-w-0` no texto: o primitivo Badge é `shrink-0`, e nome
    // de operadora longo transbordaria por cima da coluna vizinha.
    <Badge
      variant="outline"
      className="max-w-full rounded-sm border-primary/30 bg-primary/5 px-2 py-0 text-[11px] font-medium text-primary"
      title={`Convênio: ${name}`}
    >
      <span className="sr-only">Convênio:</span>
      <span className="min-w-0 truncate">{name}</span>
    </Badge>
  );
}

function PatientFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-mono tabular-nums", !children && "text-muted-foreground")}>
        {children || "—"}
      </dd>
    </div>
  );
}

function NoData() {
  return <span className="text-muted-foreground">—</span>;
}


/** Ações da linha: editar abre a ficha completa; arquivar tira da lista sem apagar. */
function PatientRowMenu({
  patient,
  onEdit,
  onArchive,
}: {
  patient: PatientListItem;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-11 sm:size-9"
            aria-label={`Ações de ${patient.full_name}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 p-1.5">
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onEdit}>
          <PencilIcon />
          Abrir ficha
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {confirming ? (
          <DropdownMenuItem
            className="min-h-11 text-destructive sm:min-h-8"
            onClick={() => {
              setConfirming(false);
              onArchive();
            }}
          >
            <ArchiveIcon />
            Confirmar arquivamento
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            closeOnClick={false}
            onClick={() => setConfirming(true)}
          >
            <ArchiveIcon />
            Arquivar paciente
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
