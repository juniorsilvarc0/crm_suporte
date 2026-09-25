"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RetryConversionButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function retry() {
    setPending(true);
    try {
      const response = await fetch(`/api/meta/conversions/${id}/retry`, {
        method: "POST",
      });
      if (response.status === 202) {
        toast.success("Evento reenfileirado com o mesmo identificador.");
        router.refresh();
        return;
      }
      if (response.status === 409) {
        toast.error("O evento não está elegível para reenvio.");
        return;
      }
      toast.error("Não foi possível reenfileirar o evento.");
    } catch {
      toast.error("Não foi possível reenfileirar o evento.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="xs" disabled={pending} onClick={retry}>
      <RotateCcwIcon />
      {pending ? "Reenfileirando" : "Reenfileirar"}
    </Button>
  );
}

