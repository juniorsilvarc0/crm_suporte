// Limpa o nome do contato vindo do WhatsApp (pushname/senderName): remove emojis,
// bandeiras e caracteres invisíveis, preservando letras acentuadas, números e
// pontuação comum. Colapsa espaços e retorna null se sobrar vazio.
//
// Ex.: "João :)" -> "João" · flags/emoji removidos · nome só de emoji -> null
export function cleanContactName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    // a uazapi prefixa o nome com "~" p/ sinalizar auto-update do pushname
    .replace(/^~/, "")
    // emojis pictográficos + bandeiras (regional indicators)
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, "")
    // seletores de variação (VS15/VS16), zero-width joiner e combining keycap
    .replace(/[︎️‍⃣]/g, "")
    // colapsa espaços resultantes
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
