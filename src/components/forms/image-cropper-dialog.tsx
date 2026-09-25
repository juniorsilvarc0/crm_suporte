"use client";

import { CropIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { getCroppedImageFile } from "@/lib/image/crop";

export function ImageCropperDialog({
  open,
  onOpenChange,
  file,
  onCropped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  onCropped: (file: File) => void;
}) {
  const [source, setSource] = useState<{ file: File; src: string } | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const src = source?.file === file ? source.src : null;

  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    const sourceFile = file;
    function load() {
      if (typeof reader.result !== "string") return;
      setSource({ file: sourceFile, src: reader.result });
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setArea(null);
    }
    reader.addEventListener("load", load);
    reader.readAsDataURL(sourceFile);
    return () => {
      reader.removeEventListener("load", load);
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file]);

  async function apply() {
    if (!file || !src || !area) return;
    setBusy(true);
    try {
      onCropped(await getCroppedImageFile(src, area, file));
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível recortar a imagem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 pb-4 pt-5">
          <DialogTitle>Ajustar foto</DialogTitle>
          <DialogDescription>Arraste para posicionar o rosto e use o zoom para enquadrar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-5 py-5">
          <div className="relative h-[46dvh] min-h-64 overflow-hidden rounded-lg border border-border bg-black">
            {src ? (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                minZoom={1}
                maxZoom={3}
                aspect={1}
                cropShape="round"
                showGrid={false}
                objectFit="contain"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_visibleArea, pixels) => setArea(pixels)}
              />
            ) : null}
          </div>
          <Field>
            <FieldLabel>Zoom</FieldLabel>
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.05}
              onValueChange={(value) => setZoom(Array.isArray(value) ? (value[0] ?? 1) : value)}
              aria-label="Zoom da foto"
            />
          </Field>
        </div>
        <DialogFooter className="m-0 shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-card/95 px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 sm:h-9">Cancelar</Button>
          <Button type="button" onClick={() => void apply()} disabled={busy || !src || !area} className="h-11 sm:h-9">
            {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <CropIcon data-icon="inline-start" />}
            Salvar foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
