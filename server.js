const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "ofertaradar", "public");

app.use(express.json());
app.use(express.static(PUBLIC));

const CACHE = new Map();
const CACHE_MS = 5 * 60 * 1000;

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, "").trim();
}

async function mlSearch(query, limit = 12) {
  const key = query.toLowerCase().trim();
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;

  const url = "https://api.mercadolibre.com/sites/MLB/search?q=" + encodeURIComponent(key) + "&limit=" + Math.min(Number(limit) || 12, 20);
  const response = await fetch(url, {headers: {"User-Agent":"OfertaRadar/1.0"}});
  if (!response.ok) throw new Error("Mercado Livre respondeu " + response.status);
  const data = await response.json();

  const products = (data.results || []).map(item => ({
    id:item.id,
    title:item.title,
    price:item.price,
    oldPrice:item.original_price || null,
    thumbnail:item.thumbnail,
    permalink:item.permalink,
    condition:item.condition,
    shipping:item.shipping?.free_shipping === true,
    seller:item.seller?.nickname || "",
    source:"Mercado Livre"
  }));

  CACHE.set(key, {time:Date.now(), data:products});
  return products;
}

app.get("/api/search", async (req,res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({error:"Digite pelo menos 2 caracteres."});
  try {
    const products = await mlSearch(q, req.query.limit);
    res.json({query:q, products, updatedAt:new Date().toISOString()});
  } catch (error) {
    res.status(502).json({error:"Não foi possível consultar as ofertas agora.", detail:error.message});
  }
});

app.get("/api/radar", async (_req,res) => {
  const terms = ["celular","ssd 1tb","notebook","smart tv","air fryer","fone bluetooth","placa de video","monitor gamer"];
  const results = [];
  for (const term of terms) {
    try {
      const products = await mlSearch(term, 4);
      results.push({term, products});
    } catch {}
  }
  res.json({results, updatedAt:new Date().toISOString()});
});

app.get("/health", (_req,res) => res.json({ok:true, service:"ofertaradar", time:new Date().toISOString()}));

app.get("*splat", (_req,res) => res.sendFile(path.join(PUBLIC, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log("OfertaRadar online na porta " + PORT));