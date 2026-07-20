# Officina 1907 — Simulatore

Simulatore React del prototipo **Officina 1907**. 2–4 giocatori, ciascuno umano o AI.

## Avvio

```bash
npm install
npm run dev        # apre su http://localhost:5199
npm run simulate   # partite headless: node scripts/simulate.js [nPartite] [nGiocatori]
npm run build      # genera dist/index.html: file UNICO autonomo, apribile con doppio click
```

Nota: la `index.html` nella radice del progetto NON va aperta direttamente (serve il dev server). Per giocare senza server usa `dist/index.html`.

**Editor tracciati** (nel setup): click su una casella per cambiarne il contenuto (vuota / 1ⓜ / 2ⓜ / risorsa / 1ⓜ per carta / 2PV / 3PV / milestone). Due schemi: Terziario e Secondario/Primario. Salvato nel browser (localStorage), «Ripristina default» per tornare ai tracciati del file plance. La milestone usata dagli Obiettivi è la casella 🏛 (se assente, gli obiettivi-milestone diventano irraggiungibili).

**Analisi di fine partita**: oltre ai punteggi — marchi/risorse rimasti, attivazioni reparto per giocatore, grafici marchi e risorse turno per turno, situazione finale di tutte le plance.

## Fonti dei dati

- **Regole**: `regolamento/officina-1907-giocatore.docx` (canone).
- **Carte** (75 operai, 12 welfare, 18 commesse, 32 tessere obiettivo): `plance/mazzi - ordinato.xlsx`, estratte con `scripts` → `src/game/data.js`.
- **Plance/tracciati**: `files stampa IG Vittorio veneto/plance giocatore 26.pdf` + design doc per slot e setup.

## Assunzioni e interpretazioni (dove i file non specificano)

1. **Tracciato Produzione (griglia 4×4, posizioni 1–16)** — da `Plance Fabbrica.xlsx`, percorso e semantica confermati dall'autore:
   serpentina da D1 (D1→D4, C4→C1, B1→B4, A4→A1); segnalini partono tutti da D1; Tensione iniziale 0/1/1 (terz/sec/prim), nessuna risorsa iniziale.
   A ogni attivazione TUTTE le caselle raggiunte riproducono (marchi, risorse, «1 ⓜ per carta [Settore]»); le stesse caselle si incassano anche una tantum all'attraversamento.
   Caselle PV (2 e 3 per reparto) = soglie cumulative conteggiate a fine partita; Milestone (terz pos 12, sec/prim pos 13) rilevante solo per gli Obiettivi.
2. **Abbinamento banchi-nodi**: non trovato nei file; layout fisso a pentagono in `NODE_BANKS` (`src/game/data.js`), facilmente modificabile.
3. **Welfare/Macchinario**: acquisto ai Servizi con scelta del lato. Sopra = avanzamento tracciati + sblocco fasi Sindacato. Sotto (Macchinario) = a inizio turno 1 risorsa del settore 1° (V5, 3 usi) o 1 risorsa per ciascun settore (V7, 2 usi). Il marcatore «+1 tensione» su alcuni pallini (nota xlsx non descritta) NON è implementato.
3b. **Borsa — "Esci senza Commesse" (homebrew, non ancora nel regolamento ufficiale, 13/07/2026)**: oltre a Cambio risorse (1→3 marchi, o 2 uguali→1 a scelta, illimitato) e Commesse (max 2/visita), il giocatore può uscire con un bonus fisso di marchi (default 3) e/o rinfrescare gratis un mercato a scelta (Welfare o banchi operai). Esclusiva con le Commesse nella stessa visita, in entrambe le direzioni: usare l'una preclude l'altra fino al turno successivo. Configurabile/disattivabile in "Editor azioni Borsa".
3c. **Borsa — modalità scambi (13/07/2026)**: "Illimitati" (default, storico) = Vendi/Scambia ripetibili a piacere. "Uno per azione" (homebrew, alternativa) = Vendi 1 uso/visita fisso, Scambia 1 base + N usi per ogni Macchinario posseduto (N editabile, default 1 — es. 2 Macchinari = 3 usi Scambia totali), sempre a tariffa base (le tariffe M1/M2 non si applicano in questa modalità, sono un concetto della modalità Illimitati). Toggle in "Editor azioni Borsa".
4. **Icona**: settore stampato sulla carta; per le carte Welfare/Macchinario conta solo il settore 1°.
5. **Commesse**: ogni requisito (commessa) completabile una sola volta; il podio (1°/2°) segue l'ordine di completamento sulla carta.
6. **Tessere obiettivo**: il regolamento dice 24, l'xlsx ne contiene 32 → usate tutte e 32.
7. **PV di completamento reparto** (riquadri gialli 3/5/5 sulla plancia): NON nel conteggio del regolamento giocatore → non implementati.
8. **Colonne "Bonus 1/Bonus 2" dell'xlsx operai**: nessuna regola le descrive → ignorate.
9. **Reparto vuoto**: Tensione bloccata a 0 (glossario); lo Sciopero senza carte bloccabili azzera solo la Tensione.
10. **«Rinuncia all'azione»**: non prevista dal regolamento, presente come valvola di sicurezza anti-stallo.
11. **Trattativa, Fase 3 «acquista con sconto»**: disponibile all'AI; per i giocatori umani non ancora nell'interfaccia.

## Struttura

- `src/game/data.js` — dati generati (non modificare a mano: rigenerare con lo script in scratchpad).
- `src/game/engine.js` — regole: stato immutabile, `initGame` / `legalCommands` / `applyCommand`, RNG con seed.
- `src/game/ai.js` — AI euristica (lookahead a 1 mossa + valutazione), più una policy rollout opzionale (`state.aiRollout`, vedi sotto).
- `src/components/` — UI React.
- `src/game/batchWorker.js` — worker per `SimulationPanel`: le partite di un batch sono indipendenti, girano in parallelo su più core (vedi sotto).
- `scripts/simulate.js` — verifica headless (partite complete tra AI).
- `scripts/decisionlog.js` — confronto Greedy vs Rollout sulle stesse mosse candidate, in un punto preciso della partita.

## AI: Greedy vs Rollout

Due policy decisionali sullo stesso motore, non due IA diverse. Scegli in base alla domanda.

- **Greedy** (default, `state.aiRollout` assente): valuta ogni mossa candidata con `evaluate()` dopo 1 sola azione. Veloce (~0.5-1s/partita), adatto a regressioni e batch massivi (500+ partite).
- **Rollout** (`state.aiRollout = {depth, rollouts}`, opt-in via config): per ogni mossa candidata gioca `depth` turni in self-play greedy e valuta lì lo stato — vede conseguenze reali, non solo la stima immediata. `depth=6` è l'orizzonte misurato (oltre non aggiunge nulla: `evaluate()` resta la stessa funzione, il lookahead non la corregge, la disegna meglio). Costo: 10-40× più lento del greedy (misurato: ~12s/partita su deck sintetico, ~42s/partita sul deck live con `usesMax` più basso — non praticabile oggi per batch da 500).

**Trovato con questa tecnica (13/07/2026):** il Greedy ha un blind spot strutturale sulla Direzione Sotto (Macchinari) — la formula di default (`usesLeft*1.0`) è cieca a `perUse`, e sul deck live il Greedy compra Direzione Sotto in pratica MAI (0.01 medi/giocatore) contro Direzione Sopra quasi sempre piena (2.84/3). Il Rollout esplora entrambi i rami (1.57/1.61) e cambia anche altro (meno Sindacato, molta più Borsa) — è una policy diversa, non un fix di una singola carta. Aumentare il lookahead NON corregge un `evaluate()` miope su una meccanica specifica (dimostrato: lookahead più profondo con la stessa `evaluate()` cieca a `perUse` non "scopre" quel valore) — se un bias è nella value function, va corretto lì.

**Parallelizzato su più core:** le partite di un batch sono indipendenti (nessuno stato condiviso) → `SimulationPanel` le distribuisce su `navigator.hardwareConcurrency` Web Worker (cap 8). 20 partite Rollout d6 misurate: **~100s con gli 8 worker contro ~10-13 min in seriale.** Il worker (`batchWorker.js`) è caricato con `?worker&inline`: finisce dentro `dist/index.html` invece che in un file separato, quindi funziona anche aperto con `file://`. `npm run simulate` e gli script in `scripts/` restano seriali (Node, non toccati).

**Modi di interrogare il simulatore, non un solo "esegui N partite"** (pannello "🎲 Simulazione automatica"): **Regressione** (500 partite, Greedy — ho rotto qualcosa?), **Bilanciamento veloce** (30 partite, Rollout d4 — prima occhiata su una carta nuova), **Bilanciamento accurato** (75 partite, Rollout d6 — verdetto affidabile, orizzonte pieno) sono preset; **Personalizzata** espone i controlli manuali (partite, rollout on/off, depth, rollouts). Ogni report si apre con `=== MODALITÀ ===` + nome/partite/IA usati, per non doverselo ricordare rileggendo un report vecchio. Durante il batch il pannello mostra anche una stima di quanto manca e l'orario previsto di fine (ricalcolata ogni secondo dal ritmo osservato finora).
