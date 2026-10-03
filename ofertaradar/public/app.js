const $=s=>document.querySelector(s);
const products=$("#products"),status=$("#status"),title=$("#resultsTitle");

function money(v){return Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function card(p){
  const discount=p.oldPrice&&p.oldPrice>p.price?Math.round((1-p.price/p.oldPrice)*100):null;
  return `<article class="card">
    <div class="pic"><img loading="lazy" src="${p.thumbnail}" alt=""></div>
    <div class="info">
      <div class="title">${escapeHtml(p.title)}</div>
      ${discount?'<span class="tag">-'+discount+'%</span>':''}
      <div class="price">${money(p.price)}</div>
      ${p.oldPrice?'<div class="old">'+money(p.oldPrice)+'</div>':''}
      <a class="cta" href="${p.permalink}" target="_blank" rel="noopener sponsored">Ver oferta</a>
    </div>
  </article>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function search(q){
  if(!q||q.trim().length<2)return;
  title.textContent='Ofertas para "'+q+'"'; status.textContent='consultando...';
  products.className='grid'; products.innerHTML='<div class="loading">Buscando preços...</div>';
  try{
    const r=await fetch('/api/search?q='+encodeURIComponent(q));
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erro');
    products.innerHTML=d.products.length?d.products.map(card).join(''):'<div class="emptyBox">Nenhum produto encontrado.</div>';
    status.textContent=d.products.length+' resultados';
  }catch(e){products.innerHTML='<div class="emptyBox">Não foi possível carregar agora.</div>';status.textContent='';}
}
$("#searchForm").addEventListener("submit",e=>{e.preventDefault();search($("#query").value);document.querySelector("#resultados").scrollIntoView({behavior:"smooth"});});
document.querySelectorAll("[data-q]").forEach(b=>b.addEventListener("click",()=>{const q=b.dataset.q;$("#query").value=q;search(q);document.querySelector("#resultados").scrollIntoView({behavior:"smooth"});}));

async function loadRadar(){
  try{
    const r=await fetch('/api/radar'); const d=await r.json();
    $("#radarGrid").innerHTML=d.results.map(x=>`<div class="radarItem"><span class="eyebrow">TENDÊNCIA</span><h3>${escapeHtml(x.term)}</h3><p>${x.products.length} produtos encontrados agora.</p><button data-q="${escapeHtml(x.term)}">Pesquisar →</button></div>`).join('');
    document.querySelectorAll("#radarGrid [data-q]").forEach(b=>b.addEventListener("click",()=>{search(b.dataset.q);document.querySelector("#resultados").scrollIntoView({behavior:"smooth"});}));
  }catch{ $("#radarGrid").innerHTML='<div class="emptyBox">Radar temporariamente indisponível.</div>'; }
}
loadRadar();