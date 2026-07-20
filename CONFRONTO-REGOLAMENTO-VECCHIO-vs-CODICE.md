# Confronto: `officina-1907-giocatore.docx` (vecchio) vs simulatore attuale (19/07/2026)

Il vecchio regolamento (`regolamento/officina-1907-giocatore.docx`) descrive uno stato del design precedente a tutte le sessioni di simulazione (Impiegati, Fabbriche, Piano Industriale a famiglie). Confronto punto per punto.

## 🔴 Divergenze strutturali (il gioco è cambiato, non solo i numeri)

| Aspetto | Vecchio regolamento | Simulatore oggi |
|---|---|---|
| **Nomi dei nodi** | "Borsa" = hub commerciale (cambia risorse/commesse) · "Servizi" = nodo Welfare | **Stessa mappa fisica**, ma "Borsa" oggi è il nodo Servizi (Impiegati+Fabbriche) e l'hub commerciale si chiama **"Città"**. Puro rename, nessun cambio di funzione — ma il nome "Borsa" è saltato da un nodo all'altro, fonte di confusione se si confrontano i testi alla lettera. |
| **Restare alla Borsa più turni** | Esplicitamente permesso ("Unica eccezione: alla Borsa puoi restare per più turni consecutivi") | **Vietato**: ogni turno si deve lasciare il nodo, Borsa/Città inclusa. Inversione deliberata (sessione 09/07/2026: nerfava i profili "contract-rush" che ci campavano). |
| **Banchi carte Operaio** | 5 mazzi **per nazionalità** (75 carte, 15/nazione), ogni nodo Mercato accede a **2 banchi adiacenti** | 5 mazzetti **A-E bilanciati per costo/tipo effetto** (72 carte), nazione = solo flavor; ogni nodo accede a **1 solo mazzetto** (Servizi/Borsa ne ha 2: il suo + Impiegati). Cambio di fondamenta del sistema di assunzione. |
| **Carte Welfare (Direzione)** | 12 carte, Direzione 2 Sopra + 2 Sotto | **Rimosse.** Direzione: 3 Sopra (**0 Sotto**), riempita solo da **Impiegati** (12 carte, mercato dedicato al nodo Servizi/Borsa, costo fisso 4, avanzano 2 tracciati contemporaneamente). |
| **Fabbriche / mappa esagonale** | Non esiste | Meccanica intera nuova: milestone → credito fondazione, mappa a esagoni, ancoraggio a risorse colorate, maggioranza territoriale, moltiplicatore sulle attivazioni. |
| **Tile R&D / mercati tracciato** | Non esiste | Meccanica intera nuova: 3 mercati per reparto (aperti da milestone 1/2/3), 6 tile acquistabili, scelta immediata o a Città. |
| **Piano Industriale — struttura tessera** | **3 obiettivi/tessera**, 3 categorie fisse (Sviluppo aziendale / Gestione personale / Organizzazione fabbrica), 24 tessere | **2 obiettivi/tessera**, nessuna categoria fissa. 25 tessere in modalità classica, **25 combinazioni** in modalità "famiglie" (quella attiva oggi: Nazionalità × Industriale) — stesso totale (25), ma un obiettivo in meno a testa. |
| **Commesse — combinazioni** | 12 combinazioni/taglia, **incluse monocolore e sbilanciate** | Piccole **7** (solo 3-settori, niente monocolore), medie **6**, grandi **15** — tutte richiedono i 3 settori. Scelta deliberata (sessione 09/07: "togliere le facili", +11% assunzioni). |
| **Commesse — 1°/2° posto** | Ogni carta ha 2 posizioni (1° e 2° completamento, PV diversi) | **Modalità "posto unico" attiva oggi**: un solo vincitore per carta, si rinnova subito. (Il motore supporta ancora la modalità 1°/2°, ma non è quella in uso.) |
| **Commesse — mercato visibile** | Sempre 3 carte attive (1 per taglia) | Dipende dalla modalità: in "posto unico" il mercato per taglia è più ampio (`contractMarket`, default n+2) — più carte contemporaneamente visibili, non 1 sola. |

## 🟡 Numeri cambiati (stessa struttura, valori diversi)

| Aspetto | Vecchio | Oggi (config live) |
|---|---|---|
| Direzione: slot Sopra/Sotto | 2 / 2 | **3 / 0** |
| Commesse grandi, PV 1°/2° | 13 / 10 | **15 / 13** |
| Conversione marchi→PV finale | 3 marchi = 1 PV | **10 marchi = 1 PV** |
| Marchi iniziali (1°-2° / 3°-4°) | 10 / 11 (compensazione ordine turno) | **10 / 10 / 10 / 10** (compensazione disattivata, test in corso) |
| Trattativa: gate Fase 2/3 | conta carte Welfare (soglie 1 e 2) | conta **Impiegati installati** (stessa soglia 1 e 2 — cambia solo cosa si conta, non i numeri) |
| Trattativa: acquisto scontato (Fase 3) | sempre disponibile | disattivato di default nel codice, **riattivato nella config live** ("acquisto scontato ON") |

## 🟢 Invariato (stessa regola, stesso numero)

- Struttura del turno (Muovi + Azione), costo movimento (0 / 1 marco), max 2 Procuratori/nodo.
- Reparti: 3 (Terziario/Secondario/Primario ≈ i vecchi Tessile/Metallurgica/Chimica come reparti, mappati ai 3 settori).
- Cap carte Sotto per reparto: 2.
- Tensione: soglia Sciopero a 3, si azzera dopo lo sciopero, blocco carta reversibile solo via Trattativa (3 marchi).
- Trattativa Fase 1 (azzera propria tensione + attacca un avversario): identica.
- Commesse piccole/medie: PV 1°/2° invariati (5/3, 9/7).
- Clock: soglia fine partita 8/12/16 per 2/3/4 giocatori.
- Conversione risorse finali: 2 uguali = 1 PV.
- Pareggio: vince chi ha più marchi, poi più Commesse.

## ⚪ Non confrontabile dal testo estratto

- Layout grafico plancia, numero fisico di cubetti/meeple, tempo di gioco reale (il vecchio doc dà minuti stimati da playtest fisici; il simulatore misura "turni", non minuti).
- Slot Sopra per reparto (3, dal codice) non è dichiarato esplicitamente nel testo del vecchio docx estratto — probabilmente era solo sulla plancia grafica, non verificabile da qui.

## Nota di lettura

Il vecchio regolamento descrive **il gioco fisico originale**, pensato per giocatori umani con carte e cubetti. Il simulatore ha aggiunto/tolto meccaniche in oltre 10 giorni di sessioni di bilanciamento (Impiegati, Fabbriche, R&D, famiglie Piano Industriale) — non sono bug del simulatore rispetto al regolamento, è il regolamento che è rimasto indietro. Se l'obiettivo finale è un nuovo regolamento fisico, `REGOLAMENTO-DAL-CODICE.md` è il punto di partenza più aggiornato; questo file serve solo a capire cosa è cambiato e perché.
