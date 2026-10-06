const https = require("https");

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers
      },
      timeout: 15000
    }, res => {
      let text = "";
      res.on("data", chunk => text += chunk);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text || "{}")); } catch { resolve({}); }
        } else {
          reject(new Error("HTTP " + res.statusCode + ": " + text.slice(0, 300)));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildOfferMessage(offers) {
  const lines = ["🔥 <b>OFERTAS ENCONTRADAS PELO OFERTARADAR</b>", ""];
  for (const p of offers) {
    const discount = p.oldPrice && p.oldPrice > p.price
      ? Math.round((1 - p.price / p.oldPrice) * 100)
      : 0;
    lines.push("🛒 <b>" + esc(p.title) + "</b>");
    lines.push("💰 " + money(p.price) + (discount ? "  🔻 -" + discount + "%" : ""));
    lines.push("⭐ " + esc(p.analysis?.label || "OFERTA") + " (" + (p.analysis?.score || 0) + "/100)");
    if (p.shipping) lines.push("🚚 Frete grátis informado");
    if (p.outboundUrl) lines.push("👉 " + esc(p.outboundUrl));
    lines.push("");
  }
  lines.push("⏱️ Radar atualizado automaticamente.");
  return lines.join("\n");
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = String(process.env.TELEGRAM_CHAT_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!token || !chatIds.length) return { configured: false, sent: 0 };
  let sent = 0;
  for (const chat_id of chatIds) {
    await postJson("https://api.telegram.org/bot" + token + "/sendMessage", {
      chat_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    });
    sent++;
  }
  return { configured: true, sent };
}

async function sendWhatsApp(text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const recipients = String(process.env.WHATSAPP_RECIPIENTS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!token || !phoneNumberId || !recipients.length) return { configured: false, sent: 0 };
  let sent = 0;
  const plainText = text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const to of recipients) {
    await postJson("https://graph.facebook.com/v23.0/" + encodeURIComponent(phoneNumberId) + "/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: true, body: plainText }
    }, { Authorization: "Bearer " + token });
    sent++;
  }
  return { configured: true, sent };
}

async function sendOffers(offers) {
  if (!offers.length) return { telegram: { configured: false, sent: 0 }, whatsapp: { configured: false, sent: 0 } };
  const message = buildOfferMessage(offers);
  const result = {
    telegram: { configured: false, sent: 0 },
    whatsapp: { configured: false, sent: 0 }
  };
  try { result.telegram = await sendTelegram(message); }
  catch (e) { console.error("Telegram:", e.message); result.telegram.error = e.message; }
  try { result.whatsapp = await sendWhatsApp(message); }
  catch (e) { console.error("WhatsApp:", e.message); result.whatsapp.error = e.message; }
  return result;
}

module.exports = { sendOffers };
