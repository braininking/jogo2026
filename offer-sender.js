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

function normalizeImageUrl(value) {
  let url=String(value||"").trim();
  if(!url)return "";
  if(url.startsWith("//"))url="https:"+url;
  if(!/^https?:\\/\\//i.test(url))return "";
  return url;
}

function buildOfferCaption(p) {
  const discount=p.oldPrice&&p.oldPrice>p.price
    ? Math.round((1-p.price/p.oldPrice)*100)
    : 0;
  const lines=[
    "🔥 <b>"+esc(p.title)+"</b>",
    "💰 <b>"+money(p.price)+"</b>"+(discount?"  🔻 -"+discount+"%":""),
    "⭐ "+esc(p.analysis?.label||"OFERTA")+" ("+(p.analysis?.score||0)+"/100)"
  ];
  if(p.shipping)lines.push("🚚 Frete grátis informado");
  if(p.outboundUrl)lines.push("👉 <a href=\""+esc(p.outboundUrl)+"\">COMPRAR AGORA</a>");
  lines.push("⏱️ Preço e estoque podem mudar a qualquer momento.");
  return lines.join("\\n");
}

function buildOfferMessage(offers) {
  return offers.map(buildOfferCaption).join("\\n\\n");
}

async function sendTelegram(offers) {
  const token=process.env.TELEGRAM_BOT_TOKEN;
  const chatIds=String(process.env.TELEGRAM_CHAT_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!token||!chatIds.length)return {configured:false,sent:0};
  let sent=0;
  const errors=[];
  for(const chat_id of chatIds){
    for(const p of offers){
      const caption=buildOfferCaption(p);
      const imageUrl=normalizeImageUrl(p.thumbnail||p.imageUrl||p.image_url);
      try{
        if(imageUrl){
          try{
            await postJson("https://api.telegram.org/bot"+token+"/sendPhoto",{
              chat_id,
              photo:imageUrl,
              caption,
              parse_mode:"HTML"
            });
            console.log("Telegram foto enviada:",chat_id,p.id);
          }catch(photoError){
            console.error("Telegram foto falhou para",p.id+":",photoError.message);
            await postJson("https://api.telegram.org/bot"+token+"/sendMessage",{
              chat_id,text:caption,parse_mode:"HTML",disable_web_page_preview:false
            });
            console.log("Telegram fallback texto:",chat_id,p.id);
          }
        }else{
          await postJson("https://api.telegram.org/bot"+token+"/sendMessage",{
            chat_id,text:caption,parse_mode:"HTML",disable_web_page_preview:false
          });
          console.log("Telegram texto sem imagem:",chat_id,p.id);
        }
        sent++;
      }catch(error){
        const message=error.message||"erro desconhecido";
        errors.push({chat_id,id:p.id,error:message});
        console.error("Telegram falhou para",chat_id,p.id+":",message);
      }
    }
  }
  return {configured:true,sent,errors};
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
  try { result.telegram = await sendTelegram(offers); }
  catch (e) { console.error("Telegram:", e.message); result.telegram.error = e.message; }
  try { result.whatsapp = await sendWhatsApp(message); }
  catch (e) { console.error("WhatsApp:", e.message); result.whatsapp.error = e.message; }
  return result;
}

module.exports = { sendOffers };
