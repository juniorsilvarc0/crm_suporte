"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/kibo-ui/spinner";

export function LogoutButton({
  variant = "icon",
}: {
  variant?: "icon" | "full" | "menu";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        toast.error("Não foi possível sair.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Sem conexão.");
    } finally {
      setPending(false);
    }
  }

  if (variant === "full") {
    return (
      <Button
        variant="ghost"
        onClick={handleClick}
        disabled={pending}
        className="h-10 w-full justify-start gap-3 px-2 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        {pending ? (
          <Spinner variant="circle-filled" className="size-[18px]" />
        ) : (
          <LogOutIcon className="size-[18px] stroke-[1.6]" />
        )}
        Sair
      </Button>
    );
  }

  if (variant === "menu") {
    return (
      <DropdownMenuItem onClick={handleClick} disabled={pending} className="h-10 gap-2.5 px-2.5">
        {pending ? <Spinner variant="circle-filled" className="size-4" /> : <LogOutIcon className="size-4 text-muted-foreground" />}
        Sair
      </DropdownMenuItem>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={pending}
      aria-label="Sair"
      className="size-10 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"
    >
      {pending ? (
        <Spinner variant="circle-filled" className="size-[18px]" />
      ) : (
        <LogOutIcon className="size-[18px] stroke-[1.6]" />
      )}
    </Button>
  );
}
