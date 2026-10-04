const $=s=>document.querySelector(s),products=$("#products"),status=$("#status"),title=$("#resultsTitle");
const API_BASE=window.location.origin;
function money(v){return Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function sourceClass(source){return String(source||"").toLowerCase().replace(/[^a-z0-9]+/g,"-")}
function card(p){
  const discount=p.oldPrice&&p.oldPrice>p.price?Math.round((1-p.price/p.oldPrice)*100):null;
  const a=p.analysis||{};
  const source=p.source||"Marketplace";
  const image=p.thumbnail||"";
  return `<article class="card">
    <div class="pic">
      ${image?'<img loading="lazy" src="'+esc(image)+'" alt="'+esc(p.title)+'" onerror="this.style.display=\'none\';this.parentElement.classList.add(\'noimg\')">':'<div class="noimg">Sem imagem</div>'}
    </div>
    <div class="info">
      <div class="cardTop"><span class="source source-${sourceClass(source)}">${esc(source)}</span>${discount?'<span class="tag">-'+discount+'%</span>':""}</div>
      <div class="title">${esc(p.title)}</div>
      ${a.label?'<span class="score">'+esc(a.label)+" · "+a.score+"/100</span>":""}
      <div class="price">${money(p.price)}</div>
      ${p.oldPrice?'<div class="old">'+money(p.oldPrice)+"</div>":""}
      ${p.shipping?'<div class="shipping">✓ Frete grátis informado</div>':""}
      ${p.seller?'<div class="seller">Vendido por '+esc(p.seller)+"</div>":""}
      <a class="cta" href="${esc(p.outboundUrl||p.permalink)}" target="_blank" rel="noopener sponsored">Ver oferta na ${esc(source)}</a>
    </div>
  </article>`
}
async function getJson(url){
  const r=await fetch(API_BASE+url,{cache:"no-store",headers:{Accept:"application/json"}});
  const text=await r.text();
  let d;try{d=JSON.parse(text)}catch{throw new Error("Resposta inválida do servidor (HTTP "+r.status+")")};
  if(!r.ok)throw new Error(d.error||"Servidor respondeu HTTP "+r.status);
  return d;
}
async function search(q){
  q=String(q||"").trim();if(q.length<2)return;
  title.textContent='Ofertas para "'+q+'"';status.textContent="consultando...";products.className="grid";products.innerHTML='<div class="loading">Buscando preços...</div>';
  try{
    const d=await getJson("/api/search?q="+encodeURIComponent(q));
    products.innerHTML=d.products.length?d.products.map(card).join(""):'<div class="emptyBox">Nenhum produto encontrado.</div>';
    status.textContent=d.products.length+" resultados";
  }catch(error){
    console.error("OfertaRadar search:",error);
    products.innerHTML='<div class="emptyBox">'+esc(error.message||"Não foi possível carregar agora.")+'</div>';
    status.textContent="erro na consulta";
  }
}
$("#searchForm").addEventListener("submit",e=>{e.preventDefault();search($("#query").value);$("#resultados").scrollIntoView({behavior:"smooth"})});
document.querySelectorAll("[data-q]").forEach(b=>b.addEventListener("click",()=>{$("#query").value=b.dataset.q;search(b.dataset.q);$("#resultados").scrollIntoView({behavior:"smooth"})}));
async function loadRadar(){
  try{
    const d=await getJson("/api/radar?refresh="+Date.now());
    $("#radarGrid").innerHTML=d.results.map(x=>`<div class="radarItem"><span class="eyebrow">ATENÇÃO</span><h3>${esc(x.term)}</h3><p>${x.productCount} resultados · ${x.discountedCount} com desconto informado</p><strong>${x.bestScore}/100</strong>${x.bestTitle?'<div class="muted">'+esc(x.bestTitle)+"</div>":""}${x.bestPrice?'<div class="price">'+money(x.bestPrice)+"</div>":""}<button data-q="${esc(x.term)}">Ver ofertas →</button>${x.bestUrl?'<a class="radarLink" href="'+esc(x.bestUrl)+'" target="_blank" rel="noopener sponsored">Abrir melhor achado ↗</a>':""}</div>`).join("");
    $("#radarGrid").querySelectorAll("button[data-q]").forEach(b=>b.addEventListener("click",()=>{ $("#query").value=b.dataset.q;search(b.dataset.q);$("#resultados").scrollIntoView({behavior:"smooth"})}));
  }catch(error){console.error("OfertaRadar radar:",error);$("#radarGrid").innerHTML='<div class="emptyBox">Radar temporariamente indisponível: '+esc(error.message||"")+"</div>"}
}
loadRadar();setInterval(loadRadar,10*60*1000);
document.querySelectorAll("[data-nav]").forEach(link=>{link.addEventListener("click",e=>{e.preventDefault();const target=document.getElementById(link.dataset.nav);if(target)target.scrollIntoView({behavior:"smooth",block:"start"});history.replaceState(null,"","#"+link.dataset.nav)})});