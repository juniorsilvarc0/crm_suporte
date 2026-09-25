type EvolutionSendTextPayload = {
  number: string;
  text: string;
};

export async function sendEvolutionText(
  apiUrl: string,
  apiKey: string,
  instance: string,
  payload: EvolutionSendTextPayload
): Promise<void> {
  const res = await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution API error ${res.status}: ${text}`);
  }
}

/**
 * Sends a WhatsApp voice note (PTT) via Evolution.
 * The `audio` field accepts a base64 string or a public URL.
 */
export async function sendEvolutionAudio(
  apiUrl: string,
  apiKey: string,
  instance: string,
  number: string,
  audioBase64OrUrl: string
): Promise<void> {
  const res = await fetch(`${apiUrl}/message/sendWhatsAppAudio/${instance}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({ number, audio: audioBase64OrUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution audio error ${res.status}: ${text}`);
  }
}
