"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  OctagonXIcon,
  UserRoundIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/kibo-ui/spinner";
import { cn } from "@/lib/utils";
import { safeRedirectPath } from "@/features/auth/lib/safe-redirect";

type Status = "idle" | "pending" | "success" | "error";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    setErrors({});
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    };

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        setErrorMessage(result.message ?? "Não foi possível entrar.");
        setStatus("error");
        return;
      }

      setStatus("success");
      const redirectTo = safeRedirectPath(searchParams.get("redirect"), window.location.origin);
      setTimeout(() => {
        router.replace(redirectTo);
        router.refresh();
      }, 450);
    } catch {
      setErrorMessage("Sem conexão. Tente novamente.");
      setStatus("error");
    }
  }

  const pending = status === "pending";
  const success = status === "success";
  const showError = status === "error" && errorMessage;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div
        aria-live="polite"
        role="status"
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none",
          showError
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        )}
        style={{ display: "grid" }}
      >
        <div className="min-h-0">
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <OctagonXIcon className="mt-0.5 size-4 shrink-0" />
            <p className="leading-snug">{errorMessage}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email" className="text-sm font-medium">
          E-mail ou usuário
        </Label>
        {/* Ícone dentro do campo: é adorno, não controle — `pointer-events-none`
            para o clique cair no input, e `aria-hidden` para não ser lido. */}
        <div className="relative">
          <UserRoundIcon
            className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/70"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            required
            disabled={pending || success}
            placeholder="seunome@empresa.com.br"
            className={cn(
              "h-12 rounded-xl pl-11",
              errors.email?.[0] && "border-destructive focus-visible:border-destructive"
            )}
          />
        </div>
        {errors.email?.[0] ? (
          <p className="text-xs text-destructive">{errors.email[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Senha
        </Label>
        <div className="relative">
          <LockIcon
            className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/70"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={pending || success}
            placeholder="••••••••••"
            className={cn(
              "h-12 rounded-xl pl-11 pr-12",
              errors.password?.[0] && "border-destructive focus-visible:border-destructive"
            )}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            disabled={pending || success}
            className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {showPassword ? (
              <EyeOffIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
          </button>
        </div>
        {errors.password?.[0] ? (
          <p className="text-xs text-destructive">{errors.password[0]}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={pending || success}
        className={cn(
          "mt-3 h-12 w-full gap-2 text-[15px] transition-colors duration-300",
          success && "bg-emerald-600 text-white hover:bg-emerald-600"
        )}
        aria-live="polite"
      >
        {pending ? (
          <>
            <Spinner variant="circle-filled" className="size-4" />
            Entrando…
          </>
        ) : success ? (
          <>
            <CheckIcon className="size-4" strokeWidth={3} />
            Tudo certo
          </>
        ) : (
          <>
            <ArrowRightIcon className="size-4" />
            Entrar
          </>
        )}
      </Button>
    </form>
  );
}
