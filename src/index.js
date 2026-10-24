// Gestionale Cantieri (prova) – Cloudflare Worker con file statici (cartella public) e un Durable Object con i dati.
// Accessi come nel gestionale dei ristoranti («Dispositivi autorizzati»):
//  - un solo indirizzo per tutti; ogni telefono/computer sceglie «Titolare» o «Operaio» (e il suo nome);
//  - il Titolare entra con il suo codice di 4 cifre (prova: 1234); il primo ingresso prepara anche i dati di esempio;
//  - un Operaio resta «In attesa del titolare» con un codice di 4 cifre: il titolare lo approva da «Oggi»;
//  - ogni dispositivo approvato ha una chiave segreta (id:chiave nell'intestazione X-Disp) e rientra da solo.
// API: POST /api/disp/richiesta {ruolo,n,pin,data?} · GET /api/disp/stato?id&k · POST /api/disp/azione {op,id} (titolare)
//      GET/PUT /api/stato (con X-Disp) come prima: {ver,data,io,disp?} · 409 se qualcuno ha salvato nel frattempo
// Ogni operaio riceve solo i suoi dati (vista) e quando salva il server prende solo ciò che può cambiare lui (unisci).
import { DurableObject } from "cloudflare:workers";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const LINGUE = { it: "italiano", en: "inglese", ro: "romeno", sq: "albanese", ar: "arabo", uk: "ucraino", fr: "francese" };
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
const cod4 = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));


// ---- Ogni operaio vede e cambia solo quello che gli compete ----
const esc = v => String(v == null ? "" : v).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])).slice(0, 2000);
const ORA = v => /^\d{1,2}:\d{2}$/.test(v || "") ? v : "";
const first = n => String(n || "").split(" ")[0];
// dati per persona (firme, ore, furgone, assunzione): si creano da soli se mancano
function migra(d) {
  d.S = d.S || {}; d.S2 = d.S2 || {}; const P = d.PERS || [], S = d.S, S2 = d.S2;
  const base = S.firmeOp || [];
  S.firmeP = S.firmeP || {};
  for (const p of P) if (!S.firmeP[p.n]) {
    const cal = JSON.stringify(p.cal || []);
    S.firmeP[p.n] = base.filter(f => { const m = /·\s*(.+)$/.exec(f.t || ""); return !m || cal.includes(m[1]); }).map(f => Object.assign({}, f));
  }
  if (!S.oreP) {
    S.oreP = {};
    const gg = ["Lun 19", "Mar 20", "Mer 21", "Gio 22", "Ven 23"];
    P.forEach((p, i) => { S.oreP[p.n] = gg.map((g, j) => [g, i === 0 && j === 2 ? 9 : (i === 2 && j === 4 ? 6 : 8), i === 0 && j === 2 ? 1 : 0]); });
  }
  for (const p of P) if (!S.oreP[p.n]) S.oreP[p.n] = [];
  if (!S2.furg) { S2.furg = {}; P.forEach((p, i) => { if (i < 2 && (S2.mat || [])[0]) S2.furg[p.n] = S2.mat[0].p; }); }
  if (!S2.assunto) { S2.assunto = {}; const a = ["01/03/2021", "15/06/2019", "10/01/2024"]; P.forEach((p, i) => { S2.assunto[p.n] = a[i] || ""; }); }
  return d;
}
const MIEI_CANT = (d, n) => { const p = (d.PERS || []).find(x => x.n === n); const t = JSON.stringify(p ? p.cal || [] : []); return (d.CANT || []).filter(c => t.includes(c.n)); };
// cosa riceve l'operaio n
function vista(d, n) {
  const p = (d.PERS || []).find(x => x.n === n), S = d.S || {}, S2 = d.S2 || {}, mio = x => x && x.n === n;
  const msg = (d.MSGS || []).filter(m => (m.dest || []).includes(n)).map(m => ({ id: m.id, a: m.dest.length > 1 ? m.a : n, t: m.t, ora: m.ora, dest: [n], letti: m.letti && m.letti[n] ? { [n]: m.letti[n] } : {} }));
  const furg = (S2.furg || {})[n];
  return {
    CANT: MIEI_CANT(d, n).map(c => ({ n: c.n, lav: c.lav, cl: c.cl, ind: c.ind, cap: c.cap, citta: c.citta, pr: c.pr, ora: c.ora, dal: c.dal, al: c.al, col: c.col, note: c.note })),
    PERS: p ? [p] : [], TODO: [], AVV: {},
    REQ: mio(d.REQ) ? d.REQ : null, REQQ: (d.REQQ || []).filter(mio),
    RISP: d.RISP && d.RISP[n] ? { [n]: d.RISP[n] } : {}, MSGS: msg,
    NOTIF: d.NOTIF && d.NOTIF[n] ? { [n]: d.NOTIF[n] } : {},
    S: { timbra: S.timbra, messaggi: [], presenze: (S.presenze || []).filter(mio), firmeOp: [], firmeSub: [], firmeP: { [n]: (S.firmeP || {})[n] || [] }, oreP: { [n]: (S.oreP || {})[n] || [] }, timbOp: { e: "", u: "" }, segnalazioni: [], rapportini: [], docSub: [] },
    S2: { giorni: S2.giorni, colori: S2.colori, posti: [], cal: {}, ferie: (S2.ferie || []).filter(f => f.chi === n), costi: [], pag: [], ordine: [], inc: [], foto: [], firmeCom: [], avanz: { perc: 0, fasi: [] },
      mat: (S2.mat || []).filter(m => m.p === furg), furg: furg ? { [n]: furg } : {}, assunto: { [n]: (S2.assunto || {})[n] || "" } }
  };
}
// quello che manda l'operaio n: si prende solo ciò che può cambiare lui, ripulito
function unisci(full, m, n) {
  const d = JSON.parse(JSON.stringify(full)), mio = x => x && x.n === n, key = r => r.ora + "|" + r.t;
  // timbratura
  const p = (d.PERS || []).find(mio), pm = (m.PERS || []).find(mio);
  if (p && pm) { p.e = ORA(pm.e) || p.e || ""; p.u = p.e ? (ORA(pm.u) || p.u || "") : ""; }
  // «dove vado?»: le sue richieste
  const sue = [m.REQ].concat(m.REQQ || []).filter(mio).map(r => ({ n, ora: ORA(r.ora), da: esc(r.da), t: esc(r.t) }));
  const ks = new Set(sue.map(key)), gia = new Set();
  if (mio(d.REQ)) { if (ks.has(key(d.REQ))) gia.add(key(d.REQ)); else d.REQ = null; }
  d.REQQ = (d.REQQ || []).filter(r => !mio(r) || (ks.has(key(r)) && gia.add(key(r))));
  for (const r of sue) if (!gia.has(key(r))) { if (!d.REQ) d.REQ = r; else d.REQQ.push(r); }
  // risposta del titolare: l'operaio può solo toglierla (Ok)
  if (d.RISP && d.RISP[n] && !(m.RISP && m.RISP[n])) delete d.RISP[n];
  // avvisi del titolare: può solo toglierli («Ok, ho visto»)
  if (d.NOTIF && d.NOTIF[n]) { const resta = new Set(((m.NOTIF || {})[n] || []).map(x => JSON.stringify(x))); d.NOTIF[n] = d.NOTIF[n].filter(x => resta.has(JSON.stringify(x))); }
  // messaggi: solo «letto»
  const lm = {}; (m.MSGS || []).forEach(x => { if (x && x.letti && x.letti[n]) lm[x.id] = x.letti[n]; });
  (d.MSGS || []).forEach(x => { if ((x.dest || []).includes(n) && lm[x.id] && !(x.letti || {})[n]) { x.letti = x.letti || {}; x.letti[n] = esc(lm[x.id]).slice(0, 20); } });
  // rapportini e segnalazioni (vanno nelle cose da fare del titolare); i tasti li rimette il server
  const ids = new Set((d.TODO || []).map(t => t.id)), nuovi = [];
  for (const t of (m.TODO || []).slice(0, 10)) {
    if (!t || !/^w\d{6,16}$/.test(t.id || "") || ids.has(t.id)) continue;
    const rap = /^Rapportino/.test(t.t || "");
    nuovi.push({ id: t.id, da: n, t: esc(t.t).slice(0, 200), s: esc(t.s).slice(0, 1500),
      b: rap ? [["Approva", "fatto('" + t.id + "','Approvato')"], ["Rimanda", "fatto('" + t.id + "','Rimandato a " + esc(first(n)).replace(/&#39;/g, "") + "')"]] : [["Risolto", "fatto('" + t.id + "','Segnato come risolto')"]] });
  }
  d.TODO = nuovi.concat(d.TODO || []);
  // firme: solo i suoi documenti, solo la firma
  const fp = ((d.S || {}).firmeP || {})[n], fm = ((((m.S || {}).firmeP) || {})[n]) || [];
  if (fp) fp.forEach(f => { const x = fm.find(y => y && y.id === f.id); if (!f.fatto && x && x.fatto) f.fatto = esc(x.fatto).slice(0, 20); });
  // ferie e permessi: le sue richieste (lo stato lo decide il titolare)
  const S2 = d.S2 = d.S2 || {}, vec = (S2.ferie || []).filter(f => f.chi === n);
  const fe = ((m.S2 || {}).ferie || []).filter(f => f && f.chi === n).slice(0, 30).map(f => { const o = vec.find(v => v.id === f.id);
    return o || { id: +f.id || Date.now(), chi: n, tipo: f.tipo === "Permesso" ? "Permesso" : "Ferie", dal: esc(f.dal).slice(0, 10), al: esc(f.al).slice(0, 10), gi: [], stato: "attesa", nota: esc(f.nota).slice(0, 300) }; });
  S2.ferie = (S2.ferie || []).filter(f => f.chi !== n).concat(fe);
  // furgone: può solo segnare quello che usa (le quantità scendono)
  const fu = (S2.furg || {})[n], mv = (S2.mat || []).find(x => x.p === fu), mm = ((m.S2 || {}).mat || []).find(x => x && x.p === fu);
  if (mv && mm) mv.v.forEach((r, i) => { const q = mm.v && mm.v[i] && +mm.v[i][1]; if (Number.isFinite(q) && q >= 0 && q < r[1]) r[1] = q; });
  return d;
}

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
      const io = { r: me.ruolo, n: me.n, id }, tit = me.ruolo === "tit";
      const extra = tit ? { disp: pub() } : {};
      if (request.method === "GET") {
        if (+url.searchParams.get("since") === row.ver && !url.searchParams.get("all")) return J(Object.assign({ same: true, ver: row.ver }, extra));
        const full = migra(JSON.parse(row.json)), mj = JSON.stringify(full);
        if (mj !== row.json) await st.put("main", { json: mj, ver: row.ver });
        return J(Object.assign({ ver: row.ver, data: tit ? full : vista(full, me.n), io }, extra));
      }
      if (request.method === "PUT") {
        const txt = await request.text();
        if (txt.length > 1800000) return J({ errore: "Troppi dati" }, 413);
        let b; try { b = JSON.parse(txt); } catch (e) { return J({ errore: "Dati non validi" }, 400); }
        if (b.ver !== row.ver) return J({ ver: row.ver, data: JSON.parse(row.json) }, 409);
        let nd = b.data || {}; delete nd.accessi;
        nd = tit ? migra(nd) : unisci(migra(JSON.parse(row.json)), nd, me.n);
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
