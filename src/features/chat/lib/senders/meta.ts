const GRAPH = "https://graph.facebook.com/v19.0";

export async function sendMetaText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Meta API error ${res.status}: ${body}`);
  }
}

/**
 * Meta Cloud API audio send is a two-step flow:
 * 1. Upload the media bytes → get a media id
 * 2. Send a message referencing that id
 */
export async function sendMetaAudio(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  audio: Blob
): Promise<void> {
  // 1. Upload media
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", audio, "voice.ogg");
  form.append("type", audio.type || "audio/ogg");

  const uploadRes = await fetch(`${GRAPH}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => uploadRes.statusText);
    throw new Error(`Meta media upload error ${uploadRes.status}: ${body}`);
  }
  const { id } = (await uploadRes.json()) as { id: string };

  // 2. Send referencing the uploaded media id
  const sendRes = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "audio",
      audio: { id },
    }),
  });
  if (!sendRes.ok) {
    const body = await sendRes.text().catch(() => sendRes.statusText);
    throw new Error(`Meta audio send error ${sendRes.status}: ${body}`);
  }
}
