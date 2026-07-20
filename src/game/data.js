// GENERATO da extract_data.py — dati da "mazzi - ordinato.xlsx" + regolamento giocatore

// Settori e risorse
export const SECTORS = ['Tessile', 'Metallurgica', 'Chimica'];
export const RESOURCE_OF = { Tessile: 'Tessuti', Metallurgica: 'Acciaio', Chimica: 'Coloranti' };
export const SECTOR_COLORS = { Tessile: '#b0413e', Metallurgica: '#3e6f8f', Chimica: '#b09c3e' };
export const NATIONS = ['Italiani', 'Francesi', 'Polacchi', 'Spagnoli', 'Tedeschi'];
export const NATION_FLAGS = { Italiani: '🇮🇹', Francesi: '🇫🇷', Polacchi: '🇵🇱', Spagnoli: '🇪🇸', Tedeschi: '🇩🇪' };

// Plancia centrale: 5 nodi perimetrali + Borsa. Ogni nodo perimetrale ha 2 banchi adiacenti.
// ASSUNZIONE: abbinamento banchi-nodi non specificato nei file — layout fisso a pentagono.
export const NODES = ['Tessile', 'Metallurgica', 'Chimica', 'Servizi', 'Sindacato', 'Borsa'];

// ⚠️ ATTENZIONE — la mappa è INVERTITA rispetto ai nomi di gioco (rinominati 17/07/2026):
//   id 'Servizi' → si chiama "Borsa"  (Impiegati + acquisto azioni degli indici)
//   id 'Borsa'   → si chiama "Città"  (vendi/scambia/commesse/bonus/refresh, le vecchie azioni)
// Gli id NON sono stati rinominati di proposito: 'Borsa' è una chiave già salvata in cfg.nodeBanks e in
// localStorage, e uno scambio di nomi è una collisione (il vecchio 'Borsa' dovrebbe diventare 'Città'
// PRIMA che 'Servizi' diventi 'Borsa', o le config salvate si sovrascrivono in silenzio).
// Usa NODE_LABEL ovunque il nome sia visibile all'utente (UI, report); mai per la logica.
export const NODE_LABEL = { Servizi: 'Borsa', Borsa: 'Città' };
export const nodeLabel = id => NODE_LABEL[id] || id;

// Borsa a indici (17/07/2026). Tutto editabile: il design su carta ha ancora nodi aperti
// (divergenza degli indici, scala del Sindacato, simmetria dei quadrimestri) — sono knob, non decisioni.
export const BORSA_INDICI_DEFAULT = {
  enabled: false,              // default OFF: nessuna regressione sui batch esistenti
  sectorDriver: 'milestone',   // attivazioni | milestone | posizioni | carte
  unionDriver: 'nessuno',      // trattative | tensione | scioperi | nessuno (= solo 3 indici)
  quadBounds: [4, 8, 12, 16],  // soglia di Clock che CHIUDE Q1..Q4 (default = quarti del clock a 16)
  prices: [5, 7, 9, 13],       // costo di un'azione, per quadrimestre
  cells: [                     // caselle per quadrimestre × rango dell'indice (1°/2°/3°/4°)
    [4, 3, 2, 1],
    [6, 4, 3, 2],
    [8, 6, 4, 2],
    [12, 9, 6, 3],
  ],
  maxSharesPerQuad: 4,         // quanti indici distinti puoi comprare in uno stesso quadrimestre
  rounding: 'down',            // dividendo = casella ÷ investitori: 'down' (arrotonda giù) | 'exact' (frazionario)
};

// Borsa a fabbriche (18/07/2026) — SOSTITUISCE la Borsa a indici quando enabled (codice indici resta dormiente).
// Mappa esagonale (2 isole) definita dall'utente via editor. 9 esagoni-risorsa ricevono un colore random a
// inizio partita. Raggiungere una milestone di un reparto → credito per fondare una fabbrica di quel settore su
// un esagono costruibile adiacente a una risorsa DELLO STESSO colore. La fabbrica produce il suo settore ogni
// turno. 2 giocatori = solo isola destra; 3-4 = tutta la mappa. Ancoraggio condiviso (più fabbriche per risorsa).
export const FACTORY_MAP = {
  // dall'editor: pointy-top, adiacenza calcolata dalla griglia (odd-r).
  // col/row = coordinate pointy-top odd-r (dall'editor esagoni), per il rendering della mappa
  hexes: [
    { id: 'L1', col: 2, row: 0, type: 'costruibile', isola: 'L' }, { id: 'L2', col: 3, row: 0, type: 'risorsa', isola: 'L' },
    { id: 'L3', col: 5, row: 0, type: 'costruibile', isola: 'L' }, { id: 'L4', col: 2, row: 1, type: 'costruibile', isola: 'L' },
    { id: 'L5', col: 3, row: 1, type: 'costruibile', isola: 'L' }, { id: 'L6', col: 4, row: 1, type: 'risorsa', isola: 'L' },
    { id: 'L7', col: 5, row: 1, type: 'costruibile', isola: 'L' }, { id: 'L8', col: 2, row: 2, type: 'costruibile', isola: 'L' },
    { id: 'L9', col: 3, row: 2, type: 'risorsa', isola: 'L' }, { id: 'L10', col: 4, row: 2, type: 'costruibile', isola: 'L' },
    { id: 'L11', col: 5, row: 2, type: 'costruibile', isola: 'L' }, { id: 'L12', col: 1, row: 3, type: 'risorsa', isola: 'L' },
    { id: 'L13', col: 2, row: 3, type: 'costruibile', isola: 'L' }, { id: 'L14', col: 4, row: 3, type: 'risorsa', isola: 'L' },
    { id: 'L15', col: 5, row: 3, type: 'costruibile', isola: 'L' }, { id: 'L16', col: 2, row: 4, type: 'costruibile', isola: 'L' },
    { id: 'R1', col: 6, row: 0, type: 'risorsa', isola: 'R' }, { id: 'R2', col: 6, row: 1, type: 'costruibile', isola: 'R' },
    { id: 'R3', col: 9, row: 1, type: 'risorsa', isola: 'R' }, { id: 'R4', col: 10, row: 1, type: 'costruibile', isola: 'R' },
    { id: 'R5', col: 9, row: 2, type: 'costruibile', isola: 'R' }, { id: 'R6', col: 10, row: 2, type: 'costruibile', isola: 'R' },
    { id: 'R7', col: 7, row: 3, type: 'costruibile', isola: 'R' }, { id: 'R8', col: 8, row: 3, type: 'costruibile', isola: 'R' },
    { id: 'R9', col: 9, row: 3, type: 'risorsa', isola: 'R' }, { id: 'R10', col: 8, row: 4, type: 'risorsa', isola: 'R' },
    { id: 'R11', col: 9, row: 4, type: 'costruibile', isola: 'R' },
  ],
  adj: {
    L1: ['L2', 'L4'], L2: ['L1', 'L4', 'L5'], L3: ['L6', 'L7', 'R1'], L4: ['L1', 'L2', 'L5', 'L8', 'L9'],
    L5: ['L10', 'L2', 'L4', 'L6', 'L9'], L6: ['L10', 'L11', 'L3', 'L5', 'L7'], L7: ['L11', 'L3', 'L6', 'R1', 'R2'],
    L8: ['L12', 'L13', 'L4', 'L9'], L9: ['L10', 'L13', 'L4', 'L5', 'L8'], L10: ['L11', 'L14', 'L5', 'L6', 'L9'],
    L11: ['L10', 'L14', 'L15', 'L6', 'L7'], L12: ['L13', 'L16', 'L8'], L13: ['L12', 'L16', 'L8', 'L9'],
    L14: ['L10', 'L11', 'L15'], L15: ['L11', 'L14'], L16: ['L12', 'L13'],
    R1: ['L3', 'L7', 'R2'], R2: ['L7', 'R1'], R3: ['R4', 'R5', 'R6'], R4: ['R3', 'R6'],
    R5: ['R3', 'R6', 'R8', 'R9'], R6: ['R3', 'R4', 'R5', 'R9'], R7: ['R10', 'R8'], R8: ['R10', 'R11', 'R5', 'R7', 'R9'],
    R9: ['R11', 'R5', 'R6', 'R8'], R10: ['R11', 'R7', 'R8'], R11: ['R10', 'R8', 'R9'],
  },
};
// Tre mappe di default, una per numero di giocatori (retro-compatibile col vecchio 2=isola destra / 3-4=intera).
// L'utente può sostituirle da editor (config.borsaFabbriche.maps[n]).
function subsetMap(pred) {
  const hexes = FACTORY_MAP.hexes.filter(pred);
  const ids = new Set(hexes.map(h => h.id));
  const adj = {};
  for (const h of hexes) adj[h.id] = (FACTORY_MAP.adj[h.id] || []).filter(n => ids.has(n));
  return { hexes, adj };
}
export const DEFAULT_FACTORY_MAPS = {
  2: subsetMap(h => h.isola === 'R'), // 2 giocatori: solo isola destra
  3: FACTORY_MAP,                     // 3-4: mappa intera
  4: FACTORY_MAP,
};

export const BORSA_FABBRICHE_DEFAULT = {
  enabled: true,                                // config viva dell'autore: Borsa a fabbriche attiva di default
  costCurve: [0, 0, 0, 0, 0, 0],                // costo della n-esima fabbrica (indice = fabbriche gia possedute); oltre = ultimo
  setupBalance: 'perColorePerIsola',            // 'bilanciato' | 'random' | 'perColorePerIsola'
  passiveIncome: false,                         // true: +1 risorsa/turno per fabbrica; false: solo la risorsa immediata alla fondazione
  factoryActivates: true,                       // true: le carte Sotto scattano N volte = forza del settore (floor 1, cap 3)
  // Fabbrica NEUTRA (default 21/07/2026): si fonda solo con marchi (nessun credito-milestone, nessun settore
  // proprio); la sua forza verso un settore = quante fabbriche del giocatore sono adiacenti alle caselle-risorsa
  // di quel colore (contate dal lato risorsa). All'attivazione di un reparto conta solo la forza di quel settore.
  // false = vecchio modello: fabbrica legata a un settore, credito-milestone, adiacenza allo stesso colore.
  neutralFactory: true,
  foundingResource: true,                       // true: fondando incassi subito 1 risorsa (neutra: una per colore adiacente distinto)
  majorityBonus: { pv: 10, enabled: true },     // PV a fine partita a chi ha più fabbriche attorno a un giacimento (neutra: senza badare al settore)
  maps: {
    2: {
      hexes: [
        { id: 'R1', col: 9, row: 1, type: 'risorsa', isola: 'R' }, { id: 'R2', col: 10, row: 1, type: 'costruibile', isola: 'R' },
        { id: 'R3', col: 9, row: 2, type: 'costruibile', isola: 'R' }, { id: 'R4', col: 10, row: 2, type: 'costruibile', isola: 'R' },
        { id: 'R5', col: 7, row: 3, type: 'costruibile', isola: 'R' }, { id: 'R6', col: 8, row: 3, type: 'costruibile', isola: 'R' },
        { id: 'R7', col: 9, row: 3, type: 'risorsa', isola: 'R' }, { id: 'R8', col: 8, row: 4, type: 'risorsa', isola: 'R' },
        { id: 'R9', col: 9, row: 4, type: 'costruibile', isola: 'R' },
      ],
      adj: {
        R9: ['R6', 'R7', 'R8'], R1: ['R2', 'R3', 'R4'], R2: ['R1', 'R4'], R3: ['R1', 'R4', 'R6', 'R7'],
        R4: ['R1', 'R2', 'R3', 'R7'], R5: ['R6', 'R8'], R6: ['R3', 'R5', 'R7', 'R8', 'R9'],
        R7: ['R3', 'R4', 'R6', 'R9'], R8: ['R5', 'R6', 'R9'],
      },
    },
    3: {
      hexes: [
        { id: 'L1', col: 5, row: 0, type: 'costruibile', isola: 'L' }, { id: 'L2', col: 4, row: 1, type: 'risorsa', isola: 'L' },
        { id: 'L3', col: 5, row: 1, type: 'costruibile', isola: 'L' }, { id: 'L4', col: 4, row: 2, type: 'costruibile', isola: 'L' },
        { id: 'L5', col: 5, row: 2, type: 'costruibile', isola: 'L' }, { id: 'L6', col: 4, row: 3, type: 'risorsa', isola: 'L' },
        { id: 'L7', col: 5, row: 3, type: 'costruibile', isola: 'L' },
        { id: 'R1', col: 6, row: 0, type: 'costruibile', isola: 'R' }, { id: 'R10', col: 8, row: 4, type: 'risorsa', isola: 'R' },
        { id: 'R11', col: 9, row: 4, type: 'costruibile', isola: 'R' }, { id: 'R2', col: 6, row: 1, type: 'costruibile', isola: 'R' },
        { id: 'R3', col: 9, row: 1, type: 'risorsa', isola: 'R' }, { id: 'R4', col: 10, row: 1, type: 'costruibile', isola: 'R' },
        { id: 'R5', col: 9, row: 2, type: 'costruibile', isola: 'R' }, { id: 'R6', col: 10, row: 2, type: 'costruibile', isola: 'R' },
        { id: 'R7', col: 7, row: 3, type: 'costruibile', isola: 'R' }, { id: 'R8', col: 8, row: 3, type: 'costruibile', isola: 'R' },
        { id: 'R9', col: 9, row: 3, type: 'risorsa', isola: 'R' },
      ],
      adj: {
        L5: ['L2', 'L3', 'L4', 'L6', 'L7'], L6: ['L4', 'L5', 'L7'], L7: ['L5', 'L6'],
        L1: ['L2', 'L3', 'R1'], L2: ['L1', 'L3', 'L4', 'L5'], L3: ['L1', 'L2', 'L5', 'R1', 'R2'], L4: ['L2', 'L5', 'L6'],
        R10: ['R11', 'R7', 'R8'], R11: ['R10', 'R8', 'R9'], R3: ['R4', 'R5', 'R6'], R4: ['R3', 'R6'],
        R5: ['R3', 'R6', 'R8', 'R9'], R6: ['R3', 'R4', 'R5', 'R9'], R7: ['R10', 'R8'], R8: ['R10', 'R11', 'R5', 'R7', 'R9'],
        R9: ['R11', 'R5', 'R6', 'R8'], R2: ['L3', 'R1'], R1: ['L1', 'L3', 'R2'],
      },
    },
    4: FACTORY_MAP,
  },
};
// copie di ogni carta commessa nel pool: piccole/medie in duplice copia (più respiro), grandi singole (già 15 combo)
export const CONTRACT_COPIES = { small: 2, medium: 2, large: 1 };
export const NODE_BANKS = {
  Tessile: ['Francesi', 'Italiani'],
  Metallurgica: ['Italiani', 'Polacchi'],
  Chimica: ['Polacchi', 'Spagnoli'],
  Servizi: ['Spagnoli', 'Tedeschi'],
  Sindacato: ['Tedeschi', 'Francesi'],
};

// Le 6 plance Fabbrica da "Plance Fabbrica.xlsx" (terziario sx 3 slot Sopra / secondario 4 / primario 4; Sotto max 2 ovunque)
export const BOARDS = [
  { id: 'p1', name: 'Plancia 1', terziario: 'Tessile', secondario: 'Chimica', primario: 'Metallurgica' },
  { id: 'p2', name: 'Plancia 2', terziario: 'Tessile', secondario: 'Metallurgica', primario: 'Chimica' },
  { id: 'p3', name: 'Plancia 3', terziario: 'Metallurgica', secondario: 'Tessile', primario: 'Chimica' },
  { id: 'p4', name: 'Plancia 4', terziario: 'Chimica', secondario: 'Tessile', primario: 'Metallurgica' },
  { id: 'p5', name: 'Plancia 5', terziario: 'Chimica', secondario: 'Metallurgica', primario: 'Tessile' },
  { id: 'p6', name: 'Plancia 6', terziario: 'Metallurgica', secondario: 'Chimica', primario: 'Tessile' },
];
// Cap fisso per OGNI reparto: 3 Sopra + 2 Sotto, carte bloccate da Sciopero incluse (conferma autore 07/07/2026)
export const ROLE_SLOTS_SOPRA = { terziario: 3, secondario: 3, primario: 3 };

// Tracciato Produzione: griglia 4x4 (righe A alto → D basso), serpentina da D1: D1→D4, C4→C1,
// B1→B4, A4→A1 = posizioni 1..16. Template UNICO condiviso dai 3 reparti (2.0: prima terziario
// aveva un layout proprio, ora è identico a secondario/primario — nessun codice ne legge la forma,
// solo il contenuto per posizione, quindi unificarlo è senza rischio).
// cell: null | {coins:n} | {res:n} | {coinsPerIcon:n} | {coinsPerTension:n} | {resPerIcon:n}
//     | {resPerTension:n} | {pv:n} | {milestone:true, opensMarket:1|2|3} | {tileSlot:1|2|3}
// Meccanica tile (2.0): pos 7/11/15 sono slot inerti finché il giocatore non compra una tile dal
// mercato aperto dalla milestone successiva (8→mercato1, 12→mercato2, 16→mercato1+2 per lo slot 15,
// vedi TRACK_TILES). Una volta comprata, l'effetto della tile sostituisce la cella per quel giocatore
// (vedi `resolveCell` in engine.js) — il template qui resta sempre lo slot vuoto.
const T = null;
export const TRACK = [
  null,                                                                    // pos 0 inutilizzata
  { coinsPerIcon: 1 }, T, T, { res: 1 },                                   // 1..4
  T, { pv: 2 }, { tileSlot: 1 }, { milestone: true, opensMarket: 1 },      // 5..8
  T, { pv: 2 }, { tileSlot: 2 }, { milestone: true, opensMarket: 2 },      // 9..12
  T, { pv: 3 }, { tileSlot: 3 }, { milestone: true, opensMarket: 3 },      // 13..16
];
export const TRACKS = { terziario: TRACK, secondario: TRACK, primario: TRACK };
export const TRACK_MAX = 16;

// Catalogo tile acquistabili (editabile via config.trackTiles, altrimenti default qui).
// market: 1 o 2 — quale mercato la propone (slot 7/11 la accettano solo dal proprio; slot 15
// accetta l'unione di entrambi, ma solo dello STESSO reparto — vedi role). role: sezione dedicata
// per reparto (terziario/secondario/primario) — cataloghi indipendenti, scorta (copies) mai condivisa
// tra reparti: un reparto non può esaurire le tile di un altro. cellType/amount: stessa grammatica
// delle celle del tracciato, solo bonus passivi per ora (niente scambi/scelte — vedi discussione in sessione).
// Catalogo condiviso dai 3 reparti: stesso contenuto ovunque, ma ogni reparto ha il suo mercato e la
// sua scorta indipendenti a runtime (vedi trackTileStock in engine.js, tenuto per-reparto).
export const TRACK_TILES = [
  { id: 'tt1', market: 1, name: '3 Marchi', cellType: 'coins', amount: 3, cost: 0, copies: 4 },
  { id: 'tt2', market: 1, name: '1 risorsa', cellType: 'res', amount: 1, cost: 1, copies: 4 },
  { id: 'tt4', market: 2, name: '1 Risorsa per carta', cellType: 'resPerIcon', amount: 1, cost: 2, copies: 4 },
  { id: 'tt5', market: 2, name: '3 marchi per carta', cellType: 'coinsPerIcon', amount: 3, cost: 1, copies: 4 },
  { id: 'ttd1acqk', market: 3, name: '1 PV per carta', cellType: 'pvPerIcon', amount: 1, cost: 3, copies: 4 },
  { id: 'ttb02zhl', market: 3, name: '6 PV', cellType: 'pv', amount: 6, cost: 3, copies: 4 },
];
// mode 'illimitato' (default, oggi): ogni giocatore sceglie liberamente, nessuna scorta condivisa.
// 'limitato' (futuro, non ancora implementato): consumerebbe `copies` da un pool condiviso.
export const TRACK_TILE_CAP_DEFAULT = { mode: 'limitato' };
// Modello "unito" (20/07/2026, dalla grafica dell'autore): sulla plancia stampata alcune caselle sono
// una sola casella doppia — D1+D2, e le tre coppie slot+milestone (C2+C1, B3+B4, A2+A1), perché la tile
// piazzata è larga due caselle e le copre entrambe. Quindi 12 passi, non 16, e arrivare sulla casella
// doppia dà SLOT e MILESTONE insieme (la milestone non è più un passo a sé).
// Ogni riga ha 2 caselle singole + 1 doppia in fondo alla serpentina.
export const TRACK_12 = [
  null,                                                                 // pos 0 inutilizzata
  { coinsPerIcon: 1 }, T, { res: 1 },                                   // 1..3   [D1+D2] · D3 · D4
  T, { pv: 2 }, { tileSlot: 1, milestone: true, opensMarket: 1 },       // 4..6   C4 · C3 · [C2+C1]
  T, { pv: 2 }, { tileSlot: 2, milestone: true, opensMarket: 2 },       // 7..9   B1 · B2 · [B3+B4]
  T, { pv: 3 }, { tileSlot: 3, milestone: true, opensMarket: 3 },       // 10..12 A4 · A3 · [A2+A1]
];

// I due modelli di tracciato selezionabili in setup. 'classico' = 16 passi (invariato, default:
// nessuna regressione sui batch esistenti). 'unito' = 12 passi, come la plancia stampata.
export const TRACK_MODELS = {
  classico: { label: 'Classico (16 caselle)', track: TRACK, max: 16 },
  unito:    { label: 'Unito (12 caselle, come la plancia)', track: TRACK_12, max: 12 },
};
export const TRACK_MODEL_DEFAULT = 'classico';

// mappa posizione → [riga, colonna] per la UI. 4 righe (0=A ... 3=D), serpentina dal basso.
// `max` = lunghezza del tracciato (16 → 4 colonne, 12 → 3 colonne).
export function trackGridPos(pos, max = TRACK_MAX) {
  const cols = max / 4;
  const rowFromBottom = Math.floor((pos - 1) / cols);   // 0=D, 1=C, 2=B, 3=A
  const idx = (pos - 1) % cols;
  return [3 - rowFromBottom, rowFromBottom % 2 === 0 ? idx : cols - 1 - idx];
}

// Setup (confermato dall'autore): segnalini Produzione tutti su D1 (pos 1);
// Tensione: terziario 0, secondario 1, primario 1. Nessuna risorsa iniziale.
export const SETUP = { primario: { prod: 1, tension: 1 }, secondario: { prod: 1, tension: 1 }, terziario: { prod: 1, tension: 0 } };

// Marchi iniziali per posizione di turno (1°/2°: 10, 3°/4°: 11)
export const STARTING_COINS = [10, 10, 10, 10];

export const TENSION_LIMIT = 3;
export const CLOCK_THRESHOLD = { 2: 8, 3: 12, 4: 16 };
export const CLOCK_REFRESH = [3, 6, 9, 12, 15];
export const MOVE_COSTS = [0, 1]; // slot 1 gratis, slot 2 = 1 marco
export const MAX_CONTRACTS_PER_VISIT = 2;
export const DIREZIONE_MAX = { sopra: 3, sotto: 0 };
export const UNBLOCK_COST = 3;

export const WORKERS = [
 {
  "id": "w1",
  "nation": "Italiani",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w2",
  "nation": "Italiani",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w3",
  "nation": "Italiani",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia 2 monete per una risorsa a tua scelta"
 },
 {
  "id": "w4",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una risorsa a tua scelta"
 },
 {
  "id": "w5",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia due monete per una risorsa a tua scelta"
 },
 {
  "id": "w6",
  "nation": "Italiani",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "coin_per_nation",
   "amount": 1
  },
  "effectText": "Prendi una moneta per ogni nazione diversa"
 },
 {
  "id": "w7",
  "nation": "Italiani",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w8",
  "nation": "Italiani",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w9",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_coins",
   "amount": 3
  },
  "effectText": "Prendi tre monete"
 },
 {
  "id": "w10",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "sector",
    "value": "Tessile"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w11",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w12",
  "nation": "Italiani",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w13",
  "nation": "Italiani",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "swap_res_3m"
  },
  "effectText": "Scambia una risorsa per 3 monete"
 },
 {
  "id": "w14",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "nation",
    "value": "Italiani"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w15",
  "nation": "Italiani",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w16",
  "nation": "Francesi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w17",
  "nation": "Francesi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia 2 monete per una risorsa a tua scelta"
 },
 {
  "id": "w18",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una risorsa a tua scelta"
 },
 {
  "id": "w19",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia due monete per una risorsa a tua scelta"
 },
 {
  "id": "w20",
  "nation": "Francesi",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w21",
  "nation": "Francesi",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w22",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_coins",
   "amount": 3
  },
  "effectText": "Prendi tre monete"
 },
 {
  "id": "w23",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "sector",
    "value": "Metallurgica"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w24",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w25",
  "nation": "Francesi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "coin_per_nation",
   "amount": 1
  },
  "effectText": "Prendi una moneta per ogni nazione diversa"
 },
 {
  "id": "w26",
  "nation": "Francesi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w27",
  "nation": "Francesi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w28",
  "nation": "Francesi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "swap_res_3m"
  },
  "effectText": "Scambia una risorsaper 3 monete"
 },
 {
  "id": "w29",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "nation",
    "value": "Francesi"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w30",
  "nation": "Francesi",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w31",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una risorsa a tua scelta"
 },
 {
  "id": "w32",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia due monete per una risorsa a tua scelta"
 },
 {
  "id": "w33",
  "nation": "Polacchi",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w34",
  "nation": "Polacchi",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia 2 monete per una risorsa a tua scelta"
 },
 {
  "id": "w35",
  "nation": "Polacchi",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w36",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_coins",
   "amount": 3
  },
  "effectText": "Prendi tre monete"
 },
 {
  "id": "w37",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "sector",
    "value": "Chimica"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w38",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w39",
  "nation": "Polacchi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w40",
  "nation": "Polacchi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "coin_per_nation",
   "amount": 1
  },
  "effectText": "Prendi una moneta per ogni nazione diversa"
 },
 {
  "id": "w41",
  "nation": "Polacchi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w42",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "nation",
    "value": "Polacchi"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w43",
  "nation": "Polacchi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w44",
  "nation": "Polacchi",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w45",
  "nation": "Polacchi",
  "sector": "Metallurgica",
  "v": 4,
  "effect": {
   "type": "swap_res_3m"
  },
  "effectText": "Scambia una risorsa per 3 monete"
 },
 {
  "id": "w46",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una risorsa a tua scelta"
 },
 {
  "id": "w47",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia due monete per una risorsa a tua scelta"
 },
 {
  "id": "w48",
  "nation": "Spagnoli",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w49",
  "nation": "Spagnoli",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w50",
  "nation": "Spagnoli",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia 2 monete per una risorsa a tua scelta"
 },
 {
  "id": "w51",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_coins",
   "amount": 3
  },
  "effectText": "Prendi tre monete"
 },
 {
  "id": "w52",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "sector",
    "value": "Chimica"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w53",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w54",
  "nation": "Spagnoli",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "coin_per_nation",
   "amount": 1
  },
  "effectText": "Prendi una moneta per ogni nazione diversa"
 },
 {
  "id": "w55",
  "nation": "Spagnoli",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w56",
  "nation": "Spagnoli",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w57",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "nation",
    "value": "Spagnoli"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w58",
  "nation": "Spagnoli",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w59",
  "nation": "Spagnoli",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w60",
  "nation": "Spagnoli",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "swap_res_3m"
  },
  "effectText": "Scambia una risorsa per 3 monete"
 },
 {
  "id": "w61",
  "nation": "Tedeschi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w62",
  "nation": "Tedeschi",
  "sector": "Chimica",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia 2 monete per una risorsa a tua scelta"
 },
 {
  "id": "w63",
  "nation": "Tedeschi",
  "sector": "Metallurgica",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una a tua scelta"
 },
 {
  "id": "w64",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "swap_res_any"
  },
  "effectText": "Scambia una risorsa per una risorsa a tua scelta"
 },
 {
  "id": "w65",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 2,
  "effect": {
   "type": "buy_res_2m"
  },
  "effectText": "Scambia due monete per una risorsa a tua scelta"
 },
 {
  "id": "w66",
  "nation": "Tedeschi",
  "sector": "Chimica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w67",
  "nation": "Tedeschi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "coin_per_nation",
   "amount": 1
  },
  "effectText": "Prendi una moneta per ogni nazione diversa"
 },
 {
  "id": "w68",
  "nation": "Tedeschi",
  "sector": "Metallurgica",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w69",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_coins",
   "amount": 3
  },
  "effectText": "Prendi tre monete"
 },
 {
  "id": "w70",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "sector",
    "value": "Tessile"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w71",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 3,
  "effect": {
   "type": "take_res"
  },
  "effectText": "Prendi questa risorsa"
 },
 {
  "id": "w72",
  "nation": "Tedeschi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 },
 {
  "id": "w73",
  "nation": "Tedeschi",
  "sector": "Chimica",
  "v": 4,
  "effect": {
   "type": "swap_res_3m"
  },
  "effectText": "Scambia una risorsa per 3 monete"
 },
 {
  "id": "w74",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "coins_per_icon",
   "amount": 2,
   "icon": {
    "kind": "nation",
    "value": "Tedeschi"
   }
  },
  "effectText": "Prendi due monete per ogni icona sulle carte lavoratore"
 },
 {
  "id": "w75",
  "nation": "Tedeschi",
  "sector": "Tessile",
  "v": 4,
  "effect": {
   "type": "res_per_tension"
  },
  "effectText": "Prendi una risorsa per livello di tensione di questo reparto"
 }
];

// Mazzo lavoratori "nuovo" (2.0, importato da editor carte esterno 15/07/2026): 6 nazioni (Greci nuova),
// 12 carte/nazione (4 per reparto). Stesso formato formula {verbo,f1,f2} del vecchio mazzo, nessuna legacy.
export const NEW_WORKERS = [
  // Greci
  { id: 'nw_gr1', nation: 'Greci', sector: 'Chimica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_gr2', nation: 'Greci', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_gr3', nation: 'Greci', sector: 'Chimica', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_gr4', nation: 'Greci', sector: 'Chimica', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_gr5', nation: 'Greci', sector: 'Tessile', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_gr6', nation: 'Greci', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_gr7', nation: 'Greci', sector: 'Tessile', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Metallurgica' } } },
  { id: 'nw_gr8', nation: 'Greci', sector: 'Tessile', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_gr9', nation: 'Greci', sector: 'Metallurgica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_gr10', nation: 'Greci', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_gr11', nation: 'Greci', sector: 'Metallurgica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'tensione' } } },
  { id: 'nw_gr12', nation: 'Greci', sector: 'Metallurgica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'icona', kind: 'sector', di: 'Chimica' } } },
  // Tedeschi
  { id: 'nw_te1', nation: 'Tedeschi', sector: 'Tessile', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_te2', nation: 'Tedeschi', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_te3', nation: 'Tedeschi', sector: 'Tessile', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_te4', nation: 'Tedeschi', sector: 'Tessile', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_te5', nation: 'Tedeschi', sector: 'Metallurgica', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_te6', nation: 'Tedeschi', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_te7', nation: 'Tedeschi', sector: 'Metallurgica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Metallurgica' } } },
  { id: 'nw_te8', nation: 'Tedeschi', sector: 'Metallurgica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_te9', nation: 'Tedeschi', sector: 'Chimica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_te10', nation: 'Tedeschi', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_te11', nation: 'Tedeschi', sector: 'Chimica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'tensione' } } },
  { id: 'nw_te12', nation: 'Tedeschi', sector: 'Chimica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'icona', kind: 'sector', di: 'Chimica' } } },
  // Polacchi
  { id: 'nw_po1', nation: 'Polacchi', sector: 'Chimica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_po2', nation: 'Polacchi', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_po3', nation: 'Polacchi', sector: 'Chimica', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_po4', nation: 'Polacchi', sector: 'Chimica', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_po5', nation: 'Polacchi', sector: 'Metallurgica', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_po6', nation: 'Polacchi', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_po7', nation: 'Polacchi', sector: 'Metallurgica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Metallurgica' } } },
  { id: 'nw_po8', nation: 'Polacchi', sector: 'Metallurgica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_po9', nation: 'Polacchi', sector: 'Tessile', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_po10', nation: 'Polacchi', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_po11', nation: 'Polacchi', sector: 'Tessile', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' }, f2: { conta: 'tensione' } } },
  { id: 'nw_po12', nation: 'Polacchi', sector: 'Tessile', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' }, f2: { conta: 'icona', kind: 'sector', di: 'Tessile' } } },
  // Spagnoli
  { id: 'nw_sp1', nation: 'Spagnoli', sector: 'Metallurgica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_sp2', nation: 'Spagnoli', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_sp3', nation: 'Spagnoli', sector: 'Metallurgica', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_sp4', nation: 'Spagnoli', sector: 'Metallurgica', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_sp5', nation: 'Spagnoli', sector: 'Chimica', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_sp6', nation: 'Spagnoli', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_sp7', nation: 'Spagnoli', sector: 'Chimica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Chimica' } } },
  { id: 'nw_sp8', nation: 'Spagnoli', sector: 'Chimica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_sp9', nation: 'Spagnoli', sector: 'Tessile', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_sp10', nation: 'Spagnoli', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_sp11', nation: 'Spagnoli', sector: 'Tessile', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' }, f2: { conta: 'tensione' } } },
  { id: 'nw_sp12', nation: 'Spagnoli', sector: 'Tessile', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' }, f2: { conta: 'icona', kind: 'sector', di: 'Tessile' } } },
  // Francesi
  { id: 'nw_fr1', nation: 'Francesi', sector: 'Tessile', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_fr2', nation: 'Francesi', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_fr3', nation: 'Francesi', sector: 'Tessile', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_fr4', nation: 'Francesi', sector: 'Tessile', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_fr5', nation: 'Francesi', sector: 'Chimica', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_fr6', nation: 'Francesi', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_fr7', nation: 'Francesi', sector: 'Chimica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Chimica' } } },
  { id: 'nw_fr8', nation: 'Francesi', sector: 'Chimica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_fr9', nation: 'Francesi', sector: 'Metallurgica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_fr10', nation: 'Francesi', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_fr11', nation: 'Francesi', sector: 'Metallurgica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' }, f2: { conta: 'tensione' } } },
  { id: 'nw_fr12', nation: 'Francesi', sector: 'Metallurgica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' }, f2: { conta: 'icona', kind: 'sector', di: 'Tessile' } } },
  // Italiani
  { id: 'nw_it1', nation: 'Italiani', sector: 'Metallurgica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_it2', nation: 'Italiani', sector: 'Metallurgica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Metallurgica' } } },
  { id: 'nw_it3', nation: 'Italiani', sector: 'Metallurgica', v: 3, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_it4', nation: 'Italiani', sector: 'Metallurgica', v: 4, effect: { verbo: 'scambia', f1: { q: 2, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 2, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_it5', nation: 'Italiani', sector: 'Tessile', v: 2, effect: { verbo: 'prendi', f1: { q: 2, tipo: 'moneta' } } },
  { id: 'nw_it6', nation: 'Italiani', sector: 'Tessile', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Tessile' } } },
  { id: 'nw_it7', nation: 'Italiani', sector: 'Tessile', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'icona', kind: 'sector', di: 'Tessile' } } },
  { id: 'nw_it8', nation: 'Italiani', sector: 'Tessile', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'moneta' }, f2: { conta: 'tensione' } } },
  { id: 'nw_it9', nation: 'Italiani', sector: 'Chimica', v: 2, effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } } },
  { id: 'nw_it10', nation: 'Italiani', sector: 'Chimica', v: 3, effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' } } },
  { id: 'nw_it11', nation: 'Italiani', sector: 'Chimica', v: 3, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'tensione' } } },
  { id: 'nw_it12', nation: 'Italiani', sector: 'Chimica', v: 4, effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'Chimica' }, f2: { conta: 'icona', kind: 'sector', di: 'Tessile' } } },
];

// 6ª nazione del mazzo nuovo (Grecia) — SOLO qui, il vecchio mazzo/NATIONS resta a 5 (scelta esplicita in sessione).
export const NATIONS_NUOVO = [...NATIONS, 'Greci'];
export const NATION_FLAGS_NUOVO = { ...NATION_FLAGS, Greci: '🇬🇷' };

// Impiegati (2.0, mazzo nuovo): carte Struttura Sopra per nazione — 1 disegno per nazione, 2 copie
// ciascuna (Copies:2 nell'export originale). Stesso meccanismo di doBuyStruttura('sopra'): al nodo
// Servizi, costo in marchi (qui 4, dalla colonna valore_potenza — sempre abbinata all'icona marchi_fondo.png
// in tutte le 12 righe), una volta installata avanza i 2 reparti indicati di card.power[settore].
// NB: valore_reparto_2 mancante nell'export per Spagnoli (Tessile) e Tedeschi (Chimica) — assunto 1 per
// coerenza con le altre 4 nazioni (pattern uniforme reparto_1:+3, reparto_2:+1 su tutte). Verificare col regolamento fisico.
// effect:'' — doBuyStruttura permette di installare QUALSIASI carta struttura anche lato 'sotto' (effetto
// passivo hire-1_X/freeSecond_X, stringa); gli Impiegati non hanno un lato sotto (solo potenza sopra), ma
// senza `effect` la stringa è undefined e effectNodes() crasha al primo giocatore che li installa sotto.
// Stringa vuota → nessun effetto (comportamento corretto: nessun bonus, invece di crash).
// 2 copie per disegno (Copies:2 nell'export originale, mercato non si rinfresca — vedi doBuyStruttura:
// una volta comprata una copia sparisce dal mercato per tutti, senza 2 copie il market si svuota subito con 4 giocatori).
const IMPIEGATI_UNICI = [
  // potenza 4/2 (era 3/1) — bump confermato da A/B 18/07/2026: milestone2 33%→56%, milestone3 5%→14%,
  // abbandono tracciato 40%→20%, nessun anticipo collaterale sugli slot lavoratore (turno 2°Sotto/3°Sopra invariati)
  { id: 'imp_it', nation: 'Italiani', cost: 4, power: { Chimica: 4, Metallurgica: 2 }, effect: '' },
  { id: 'imp_sp', nation: 'Spagnoli', cost: 4, power: { Chimica: 4, Tessile: 2 }, effect: '' }, // Tessile: assunto (dato mancante)
  { id: 'imp_gr', nation: 'Greci', cost: 4, power: { Metallurgica: 4, Tessile: 2 }, effect: '' },
  { id: 'imp_de', nation: 'Tedeschi', cost: 4, power: { Metallurgica: 4, Chimica: 2 }, effect: '' }, // Chimica: assunto (dato mancante)
  { id: 'imp_pl', nation: 'Polacchi', cost: 4, power: { Tessile: 4, Chimica: 2 }, effect: '' },
  { id: 'imp_fr', nation: 'Francesi', cost: 4, power: { Tessile: 4, Metallurgica: 2 }, effect: '' },
];
export const IMPIEGATI = IMPIEGATI_UNICI.flatMap(c => [1, 2].map(n => ({ ...c, id: `${c.id}_${n}` })));

// Mazzo nuovo (homebrew 15/07/2026): i 72 lavoratori NON sono più raggruppati per nazione nei banchi
// fisici — la nazione resta solo flavor sulla carta (obiettivi/flag), il banco fisico è un campo a
// parte (`deck`). `v` = costo in marchi (rinominato da `cost`, stesso campo letto da legalCommands/
// doHire per qualunque carta).
// Distribuzione: i 72 lavoratori ordinati per (V, tipo bonus) e distribuiti a rotazione in 5 mazzetti
// (A..E, ~14 carte ciascuno) — bilanciamento algoritmico di partenza, non manuale: verificare con le
// simulazioni e correggere se un mazzetto risulta sistematicamente più forte/debole (vedi editor).
const NEW_DECK_GROUPS = ['A', 'B', 'C', 'D', 'E'];
const VERB_RANK = { prendi: 0, scambia: 1, perOgni: 2 };
// I 12 Impiegati stanno in un mazzo a parte (non sparsi in A..E): mercato dedicato al nodo Servizi,
// IMPIEGATI_MARKET carte scoperte, mescolato a inizio partita. Restano carte "lavoratore" a tutti gli
// effetti (stesso `hire`, stesso WORKER_BY_ID): Sopra avanzano i 2 reparti di `power` invece di uno solo
// di `sector`+`v`, e placements() li ammette solo in Direzione Sopra.
export const IMPIEGATI_BANK = 'Impiegati';
export const IMPIEGATI_MARKET = 3;
export const NEW_WORKERS_MERGED = (() => {
  const impiegatiAsWorkers = IMPIEGATI.map(c => ({ id: c.id, nation: c.nation, v: c.cost, power: c.power, effect: c.effect, deck: IMPIEGATI_BANK }));
  const sorted = [...NEW_WORKERS].sort((a, b) => (a.v - b.v) || (VERB_RANK[a.effect.verbo] - VERB_RANK[b.effect.verbo]));
  return [...sorted.map((c, i) => ({ ...c, deck: NEW_DECK_GROUPS[i % 5] })), ...impiegatiAsWorkers];
})();
// nodo fisico → mazzetto: 1:1 (non più coppie di nazioni adiacenti, i 5 mazzetti sono già bilanciati).
// Sindacato ne ha due: il mazzetto E come gli altri nodi, più il mercato Impiegati (assunzione al Sindacato).
export const NEW_NODE_BANKS = { Tessile: ['A'], Metallurgica: ['B'], Chimica: ['C'], Servizi: ['D'], Sindacato: ['E', IMPIEGATI_BANK] };

export const WELFARE = [
 {
  "id": "wf1",
  "name": "Asilo operaio",
  "v": 5,
  "s1": "Chimica",
  "s2": "Tessile",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Chimica"
  ]
 },
 {
  "id": "wf2",
  "name": "Casa di ringhiera",
  "v": 5,
  "s1": "Chimica",
  "s2": "Metallurgica",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Chimica"
  ]
 },
 {
  "id": "wf3",
  "name": "Trasporto operaio",
  "v": 5,
  "s1": "Metallurgica",
  "s2": "Chimica",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Metallurgica"
  ]
 },
 {
  "id": "wf4",
  "name": "Infermeria di fabbrica",
  "v": 5,
  "s1": "Metallurgica",
  "s2": "Tessile",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Metallurgica"
  ]
 },
 {
  "id": "wf5",
  "name": "Mensa aziendale",
  "v": 5,
  "s1": "Tessile",
  "s2": "Metallurgica",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Tessile"
  ]
 },
 {
  "id": "wf6",
  "name": "Spaccio aziendale",
  "v": 5,
  "s1": "Tessile",
  "s2": "Chimica",
  "t1": 4,
  "t2": 2,
  "usesMax": 3,
  "perUse": [
   "Tessile"
  ]
 },
 {
  "id": "wf7",
  "name": "Camera del lavoro",
  "v": 7,
  "s1": "Chimica",
  "s2": "Metallurgica",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Chimica",
   "Metallurgica"
  ]
 },
 {
  "id": "wf8",
  "name": "Squadra di fabbrica",
  "v": 7,
  "s1": "Chimica",
  "s2": "Tessile",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Chimica",
   "Tessile"
  ]
 },
 {
  "id": "wf9",
  "name": "Orti operai",
  "v": 7,
  "s1": "Metallurgica",
  "s2": "Tessile",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Metallurgica",
   "Tessile"
  ]
 },
 {
  "id": "wf10",
  "name": "Banda musicale",
  "v": 7,
  "s1": "Metallurgica",
  "s2": "Chimica",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Metallurgica",
   "Chimica"
  ]
 },
 {
  "id": "wf11",
  "name": "Colonia estiva",
  "v": 7,
  "s1": "Tessile",
  "s2": "Metallurgica",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Tessile",
   "Metallurgica"
  ]
 },
 {
  "id": "wf12",
  "name": "Biblioteca popolare",
  "v": 7,
  "s1": "Tessile",
  "s2": "Chimica",
  "t1": 5,
  "t2": 3,
  "usesMax": 2,
  "perUse": [
   "Tessile",
   "Chimica"
  ]
 }
];

export const CONTRACTS = {
 "small": [
  { "id": "small1", "size": "small", "pv": [5, 3], "reqs": [["Tessile","Tessile","Metallurgica"]] },
  { "id": "small2", "size": "small", "pv": [5, 3], "reqs": [["Tessile","Tessile","Chimica"]] },
  { "id": "small3", "size": "small", "pv": [5, 3], "reqs": [["Tessile","Metallurgica","Metallurgica"]] },
  { "id": "small4", "size": "small", "pv": [5, 3], "reqs": [["Tessile","Metallurgica","Chimica"]] },
  { "id": "small5", "size": "small", "pv": [5, 3], "reqs": [["Tessile","Chimica","Chimica"]] },
  { "id": "small6", "size": "small", "pv": [5, 3], "reqs": [["Metallurgica","Metallurgica","Chimica"]] },
  { "id": "small7", "size": "small", "pv": [5, 3], "reqs": [["Metallurgica","Chimica","Chimica"]] }
 ],
 "medium": [
  { "id": "medium1", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Tessile","Tessile","Metallurgica","Chimica"]] },
  { "id": "medium2", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Tessile","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "medium3", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Tessile","Metallurgica","Chimica","Chimica"]] },
  { "id": "medium4", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Metallurgica","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "medium5", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Metallurgica","Metallurgica","Chimica","Chimica"]] },
  { "id": "medium6", "size": "medium", "pv": [9, 7], "reqs": [["Tessile","Metallurgica","Chimica","Chimica","Chimica"]] }
 ],
 "large": [
  { "id": "large1", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Tessile","Tessile","Metallurgica","Chimica"]] },
  { "id": "large2", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Tessile","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "large3", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Tessile","Metallurgica","Chimica","Chimica"]] },
  { "id": "large4", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Metallurgica","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "large5", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Metallurgica","Metallurgica","Chimica","Chimica"]] },
  { "id": "large6", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Tessile","Metallurgica","Chimica","Chimica","Chimica"]] },
  { "id": "large7", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Metallurgica","Metallurgica","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "large8", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Metallurgica","Metallurgica","Metallurgica","Chimica","Chimica"]] },
  { "id": "large9", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Metallurgica","Metallurgica","Chimica","Chimica","Chimica"]] },
  { "id": "large10", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Tessile","Metallurgica","Chimica","Chimica","Chimica","Chimica"]] },
  { "id": "large11", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Metallurgica","Metallurgica","Metallurgica","Metallurgica","Metallurgica","Chimica"]] },
  { "id": "large12", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Metallurgica","Metallurgica","Metallurgica","Metallurgica","Chimica","Chimica"]] },
  { "id": "large13", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Metallurgica","Metallurgica","Metallurgica","Chimica","Chimica","Chimica"]] },
  { "id": "large14", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Metallurgica","Metallurgica","Chimica","Chimica","Chimica","Chimica"]] },
  { "id": "large15", "size": "large", "pv": [15, 13], "reqs": [["Tessile","Metallurgica","Chimica","Chimica","Chimica","Chimica","Chimica"]] }
 ],
};

export const OBJECTIVE_TILES = [
 {
  "id": "pf1",
  "name": "Piano 1",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Italiani",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf2",
  "name": "Piano 2",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Italiani",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf3",
  "name": "Piano 3",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Italiani",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf4",
  "name": "Piano 4",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Italiani",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf5",
  "name": "Piano 5",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Italiani",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 },
 {
  "id": "pf6",
  "name": "Piano 6",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Spagnoli",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf7",
  "name": "Piano 7",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Spagnoli",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf8",
  "name": "Piano 8",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Spagnoli",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf9",
  "name": "Piano 9",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Spagnoli",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf10",
  "name": "Piano 10",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Spagnoli",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 },
 {
  "id": "pf11",
  "name": "Piano 11",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Francesi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf12",
  "name": "Piano 12",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Francesi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf13",
  "name": "Piano 13",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Francesi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf14",
  "name": "Piano 14",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Francesi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf15",
  "name": "Piano 15",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Francesi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 },
 {
  "id": "pf16",
  "name": "Piano 16",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Tedeschi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf17",
  "name": "Piano 17",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Tedeschi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf18",
  "name": "Piano 18",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Tedeschi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf19",
  "name": "Piano 19",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Tedeschi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf20",
  "name": "Piano 20",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Tedeschi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 },
 {
  "id": "pf21",
  "name": "Piano 21",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Polacchi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf22",
  "name": "Piano 22",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Polacchi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf23",
  "name": "Piano 23",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Polacchi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf24",
  "name": "Piano 24",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Polacchi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf25",
  "name": "Piano 25",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Polacchi",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 },
 {
  "id": "pf26",
  "name": "Piano 26",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Greci",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Tessile"
    }
   }
  ]
 },
 {
  "id": "pf27",
  "name": "Piano 27",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Greci",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Metallurgica"
    }
   }
  ]
 },
 {
  "id": "pf28",
  "name": "Piano 28",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Greci",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "sector_leader",
     "sector": "Chimica"
    }
   }
  ]
 },
 {
  "id": "pf29",
  "name": "Piano 29",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Greci",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "direzione_full",
     "sopra": 3,
     "sotto": 0
    }
   }
  ]
 },
 {
  "id": "pf30",
  "name": "Piano 30",
  "objectives": [
   {
    "pv": 7,
    "cond": {
     "type": "workers_nation",
     "nation": "Greci",
     "n": 4
    }
   },
   {
    "pv": 7,
    "cond": {
     "type": "full_dept",
     "sopra": 3,
     "sotto": 2,
     "minCount": 2
    }
   }
  ]
 }
];
