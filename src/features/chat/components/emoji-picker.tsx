"use client";

import { useEffect, useState } from "react";
import { SmileIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Seletor de emojis leve (sem dependência externa) — conjunto curado por
// categoria, estilo WhatsApp Web. Insere o emoji via onSelect (o composer
// coloca no cursor).
const CATEGORIES: { key: string; label: string; emojis: string[] }[] = [
  {
    key: "smileys",
    label: "😀",
    emojis:
      "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤠 😈 👻 💀 🤖 🎃".split(
        " "
      ),
  },
  {
    key: "gestures",
    label: "👍",
    emojis:
      "👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✍️ 💅 🤳 💪 🦾 👏 🙌 👐 🤲 🫶 👀 👁️ 👅 👄 🧠 🫀".split(
        " "
      ),
  },
  {
    key: "hearts",
    label: "❤️",
    emojis:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ❤️‍🔥 ✨ ⭐ 🌟 💫 ⚡ 🔥 💥 💯 ✅ ❌ ❓ ❗ 💤 👍 🎉 🎊".split(
        " "
      ),
  },
  {
    key: "animals",
    label: "🐶",
    emojis:
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🐙 🦐 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🌸 🌹 🌺 🌻 🌷 🌱 🌲 🌳 🍀 🌈 ☀️ 🌙".split(
        " "
      ),
  },
  {
    key: "food",
    label: "🍔",
    emojis:
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥝 🍅 🥑 🌽 🥕 🍞 🧀 🥚 🍳 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍿 🍦 🍰 🎂 🍫 🍬 🍭 🍩 🍪 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷".split(
        " "
      ),
  },
  {
    key: "activities",
    label: "⚽",
    emojis:
      "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🎯 🎣 🎮 🕹️ 🎲 🧩 🎸 🎹 🎺 🎻 🥁 🎬 🎤 🎧 📱 💻 ⌚ 📷 📸 🎥 📺 💡 🔦 🔋 🎁 🎈 🎉 🎊 🏆 🥇 🥈 🥉".split(
        " "
      ),
  },
  {
    key: "travel",
    label: "🚗",
    emojis:
      "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🚚 🚛 🚜 🏍️ 🛵 🚲 ✈️ 🚀 🚁 ⛵ 🚤 ⚓ 🏖️ 🏝️ 🏔️ ⛰️ 🌋 🏕️ 🏠 🏡 🏢 🏥 🏨 🏦 🏫 🗼 🎡 🎢 🌇 🌃 🌉".split(
        " "
      ),
  },
  {
    key: "symbols",
    label: "🔣",
    emojis:
      "💬 💭 🔔 🔕 🎵 🎶 ➕ ➖ ✖️ 💲 💰 🎁 🏆 📌 📍 ✏️ 📝 📎 🔒 🔓 ⚠️ 🚫 ✔️ ➡️ ⬅️ ⬆️ ⬇️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🕐 📅 ✅ ❌ ❓ ❗ 🇧🇷".split(
        " "
      ),
  },
];

export function EmojiPicker({
  onSelect,
  disabled,
}: {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(0);

  /**
   * Esc fecha o painel.
   *
   * Ele é popover solto (ver a nota abaixo), então não herda o Esc do Base UI —
   * e sem tratar aqui o Esc seguiria adiante e fecharia a conversa inteira com o
   * seletor aberto. `preventDefault` é o sinal de "eu tratei" para o ChatView.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Emojis"
        className="flex size-11 items-center justify-center rounded-full text-[var(--wa-meta)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5 sm:size-9"
      >
        <SmileIcon className="size-5" />
      </button>

      {/* ⚠️ Continua POPOVER, não vira gaveta.
          Este seletor é usado DENTRO do diálogo de editar e da tela de envio.
          No celular aqueles dois já são gaveta, e uma gaveta dentro de outra é
          o anti-padrão do UI.md §9: dois backdrops, duas armadilhas de foco e
          dois donos do Esc. O que ele precisava mesmo no celular era caber na
          tela e ter alvo de dedo — é o que está abaixo. */}
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-12 right-0 z-20 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--wa-panel-border)] bg-popover shadow-lg">
            {/* Tabs de categoria */}
            <div className="flex border-b border-[var(--wa-panel-border)]">
              {CATEGORIES.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCat(i)}
                  aria-label={c.key}
                  className={cn(
                    "min-h-11 flex-1 text-lg transition-colors sm:min-h-9 sm:text-base",
                    i === cat
                      ? "border-b-2 border-[var(--wa-green-deep)] bg-black/5 dark:bg-white/5"
                      : "opacity-60 hover:opacity-100"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {/* Grade de emojis. 36px no celular: numa grade densa de alvos
                iguais, é o tamanho que o próprio WhatsApp usa — 44px por
                célula não caberia em 8 colunas numa tela de 320px. */}
            <div className="grid max-h-[40dvh] grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain p-2 sm:max-h-56">
              {CATEGORIES[cat].emojis.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  type="button"
                  onClick={() => onSelect(e)}
                  className="flex size-9 items-center justify-center rounded text-2xl leading-none hover:bg-black/5 dark:hover:bg-white/10 sm:size-8 sm:text-xl"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
