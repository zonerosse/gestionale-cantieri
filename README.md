# Gestionale Cantieri (prova)

Prova del gestionale per piccole imprese dei cantieri. Dati di esempio inventati.

- `public/index.html` – l'app (titolare e operai), installabile sul telefono dalla schermata Home.
- `src/index.js` – Worker: serve i file di `public` e `/api/stato`; i dati stanno in un Durable Object (SQLite), niente database da creare.
- `wrangler.jsonc` – configurazione: Cloudflare la usa da sola con «npx wrangler deploy» a ogni push.

Al primo avvio la pagina offre «Prepara il gestionale di prova»: crea i link del titolare e degli operai (Squadra → Link personali).
Nella versione vera il server dovrà filtrare cosa vede e cosa può cambiare ogni operaio.
