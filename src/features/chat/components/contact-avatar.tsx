"use client";

import { useState } from "react";
import { UserRoundIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Avatar do contato, no padrão do WhatsApp Web: círculo neutro com silhueta
 * quando não há foto, iniciais quando há nome de verdade.
 *
 * O `onError` não é detalhe: as URLs de foto do WhatsApp (`pps.whatsapp.net`)
 * são assinadas e EXPIRAM — medido em produção, parte delas já devolve 403. Sem
 * o fallback o navegador desenha o ícone de imagem quebrada ("?").
 */
export function ContactAvatar({
  name,
  phone,
  url,
  className,
}: {
  name?: string | null;
  phone?: string | null;
  url?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  // O header reaproveita a MESMA instância ao trocar de conversa. Sem zerar,
  // uma foto quebrada contaminaria a próxima conversa, que tem foto boa.
  // Ajuste durante o render, padrão do repo.
  const [syncedUrl, setSyncedUrl] = useState(url);
  if (url !== syncedUrl) {
    setSyncedUrl(url);
    setBroken(false);
  }

  // Nome "de verdade" = tem letra. Telefone salvo como nome vira silhueta, que
  // é mais legível que as iniciais de um número.
  const label = name?.trim() ?? "";
  const initials = /\p{L}/u.test(label)
    ? label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase()
    : "";

  const showImage = Boolean(url) && !broken;

  return (
    <div
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-[var(--wa-avatar-bg)] text-[var(--wa-avatar-fg)]",
        className
      )}
      aria-label={label || phone || "Contato"}
    >
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url as string}
          alt=""
          referrerPolicy="no-referrer"
          // A lista monta as 407 conversas de uma vez. Sem `lazy` eram ~280
          // requisições simultâneas a `pps.whatsapp.net` já na abertura da
          // tela — boa parte para URL expirada, só para cair nas iniciais.
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : initials ? (
        <span className="text-sm font-semibold">{initials}</span>
      ) : (
        <UserRoundIcon className="size-1/2" aria-hidden />
      )}
    </div>
  );
}
