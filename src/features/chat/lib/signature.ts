// Assinatura das mensagens enviadas pelo operador no chat do CRM.
//
// Regra (definida com o cliente):
//   - checkbox desmarcado           → sem assinatura;
//   - checkbox marcado + apelido    → assina com o apelido;
//   - checkbox marcado, apelido vazio → assina com o PRIMEIRO NOME do usuário.

export type SignatureSource = {
  name: string;
  apelido_atendimento: string | null;
  assinar_mensagens: boolean;
};

// Nome que vai assinar, ou null quando não se deve assinar.
export function resolveSignature(user: SignatureSource): string | null {
  if (!user.assinar_mensagens) return null;

  const apelido = user.apelido_atendimento?.trim();
  if (apelido) return apelido;

  const firstName = user.name?.trim().split(/\s+/)[0];
  return firstName || null;
}

// Prefixa a mensagem com a assinatura em negrito (padrão WhatsApp), de forma
// que o contato veja quem está falando. Sem assinatura, devolve o texto intacto.
export function signMessage(content: string, signature: string | null): string {
  if (!signature) return content;
  return `*${signature}:*\n${content}`;
}
