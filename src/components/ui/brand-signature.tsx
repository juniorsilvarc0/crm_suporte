import { cn } from "@/lib/utils"

// Assinatura da marca. "chamado" e "dono" são os dois polos da frase — a
// demanda de um lado, quem responde por ela do outro — e é neles que o
// destaque pousa.
//
// ⚠️ A versal é feita por CSS (`uppercase`), NUNCA escrevendo "CHAMADO" no JSX.
// Leitor de tela soletra palavra gravada em caixa alta ("C-H-A-M-A-D-O"); com
// `text-transform` o texto continua "chamado"/"dono" na árvore de
// acessibilidade, e só o desenho muda. Esta é a razão de o componente existir:
// a regra precisa morar em um lugar só, não ser relembrada a cada uso.
//
// O destaque NÃO é salto de corpo nem de brilho. Versal já cresce sozinha
// (altura de maiúscula no lugar da altura de x), então aumentar `text-*`
// dobraria o efeito e viraria grito; e as duas cores ficam na mesma faixa de
// luminosidade de propósito — quem separa as palavras é a MATIZ (o lima da
// Ticbox contra o branco) e o PESO (400 contra 600). A entrelinha positiva
// é correção obrigatória, não enfeite: versal desenhada com o espacejamento de
// caixa baixa fecha demais.

type BrandSignatureTone = "on-brand" | "muted"

// `-me-*` cancela o espaço que o `tracking` deixa depois da ÚLTIMA letra —
// sem isso o vão depois de "DONO" fica maior que os outros e parece erro.
const TONES: Record<BrandSignatureTone, { base: string; key: string }> = {
  // Sobre o painel verde-petróleo do login: branco recuado + lima da Ticbox
  // (lima sobre #042D29 = 10,44:1; lima sobre branco reprovaria).
  "on-brand": {
    base: "font-normal text-white/90",
    key: "font-semibold tracking-[0.06em] -me-[0.06em] text-brand-lime",
  },
  // Sobre superfície de tema (`bg-card`), claro ou escuro. Corpo menor pede
  // entrelinha um pouco maior para a versal não empastar.
  muted: {
    base: "font-normal text-muted-foreground",
    key: "font-semibold tracking-[0.08em] -me-[0.08em] text-primary",
  },
}

type BrandSignatureProps = {
  tone?: BrandSignatureTone
  className?: string
}

export function BrandSignature({ tone = "muted", className }: BrandSignatureProps) {
  const { base, key } = TONES[tone]
  const keyClassName = cn("uppercase", key)

  return (
    <p className={cn("font-display text-pretty", base, className)}>
      {/* Uma linha só de propósito: quebrar antes do <span> obrigaria um {" "}
          e o React emitiria um nó de comentário no meio da frase. */}
      Todo <span className={keyClassName}>chamado</span> com <span className={keyClassName}>dono</span> e prazo.
    </p>
  )
}

export default BrandSignature
