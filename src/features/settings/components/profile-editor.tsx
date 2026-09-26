"use client";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { AvatarField } from "@/features/settings/components/avatar-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { isColorName, type ColorName } from "@/features/tags/schemas/colors";
import { appUserRoleLabel, type AppUser } from "@/features/settings/types";

export function ProfileEditor({ user }: { user: AppUser }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url);
  const [color, setColor] = useState<ColorName>(isColorName(user.avatar_color) ? user.avatar_color : "slate");
  const [apelido, setApelido] = useState(user.apelido_atendimento ?? "");
  const [assinar, setAssinar] = useState(user.assinar_mensagens);
  const [pending, setPending] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  async function saveProfile() {
    setPending(true);
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, is_active: user.is_active, role: user.role, avatar_url: avatarUrl, avatar_color: color, apelido_atendimento: apelido, assinar_mensagens: assinar }),
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message);
      toast.success("Perfil atualizado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível salvar o perfil.");
    } finally {
      setPending(false);
    }
  }

  async function savePassword() {
    if (password.length < 8) return toast.error("A senha deve ter ao menos 8 caracteres.");
    if (password !== confirm) return toast.error("As senhas não conferem.");
    setPasswordPending(true);
    try {
      const response = await fetch(`/api/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message);
      setPassword("");
      setConfirm("");
      toast.success("Senha atualizada.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível alterar a senha.");
    } finally {
      setPasswordPending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <AvatarField userId={user.id} name={name || user.name} avatarUrl={avatarUrl} avatarColor={color} onChange={setAvatarUrl} />
        <div className="min-w-0 space-y-1">
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{name || user.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
          <Badge variant="outline" className="mt-1">{appUserRoleLabel[user.role]}</Badge>
        </div>
      </div>

      <section aria-labelledby="identity-title" className="mt-8 border-t border-border/70 pt-6">
        <h2 id="identity-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identidade</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="profile-name">Nome</Label>
            <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-email">E-mail</Label>
            <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="profile-apelido">
              Apelido para atendimento <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="profile-apelido"
              value={apelido}
              onChange={(event) => setApelido(event.target.value)}
              maxLength={40}
              autoComplete="off"
              placeholder="Ex.: Ana, Suporte N1"
            />
            <p className="text-xs text-muted-foreground">
              Nome que assina suas mensagens no chat. Em branco, usa seu primeiro nome.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:col-span-2">
            <Checkbox
              checked={assinar}
              onCheckedChange={(checked) => setAssinar(Boolean(checked))}
              className="mt-0.5"
              aria-label="Assinar mensagens enviadas no chat"
            />
            <span className="grid gap-0.5 text-sm">
              <span className="font-medium">Assinar minhas mensagens no chat</span>
              <span className="text-xs text-muted-foreground">
                Ao assumir uma conversa, o contato vê quem está falando. Desmarcado,
                as mensagens seguem sem assinatura.
              </span>
            </span>
          </label>
          <div className="grid gap-2 sm:col-span-2">
            <Label>Cor do avatar</Label>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => void saveProfile()} disabled={pending || !name.trim() || !email.trim()}>
            {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            Salvar perfil
          </Button>
        </div>
      </section>

      <section aria-labelledby="security-title" className="mt-8 border-t border-border/70 pt-6">
        <h2 id="security-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Segurança</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="profile-password">Nova senha</Label>
            <Input id="profile-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Mínimo de 8 caracteres" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-password-confirm">Confirmar senha</Label>
            <Input id="profile-password-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="outline" disabled={passwordPending || !password || !confirm} onClick={() => void savePassword()}>
            {passwordPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Alterar senha
          </Button>
        </div>
      </section>
    </main>
  );
}
