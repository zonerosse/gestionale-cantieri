// Gestionale Cantieri (prova): tutto lo stato in una riga D1 (binding DB).
// Accesso con link personale ?k=<token>: i token stanno in data.accessi = {token:{r:'tit'}|{r:'op',n:'Nome'}}.
// GET   ?k=&since=ver  → {ver,data,io} (agli operai senza "accessi"); {same:true} se non è cambiato niente
// PUT   ?k=  {ver,data} → {ver}; 409 con l'ultima versione se nel frattempo qualcuno ha salvato
// POST  {data,nomi}     → solo a gestionale vuoto: crea i link (titolare + uno per persona) → {tit}
// NB: è una PROVA con dati inventati. Nella versione vera il server deve filtrare cosa vede e cosa può cambiare ogni operaio.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const tok = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, "0")).join("");
export async function onRequest({ request, env }) {
  if (!env.DB) return J({ error: "Manca il database: in Cloudflare collega D1 con il nome DB." }, 500);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS stato (id TEXT PRIMARY KEY, json TEXT NOT NULL, ver INTEGER NOT NULL)").run();
  const url = new URL(request.url), k = url.searchParams.get("k") || "";
  const row = await env.DB.prepare("SELECT json, ver FROM stato WHERE id='main'").first();
  if (request.method === "POST") {
    if (row) return J({ error: "Il gestionale è già pronto: usa il tuo link." }, 409);
    let b; try { b = await request.json(); } catch (e) { return J({ error: "Dati non validi" }, 400); }
    const data = b.data || {}, acc = {}, tit = tok();
    acc[tit] = { r: "tit" };
    (b.nomi || []).slice(0, 50).forEach(n => { acc[tok()] = { r: "op", n: String(n).slice(0, 80) }; });
    data.accessi = acc;
    await env.DB.prepare("INSERT INTO stato (id, json, ver) VALUES ('main', ?, 1)").bind(JSON.stringify(data)).run();
    return J({ tit });
  }
  if (!row) return J({ vuoto: true });
  const data = JSON.parse(row.json), acc = data.accessi || {}, io = acc[k];
  if (!io) return J({ error: "Link non valido" }, 403);
  const vista = d => { if (io.r === "tit") return d; const c = Object.assign({}, d); delete c.accessi; return c; };
  if (request.method === "GET") {
    if (+url.searchParams.get("since") === row.ver) return J({ same: true, ver: row.ver });
    return J({ ver: row.ver, data: vista(data), io });
  }
  if (request.method === "PUT") {
    const txt = await request.text();
    if (txt.length > 3000000) return J({ error: "Troppi dati" }, 413);
    let b; try { b = JSON.parse(txt); } catch (e) { return J({ error: "Dati non validi" }, 400); }
    if (b.ver !== row.ver) return J({ ver: row.ver, data: vista(data) }, 409);
    const nd = b.data || {};
    nd.accessi = acc; // i link li decide solo il server
    const r = await env.DB.prepare("UPDATE stato SET json=?, ver=ver+1 WHERE id='main' AND ver=?").bind(JSON.stringify(nd), row.ver).run();
    if (!r.meta || !r.meta.changes) { const n = await env.DB.prepare("SELECT json, ver FROM stato WHERE id='main'").first(); return J({ ver: n.ver, data: vista(JSON.parse(n.json)) }, 409); }
    return J({ ver: row.ver + 1 });
  }
  return J({ error: "Metodo non permesso" }, 405);
}
