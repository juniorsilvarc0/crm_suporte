import { isActiveContract } from "@/features/customer-source/active-contract";
import type { CustomerContext } from "@/features/customer-source/types";

// Os selos do cliente na TCBX, para a tela. Neutro (sem React): o cabeçalho do
// chat e os testes importam daqui.
//
// SELO DA EMPRESA: a TCBX não tem campo de selo. A qualificação vem no NOME do
// sistema contratado (`contratos[].sistemas[].nome`), no fim e entre
// parênteses ("Sistema X (Ouro)") ou, às vezes, no meio do nome ("Sistema X
// Diamante [Gestão]", "Sistema Y Diamante + Hotel"). Varredura de 2026-10-28 (241
// empresas): Ouro, Diamante e MEI. Enquanto a TCBX não expõe um campo próprio, o
// selo é lido do nome — e sistema sem selo no nome não ganha selo.
//
// SELO DA PESSOA: o papel do contato no cliente (`contatos[].tipo`: dono,
// financeiro, operacional, gerente, outro), achado pelo telefone (`contactRole`).

export type CompanySealTone = "diamante" | "platina" | "ouro" | "prata" | "bronze" | "outro";

export type CompanySeal = {
  label: string;
  tone: CompanySealTone;
  /** Os sistemas que trazem o selo, como a TCBX os nomeia (para o title). */
  systems: string[];
};

// Os níveis conhecidos, do mais alto para o mais baixo: é a ordem na tela.
const TIERS: { word: string; label: string; tone: CompanySealTone }[] = [
  { word: "diamante", label: "Diamante", tone: "diamante" },
  { word: "platina", label: "Platina", tone: "platina" },
  { word: "ouro", label: "Ouro", tone: "ouro" },
  { word: "prata", label: "Prata", tone: "prata" },
  { word: "bronze", label: "Bronze", tone: "bronze" },
];

const SUFFIX = /\(([^()]{1,30})\)\s*$/;

/** O selo que o nome de um sistema traz, ou null. */
export function sealFromSystemName(name: string | null | undefined): { label: string; tone: CompanySealTone } | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  // Nível conhecido como PALAVRA (em qualquer lugar): "Diamante" casa, "Ouroboros" não.
  for (const tier of TIERS) {
    if (new RegExp(`(^|[^\\p{L}])${tier.word}([^\\p{L}]|$)`, "iu").test(text)) {
      return { label: tier.label, tone: tier.tone };
    }
  }
  // Outro rótulo entre parênteses no fim ("MEI"): aparece como veio.
  const suffix = SUFFIX.exec(text)?.[1]?.trim();
  return suffix ? { label: suffix, tone: "outro" } : null;
}

const TONE_ORDER: CompanySealTone[] = ["diamante", "platina", "ouro", "prata", "bronze", "outro"];

/**
 * Os selos da empresa, dos sistemas dos contratos VIGENTES (um contrato
 * encerrado não qualifica o cliente hoje). Um selo por rótulo, do nível mais
 * alto para o mais baixo.
 */
export function companySeals(context: CustomerContext): CompanySeal[] {
  const byLabel = new Map<string, CompanySeal>();
  for (const contract of context.contratos) {
    if (!isActiveContract(contract)) continue;
    // `?? []`: na troca rolante, a resposta pode vir da réplica ainda na versão
    // anterior, que não mandava `sistemas`.
    for (const system of contract.sistemas ?? []) {
      const seal = sealFromSystemName(system.nome);
      if (!seal || !system.nome) continue;
      const current = byLabel.get(seal.label) ?? { ...seal, systems: [] };
      if (!current.systems.includes(system.nome.trim())) current.systems.push(system.nome.trim());
      byLabel.set(seal.label, current);
    }
  }
  return [...byLabel.values()].sort(
    (a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone) || a.label.localeCompare(b.label, "pt-BR")
  );
}

const ROLE_LABELS: Record<string, string> = {
  dono: "Dono",
  financeiro: "Financeiro",
  operacional: "Operacional",
  gerente: "Gerente",
  outro: "Outro",
};

/** O papel da pessoa como a tela o mostra. Papel que a tela não conhece aparece como veio. */
export function contactRoleLabel(role: string): string {
  const key = role.trim().toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : role;
}
