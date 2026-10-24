# Gestionale Cantieri (prova)

Prova del gestionale per piccole imprese dei cantieri. Dati di esempio inventati.

- `public/index.html` – l'app (titolare e operai), installabile sul telefono dalla schermata Home.
- `functions/api/stato.js` – salva tutto in Cloudflare D1 (binding `DB`), accesso con link personale `?k=`.

Cloudflare Pages: nessun comando di build, cartella di output `public`, binding D1 con nome `DB`.
Al primo avvio la pagina offre «Prepara il gestionale di prova»: crea i link del titolare e degli operai.
