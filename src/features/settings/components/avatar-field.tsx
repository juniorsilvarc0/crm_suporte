"use client";

import { ImageUpIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ImageCropperDialog } from "@/components/forms/image-cropper-dialog";
import { ProfileAvatar } from "@/features/settings/components/profile-avatar";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export function AvatarField({
  userId,
  name,
  avatarUrl,
  avatarColor,
  onChange,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string;
  onChange?: (url: string | null) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  function pick(file?: File) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) {
      toast.error("Use uma imagem PNG, JPG ou WebP de até 5 MB.");
      return;
    }
    setPickedFile(file);
    setCropOpen(true);
  }

  async function upload(file?: File) {
    if (!file) return;
    setPending(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch(`/api/users/${userId}/avatar`, { method: "POST", body: form });
      const result = (await response.json()) as { ok: boolean; message?: string; avatarUrl?: string };
      if (!response.ok || !result.ok) throw new Error(result.message);
      onChange?.(result.avatarUrl ?? null);
      toast.success("Foto atualizada.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível enviar a foto.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      const response = await fetch(`/api/users/${userId}/avatar`, { method: "DELETE" });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message);
      onChange?.(null);
      toast.success("Foto removida.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível remover a foto.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button type="button" disabled={pending} onClick={() => inputRef.current?.click()} aria-label={avatarUrl ? "Alterar foto" : "Adicionar foto"} className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <ProfileAvatar name={name} avatarUrl={avatarUrl} avatarColor={avatarColor} size="xl" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/45 text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {pending ? <Loader2Icon className="size-5 animate-spin" /> : <ImageUpIcon className="size-5" />}
        </span>
      </button>
      <div className="flex flex-col items-start gap-1.5">
        <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} className="sr-only" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
        <Button type="button" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
          <ImageUpIcon data-icon="inline-start" />
          {avatarUrl ? "Alterar foto" : "Adicionar foto"}
        </Button>
        {avatarUrl ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => void remove()} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            <Trash2Icon data-icon="inline-start" /> Remover
          </Button>
        ) : null}
      </div>
      <ImageCropperDialog
        open={cropOpen}
        onOpenChange={setCropOpen}
        file={pickedFile}
        onCropped={(file) => void upload(file)}
      />
    </div>
  );
}
