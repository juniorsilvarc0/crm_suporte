"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarkAttendedButton({
  appointmentId,
  fullWidth = false,
  variant = "secondary",
  className,
}: {
  appointmentId: string;
  fullWidth?: boolean;
  variant?: "default" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/attended`, {
        method: "POST",
      });
      const result = (await response.json()) as { ok: boolean; message?: string };

      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível registrar.");
        return;
      }

      toast.success(result.message ?? "Visita registrada.");
      router.refresh();
    } catch {
      toast.error("Não foi possível registrar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      size={fullWidth ? "default" : "sm"}
      variant={variant}
      onClick={handleClick}
      disabled={pending}
      className={cn(fullWidth && "h-11 w-full", className)}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <CheckCircle2Icon data-icon="inline-start" />
      )}
      Visitou
    </Button>
  );
}
