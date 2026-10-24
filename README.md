# Gestionale Cantieri (prova)

Prova del gestionale per piccole imprese dei cantieri. Dati di esempio inventati.

- `public/index.html` – l'app (titolare e operai), installabile sul telefono dalla schermata Home.
- `src/index.js` – Worker: serve i file di `public` e `/api/stato`; i dati stanno in un Durable Object (SQLite), niente database da creare.
- `wrangler.jsonc` – configurazione: Cloudflare la usa da sola con «npx wrangler deploy» a ogni push.

Al primo avvio la pagina offre «Prepara il gestionale di prova»: crea i link del titolare e degli operai (Squadra → Link personali).
Nella versione vera il server dovrà filtrare cosa vede e cosa può cambiare ogni operaio.

## Accessi (come il gestionale dei ristoranti)
Un solo indirizzo. Si sceglie la lingua, poi «Operaio» (con il proprio nome) o «Titolare» (codice di 4 cifre, nella prova 1234).
Il telefono nuovo di un operaio resta «In attesa del titolare» con un codice: il titolare lo approva in cima a «Oggi».
Telefoni collegati, «Togli» e «Cambia il codice del titolare» in Squadra.

## Lingue degli operai
Italiano dentro l'app; English, Română, Shqip, العربية (da destra a sinistra), Українська, Français in `public/lang/xx.json`,
scaricate solo quando l'operaio le sceglie dal menu (poi restano sul telefono). Gli avvisi del titolare (spostamenti, ferie)
sono salvati come dati e scritti nella lingua dell'operaio; i messaggi scritti a mano dal titolare restano in italiano.
Per aggiungere una lingua: un file nuovo in `public/lang/` con le stesse chiavi e una riga in `LANGS`.
