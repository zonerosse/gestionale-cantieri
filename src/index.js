// Gestionale Cantieri (prova) – Cloudflare Worker con file statici (cartella public) e un Durable Object con i dati.
// Accessi come nel gestionale dei ristoranti («Dispositivi autorizzati»):
//  - un solo indirizzo per tutti; ogni telefono/computer sceglie «Titolare» o «Operaio» (e il suo nome);
//  - il Titolare entra con il suo codice di 4 cifre (prova: 1234); il primo ingresso prepara anche i dati di esempio;
//  - un Operaio resta «In attesa del titolare» con un codice di 4 cifre: il titolare lo approva da «Oggi»;
//  - ogni dispositivo approvato ha una chiave segreta (id:chiave nell'intestazione X-Disp) e rientra da solo.
// API: POST /api/disp/richiesta {ruolo,n,pin,data?} · GET /api/disp/stato?id&k · POST /api/disp/azione {op,id} (titolare)
//      GET/PUT /api/stato (con X-Disp) come prima: {ver,data,io,disp?} · 409 se qualcuno ha salvato nel frattempo
// NB: è una PROVA. Nella versione vera il server deve filtrare cosa vede e cosa può cambiare ogni operaio.
import { DurableObject } from "cloudflare:workers";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const LINGUE = { it: "italiano", en: "inglese", ro: "romeno", sq: "albanese", ar: "arabo", uk: "ucraino", fr: "francese" };
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
const cod4 = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));

export class Stato extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url), st = this.ctx.storage, p = url.pathname;
    const disp = (await st.get("disp")) || {};
    const pin = (await st.get("pin")) || "1234";
    const now = Date.now();
    const pub = () => Object.keys(disp).map(id => { const d = disp[id]; return { id, ruolo: d.ruolo, n: d.n, codice: d.codice, stato: d.stato, at: d.at, visto: d.visto, lang: d.lang || "it" }; });

    if (p === "/api/disp/richiesta" && request.method === "POST") {
      let b; try { b = await request.json(); } catch (e) { return J({ errore: "Dati non validi" }, 400); }
      const ruolo = b.ruolo === "tit" ? "tit" : "op", n = String(b.n || "").slice(0, 80);
      if (ruolo === "tit") {
        const ip = request.headers.get("cf-connecting-ip") || "x", kk = "pinerr:" + ip, err = (await st.get(kk)) || { n: 0, t: now };
        if (now - err.t > 900000) { err.n = 0; err.t = now; }
        if (err.n >= 5) return J({ errore: "Troppi codici sbagliati: riprova tra 15 minuti" }, 429);
        if (String(b.pin || "") !== pin) { err.n++; await st.put(kk, err); return J({ errore: "Codice sbagliato" }, 403); }
        await st.delete(kk);
        if (!(await st.get("main"))) await st.put("main", { json: JSON.stringify(b.data || {}), ver: 1 });
      } else {
        if (!(await st.get("main"))) return J({ errore: "Il titolare deve entrare per primo" }, 409);
        if (!n) return J({ errore: "Scegli il tuo nome" }, 400);
      }
      const id = rnd(8), k = rnd(18);
      disp[id] = { k, ruolo, n: ruolo === "tit" ? "Titolare" : n, codice: cod4(), stato: ruolo === "tit" ? "ok" : "attesa", at: now, visto: now };
      await st.put("disp", disp);
      return J({ id, k, stato: disp[id].stato, codice: disp[id].codice });
    }

    if (p === "/api/nomi") { const row = await st.get("main"); let nomi = []; try { nomi = (JSON.parse(row.json).PERS || []).map(x => x.n); } catch (e) {} return J({ nomi }); }
    // da qui serve un dispositivo riconosciuto
    let id = url.searchParams.get("id") || "", k = url.searchParams.get("k") || "";
    const h = request.headers.get("x-disp") || ""; if (h.includes(":")) [id, k] = h.split(":");
    const me = disp[id];
    if (!me || me.k !== k) return J({ errore: "dispositivo" }, 401);
    if (now - (me.visto || 0) > 60000) { me.visto = now; await st.put("disp", disp); }

    const lg = (request.headers.get("x-lang") || "").slice(0, 5);
    if (lg && me.lang !== lg) { me.lang = lg; await st.put("disp", disp); }
    if (p === "/api/disp/stato") return J({ stato: me.stato, codice: me.codice, ruolo: me.ruolo, n: me.n });
    if (me.stato !== "ok") return J({ errore: "non approvato", stato: me.stato }, 403);

    // traduzione dei testi scritti a mano (messaggi del titolare, rapportini e segnalazioni degli operai), con Claude
    if (p === "/api/traduci" && request.method === "POST") {
      let b; try { b = await request.json(); } catch (e) { return J({ errore: "Dati non validi" }, 400); }
      const a = String(b.a || ""), testi = (b.testi || []).slice(0, 20).map(t => String(t).slice(0, 2000));
      if (!LINGUE[a]) return J({ errore: "Lingua non prevista" }, 400);
      const out = [], manca = [];
      for (const t of testi) { const h = "tr:" + a + ":" + await sha(t); const c = await st.get(h); out.push(c || null); if (!c) manca.push([out.length - 1, t, h]); }
      if (manca.length) {
        if (!this.env.ANTHROPIC_API_KEY) return J({ errore: "chiave", out });
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
          headers: { "x-api-key": this.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 3000,
            system: "Traduci messaggi di lavoro tra il titolare di una piccola impresa edile e i suoi operai. Traduci in " + LINGUE[a] + ", in modo semplice e diretto, come parlerebbe un collega in cantiere. Non tradurre nomi di persone, nomi dei cantieri, indirizzi, orari e numeri. Rispondi SOLO con un array JSON di stringhe, nello stesso ordine, senza altro testo.",
            messages: [{ role: "user", content: JSON.stringify(manca.map(x => x[1])) }] }) });
        if (!r.ok) return J({ errore: "Traduzione non riuscita (" + r.status + ")", out });
        const j = await r.json(); let arr = [];
        try { const txt = (j.content || []).map(c => c.text || "").join(""); arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)); } catch (e) {}
        for (let i = 0; i < manca.length; i++) if (typeof arr[i] === "string") { out[manca[i][0]] = arr[i]; await st.put(manca[i][2], arr[i]); }
      }
      return J({ out });
    }

    if (p === "/api/disp/azione" && request.method === "POST") {
      if (me.ruolo !== "tit") return J({ errore: "Solo il titolare" }, 403);
      let b; try { b = await request.json(); } catch (e) { return J({ errore: "Dati non validi" }, 400); }
      if (b.op === "pin") { if (!/^\d{4}$/.test(b.pin || "")) return J({ errore: "Servono 4 cifre" }, 400); await st.put("pin", b.pin); return J({ ok: true }); }
      const d = disp[b.id]; if (!d) return J({ errore: "Dispositivo non trovato" }, 404);
      if (b.id === id && b.op === "togli") return J({ errore: "Non puoi togliere te stesso" }, 400);
      d.stato = b.op === "approva" ? "ok" : b.op === "rifiuta" ? "rifiutato" : b.op === "togli" ? "tolto" : d.stato;
      await st.put("disp", disp);
      return J({ ok: true, disp: pub() });
    }

    if (p === "/api/stato") {
      const row = await st.get("main");
      if (!row) return J({ vuoto: true });
      const io = { r: me.ruolo, n: me.n, id };
      const extra = me.ruolo === "tit" ? { disp: pub() } : {};
      if (request.method === "GET") {
        if (+url.searchParams.get("since") === row.ver && !url.searchParams.get("all")) return J(Object.assign({ same: true, ver: row.ver }, extra));
        return J(Object.assign({ ver: row.ver, data: JSON.parse(row.json), io }, extra));
      }
      if (request.method === "PUT") {
        const txt = await request.text();
        if (txt.length > 1800000) return J({ errore: "Troppi dati" }, 413);
        let b; try { b = JSON.parse(txt); } catch (e) { return J({ errore: "Dati non validi" }, 400); }
        if (b.ver !== row.ver) return J({ ver: row.ver, data: JSON.parse(row.json) }, 409);
        const nd = b.data || {}; delete nd.accessi;
        await st.put("main", { json: JSON.stringify(nd), ver: row.ver + 1 });
        return J({ ver: row.ver + 1 });
      }
    }
    return J({ errore: "Non trovato" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return env.STATO.get(env.STATO.idFromName("main")).fetch(request);
    return env.ASSETS.fetch(request);
  }
};
