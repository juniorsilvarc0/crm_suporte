"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import {
  Dialog,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/forms/form-select";
import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import type { ColorName } from "@/features/tags/schemas/colors";
import {
  appUserRoleOptions,
  isAppUserRole,
  type AppUserRole,
} from "@/features/settings/types";

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [role, setRole] = useState<AppUserRole>("member");
  const [color, setColor] = useState<ColorName>("slate");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [assinarMensagens, setAssinarMensagens] = useState(true);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setErrors({});
      setRole("member");
      setColor("slate");
      setMustChangePassword(true);
      setAssinarMensagens(true);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const payload = {
      ...Object.fromEntries(new FormData(event.currentTarget)),
      must_change_password: mustChangePassword,
      assinar_mensagens: assinarMensagens,
    };

    try {
      const res = await fetch("/api/users", {
        method: "POST",
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
        toast.error(result.message ?? "Não foi possível criar o usuário.");
        return;
      }

      toast.success(result.message ?? "Usuário criado.");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o usuário.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => handleOpenChange(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Novo usuário
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <ModalShell
          size="medium"
          title="Novo usuário"
          description="Defina a identidade e o nível de acesso ao CRM."
          onSubmit={handleSubmit}
          footer={
            <ModalFooterActions>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="h-11 sm:h-9">Cancelar</Button>
              <Button type="submit" disabled={pending} className="h-11 sm:h-9">{pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}Adicionar usuário</Button>
            </ModalFooterActions>
          }
        >
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <Label htmlFor="new-user-name">Nome</Label>
              <Input
                id="new-user-name"
                name="name"
                autoComplete="off"
                required
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "new-user-name-err" : undefined}
              />
              {errors.name ? (
                <p id="new-user-name-err" className="text-xs text-destructive">
                  {errors.name[0]}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-user-role">Papel</Label>
              <FormSelect
                id="new-user-role"
                name="role"
                value={role}
                onValueChange={(value) => {
                  if (isAppUserRole(value)) setRole(value);
                }}
                options={appUserRoleOptions}
              />
            </div>

            <div className="grid gap-2">
              <Label>Cor do avatar</Label>
              <input type="hidden" name="avatar_color" value={color} />
              <ColorSwatchPicker value={color} onChange={setColor} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "new-user-email-err" : undefined}
              />
              {errors.email ? (
                <p id="new-user-email-err" className="text-xs text-destructive">
                  {errors.email[0]}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-user-password">Senha</Label>
              <Input
                id="new-user-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password ? "new-user-password-err" : "new-user-password-hint"
                }
              />
              {errors.password ? (
                <p id="new-user-password-err" className="text-xs text-destructive">
                  {errors.password[0]}
                </p>
              ) : (
                <p id="new-user-password-hint" className="text-xs text-muted-foreground">
                  Mínimo de 8 caracteres.
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <Checkbox
                checked={mustChangePassword}
                onCheckedChange={(checked) => setMustChangePassword(Boolean(checked))}
                className="mt-0.5"
                aria-label="Exigir troca de senha no primeiro acesso"
              />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">Exigir troca de senha no primeiro acesso</span>
                <span className="text-xs text-muted-foreground">
                  A senha acima é temporária. No primeiro login, o usuário precisa
                  definir a própria senha antes de usar o sistema.
                </span>
              </span>
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="new-user-apelido">
                Apelido para atendimento{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="new-user-apelido"
                name="apelido_atendimento"
                autoComplete="off"
                maxLength={40}
                placeholder="Ex.: Ana, Suporte N1"
                aria-invalid={errors.apelido_atendimento ? true : undefined}
                aria-describedby={
                  errors.apelido_atendimento
                    ? "new-user-apelido-err"
                    : "new-user-apelido-hint"
                }
              />
              {errors.apelido_atendimento ? (
                <p id="new-user-apelido-err" className="text-xs text-destructive">
                  {errors.apelido_atendimento[0]}
                </p>
              ) : (
                <p id="new-user-apelido-hint" className="text-xs text-muted-foreground">
                  Nome que assina as mensagens no chat. Em branco, usa o primeiro nome.
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <Checkbox
                checked={assinarMensagens}
                onCheckedChange={(checked) => setAssinarMensagens(Boolean(checked))}
                className="mt-0.5"
                aria-label="Assinar mensagens enviadas no chat"
              />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">Assinar mensagens no chat</span>
                <span className="text-xs text-muted-foreground">
                  Ao assumir uma conversa, as mensagens vão identificadas para o
                  contato. Desmarcado, seguem sem assinatura.
                </span>
              </span>
            </label>
          </div>
        </ModalShell>
      </Dialog>
    </>
  );
}
