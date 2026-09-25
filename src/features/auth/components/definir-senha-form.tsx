"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DefinirSenhaForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password.length < 8) {
      setError("A senha deve ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/auth/definir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        setError(result.message ?? "Não foi possível definir a senha.");
        return;
      }
      toast.success("Senha definida. Bem-vindo!");
      // Recarrega para o layout reavaliar o flag (agora limpo) e liberar o app.
      router.replace("/app");
      router.refresh();
    } catch {
      setError("Não foi possível definir a senha.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="definir-password">Nova senha</Label>
        <Input
          id="definir-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          aria-invalid={error ? true : undefined}
        />
        <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="definir-confirm">Confirmar nova senha</Label>
        <Input
          id="definir-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "definir-err" : undefined}
        />
        {error ? (
          <p id="definir-err" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="h-11">
        {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
        Definir senha e continuar
      </Button>
    </form>
  );
}
