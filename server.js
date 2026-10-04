const express=require("express");
const path=require("path");
const app=express();
const PORT=process.env.PORT||3000;
const PUBLIC=path.join(__dirname,"ofertaradar","public");
app.use(express.json());\napp.use((req,_res,next)=>{if(req.path.startsWith("/api/"))console.log("API",req.method,req.originalUrl);next();});
app.use(express.static(PUBLIC));

const CACHE=new Map(),CACHE_MS=5*60*1000;
const HISTORY=[];
let db=null;

async function initHistoryDb(){
  if(!process.env.DATABASE_URL)return;
  try{
    const {Pool}=require("pg");
    db=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
    await db.query("CREATE TABLE IF NOT EXISTS price_history (id TEXT NOT NULL, title TEXT NOT NULL, price NUMERIC NOT NULL, old_price NUMERIC, source TEXT, permalink TEXT, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id,captured_at))");
    await db.query("CREATE INDEX IF NOT EXISTS idx_price_history_id_time ON price_history(id,captured_at DESC)");
    console.log("Histórico de preços: banco conectado");
  }catch(e){
    db=null;
    console.error("Histórico de preços indisponível:",e.message);
  }
}

async function saveHistory(products){
  const rows=products||[];
  if(db){
    for(const p of rows){
      try{
        await db.query(
          "INSERT INTO price_history(id,title,price,old_price,source,permalink) VALUES($1,$2,$3,$4,$5,$6)",
          [p.id,p.title,p.price,p.oldPrice,p.source,p.permalink]
        );
      }catch{}
    }
  }else{
    const now=new Date().toISOString();
    for(const p of rows)HISTORY.push({...p,capturedAt:now});
    if(HISTORY.length>3000)HISTORY.splice(0,HISTORY.length-3000);
  }
}

async function getHistory(id,limit=30){
  if(db){
    const r=await db.query(
      "SELECT id,title,price,old_price AS \"oldPrice\",source,permalink,captured_at AS \"capturedAt\" FROM price_history WHERE id=$1 ORDER BY captured_at DESC LIMIT $2",
      [id,Math.min(Number(limit)||30,100)]
    );
    return r.rows;
  }
  return HISTORY.filter(x=>x.id===id).slice(-Math.min(Number(limit)||30,100)).reverse();
}

const CATEGORIES={
  celulares:"celular",informatica:"notebook",games:"video game",tvs:"smart tv",casa:"air fryer",
  eletrodomesticos:"eletrodomésticos",beleza:"beleza",ferramentas:"ferramentas",audio:"fone bluetooth",
  wearables:"smartwatch","ssd-1tb":"ssd 1tb","placa-de-video":"placa de video","memoria-ram":"memoria ram",
  "headset-gamer":"headset gamer","tv-43-polegadas":"tv 43 polegadas","notebooks-ate-3000":"notebook até 3000",
  "celulares-ate-1000":"celular até 1000","melhores-celulares":"celular melhor avaliado",
  notebooks:"notebook","air-fryer":"air fryer"
};

function affiliateUrl(p){
  const tpl=process.env.AFFILIATE_REDIRECT_TEMPLATE;
  if(!tpl)return p.permalink;
  return tpl.replaceAll("{url}",encodeURIComponent(p.permalink)).replaceAll("{id}",encodeURIComponent(p.id));
}

function scoreProduct(p){
  let score=50;
  if(p.oldPrice&&p.oldPrice>p.price)score+=Math.min(35,Math.round((1-p.price/p.oldPrice)*100)*1.4);
  if(p.shipping)score+=5;
  if(p.condition==="new")score+=5;
  score=Math.max(0,Math.min(100,Math.round(score)));
  return{
    score,
    label:score>=80?"ÓTIMA COMPRA":score>=65?"PREÇO BOM":score>=50?"PREÇO NORMAL":"NÃO COMPRARIA AGORA"
  };
}

async function mlSearch(query,limit=12){
  const key=query.toLowerCase().trim();
  const cached=CACHE.get(key);
  if(cached&&Date.now()-cached.time<CACHE_MS)return cached.data;
  const url="https://api.mercadolibre.com/sites/MLB/search?q="+encodeURIComponent(key)+"&limit="+Math.min(Number(limit)||12,20);
  const response=await fetch(url,{headers:{"User-Agent":"OfertaRadar/1.1"}});
  if(!response.ok)throw new Error("Mercado Livre respondeu "+response.status);
  const data=await response.json();
  const products=(data.results||[]).map(item=>{
    const p={
      id:item.id,title:item.title,price:item.price,oldPrice:item.original_price||null,
      thumbnail:item.thumbnail,permalink:item.permalink,condition:item.condition,
      shipping:item.shipping?.free_shipping===true,seller:item.seller?.nickname||"",source:"Mercado Livre"
    };
    return{...p,analysis:scoreProduct(p),outboundUrl:affiliateUrl(p)};
  });
  CACHE.set(key,{time:Date.now(),data:products});
  return products;
}

app.get("/api/history/:id",async(req,res)=>{
  try{res.json({id:req.params.id,history:await getHistory(req.params.id)});}
  catch{res.status(500).json({error:"Histórico indisponível."});}
});

app.get("/api/search",async(req,res)=>{
  const q=String(req.query.q||"").trim();
  if(q.length<2)return res.status(400).json({error:"Digite pelo menos 2 caracteres."});
  try{
    const products=await mlSearch(q,req.query.limit);
    await saveHistory(products);
    res.json({query:q,products,updatedAt:new Date().toISOString()});
  }catch(error){
    res.status(502).json({error:"Não foi possível consultar as ofertas agora.",detail:error.message});
  }
});

app.get("/api/category/:slug",async(req,res)=>{
  const q=CATEGORIES[req.params.slug];
  if(!q)return res.status(404).json({error:"Categoria não encontrada."});
  try{
    const products=await mlSearch(q,16);
    await saveHistory(products);
    res.json({slug:req.params.slug,query:q,products,updatedAt:new Date().toISOString()});
  }catch{
    res.status(502).json({error:"Categoria temporariamente indisponível."});
  }
});

app.get("/api/radar",async(_req,res)=>{
  const terms=["celular","ssd 1tb","notebook","smart tv","air fryer","fone bluetooth","placa de video","monitor gamer"];
  const results=[];
  for(const term of terms)try{
    const products=await mlSearch(term,12);
    await saveHistory(products);
    const discounted=products.filter(p=>p.oldPrice&&p.oldPrice>p.price);
    const best=products.slice().sort((a,b)=>b.analysis.score-a.analysis.score)[0];
    results.push({
      term,productCount:products.length,discountedCount:discounted.length,
      bestScore:best?best.analysis.score:0,bestTitle:best?best.title:"",
      bestPrice:best?best.price:null,bestUrl:best?best.outboundUrl:null
    });
  }catch{}
  results.sort((a,b)=>b.bestScore-a.bestScore||b.discountedCount-a.discountedCount);
  res.json({
    results,updatedAt:new Date().toISOString(),
    note:"Radar de oportunidade baseado em preço, desconto informado e disponibilidade dos resultados atuais. Não representa volume real de vendas."
  });
});

const CATEGORY_NAMES={
  celulares:"Celulares",informatica:"Informática",games:"Games",tvs:"TVs",casa:"Casa",
  eletrodomesticos:"Eletrodomésticos",beleza:"Beleza",ferramentas:"Ferramentas",audio:"Áudio",
  wearables:"Wearables","ssd-1tb":"SSD 1TB","placa-de-video":"Placas de vídeo","memoria-ram":"Memória RAM",
  "headset-gamer":"Headset Gamer","tv-43-polegadas":"TV 43 polegadas",
  "notebooks-ate-3000":"Notebooks até R$ 3.000","celulares-ate-1000":"Celulares até R$ 1.000",
  "melhores-celulares":"Melhores Celulares",notebooks:"Notebooks","air-fryer":"Air Fryer"
};

function esc(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function money(v){
  return Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function seoCard(p){
  const d=p.oldPrice&&p.oldPrice>p.price?Math.round((1-p.price/p.oldPrice)*100):null;
  return '<article class="card"><div class="pic"><img loading="lazy" src="'+esc(p.thumbnail)+'" alt="'+esc(p.title)+'"></div><div class="info"><div class="title">'+esc(p.title)+'</div>'+
    (d?'<span class="tag">-'+d+'%</span>':'')+
    '<span class="score">'+esc(p.analysis.label)+' · '+p.analysis.score+'/100</span>'+
    '<div class="price">'+money(p.price)+'</div>'+
    (p.oldPrice?'<div class="old">'+money(p.oldPrice)+'</div>':'')+
    (p.shipping?'<div class="shipping">✓ Frete grátis informado</div>':'')+
    '<a class="cta" href="'+esc(p.outboundUrl||p.permalink)+'" target="_blank" rel="noopener sponsored">Ver oferta</a></div></article>';
}

function seoPage(slug,products){
  const name=CATEGORY_NAMES[slug]||slug;
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    esc(name)+' — Ofertas e preços | OfertaRadar</title><meta name="description" content="Compare '+esc(name.toLowerCase())+
    ', veja preços atuais e encontre ofertas no OfertaRadar."><link rel="canonical" href="https://ofertaradar.onrender.com/'+esc(slug)+
    '"><link rel="stylesheet" href="/style.css"></head><body><header class="top"><div class="wrap nav"><a class="brand" href="/">Oferta<span>Radar</span></a><nav><a href="/">Início</a><a href="/#radar">Radar</a><a href="/#categorias">Categorias</a></nav></div></header><main><section class="hero"><div class="wrap"><div class="eyebrow">OFERTAS · '+
    esc(name.toUpperCase())+'</div><h1>'+esc(name)+' com preços para comparar.</h1><p>Resultados atuais, descontos informados quando disponíveis e análise automática de custo-benefício.</p></div></section><section class="wrap section"><div class="sectionHead"><div><span class="eyebrow">OFERTAS ATUAIS</span><h2>'+
    esc(name)+'</h2></div><span class="status">'+products.length+' resultados</span></div><div class="grid">'+products.map(seoCard).join('')+
    '</div></section><section class="wrap section about"><h2>Como o OfertaRadar analisa</h2><p>Quando há preço anterior informado, calculamos o desconto. Também consideramos frete grátis e condição do produto para criar um indicador auxiliar. Isso não garante que seja a melhor compra.</p><p class="muted">Preços, estoque e condições podem mudar. Confira a oferta final antes de comprar.</p></section></main><footer><div class="wrap">© 2026 OfertaRadar</div></footer></body></html>';
}

for(const slug of Object.keys(CATEGORIES)){
  app.get("/"+slug,async(_req,res)=>{
    try{res.send(seoPage(slug,await mlSearch(CATEGORIES[slug],16)));}
    catch{res.status(503).send("Categoria temporariamente indisponível.");}
  });
}

app.get("/ofertas",async(_req,res)=>{
  try{
    const terms=["celular","ssd 1tb","notebook","smart tv","air fryer","fone bluetooth","placa de video","monitor gamer"];
    const all=[];
    for(const term of terms){
      try{const products=await mlSearch(term,8);all.push(...products);}catch{}
    }
    const unique=[...new Map(all.map(p=>[p.id,p])).values()];
    unique.sort((a,b)=>b.analysis.score-a.analysis.score||(b.oldPrice?1:0)-(a.oldPrice?1:0));
    res.send('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ofertas do Momento — OfertaRadar</title><meta name="description" content="Ofertas atuais encontradas pelo OfertaRadar, organizadas por preço, desconto informado e custo-benefício."><link rel="canonical" href="https://ofertaradar.onrender.com/ofertas"><link rel="stylesheet" href="/style.css"><script type="application/ld+json">'+JSON.stringify({"@context":"https://schema.org","@type":"WebPage","name":"Ofertas do Momento","url":"https://ofertaradar.onrender.com/ofertas"})+'</script></head><body><header class="top"><div class="wrap nav"><a class="brand" href="/">Oferta<span>Radar</span></a><nav><a href="/">Início</a><a href="/ofertas">Ofertas</a><a href="/#radar">Radar</a><a href="/#categorias">Categorias</a></nav></div></header><main><section class="hero"><div class="wrap"><div class="eyebrow">⚡ OFERTAS ATUAIS</div><h1>Ofertas do momento</h1><p>Produtos encontrados nas buscas atuais e ordenados pelo indicador de oportunidade do OfertaRadar.</p></div></section><section class="wrap section"><div class="sectionHead"><div><span class="eyebrow">RADAR DE PREÇOS</span><h2>Achados para conferir</h2><p class="muted">A seleção usa preço, desconto informado, frete e condição. Não representa volume real de vendas.</p></div><span class="status">'+unique.length+' ofertas analisadas</span></div><div class="grid">'+unique.map(seoCard).join('')+'</div></section></main><footer><div class="wrap">© 2026 OfertaRadar · Preços sujeitos a alteração</div></footer></body></html>');
  }catch{res.status(503).send("Ofertas temporariamente indisponíveis.");}
});

app.get("/api/test",(_req,res)=>res.json({ok:true,service:"ofertaradar",time:new Date().toISOString()}));\n\napp.get("/health",(_req,res)=>res.json({
  ok:true,service:"ofertaradar",version:"1.6",
  affiliateReady:Boolean(process.env.AFFILIATE_REDIRECT_TEMPLATE),
  time:new Date().toISOString()
}));

app.get("*splat",(_req,res)=>res.sendFile(path.join(PUBLIC,"index.html")));

initHistoryDb().finally(()=>app.listen(PORT,"0.0.0.0",()=>console.log("OfertaRadar online na porta "+PORT)));
