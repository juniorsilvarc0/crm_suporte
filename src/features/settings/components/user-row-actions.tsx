"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  KeyRoundIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/forms/form-select";
import {
  appUserRoleOptions,
  isAppUserRole,
  type AppUser,
} from "@/features/settings/types";
import { cn } from "@/lib/utils";

export function UserRowActions({ user, isCurrent }: { user: AppUser; isCurrent: boolean }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<AppUser["role"]>(user.role);
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [apelido, setApelido] = useState(user.apelido_atendimento ?? "");
  const [assinar, setAssinar] = useState(user.assinar_mensagens);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function send(
    url: string,
    method: "PATCH" | "POST" | "DELETE",
    payload: Record<string, unknown> | undefined,
    successMessage: string
  ) {
    setPending(true);
    setErrors({});
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as {
        ok: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };
      if (!res.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível concluir.");
        return false;
      }
      toast.success(result.message ?? successMessage);
      router.refresh();
      return true;
    } catch {
      toast.error("Não foi possível concluir.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function setActive(next: boolean) {
    return send(
      `/api/users/${user.id}`,
      "PATCH",
      { name: user.name, email: user.email, is_active: next, role: user.role, avatar_url: user.avatar_url, avatar_color: user.avatar_color },
      next ? "Usuário ativado." : "Usuário desativado."
    );
  }

  async function handleEdit(event: FormEvent) {
    event.preventDefault();
    const ok = await send(
      `/api/users/${user.id}`,
      "PATCH",
      { name, email, is_active: user.is_active, role, avatar_url: user.avatar_url, avatar_color: user.avatar_color, apelido_atendimento: apelido, assinar_mensagens: assinar },
      "Usuário atualizado."
    );
    if (ok) setEditOpen(false);
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    const ok = await send(
      `/api/users/${user.id}/reset-password`,
      "POST",
      // Para o próprio usuário a exigência não se aplica (a RPC limpa no self).
      isCurrent ? { password } : { password, must_change_password: mustChangePassword },
      "Senha redefinida."
    );
    if (ok) {
      setPassword("");
      setPasswordOpen(false);
    }
  }

  async function handleConfirmDeactivate() {
    const ok = await setActive(false);
    if (ok) setConfirmOpen(false);
  }

  async function handleConfirmDelete() {
    const ok = await send(
      `/api/users/${user.id}`,
      "DELETE",
      undefined,
      "Usuário excluído."
    );
    if (ok) setDeleteOpen(false);
  }

  function openEdit() {
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setApelido(user.apelido_atendimento ?? "");
    setAssinar(user.assinar_mensagens);
    setErrors({});
    setEditOpen(true);
  }

  function openPassword() {
    setPassword("");
    setMustChangePassword(true);
    setErrors({});
    setPasswordOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
          aria-label={`Ações de ${user.name}`}
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={openEdit}>
            <PencilIcon data-icon="inline-start" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openPassword}>
            <KeyRoundIcon data-icon="inline-start" />
            Redefinir senha
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.is_active ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={isCurrent}
              onClick={() => setConfirmOpen(true)}
            >
              <UserXIcon data-icon="inline-start" />
              Desativar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={pending} onClick={() => void setActive(true)}>
              <UserCheckIcon data-icon="inline-start" />
              Ativar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={isCurrent}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <ModalShell
          size="medium"
          title="Editar usuário"
          description={`Atualize os dados de acesso de ${user.name}.`}
          onSubmit={handleEdit}
          footer={<ModalFooterActions><Button type="button" variant="outline" onClick={() => setEditOpen(false)} className="h-11 sm:h-9">Cancelar</Button><Button type="submit" disabled={pending} className="h-11 sm:h-9">{pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}Salvar alterações</Button></ModalFooterActions>}
        >
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-name-${user.id}`}>Nome</Label>
              <Input
                id={`edit-name-${user.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? `edit-name-err-${user.id}` : undefined}
              />
              {errors.name ? (
                <p id={`edit-name-err-${user.id}`} className="text-xs text-destructive">
                  {errors.name[0]}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-role-${user.id}`}>Papel</Label>
              <FormSelect
                id={`edit-role-${user.id}`}
                value={role}
                onValueChange={(value) => {
                  if (isAppUserRole(value)) setRole(value);
                }}
                disabled={isCurrent}
                options={appUserRoleOptions}
              />
              {isCurrent ? <p className="text-xs text-muted-foreground">Seu próprio papel não pode ser alterado aqui.</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-email-${user.id}`}>Email</Label>
              <Input
                id={`edit-email-${user.id}`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? `edit-email-err-${user.id}` : undefined}
              />
              {errors.email ? (
                <p id={`edit-email-err-${user.id}`} className="text-xs text-destructive">
                  {errors.email[0]}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-apelido-${user.id}`}>
                Apelido para atendimento{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id={`edit-apelido-${user.id}`}
                value={apelido}
                onChange={(event) => setApelido(event.target.value)}
                maxLength={40}
                autoComplete="off"
                placeholder="Ex.: Dra. Ana, Recepção"
              />
              <p className="text-xs text-muted-foreground">
                Assina as mensagens no chat. Em branco, usa o primeiro nome.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <Checkbox
                checked={assinar}
                onCheckedChange={(checked) => setAssinar(Boolean(checked))}
                className="mt-0.5"
                aria-label="Assinar mensagens no chat"
              />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">Assinar mensagens no chat</span>
                <span className="text-xs text-muted-foreground">
                  O contato vê quem está falando ao assumir a conversa.
                </span>
              </span>
            </label>
          </div>
        </ModalShell>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <ModalShell
          size="compact"
          title="Redefinir senha"
          description={`Defina uma nova senha para ${user.name}.`}
          onSubmit={handleResetPassword}
          footer={<ModalFooterActions><Button type="button" variant="outline" onClick={() => setPasswordOpen(false)} className="h-11 sm:h-9">Cancelar</Button><Button type="submit" disabled={pending} className="h-11 sm:h-9">{pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}Redefinir senha</Button></ModalFooterActions>}
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`reset-pass-${user.id}`}>Nova senha</Label>
              <Input
                id={`reset-pass-${user.id}`}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password ? `reset-pass-err-${user.id}` : `reset-pass-hint-${user.id}`
                }
              />
              {errors.password ? (
                <p id={`reset-pass-err-${user.id}`} className="text-xs text-destructive">
                  {errors.password[0]}
                </p>
              ) : (
                <p id={`reset-pass-hint-${user.id}`} className="text-xs text-muted-foreground">
                  Mínimo de 8 caracteres.
                </p>
              )}
            </div>

            {isCurrent ? null : (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <Checkbox
                  checked={mustChangePassword}
                  onCheckedChange={(checked) => setMustChangePassword(Boolean(checked))}
                  className="mt-0.5"
                  aria-label="Exigir troca de senha no próximo login"
                />
                <span className="grid gap-0.5 text-sm">
                  <span className="font-medium">Exigir troca no próximo login</span>
                  <span className="text-xs text-muted-foreground">
                    A senha acima é temporária. {user.name.split(" ")[0]} precisa
                    definir a própria senha ao entrar.
                  </span>
                </span>
              </label>
            )}
          </div>
        </ModalShell>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desativar usuário</DialogTitle>
            <DialogDescription>
              {user.name} perderá o acesso ao painel. Você pode reativar depois.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={handleConfirmDeactivate}
            >
              {pending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              Desativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              {user.name} será removido definitivamente. Esta ação não pode ser
              desfeita — se quiser apenas suspender o acesso, use &ldquo;Desativar&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={handleConfirmDelete}
            >
              {pending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
