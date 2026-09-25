import type { Area } from "react-easy-crop";

const OUTPUT_TYPES = ["image/png", "image/jpeg", "image/webp"];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function getCroppedImageFile(
  imageSrc: string,
  area: Area,
  sourceFile: File
): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas não suportado.");

  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  context.drawImage(
    image,
    Math.round(area.x),
    Math.round(area.y),
    Math.round(area.width),
    Math.round(area.height),
    0,
    0,
    canvas.width,
    canvas.height
  );

  const type = OUTPUT_TYPES.includes(sourceFile.type) ? sourceFile.type : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Não foi possível gerar a imagem recortada."));
    }, type, 0.9);
  });

  return new File([blob], sourceFile.name, {
    type,
    lastModified: Date.now(),
  });
}
