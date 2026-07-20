# Officina 1907 — Regolamento estratto dal simulatore (19/07/2026)

*Non è un regolamento scritto a mano: è la ricostruzione fedele di ciò che `engine.js` + `data.js` implementano davvero, incrociata con la configurazione live usata in tutte le simulazioni di questa sessione (localStorage del browser). Dove il codice permette varianti (editor), è indicata la variante ATTIVA di default oggi. Meccaniche costruite e poi disattivate (Welfare/Macchinari, Borsa a indici, Carte Struttura) sono elencate in fondo come storia, non come regole vigenti.*

---

## 1. Tema e panoramica

Industria tessile/metallurgica/chimica, Europa 1907. 2-4 giocatori. Ogni giocatore possiede una fabbrica (una delle 6 plance) e assume lavoratori per farla crescere lungo tre linee di produzione, mentre gestisce tensione sindacale, commesse commerciali e — nella versione attuale — l'espansione territoriale con nuove fabbriche.

## 2. Componenti

- **Plancia Fabbrica** (1 delle 6, assegnata a caso o scelta): 3 reparti — **Terziario** (3 slot Sopra + 2 Sotto), **Secondario** (3+2), **Primario** (3+2) — ciascuno associato a uno dei 3 settori (Tessile/Metallurgica/Chimica). Ogni plancia assegna i 3 settori ai 3 reparti in un ordine diverso (le 6 permutazioni possibili).
- **Direzione**: 3 slot Sopra, **0 slot Sotto** (di proposito — vedi §8).
- **Tracciato Produzione**: griglia 4×4 (16 posizioni) per reparto, identica nei 3 reparti.
- **75+12 carte Lavoratore** (mazzo "nuovo"): 72 lavoratori generici in 5 mazzetti bilanciati (A-E) + 12 carte **Impiegato** (mercato dedicato).
- **Carte Commesse**: piccole/medie/grandi, in pool con copie multiple.
- **Mappa esagonale Fabbriche** (Borsa a fabbriche): 27 esagoni (11 con 2 giocatori), risorse colorate + siti costruibili.
- **32 (o 25, vedi §14) tessere Piano Industriale**, ciascuna con 2 obiettivi.
- Segnalini Procuratore (1 a testa, si muove sui nodi), marchi (ⓜ), risorse (Tessuti/Acciaio/Coloranti).

## 3. Setup

- Ogni giocatore riceve una plancia (no doppioni), una tessera Piano Industriale, **10 marchi** (uguali per tutti nella config live — il default di codice sarebbe 10/10/11/11 per compensare l'ordine di turno, ma è disattivato).
- Tracciato Produzione: tutti partono in **posizione 1**.
- Tensione: Terziario parte a 0, Secondario e Primario a 1.
- Nessuna risorsa iniziale.
- Procuratore di tutti in **Città** (nodo "Borsa" nel codice, rinominato in UI — vedi nota nomi sotto).
- **Clock** a 0, soglia di fine partita: **8 (2p) / 12 (3p) / 16 (4p)**.

**⚠️ Nota sui nomi**: nel codice il nodo con id `Servizi` è mostrato come **"Borsa"** (Impiegati + fondazione fabbriche), e il nodo con id `Borsa` è mostrato come **"Città"** (vendita/scambio/Commesse/R&D). Questo regolamento usa sempre i nomi visibili in gioco (Borsa = Impiegati/Fabbriche, Città = tutto il resto).

## 4. Struttura del turno

Ogni turno ha due fasi:

1. **Muovi**: sposta il Procuratore su un nodo diverso da quello in cui si trovava (non puoi restare, nemmeno in Città — niente turni consecutivi nello stesso posto). Un nodo ospita al massimo 2 Procuratori: il 1° entra gratis, il 2° paga 1 marco (Città è sempre gratis e senza limite di occupanti).
2. **Azione**: esegui l'azione del nodo in cui sei arrivato (vedi §5). Puoi sempre passare.

Il turno passa al giocatore successivo (ordine fisso, non a serpentina di default) dopo l'azione, salvo eccezioni (vedi Città, dove puoi incatenare più mosse nella stessa visita).

## 5. I nodi

### Tessile / Metallurgica / Chimica (nodi settore)
Ogni nodo settore offre:
- **Assumi**: prendi la carta lavoratore in cima al banco assegnato a quel nodo (5 mazzetti A-E, uno per nodo — le carte NON sono più raggruppate per nazionalità fisica, la nazione è solo testo/flavor sulla carta) e installala (vedi §6).
- **Attiva reparto**: fa scattare la produzione del reparto di quel settore (vedi §7 e §9).

### Borsa (Impiegati + Fabbriche)
- **Assumi Impiegato**: mercato di 3 carte scoperte (mazzo dedicato, 12 carte uniche × 2 copie). Costo 4 marchi, va sempre in Direzione **Sopra** e avanza **due tracciati contemporaneamente** (vedi §8).
- **Fondazione fabbrica**: se hai un credito (da milestone raggiunta) e un sito libero, puoi fondare (vedi §9).

### Sindacato
- **Trattativa sindacale**: azione a più fasi, vedi §11.

### Città
Nodo "hub": puoi incatenare più azioni nella stessa visita (vendere/scambiare risorse, comprare tile R&D, completare Commesse), con alcuni vincoli di esclusività — vedi §12.

## 6. Le carte Lavoratore

Ogni carta ha: nazionalità (flavor/obiettivi), settore, costo V (in marchi), e una **formula d'effetto** a 3 elementi:

- **verbo**: `prendi` (guadagna subito), `scambia` (paga → guadagna), `perOgni` (guadagna × un conteggio).
- **f1/f2**: quantità + tipo (marco o risorsa di un settore, anche "a scelta" del giocatore).
- conteggi possibili per `perOgni`: icona di settore installata Sopra, nazionalità distinte Sopra, Tensione del reparto, **numero di fabbriche possedute di quel settore**.

Ogni carta si installa in uno dei 2 lati di un reparto:
- **Sopra** (max 3 slot/reparto): deve essere del settore del reparto; **avanza subito il tracciato Produzione di quel reparto di un numero di caselle pari al costo V della carta**.
- **Sotto** (max 2 slot/reparto): qualunque settore; non avanza il tracciato, ma il suo effetto **scatta a ogni "Attiva reparto"** di quel reparto (ricorrente, non una tantum).

## 7. Il tracciato Produzione

Griglia 4×4 per reparto (16 posizioni), stessa struttura nei 3 reparti:

| pos | effetto |
|---|---|
| 1 | marchi × carte Sopra installate (icona) |
| 4 | +1 risorsa |
| 6 | 2 PV a fine partita |
| 7 | slot tile mercato 1 (R&D) |
| 8 | **Milestone 1** — apre mercato 1 |
| 10 | 2 PV |
| 11 | slot tile mercato 2 |
| 12 | **Milestone 2** — apre mercato 2 |
| 13 | 3 PV |
| 15 | slot tile mercato 1+2 combinati |
| 16 | **Milestone 3** — apre mercato 3 |

- **Avanzamento**: assumere Sopra (di V caselle) o installare un Impiegato (di potenza) fa avanzare il tracciato; ogni casella attraversata paga **una tantum** il suo bonus (marchi/risorse).
- **Attivazione**: "Attiva reparto" fa **riprodurre** tutte le caselle marchi/risorse già raggiunte (le celle PV/milestone non si ripetono), più gli effetti delle carte Sotto.
- **Milestone**: attraversare pos 8/12/16 apre il mercato tile corrispondente **e dà un credito per fondare una fabbrica di quel settore** (vedi §9).
- **Tile R&D** (slot 7/11/15): quando la milestone che li apre scatta, il giocatore sceglie subito una tile dal catalogo di quel mercato (o rinuncia, riprovando poi a Città). Catalogo attuale (6 tile, costo in risorse del proprio settore, indipendente per ciascuno dei 3 reparti):

| tile | mercato | effetto | costo |
|---|---|---|---|
| 3 Marchi | 1 | +3 marchi una tantum | 0 |
| 1 risorsa | 1 | +1 risorsa una tantum | 1 |
| 1 Risorsa per carta | 2 | +1 risorsa × icone Sopra, si ripete a ogni attivazione | 2 |
| 3 marchi per carta | 2 | +3 marchi × icone Sopra, si ripete a ogni attivazione | 1 |
| 1 PV per carta | 3 | +1 PV × icone Sopra, a fine partita | 3 |
| 6 PV | 3 | +6 PV a fine partita | 3 |

Ogni reparto ha una scorta propria di 4 copie per tile (non condivisa fra reparti).

## 8. Impiegati e Direzione

Welfare e Macchinari **sono stati rimossi dal design attuale**: la Direzione ha solo 3 slot Sopra, **0 slot Sotto**. L'unico modo di riempirla sono gli **Impiegati**, assunti al nodo Borsa:

- Costo fisso 4 marchi, mercato di 3 carte scoperte (12 uniche × 2 copie, non si rinnova da sola quando esaurita).
- Ogni Impiegato ha una nazionalità e una **potenza su 2 settori** (es. Chimica+4 / Metallurgica+2): installarlo avanza **entrambi** i tracciati corrispondenti, subito, della quantità indicata.
- Nessun effetto Sotto (non esiste più quella posizione).
- Il numero di Impiegati installati (`direzione.sopra.length`) è il **gate unico** che sblocca sia le azioni avanzate della Trattativa sindacale sia le tariffe migliori di vendita/scambio a Città (vedi §11-12) — un tempo questo gate era "Welfare posseduti"/"Macchinari posseduti" separatamente, ora è la stessa metrica.

## 9. Le Fabbriche (nodo Borsa)

- Ogni **milestone di tracciato attraversata** (pos 8/12/16, qualunque reparto) dà **1 credito** per fondare una fabbrica del settore di quel reparto.
- A Borsa, con un credito, un sito libero e i marchi: **fondi** una fabbrica. Costo attuale: **0 marchi** (curva di costo azzerata) — il vincolo è solo credito + sito.
- Un sito è "costruibile" se **adiacente a un esagono-risorsa dello stesso colore** del settore che vuoi fondare (l'ancoraggio è condiviso: più fabbriche possono appoggiarsi alla stessa risorsa, che non si consuma). Colori assegnati a caso a inizio partita, bilanciati (≥3 caselle per colore su mappa da 9 risorse).
- Fondare **paga subito 1 risorsa** del settore, poi **produce +1 risorsa di quel settore a ogni proprio inizio turno** (reddito passivo) — su questa config è **disattivato di default** (`passiveIncome: false`): resta solo la risorsa immediata alla fondazione.
- **Le carte Sotto ×fabbrica scattano più volte**: se hai N fabbriche del settore del reparto attivato (N=1-3, cap 3), ogni carta Sotto di quel reparto si applica N volte invece di una alla singola "Attiva reparto" (`factoryActivates: true`).
- **Maggioranza territoriale** (fine partita): per ogni giacimento-risorsa, chi ha più fabbriche di quel settore adiacenti vince **10 PV**; pareggio → decide chi ha la milestone di quel settore; pareggio anche lì → nessuno.
- 2 giocatori: si gioca solo su metà mappa (isola destra, 11 esagoni). 3-4 giocatori: mappa intera (27 esagoni).

## 10. Tensione e Sciopero

- Ogni **"Attiva reparto"** alza la Tensione di quel reparto di 1 (se il reparto ha almeno una carta installata).
- Alla soglia **3**, scatta lo **Sciopero**: la Tensione si azzera e il giocatore deve **bloccare** una carta a scelta (Sopra o Sotto) di quel reparto — la carta bloccata smette di produrre. Se la carta bloccata era Sopra, il tracciato **retrocede** del suo valore V (mai sotto la posizione di partenza).
- Le carte bloccate a fine partita costano **-3 PV ciascuna**.
- Un avversario può forzare +1 Tensione su un tuo reparto tramite l'attacco in Trattativa (§11) — se questo fa scattare lo sciopero, lo subisci tu, ma viene contato come "sciopero causato da un avversario".

## 11. Trattativa sindacale (nodo Sindacato)

Un'unica azione composta in 3 fasi, tutte opzionali/combinabili in un solo turno:

1. **Fase base** (nessun requisito): puoi **azzerare la Tensione** di un tuo reparto a scelta E/O **+1 Tensione a un reparto a scelta di un avversario**.
2. **Fase 2** (richiede ≥1 Impiegato installato): **rinfresca** tutti i banchi (scopre le prossime carte) oppure **sblocca** una carta bloccata da Sciopero, pagando 3 marchi (il tracciato riavanza se era Sopra, ma non recupera le caselle già perse).
3. **Fase 3** (richiede ≥2 Impiegati): **riduci di 1 la Tensione** di un tuo reparto, oppure **assumi con sconto** (1 marco in meno) una carta di un banco qualsiasi, installandola subito. (Lo sconto-acquisto è **disattivato** di default nel codice ma **attivo nella config live** — "acquisto scontato ON".)

## 12. Città: vendita, scambio, R&D, Commesse

Al nodo Città puoi incatenare più azioni nella stessa visita:

- **Vendi**: 1 risorsa → 3 marchi (tariffa base; le tariffe migliori a 1/2 Macchinari non si applicano più, dato che i Macchinari non esistono — restano sempre alla tariffa base).
- **Scambia**: 2 risorse → 1 risorsa a scelta (tariffa base).
- **Compra tile R&D**: se una milestone è già stata raggiunta ma non hai ancora scelto la tile per quello slot, puoi farlo qui (ripiego rispetto alla scelta immediata al momento della milestone).
- **Completa Commesse**: paga le risorse richieste, incassa i PV (vedi §13). Max 2 commesse per visita.
- **Uscita con bonus fisso** (+3 marchi) o **rinfresco gratuito** di un mercato: alternative a completare Commesse — **esclusive tra loro e con le Commesse nella stessa visita** (o fai l'una o l'altra cosa, non entrambe).

## 13. Commesse

- 3 taglie: **piccola** (3 risorse, 5/3 PV), **media** (5 risorse, 9/7 PV), **grande** (7 risorse, 15/13 PV) — combinazioni di risorse fisse, tutte quelle possibili senza monocolore per le piccole, con tutti e 3 i settori rappresentati per medie/grandi.
- Pool con copie: piccole e medie ×2, grandi ×1.
- **Modalità "posto unico"** (attiva nella config live): ogni carta ha **un solo vincitore** (chi la completa per primo prende `pv[0]`) e si **rinfresca subito**; niente 2° posto. (Il codice supporta anche una modalità "1°+2° posto" con mercato a slot singolo, non usata di default oggi.)
- Completare una Commessa fa avanzare il **Clock** di 1 — il Clock è l'unico modo in cui la partita si avvicina alla fine.
- Si può richiedere un numero minimo di milestone di tracciato raggiunte per accedere a una taglia (`contractMilestoneReq`) — di default 0 per tutte, nessun gate nella config live osservata.

## 14. Piano Industriale (obiettivi personali)

Ogni giocatore pesca una tessera segreta a inizio partita con **2 obiettivi**, ciascuno vale PV se completato entro fine partita.

Config live: modalità **"Nuovo" a famiglie** (non le 32 tessere fisse classiche). 2 famiglie di 5 obiettivi ciascuna, **25 combinazioni** (prodotto cartesiano), tessera = 1 obiettivo pescato da ciascuna famiglia:

- **Famiglia Nazionalità** (5 varianti, una per nazione): "3 lavoratori [nazione] installati" — 7 PV.
- **Famiglia Industriale** (5 varianti): 4 combinazioni di milestone su 1-3 settori (15 PV) + "almeno 2 reparti pieni, 3 Sopra e 2 Sotto" (7 PV).

Tipi di condizione supportati dal motore (usati anche dalle vecchie 32 tessere classiche, non tutti nella config live attuale): milestone di tracciato, N lavoratori di una nazione, N lavoratori della stessa nazione, N nazionalità diverse, tutte le Tensioni a un target, marchi guadagnati in una singola attivazione, N carte Sotto/Sopra in ogni reparto, carte in Direzione, reparto pieno, mix di Commesse per taglia, leadership di settore, nessuna carta bloccata a fine partita.

## 15. Fine partita e punteggio

- Il Clock raggiunge la soglia (8/12/16) → si completa il giro in corso, poi si contano i PV.
- **PV totali** = Commesse completate + obiettivi Piano Industriale + soglie PV sui 3 tracciati + `⌊marchi finali / 10⌋` + `⌊risorse finali (per tipo) / 2⌋` + maggioranza territoriale fabbriche (10 PV/giacimento vinto) **−** 3 PV per ogni carta bloccata da Sciopero.
  (Conversione finale: 10 marchi = 1 PV, 2 risorse uguali = 1 PV — nella config live; il default di codice sarebbe 3m/2R, sovrascritto.)
- Pareggio: vince chi ha più marchi, poi chi ha più Commesse completate.

---

## Meccaniche costruite e poi disattivate (non fanno parte del gioco attuale)

- **Welfare/Macchinari**: carte Direzione Sotto pre-Impiegati, rimosse (cap Sotto = 0).
- **Borsa a indici**: 4 indici (3 settori + Sindacato) su cui investire, sostituita dalla Borsa a fabbriche.
- **Carte Struttura**: variante di Welfare con effetti su coppie di nodi, mai attivata di default, codice dormiente.
- **Mazzo "Classico"** (75 lavoratori, banchi per nazionalità, 32 tessere Piano Industriale fisse): ancora selezionabile dagli editor ma non la config in uso nelle simulazioni di questa sessione.

---

*Fonti: `src/game/engine.js`, `src/game/data.js`, `src/components/SetupScreen.jsx` (defaults di codice, già allineati alla config viva secondo le sessioni precedenti) + osservazione diretta della config live nel browser (localStorage) durante questa sessione.*
