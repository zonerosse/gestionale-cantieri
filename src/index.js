// Gestionale Cantieri (prova) – Cloudflare Worker con file statici (cartella public) e un Durable Object con i dati.
// Accesso con link personale ?k=<token>: i token stanno in data.accessi = {token:{r:'tit'}|{r:'op',n:'Nome'}}.
// GET  /api/stato?k=&since=ver → {ver,data,io} (agli operai senza "accessi"); {same:true} se non è cambiato niente
// PUT  /api/stato?k=  {ver,data} → {ver}; 409 con l'ultima versione se nel frattempo qualcuno ha salvato
// POST /api/stato {data,nomi}   → solo a gestionale vuoto: crea i link (titolare + uno per persona) → {tit}
// NB: è una PROVA con dati inventati. Nella versione vera il server deve filtrare cosa vede e cosa può cambiare ogni operaio.
import { DurableObject } from "cloudflare:workers";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const tok = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, "0")).join("");

export class Stato extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url), k = url.searchParams.get("k") || "", st = this.ctx.storage;
    const row = await st.get("main"); // {json, ver}
    if (request.method === "POST") {
      if (row) return J({ error: "Il gestionale è già pronto: usa il tuo link." }, 409);
      let b; try { b = await request.json(); } catch (e) { return J({ error: "Dati non validi" }, 400); }
      const data = b.data || {}, acc = {}, tit = tok();
      acc[tit] = { r: "tit" };
      (b.nomi || []).slice(0, 50).forEach(n => { acc[tok()] = { r: "op", n: String(n).slice(0, 80) }; });
      data.accessi = acc;
      await st.put("main", { json: JSON.stringify(data), ver: 1 });
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
      if (txt.length > 1800000) return J({ error: "Troppi dati" }, 413);
      let b; try { b = JSON.parse(txt); } catch (e) { return J({ error: "Dati non validi" }, 400); }
      if (b.ver !== row.ver) return J({ ver: row.ver, data: vista(data) }, 409);
      const nd = b.data || {};
      nd.accessi = acc; // i link li decide solo il server
      await st.put("main", { json: JSON.stringify(nd), ver: row.ver + 1 });
      return J({ ver: row.ver + 1 });
    }
    return J({ error: "Metodo non permesso" }, 405);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/stato") return env.STATO.get(env.STATO.idFromName("main")).fetch(request);
    return env.ASSETS.fetch(request);
  }
};
