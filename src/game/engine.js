// Engine di Officina 1907 — regole dal regolamento giocatore + plance 26.
// Stato immutabile: ogni comando restituisce un nuovo stato (clone profondo).
import {
  SECTORS, RESOURCE_OF, NATIONS, NODES, NODE_BANKS, BOARDS, ROLE_SLOTS_SOPRA,
  TRACKS, SETUP, STARTING_COINS, TENSION_LIMIT,
  CLOCK_THRESHOLD, CLOCK_REFRESH, MOVE_COSTS, MAX_CONTRACTS_PER_VISIT,
  DIREZIONE_MAX, UNBLOCK_COST, WORKERS, WELFARE, CONTRACTS, CONTRACT_COPIES, OBJECTIVE_TILES,
  TRACK_TILES, TRACK_TILE_CAP_DEFAULT, IMPIEGATI_BANK, IMPIEGATI_MARKET,
  BORSA_INDICI_DEFAULT, BORSA_FABBRICHE_DEFAULT, FACTORY_MAP, DEFAULT_FACTORY_MAPS,
} from './data.js';

const STRIKE_PENALTY_PV = 3; // penalità PV di default per ogni carta bloccata (Sciopero) a fine partita

// Azioni della Trattativa. resetOwn + attackOther sono un blocco unico sempre attivo; unblock è opzionale.
// Nessun requisito di Impiegati: le azioni gatate sono state rimosse dal design.
const TRATTATIVA_DEFAULT = {
  resetOwn:    { enabled: true, cost: 0 },              // azzera la propria Tensione
  attackOther: { enabled: true, cost: 0 },              // +1 Tensione a un avversario
  unblock:     { enabled: true, cost: UNBLOCK_COST },   // libera una carta bloccata
};
function mergeTrattativa(cfg) {
  const out = {};
  for (const k of Object.keys(TRATTATIVA_DEFAULT)) out[k] = { ...TRATTATIVA_DEFAULT[k], ...(cfg?.[k] || {}) };
  return out;
}

// Config di default delle azioni Borsa: sell = risorsa→marchi, convert = risorsa→risorsa a scelta.
const BORSA_DEFAULT = {
  sell:      { enabled: true, give: 1, get: 3 },
  convert:   { enabled: true, give: 2, get: 1 },
};
function mergeBorsa(cfg) {
  const out = {};
  for (const k of Object.keys(BORSA_DEFAULT)) out[k] = { ...BORSA_DEFAULT[k], ...(cfg?.[k] || {}) };
  return out;
}

// Alternativa a "entrare nelle Commesse": uscire con un bonus fisso, e/o rinfrescare un mercato a scelta.
// Non fanno parte del regolamento base (omesse volutamente da BORSA_DEFAULT: shape diversa da give/get,
// romperebbero il loop generico in borsaCommands) — mutuamente esclusive con completare Commesse nella
// stessa visita (vedi state.borsaExitUsed/borsaRefreshUsed, azzerati in startTurn).
const BORSA_EXIT_DEFAULT = { enabled: true, coins: 3 };
const BORSA_REFRESH_DEFAULT = { enabled: true };
function mergeBorsaExit(cfg) { return { ...BORSA_EXIT_DEFAULT, ...(cfg || {}) }; }
function mergeBorsaRefresh(cfg) { return { ...BORSA_REFRESH_DEFAULT, ...(cfg || {}) }; }

// Modalità scambi Borsa: 'illimitati' (default, comportamento storico, tariffe base+M1+M2 come sopra) oppure

// ===== Borsa a indici (17/07/2026) =====
// 4 indici (3 settori + Sindacato) salgono durante la partita. A ogni chiusura di quadrimestre si
// classificano, e ogni indice paga la sua casella DIVISA per il numero di GIOCATORI che ci hanno investito
// (non per azioni: una sola azione per indice per quadrimestre, comprarne due non farebbe nulla).
// L'azione è un biglietto one-shot: vale solo per il quadrimestre in cui la compri.
// Si compra al nodo id 'Servizi' (= "Borsa" a schermo, vedi NODE_LABEL).
function mergeBorsaIndici(cfg) {
  const m = { ...BORSA_INDICI_DEFAULT, ...(cfg || {}) };
  // gli array vanno sostituiti, non fusi: un merge superficiale terrebbe la coda del default
  m.quadBounds = (cfg?.quadBounds || BORSA_INDICI_DEFAULT.quadBounds).slice();
  m.prices = (cfg?.prices || BORSA_INDICI_DEFAULT.prices).slice();
  m.cells = (cfg?.cells || BORSA_INDICI_DEFAULT.cells).map(r => r.slice());
  return m;
}

// Nomi degli indici in gioco, nell'ordine che rompe i pari-merito (chi viene prima vince il tie).
export function indexNames(state) {
  const base = [...SECTORS];
  return state.borsaIndici.unionDriver === 'nessuno' ? base : [...base, 'Sindacato'];
}

// Valore corrente di un indice. Due famiglie di driver:
//  - a contatore (state.indexCount): un evento lo incrementa (attivazioni/milestone/trattative/scioperi)
//  - derivati: calcolati dallo stato al volo (posizioni/carte/tensione) — niente contatore da tenere in sync
export function indexValue(state, name) {
  const B = state.borsaIndici;
  if (name === 'Sindacato') {
    if (B.unionDriver === 'tensione') {
      return state.players.reduce((a, p) => a + DEPT_ROLES.reduce((b, r) => b + p.depts[r].tension, 0), 0);
    }
    return state.indexCount.Sindacato || 0; // trattative | scioperi (stesso contatore, lo alimenta un evento diverso)
  }
  switch (B.sectorDriver) {
    case 'posizioni': return state.players.reduce((a, p) => a + (deptOfSector(p, name)?.prod || 0), 0);
    case 'carte':     return state.players.reduce((a, p) => a + iconCount(p, name, state.welfareById), 0);
    default:          return state.indexCount[name] || 0; // attivazioni | milestone
  }
}

// Classifica: dal più alto al più basso. Pari-merito rotto dall'ordine di indexNames (deterministico).
export function rankedIndices(state) {
  const names = indexNames(state);
  return [...names].sort((a, b) => indexValue(state, b) - indexValue(state, a) || names.indexOf(a) - names.indexOf(b));
}

// Casella che un indice pagherebbe SE il quadrimestre chiudesse ora (rango attuale).
export function cellNow(state, name, quad = state.quad) {
  const row = state.borsaIndici.cells[quad] || [];
  return row[rankedIndices(state).indexOf(name)] ?? 0;
}

// Dividendo atteso entrando ORA su un indice: casella ÷ (investitori attuali + me).
// Formula vera letta dallo stato, non una costante euristica: è ciò che l'IA userà per decidere.
export function expectedDividend(state, name, alreadyIn) {
  const investors = state.players.filter(p => p.shares[name]).length + (alreadyIn ? 0 : 1);
  if (!investors) return 0;
  const raw = cellNow(state, name) / investors;
  return state.borsaIndici.rounding === 'exact' ? raw : Math.floor(raw);
}

// Alimenta i driver a contatore. `kind` = l'evento appena avvenuto; l'indice sale solo se è il driver scelto
// nella config. I driver derivati (posizioni/carte/tensione) ignorano questa via: li legge indexValue().
function noteIndexEvent(state, kind, name) {
  const B = state.borsaIndici;
  if (!B?.enabled) return;
  if (name === 'Sindacato') { if (B.unionDriver === kind) state.indexCount.Sindacato += 1; return; }
  if (B.sectorDriver === kind) state.indexCount[name] = (state.indexCount[name] || 0) + 1;
}

function payoutQuad(state) {
  const B = state.borsaIndici;
  const ranked = rankedIndices(state);
  const row = B.cells[state.quad] || [];
  ranked.forEach((name, rank) => {
    const cell = row[rank] ?? 0;
    const investors = state.players.filter(p => p.shares[name]);
    if (!cell || !investors.length) return;
    const raw = cell / investors.length;
    const pv = B.rounding === 'exact' ? raw : Math.floor(raw);
    for (const p of investors) {
      p.pvBorsa += pv;
      p.borsaLog.push({ quad: state.quad, index: name, rank, cell, investors: investors.length, pv, turn: state.turn });
    }
    log(state, `Borsa Q${state.quad + 1}: ${name} chiude ${rank + 1}° (indice ${indexValue(state, name)}) — casella ${cell} ÷ ${investors.length} investitori = ${pv} PV a ${investors.map(p => p.name).join(', ')}.`);
  });
  for (const p of state.players) p.shares = {}; // il biglietto vale solo per il quadrimestre appena chiuso
}

// ===== Borsa a fabbriche (18/07/2026) — sostituisce gli indici quando enabled =====
function mergeBorsaFabbriche(cfg) {
  const m = { ...BORSA_FABBRICHE_DEFAULT, ...(cfg || {}) };
  m.costCurve = (cfg?.costCurve || BORSA_FABBRICHE_DEFAULT.costCurve).slice();
  return m;
}
export function factoryIslands(nPlayers) { return nPlayers <= 2 ? ['R'] : ['L', 'R']; }
// costo della prossima fabbrica per un giocatore (curva a scalare, indicizzata sulle fabbriche già possedute)
export function factoryCost(state, p) {
  const curve = state.borsaFabbriche.costCurve;
  return curve[Math.min(p.factories.length, curve.length - 1)];
}
// assegna un colore alle 9 (o meno, in 2p) caselle-risorsa sulle isole attive
function setupFactoryResources(state, rnd) {
  const F = state.borsaFabbriche;
  const M = state.factoryMap; // mappa già scelta per numero giocatori: tutti gli esagoni sono attivi
  state.factoryHexById = Object.fromEntries(M.hexes.map(h => [h.id, h]));
  state.factoryHexes = M.hexes.map(h => h.id);
  state.hexResource = {};   // id risorsa → settore
  state.hexFactory = {};    // id costruibile → { playerId, sector }
  const resHexes = shuffled(M.hexes.filter(h => h.type === 'risorsa').map(h => h.id), rnd);
  let colors;
  if (F.setupBalance === 'random') {
    colors = resHexes.map(() => SECTORS[Math.floor(rnd() * SECTORS.length)]);
  } else {
    // bilanciato: almeno `per` di ogni colore (per = 3 con ≥9 risorse, altrimenti il max possibile),
    // poi il resto random, poi POSIZIONI casuali (shuffle). Niente maggioranze di colore.
    const per = Math.min(3, Math.floor(resHexes.length / SECTORS.length));
    colors = [];
    for (const s of SECTORS) for (let i = 0; i < per; i++) colors.push(s);
    while (colors.length < resHexes.length) colors.push(SECTORS[Math.floor(rnd() * SECTORS.length)]);
    colors = shuffled(colors, rnd);
  }
  resHexes.forEach((id, i) => { state.hexResource[id] = colors[i]; });
}
// esagoni costruibili dove il giocatore può fondare una fabbrica di settore `sector`:
// vuoti, sull'isola attiva, adiacenti a una risorsa dello stesso colore (ancoraggio condiviso: la risorsa non si consuma)
function factoryBuildSpots(state, sector) {
  const out = [];
  const neutral = state.borsaFabbriche?.neutralFactory;
  for (const id of state.factoryHexes) {
    const h = state.factoryHexById[id];
    if (h.type !== 'costruibile' || state.hexFactory[id]) continue;
    // neutra: basta essere adiacente a UNA risorsa qualsiasi; legacy: allo stesso colore del settore
    const anchored = (state.factoryMap.adj[id] || []).some(n => neutral ? state.hexResource[n] : state.hexResource[n] === sector);
    if (anchored) out.push(id);
  }
  return out;
}
// colori delle risorse adiacenti a un sito (per la risorsa immediata neutra e per l'IA)
function adjacentSectors(state, hex) {
  const set = new Set();
  for (const n of (state.factoryMap.adj[hex] || [])) if (state.hexResource[n]) set.add(state.hexResource[n]);
  return [...set];
}
// settori per cui il giocatore ha un credito (milestone raggiunta) E almeno un posto libero E i marchi
function factoryBuildableSectors(state, p) {
  if (!state.borsaFabbriche.enabled) return [];
  if (p.coins < factoryCost(state, p)) return [];
  // neutra: nessun gate di settore. Con milestoneGate ON serve un credito-milestone non speso (generico):
  // creditiGuadagnati (ogni milestone attraversata, qualsiasi reparto) > fabbriche già costruite.
  if (state.borsaFabbriche.neutralFactory) {
    if (state.borsaFabbriche.milestoneGate && p.factoryCreditsEarned <= p.factories.length) return [];
    return factoryBuildSpots(state, null).length ? [null] : [];
  }
  return SECTORS.filter(s => (p.factoryCredits[s] || 0) > 0 && factoryBuildSpots(state, s).length > 0);
}

// Chiude ogni quadrimestre la cui soglia di Clock è stata superata (un solo avanzamento può chiuderne più d'uno).
function checkQuadClose(state) {
  if (!state.borsaIndici.enabled) return;
  const B = state.borsaIndici;
  while (state.quad < B.cells.length && state.clock >= (B.quadBounds[state.quad] ?? Infinity)) {
    payoutQuad(state);
    state.quad += 1;
  }
}

// Slot per reparto (Sopra/Sotto) + Direzione. Default = regole attuali (3 Sopra, 2 Sotto; Direzione 3/2).
const SLOTS_DEFAULT = {
  terziario:  { sopra: 3, sotto: 2 },
  secondario: { sopra: 3, sotto: 2 },
  primario:   { sopra: 3, sotto: 2 },
  direzione:  { sopra: 3, sotto: 0 },
};
function mergeSlots(cfg) {
  const out = {};
  for (const k of Object.keys(SLOTS_DEFAULT)) out[k] = { ...SLOTS_DEFAULT[k], ...(cfg?.[k] || {}) };
  return out;
}

// ---------- RNG deterministico (mulberry32) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const WORKER_BY_ID = Object.fromEntries(WORKERS.map(w => [w.id, w]));
export const WELFARE_BY_ID = Object.fromEntries(WELFARE.map(w => [w.id, w]));

const DEPT_ROLES = ['terziario', 'secondario', 'primario'];
const WELFARE_MARKET = 3; // carte Welfare/Macchinari scoperte al nodo Servizi (mazzo mescolato, refresh all'acquisto)

// Quante carte di un banco sono scoperte/comprabili. I banchi lavoratori mostrano solo la cima (1);
// il mercato Impiegati al nodo Sindacato ne mostra IMPIEGATI_MARKET. Comprarne una la toglie dalla pila,
// così la successiva è scoperta da sola: il "refill" del mercato è la pila stessa, nessun array separato.
const bankDepth = bank => (bank === IMPIEGATI_BANK ? IMPIEGATI_MARKET : 1);
// carte comprabili adesso da un banco (vuoto se esaurito) — usata anche da ai/UI/batchsim.
export const bankMarket = (state, bank) => state.banks[bank].slice(0, bankDepth(bank));
const MAX_ROUNDS = 80; // ponytail: cap di sicurezza, una partita normale dura ~24 round; termina config bloccate
const PLAYER_COLORS = ['#c0392b', '#2471a3', '#1e8449', '#b7950b'];

// ---------- Setup ----------
export function initGame(config) {
  // config: { seed, players: [{ name, isAI, boardId|null }] }
  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = mulberry32(seed);
  const n = config.players.length;
  if (n < 2 || n > 4) throw new Error('2-4 giocatori');

  // plance: scelte o assegnate a caso senza doppioni
  const taken = new Set(config.players.map(p => p.boardId).filter(Boolean));
  const free = shuffled(BOARDS.filter(b => !taken.has(b.id)), rnd);
  // Tessere Piano Industriale: editabili via config.tiles (testo/PV/condizione obiettivi), altrimenti default OBJECTIVE_TILES.
  const tileDeck = (config.tiles && config.tiles.length) ? config.tiles : OBJECTIVE_TILES;
  // config.forcedTile/forcedSeat: per il "Ricalcola" dell'editor — forza una tessera su un posto fisso invece di pescarla a caso,
  // così ogni partita del batch osserva quella tessera (altrimenti servirebbero ~8× le partite per lo stesso campione).
  const tiles = shuffled(config.forcedTile ? tileDeck.filter(t => t.id !== config.forcedTile.id) : tileDeck, rnd);

  const players = config.players.map((pc, i) => {
    const board = BOARDS.find(b => b.id === pc.boardId) || free.pop();
    const depts = {};
    for (const role of DEPT_ROLES) {
      depts[role] = {
        role, sector: board[role],
        sopra: [], sotto: [], blocked: [],
        prod: SETUP[role].prod, tension: config.startTension?.[role] ?? SETUP[role].tension,
        slotTurn: { sopra: [null, null, null], sotto: [null, null] }, // turno di riempimento di ogni slot (autopsia accelerazione)
        tileFills: {}, // pos → id tile acquistata dal mercato (7/11/15), sostituisce la cella del template per questo giocatore
      };
    }
    const resources = { Tessuti: 0, Acciaio: 0, Coloranti: 0 };
    return {
      id: i, name: pc.name || `Giocatore ${i + 1}`, isAI: !!pc.isAI,
      personality: pc.personality || 'neutro', // profilo AI (vedi PROFILES in ai.js)
      color: PLAYER_COLORS[i], boardId: board.id, boardName: board.name,
      coins: (config.startingCoins || STARTING_COINS)[i], resources,
      coinsStart: (config.startingCoins || STARTING_COINS)[i], // per derivare i marchi spesi = start + guadagnati − finali
      coinsGained: 0,             // marchi guadagnati durante la partita (funnel addCoins)
      // da dove nascono i marchi. bonus = SOLO effetti carte lavoratore (dept.sotto), splittati per tipo:
      // lavFisso=«prendi N monete» · lavNazioni=marchi×nazionalità · lavIcone=marchi×icona · lavTensione=marchi×tensione
      coinsGainedBy: { ...Object.fromEntries(SECTORS.map(s => [s, 0])), tracciati: 0, lavFisso: 0, lavNazioni: 0, lavIcone: 0, lavTensione: 0, lavFabbrica: 0, scambio: 0, trackTile: 0 },
      coinsSpentBy: { lavoratori: 0, direzione: 0, sindacato: 0, borsa: 0, movimento: 0, azioni: 0 }, // dove sono finiti i marchi
      shares: {},      // Borsa a indici: { [indice]: true } per il quadrimestre CORRENTE (azzerato a ogni chiusura)
      // Borsa a fabbriche: credito per settore (una milestone = una fabbrica di quel settore) + fabbriche possedute
      factoryCredits: { ...Object.fromEntries(SECTORS.map(s => [s, 0])) },
      factoryCreditsEarned: 0, // milestone attraversate totali = crediti guadagnati (per il tasso "guadagnati vs costruiti")
      factories: [],   // { hex, sector, turn }
      // valore dalle carte Sotto: passata base (1×) vs passate EXTRA da factoryActivates (2ª/3ª). Per misurare
      // l'IMPATTO del moltiplicatore, non solo la frequenza: quanto del valore Sotto nasce dalle attivazioni-fabbrica.
      sottoVal: { baseC: 0, baseR: 0, extraC: 0, extraR: 0 },
      pvBorsa: 0,      // PV incassati dai dividendi
      borsaLog: [],    // {quad, index, rank, cell, investors, pv, turn} per ogni dividendo riscosso
      // {turn, quad, index, rankAtBuy, valueAtBuy, investorsAtBuy, price, coinsBefore, nFree} per ogni acquisto.
      // rankAtBuy serve a confrontarlo col rango alla CHIUSURA: se non cambia mai, comprare non è una
      // scommessa ma una lettura di una classifica già decisa — e il dilemma del design non esiste.
      borsaBuys: [],
      lastHireTurn: 0, lastDirTurn: 0, // turno dell'ultima carta installata (reparto / Direzione) — #3 tempo di costruzione
      firstMachineTurn: null, // turno del gate Borsa: quando installa il 1° Macchinario (mai = null)
      resToContracts: 0, // risorse spese specificamente per completare commesse (vs prodotte)
      node: 'Borsa', prevNode: null,
      depts,
      direzione: { sopra: [], sotto: [], slotTurn: { sopra: [null, null], sotto: [null, null] } }, // sotto: [{id, usesLeft}]
      tile: (config.forcedTile && i === (config.forcedSeat ?? 0)) ? config.forcedTile : tiles.pop(),
      achieved: [false, false, false],
      contractsWon: [], // {cardId, size, place(0|1), pv}
      maxActivationCoins: 0,
      activations: 0,             // quante volte ha usato "Attiva reparto"
      activationsBySector: Object.fromEntries(SECTORS.map(s => [s, 0])), // attivazioni per settore/reparto
      tensionReductions: 0,       // quante volte ha abbassato la Tensione al Sindacato (Trattativa fase 3)
      sindacato: { trattative: 0, unblock: 0 }, // sotto-azioni Trattativa
      strikesByOpponent: 0,       // scioperi subiti in un reparto causati da un altro giocatore (attacco Trattativa)
      nodeVisits: Object.fromEntries(NODES.map(nd => [nd, 0])), // quante volte ha visitato ogni nodo
      coinsHistory: [],           // marchi a fine di ogni proprio turno
      resHistory: [],             // risorse totali a fine di ogni proprio turno
      resGen: Object.fromEntries(SECTORS.map(s => [s, 0])),   // risorse prodotte per settore (via addRes)
      resSpent: Object.fromEntries(SECTORS.map(s => [s, 0])), // risorse consumate per settore (commesse/conversioni/vendite)
      resGainedBy: { produzione: 0, tracciati: 0, macchinari: 0, bonus: 0, acquisto: 0, scambio: 0, trackTile: 0, fabbrica: 0 }, // da dove nascono le risorse
      resSpentByCat: { commesse: 0, vendita: 0, scambio: 0, tile: 0 }, // dove finiscono le risorse (residuo = in mano a fine)
      convCount: { risorsaRisorsa: 0, marchiRisorsa: 0, risorsaMarchi: 0 }, // quante volte avviene ogni tipo di conversione (non l'ammontare, l'evento)
      convAttempts: { risorsaRisorsa: 0, marchiRisorsa: 0, risorsaMarchi: 0 }, // quante volte una carta 'scambia' era in gioco al momento dell'attivazione (usata o no)
      struttura: [],              // effetti passivi delle carte struttura possedute (modalità 'struttura')
      tileGains: {},              // valore reale prodotto da ogni tile tracciato acquistata: {tileId: {coins, res, uses}}
    };
  });

  // carte Lavoratore: editabili via config.workers (V, settore, nazionalità, formula effetto), altrimenti default WORKERS.
  // ponytail: WORKER_BY_ID è globale, ricostruito a ogni initGame — ok perché le partite girano in SEQUENZA (batch e UI).
  // Se un giorno gireranno in parallelo, spostare in state.workerById come welfareById.
  const workerDeck = (config.workers && config.workers.length) ? config.workers : WORKERS;
  for (const k in WORKER_BY_ID) delete WORKER_BY_ID[k];
  for (const w of workerDeck) WORKER_BY_ID[w.id] = w;
  // nazioni in gioco: editabile via config.nations (mazzo nuovo aggiunge Greci) — SOLO flavor/obiettivi
  // (countNation/distinctNations leggono w.nation direttamente, mai questa lista). Non è la stessa cosa
  // del raggruppamento fisico carta→banco: quello usa nodeBanks/w.deck, vedi sotto.
  const nations = (config.nations && config.nations.length) ? config.nations : NATIONS;
  // banchi fisici: nodo→id-banco editabile via config.nodeBanks (mazzo nuovo: 5 mazzetti bilanciati,
  // non più a coppie di nazioni adiacenti). Il banco raggruppa le carte per w.deck se presente, altrimenti
  // per w.nation (vecchio mazzo, comportamento identico a prima — nessun campo `deck` sulle vecchie carte).
  const nodeBanks = (config.nodeBanks && Object.keys(config.nodeBanks).length) ? config.nodeBanks : NODE_BANKS;
  const bankIds = [...new Set(Object.values(nodeBanks).flat())];
  const banks = {};
  for (const id of bankIds) {
    banks[id] = shuffled(workerDeck.filter(w => (w.deck ?? w.nation) === id).map(w => w.id), rnd);
  }
  // carte Welfare/Macchinari: editabili via config.welfare, altrimenti default WELFARE.
  // Mazzo mescolato, WELFARE_MARKET carte scoperte a inizio partita; refresh dal mazzo a ogni acquisto.
  const welfareDeck = (config.welfare && config.welfare.length) ? config.welfare : WELFARE;
  // ogni carta entra nel mazzo in `copies` copie (default 2 → 12 carte uniche = 24 nel mazzo; 0 = esclusa)
  const welfareShuffled = shuffled(welfareDeck.flatMap(w => Array(Math.max(0, Math.min(9, w.copies ?? 2))).fill(w.id)), rnd);

  // Commesse: mazzo per taglia (quante commesse in gioco) + mercato scoperto (rifresca a completamento).
  // config.contractPV[size]=[pv1,pv2] (single-place usa pv1); config.contractCount[size]=carte nel mazzo;
  // config.contractMarket = carte scoperte per taglia (regolamento v2: 2 per taglia = 6 in tutto).
  const contracts = {};
  const marketSize = config.singlePlace ? Math.max(1, config.contractMarket ?? 2) : 1;
  for (const size of ['small', 'medium', 'large']) {
    const pv = config.contractPV?.[size];
    // Ogni carta canonica ha 2 commesse (reqs[0], reqs[1]): le dividiamo in 2 carte da 1 commessa.
    const split = [];
    for (const c of CONTRACTS[size]) {
      c.reqs.forEach((req, k) => {
        split.push({ id: `${c.id}${k === 0 ? 'a' : 'b'}`, size, pv: pv ? [...pv] : [...c.pv], reqs: [req] });
      });
    }
    // Pool = ogni combo in CONTRACT_COPIES[size] copie (piccole/medie ×2, grandi ×1), id univoco.
    const copies = CONTRACT_COPIES[size] || 1;
    const pool = [];
    for (let cp = 0; cp < copies; cp++) for (const card of split) pool.push({ ...card, id: `${card.id}_${cp}` });
    // Mescola il pool ed estrai N carte (contractCount) per formare il mazzo di gioco.
    let deck = shuffled(pool, rnd);
    const wanted = config.contractCount?.[size];
    if (wanted != null) deck = deck.slice(0, Math.max(marketSize, wanted));
    const nSlots = Math.min(marketSize, deck.length);
    contracts[size] = { deck, active: Array.from({ length: nSlots }, () => makeContractSlot(deck)) };
  }

  // tracciati personalizzati (editor) o default; milestone calcolata dalla cella.
  // Con più celle {milestone:true} sullo stesso template (2.0: 3 milestone di mercato), milestonePos
  // resta la PRIMA — è quella che storicamente segnala "reparto sviluppato" per contractMilestoneReq/
  // milestoneCount/condizioni obiettivo (soglia pre-2.0 ~C12-13 su tracciato più corto); le altre 2
  // sono solo i gate dei mercati 2/3 (vedi marketUnlockPos sotto).
  const tracks = structuredClone(config.tracks || TRACKS);
  // lunghezza del tracciato dal template stesso (16 = modello classico, 12 = modello unito):
  // niente costante globale, così i due modelli convivono nella stessa build.
  const trackMax = Math.max(...DEPT_ROLES.map(r => tracks[r].length - 1));
  const milestonePos = {};
  const marketUnlockPos = {};
  const tileSlotPos = {};
  for (const role of DEPT_ROLES) {
    const track = tracks[role];
    let first = -1;
    marketUnlockPos[role] = {};
    tileSlotPos[role] = {};
    track.forEach((c, i) => {
      if (!c) return;
      if (c.milestone && first < 0) first = i;
      if (c.opensMarket) marketUnlockPos[role][c.opensMarket] = i;
      if (c.tileSlot) tileSlotPos[role][c.tileSlot] = i;
    });
    milestonePos[role] = first > 0 ? first : Infinity;
  }
  const trackTileDeck = (config.trackTiles && config.trackTiles.length) ? config.trackTiles : TRACK_TILES;
  const trackTileById = Object.fromEntries(trackTileDeck.map(t => [t.id, t]));
  const trackTileCap = { ...TRACK_TILE_CAP_DEFAULT, ...(config.trackTileCap || {}) };
  // pool condiviso (mode:'limitato'): copie residue per tile, consumate a ogni acquisto da QUALSIASI giocatore —
  // ma tenuto PER REPARTO (stesso catalogo, 3 mercati/scorte indipendenti: esaurire una tile in Tessile
  // non tocca la copia di Metallurgica/Chimica). In mode:'illimitato' (default) resta inerte.
  const trackTileStock = {};
  for (const role of DEPT_ROLES) trackTileStock[role] = Object.fromEntries(trackTileDeck.map(t => [t.id, t.copies ?? Infinity]));

  const state = {
    seed, nPlayers: n,
    headless: !!config.headless, // true nei batch: disattiva il log di partita
    // coinsRepeat: true = le caselle marchi riproducono a ogni attivazione (default);
    // false = variante "marchi solo all'attraversamento" (le caselle risorsa riproducono comunque)
    rules: {
      coinsRepeat: config.coinsRepeat !== false,
      // conversioni di fine partita: N marchi → 1 PV, N risorse uguali → 1 PV
      coinsPerPV: Math.max(1, config.conversions?.coinsPerPV ?? 10),
      resPerPV: Math.max(1, config.conversions?.resPerPV ?? 2),
    },
    tracks, trackMax, milestonePos, marketUnlockPos, tileSlotPos, trackTileById, trackTileCap, trackTileStock,
    nations, nodeBanks, bankIds, players, banks,
    welfareMarket: welfareShuffled.slice(0, WELFARE_MARKET),  // carte scoperte comprabili
    welfareDrawPile: welfareShuffled.slice(WELFARE_MARKET),   // mazzo coperto, rifornisce il mercato
    welfareById: Object.fromEntries(welfareDeck.map(w => [w.id, w])), // carte Welfare/Macchinari editabili (config.welfare)
    contracts,
    clock: 0,
    // Clock sale solo completando commesse: se il mazzo totale è < soglia, la partita non finirebbe mai.
    // Cappa la soglia al numero di commesse esistenti così la partita termina comunque.
    clockThreshold: Math.min(
      config.clockThreshold?.[n] ?? CLOCK_THRESHOLD[n], // editabile per numero giocatori (durata partita)
      Object.values(contracts).reduce((s, c) => s + c.deck.length + c.active.length, 0)
    ),
    endOnTrigger: !!config.endOnTrigger, // true: partita finisce col giocatore che scatta il trigger, senza chiudere il giro
    rotateStart: !!config.rotateStart,   // true: il primo giocatore ruota a ogni round (test vantaggio posizionale)
    snakeOrder: !!config.snakeOrder,     // true: ordine a serpentina (0,1,2,3 poi 3,2,1,0...) — chi è ultimo in un round è primo nel successivo (A/B vantaggio posizionale)
    singlePlace: !!config.singlePlace,   // true: la commessa ha un solo vincitore (PV 1°) e si rinfresca subito, niente 2° posto
    slots: mergeSlots(config.slots),     // cap Sopra/Sotto per reparto + Direzione (editabile)
    // requisito milestone per completare commesse di ogni taglia (0-3): quante milestone di tracciato servono
    contractMilestoneReq: { small: 0, medium: 0, large: 0, ...(config.contractMilestoneReq || {}) },
    // nodo Servizi: 'welfare' (vecchio: compra Welfare/Macchinari) o 'struttura' (nuovo: compra carte struttura)
    servicesMode: config.servicesMode === 'struttura' ? 'struttura' : 'welfare',
    welfareEnabled: config.welfareEnabled !== false, // false: nodo Servizi non offre più Welfare/Macchinari (A/B, test "la meccanica serve?")
    strutturaCards: config.struttura || [],
    strutturaMarket: config.servicesMode === 'struttura' && config.struttura ? config.struttura.map((_, i) => i) : [],
    trattativa: mergeTrattativa(config.trattativa), // azioni Trattativa configurabili (enabled/cost)
    borsa: mergeBorsa(config.borsa), // azioni Città configurabili (enabled/give/get)
    borsaExit: mergeBorsaExit(config.borsaExit), // uscita con bonus fisso invece delle Commesse
    borsaRefresh: mergeBorsaRefresh(config.borsaRefresh), // refresh gratuito (Welfare o banchi) invece delle Commesse
    // Borsa a indici: id nodo 'Servizi' = "Borsa" a schermo (NODE_LABEL). Default enabled:false → invariato.
    borsaIndici: mergeBorsaIndici(config.borsaIndici),
    quad: 0, // quadrimestre corrente (0..3), avanza alle soglie di Clock in borsaIndici.quadBounds
    indexCount: { ...Object.fromEntries(SECTORS.map(s => [s, 0])), Sindacato: 0 }, // driver a contatore
    borsaFabbriche: mergeBorsaFabbriche(config.borsaFabbriche), // sostituisce gli indici quando enabled
    // mappa per numero giocatori: config.borsaFabbriche.maps[n] > map singola (legacy) > default per n
    factoryMap: (config.borsaFabbriche?.maps?.[n]?.hexes?.length) ? config.borsaFabbriche.maps[n]
      : (config.borsaFabbriche?.map?.hexes?.length) ? config.borsaFabbriche.map
      : (DEFAULT_FACTORY_MAPS[n] || FACTORY_MAP),
    aiSaturate: config.aiSaturate !== false, // AI: valore decrescente su risorse oltre il fabbisogno (evita l'accumulo irrazionale). Default ON.
    aiValueMachines: config.aiValueMachines === true, // AI: valuta i Macchinari (Direzione Sotto) per il flusso di produzione, non a 1.0/uso. Default OFF (sperimentale, A/B).
    aiRollout: config.aiRollout || null, // AI: {depth, rollouts} — invece di evaluate() dopo 1 mossa, gioca N turni in self-play e valuta lì. Default OFF (costoso, sperimentale).
    strikePenalty: config.strikePenalty !== false, // default ON: ogni carta bloccata a fine partita costa PV
    strikePenaltyPV: Math.max(0, config.strikePenaltyPV ?? STRIKE_PENALTY_PV), // PV persi per carta bloccata a fine partita
    finalRound: false, endImmediate: false, gameOver: false, results: null,
    turn: 1, current: 0, roundStart: 0, roundTurns: 0, dir: 1,
    phase: 'move', // move | action | borsa | done (fine turno in attesa di endTurn implicito)
    contractsThisVisit: 0,
    borsaExitUsed: false, borsaRefreshUsed: false, // esclusivi con completare Commesse nella stessa visita
    borsaTileUsed: false, // idem: comprare una tile (R&D) esclude le Commesse nella stessa visita, non esclude bonus/refresh
    sellUsedThisVisit: 0, convertUsedThisVisit: 0, // contatori per la modalità 'unoPerAzione' (azzerati in startTurn)
    pending: null, // { type: 'sciopero'|'effect', ... }
    pendingQueue: [],
    activationCoins: null, // marchi guadagnati nell'attivazione in corso
    log: [],
  };
  log(state, `Partita a ${n}: ${players.map(p => `${p.name} (${p.boardName}${p.isAI ? ', AI' : ''})`).join(' · ')}. Seed ${seed}.`);
  if (state.borsaFabbriche.enabled) setupFactoryResources(state, rnd); // assegna i colori random alle caselle-risorsa
  startTurn(state);
  checkObjectivesAll(state);
  return state;
}

function makeContractSlot(deck) {
  if (deck.length === 0) return null;
  const card = deck.shift();
  return { card, doneReq: card.reqs.map(() => false), places: [null, null] };
}
// rinfresca la carta all'indice `index` del mercato di una taglia
function drawContract(entry, index = 0) {
  entry.active[index] = makeContractSlot(entry.deck);
}

function log(state, text) {
  if (state.headless) return; // batch: niente log → cloni molto più leggeri
  state.log.push({ turn: state.turn, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

// ---------- Helpers di lettura ----------
export function currentPlayer(state) { return state.players[state.current]; }

export function deptOfSector(player, sector) {
  return DEPT_ROLES.map(r => player.depts[r]).find(d => d.sector === sector);
}

// sopraOnly: le carte Sotto sono fisicamente infilate sotto la plancia — la loro icona (nazione/settore
// stampata in alto sulla carta) non è visibile in gioco. I moltiplicatori "per icona"/"per nazione" contano
// solo ciò che si vede (Sopra); i conteggi di POSSESSO (obiettivi tipo "N lavoratori Tedeschi installati")
// contano l'installazione a prescindere dalla visibilità, quindi restano sopra+sotto (default).
function installedWorkerCards(player, sopraOnly = false) {
  const out = [];
  for (const role of DEPT_ROLES) {
    const d = player.depts[role];
    for (const id of (sopraOnly ? d.sopra : [...d.sopra, ...d.sotto])) out.push(WORKER_BY_ID[id]);
  }
  return out;
}

// Icona = settore stampato sulla carta installata, visibile solo Sopra (operai + welfare/macchinari Sopra: settore 1°)
export function iconCount(player, sector, welfareById = WELFARE_BY_ID) {
  let c = installedWorkerCards(player, true).filter(w => w.sector === sector).length;
  for (const id of player.direzione.sopra) {
    if (typeof id !== 'string') continue;
    const imp = WORKER_BY_ID[id];
    if (imp?.power) { if (sector in imp.power) c++; } // Impiegato: icona su entrambi i settori di power
    else if (welfareById[id]?.s1 === sector) c++;
  }
  return c;
}

// sopraOnly=true per il moltiplicatore "marchi × nazionalità" (countOf sotto: icona visibile solo Sopra);
// default false per gli obiettivi "N lavoratori di nazione X installati" (possesso, non visibilità).
function nationCount(player, nation, sopraOnly = false) {
  return installedWorkerCards(player, sopraOnly).filter(w => w.nation === nation).length;
}
function distinctNations(player, sopraOnly = false) {
  return new Set(installedWorkerCards(player, sopraOnly).map(w => w.nation)).size;
}
function deptCardCount(d) { return d.sopra.length + d.sotto.length; }

// Welfare/Macchinari rimossi: il gate della Trattativa (reqWelfare) è il numero di Impiegati in
// Direzione (sempre Sopra, mai più Sotto — vedi placements()).
export function welfareCount(player) { return player.direzione.sopra.length; }

// src = canale di provenienza (settore | 'tracciati' | 'bonus' | 'scambio') per il bilancio marchi
function addCoins(state, player, amount, src) {
  player.coins += amount;
  if (amount > 0) {
    if (player.coinsGained !== undefined) player.coinsGained += amount; // telemetria: marchi guadagnati
    if (src && player.coinsGainedBy) player.coinsGainedBy[src] += amount; // da dove nasce la ricchezza
    if (state.activationCoins !== null) state.activationCoins += amount;
  }
}
// spesa marchi con categoria (lavoratori/direzione/sindacato/borsa/movimento) per il report "dove sono finiti"
function spendCoins(player, cat, amount) {
  player.coins -= amount;
  if (player.coinsSpentBy && amount > 0) player.coinsSpentBy[cat] += amount;
}
// channel = canale di produzione (produzione | tracciati | macchinari | bonus) per il bilancio risorse
function addRes(player, sector, amount, channel) {
  player.resources[RESOURCE_OF[sector]] += amount;
  if (player.resGen) player.resGen[sector] += amount; // telemetria: produzione per settore
  if (channel && player.resGainedBy) player.resGainedBy[channel] += amount; // da dove nasce la risorsa
}
// risorsa entrata per CONVERSIONE (scambio/acquisto): NON è produzione → fuori da resGen (non falsa "risorse sprecate")
function convRes(player, sector, amount, channel) {
  player.resources[RESOURCE_OF[sector]] += amount;
  if (player.resGainedBy) player.resGainedBy[channel] += amount;
  if (player.convCount) player.convCount[channel === 'acquisto' ? 'marchiRisorsa' : 'risorsaRisorsa']++;
}
// consuma risorse contando la spesa per settore (telemetria) e per categoria d'impiego (bilancio)
function spendRes(player, sector, amount, cat) {
  player.resources[RESOURCE_OF[sector]] -= amount;
  if (player.resSpent) player.resSpent[sector] += amount;
  if (cat && player.resSpentByCat) player.resSpentByCat[cat] += amount;
  if (cat === 'vendita' && player.convCount) player.convCount.risorsaMarchi++;
}

export function totalResources(player) {
  return Object.values(player.resources).reduce((a, b) => a + b, 0);
}

function factoryCount(player, sector) {
  return (player.factories || []).filter(f => f.sector === sector).length;
}

// Forza di un giocatore verso un settore.
// Fabbrica NEUTRA: si conta dal lato risorsa — per ogni casella-risorsa di quel colore, quante fabbriche del
// giocatore le stanno adiacenti; poi si somma. Una fabbrica adiacente a 2 caselle Tessile vale 2 verso Tessile.
// Legacy: numero di fabbriche taggate con quel settore (comportamento storico).
function factoryStrength(state, player, sector) {
  if (!state.borsaFabbriche?.neutralFactory) return factoryCount(player, sector);
  const mine = new Set((player.factories || []).map(f => f.hex));
  let n = 0;
  for (const rid of Object.keys(state.hexResource)) {
    if (state.hexResource[rid] !== sector) continue;
    for (const nb of (state.factoryMap.adj[rid] || [])) if (mine.has(nb)) n++;
  }
  return n;
}

// ---------- Tracciato Produzione (griglia 4x4, posizioni 1..16) ----------
// Guadagno di una casella (usato sia all'attraversamento sia a ogni attivazione)
function cellGain(state, player, dept, cell) {
  if (!cell) return null;
  const welfareById = state?.welfareById || WELFARE_BY_ID;
  if (cell.coins) return { coins: cell.coins };
  if (cell.res) return { res: cell.res };
  if (cell.coinsPerIcon) return { coins: cell.coinsPerIcon * iconCount(player, dept.sector, welfareById) };
  if (cell.coinsPerTension) return { coins: cell.coinsPerTension * dept.tension };
  if (cell.resPerIcon) return { res: cell.resPerIcon * iconCount(player, dept.sector, welfareById) };
  if (cell.resPerTension) return { res: cell.resPerTension * dept.tension };
  if (cell.coinsPerFactory) return { coins: cell.coinsPerFactory * factoryStrength(state, player, dept.sector) };
  if (cell.resPerFactory) return { res: cell.resPerFactory * factoryStrength(state, player, dept.sector) };
  return null; // pv / milestone / tileSlot vuoto: nessuna produzione
}

// Cella effettiva a una posizione: se il giocatore ha comprato una tile per quello slot (pos 7/11/15),
// il suo effetto sostituisce la cella del template per lui — altrimenti è il template così com'è.
function resolveCell(state, dept, pos) {
  const filled = dept.tileFills?.[pos];
  if (filled) { const t = state.trackTileById[filled]; return t ? { [t.cellType]: t.amount } : null; }
  return state.tracks[dept.role][pos];
}

// Avanzamento: incassa una tantum il bonus di ogni casella attraversata.
// Tile comprabili per uno slot: catalogo del mercato, costo in risorse del reparto, scorta (mode 'limitato').
// Condivisa dal trigger di raggiungimento (advanceTrack) e dal ripiego alla Borsa (R&D).
function tileOptions(state, p, role, market) {
  const sector = p.depts[role].sector;
  return Object.values(state.trackTileById).filter(t => t.market === market
    && p.resources[RESOURCE_OF[sector]] >= t.cost
    && !(state.trackTileCap.mode === 'limitato' && (state.trackTileStock[role][t.id] ?? 0) <= 0));
}

function advanceTrack(state, player, dept, steps, reason) {
  const from = dept.prod;
  const to = Math.min(from + steps, state.trackMax);
  const gains = [];
  for (let pos = from + 1; pos <= to; pos++) {
    const cell = resolveCell(state, dept, pos);
    const g = cellGain(state, player, dept, cell);
    if (g?.coins) { addCoins(state, player, g.coins, 'tracciati'); gains.push(`+${g.coins} ⓜ`); }
    if (g?.res) { addRes(player, dept.sector, g.res, 'tracciati'); gains.push(`+${g.res} ${RESOURCE_OF[dept.sector]}`); }
    if (cell?.milestone) { gains.push('milestone Città'); noteIndexEvent(state, 'milestone', dept.sector); }
    if (cell?.pv) gains.push(`soglia ${cell.pv} PV`);
  }
  dept.prod = to;
  if (to > from) log(state, `${player.name}: ${dept.sector} avanza a ${to}${gains.length ? ' (' + gains.join(', ') + ')' : ''}${reason ? ' — ' + reason : ''}.`);
  checkTileUnlocks(state, player, dept, from, to);
}

// Mercato tile: la scelta scatta appena si ATTRAVERSA la milestone che apre il mercato. Alla Borsa (R&D)
// restava quasi sempre inutilizzata perché esclusiva con le Commesse, che l'IA greedy preferisce sempre
// (sblocca 79% dei reparti → compra 4%). Chi rinuncia qui può ancora comprarla alla Borsa.
// Un solo avanzamento può attraversare più milestone (es. Impiegato +3): la coda le serve una alla volta.
// Chiamata da OGNI punto che fa salire il tracciato, non solo advanceTrack: lo sblocco della Trattativa
// ripristina `prod` direttamente (non ripaga le caselle già riscosse) e superava la milestone in silenzio.
function checkTileUnlocks(state, player, dept, from, to) {
  for (const [marketStr, unlockPos] of Object.entries(state.marketUnlockPos[dept.role] || {})) {
    if (unlockPos <= from || unlockPos > to) continue; // non attraversata in questa salita
    // Borsa a fabbriche: ogni milestone attraversata dà un credito per fondare una fabbrica di questo settore.
    // Le posizioni marketUnlockPos SONO le milestone (pos 8/12/16), quindi qui = "una milestone in più superata".
    if (state.borsaFabbriche.enabled) { player.factoryCredits[dept.sector] = (player.factoryCredits[dept.sector] || 0) + 1; player.factoryCreditsEarned += 1; }
    const market = Number(marketStr);
    const pos = state.tileSlotPos[dept.role]?.[market];
    if (pos == null || dept.tileFills[pos]) continue;
    if (tileOptions(state, player, dept.role, market).length === 0) continue; // niente da scegliere: nessun pending
    state.pendingQueue.push({ type: 'trackTile', playerId: player.id, role: dept.role, market, pos });
  }
  advancePending(state);
}

// Attivazione: le caselle raggiunte riproducono (marchi solo se rules.coinsRepeat).
function trackProduction(state, player, dept) {
  let coins = 0, res = 0;
  for (let pos = 1; pos <= dept.prod; pos++) {
    const tileId = dept.tileFills[pos];
    const g = cellGain(state, player, dept, resolveCell(state, dept, pos));
    const c = g?.coins && state.rules.coinsRepeat ? g.coins : 0;
    const r = g?.res ? g.res : 0;
    if (tileId && (c || r)) {
      const acc = player.tileGains[tileId] ?? (player.tileGains[tileId] = { coins: 0, res: 0, uses: 0 });
      acc.coins += c; acc.res += r; acc.uses++;
    }
    coins += c; res += r;
  }
  if (res > 0) addRes(player, dept.sector, res, 'produzione');
  if (coins > 0) addCoins(state, player, coins, dept.sector);
  if (res > 0 || coins > 0) {
    log(state, `${player.name}: tracciato produce${res ? ` ${res} ${RESOURCE_OF[dept.sector]}` : ''}${res && coins ? ' e' : ''}${coins ? ` ${coins} march${coins === 1 ? 'o' : 'i'}` : ''}.`);
  }
}

// PV di fine partita dalle soglie raggiunte sui 3 tracciati
export function trackPV(state, player) {
  let pv = 0;
  for (const role of DEPT_ROLES) {
    const d = player.depts[role];
    for (let pos = 1; pos <= d.prod; pos++) {
      const c = resolveCell(state, d, pos);
      if (!c) continue;
      if (c.pv) pv += c.pv;
      if (c.pvPerIcon) pv += c.pvPerIcon * iconCount(player, d.sector, state.welfareById);
      if (c.pvPerTension) pv += c.pvPerTension * d.tension;
      if (c.pvPerFactory) pv += c.pvPerFactory * factoryStrength(state, player, d.sector);
    }
  }
  return pv;
}

// Valore reale prodotto da ogni tile tracciato acquistata (per il report "quanto ha reso", non solo "comprata").
// coins/res: da player.tileGains, accumulato durante la partita (acquisto una tantum + ogni attivazione successiva).
// pv/pvPerIcon/pvPerTension: snapshot allo stato attuale (stessa regola di trackPV, non un accumulo — il valore PV
// di una soglia raggiunta non "si ripete", conta una volta sola comunque la si guardi).
// Resa attesa di una tile per QUESTO giocatore adesso: le celle coins/res riproducono a ogni attivazione,
// le celle pv valgono una volta sola a fine partita. Serve all'IA per SCEGLIERE fra tile di tipo diverso
// (tileValue qui sotto è l'opposto: retrospettiva, quanto una tile ha davvero reso).
export function tileForecast(state, player, role, tile) {
  const d = player.depts[role];
  if (tile.cellType === 'pv') return { coins: 0, res: 0, pv: tile.amount };
  if (tile.cellType === 'pvPerIcon') return { coins: 0, res: 0, pv: tile.amount * iconCount(player, d.sector, state.welfareById) };
  if (tile.cellType === 'pvPerTension') return { coins: 0, res: 0, pv: tile.amount * d.tension };
  if (tile.cellType === 'pvPerFactory') return { coins: 0, res: 0, pv: tile.amount * factoryStrength(state, player, d.sector) };
  const g = cellGain(state, player, d, { [tile.cellType]: tile.amount }) || {};
  return { coins: g.coins || 0, res: g.res || 0, pv: 0 };
}

export function tileValue(state, player) {
  const out = {};
  for (const [tileId, acc] of Object.entries(player.tileGains)) out[tileId] = { coins: acc.coins, res: acc.res, pv: 0, uses: acc.uses };
  for (const role of DEPT_ROLES) {
    const d = player.depts[role];
    for (const tileId of Object.values(d.tileFills)) {
      const t = state.trackTileById[tileId];
      if (!t) continue;
      let pv = 0;
      if (t.cellType === 'pv') pv = t.amount;
      else if (t.cellType === 'pvPerIcon') pv = t.amount * iconCount(player, d.sector, state.welfareById);
      else if (t.cellType === 'pvPerTension') pv = t.amount * d.tension;
      else if (t.cellType === 'pvPerFactory') pv = t.amount * factoryStrength(state, player, d.sector);
      if (pv) { out[tileId] = out[tileId] || { coins: 0, res: 0, pv: 0, uses: 0 }; out[tileId].pv += pv; out[tileId].uses ||= 1; }
    }
  }
  return out;
}

// ---------- Tensione / Sciopero ----------
function raiseTension(state, owner, dept, amount, cause) {
  if (deptCardCount(dept) === 0) { log(state, `${owner.name}: reparto ${dept.sector} vuoto, Tensione resta a 0.`); return; }
  dept.tension = Math.min(dept.tension + amount, TENSION_LIMIT);
  log(state, `${owner.name}: Tensione ${dept.sector} a ${dept.tension}${cause ? ' (' + cause + ')' : ''}.`);
}

function checkStrike(state, owner, dept, byOpponent = false) {
  if (dept.tension < TENSION_LIMIT) return;
  if (byOpponent) owner.strikesByOpponent += 1;
  noteIndexEvent(state, 'scioperi', 'Sindacato');
  const options = [...dept.sopra, ...dept.sotto].filter(id => !dept.blocked.includes(id));
  dept.tension = 0;
  if (options.length === 0) {
    log(state, `${owner.name}: SCIOPERO in ${dept.sector} — nessuna carta bloccabile, Tensione azzerata.`);
    return;
  }
  log(state, `${owner.name}: SCIOPERO in ${dept.sector}! Deve bloccare una carta.`);
  state.pendingQueue.push({ type: 'sciopero', playerId: owner.id, role: dept.role, options });
  advancePending(state);
}

function advancePending(state) {
  if (!state.pending && state.pendingQueue.length > 0) {
    state.pending = state.pendingQueue.shift();
  }
}

// ---------- Obiettivi ----------
function condMet(state, player, cond) {
  switch (cond.type) {
    case 'milestones':
      // cond.sectors: {sector, milestone:1|2|3}; retrocompatibile con vecchie tessere salvate (stringa nuda = milestone 1).
      return cond.sectors.every(s => {
        const sector = typeof s === 'string' ? s : s.sector;
        const level = typeof s === 'string' ? 1 : (s.milestone ?? 1);
        const d = deptOfSector(player, sector);
        const threshold = state.marketUnlockPos[d.role]?.[level];
        return threshold != null && isFinite(threshold) && d.prod >= threshold;
      });
    case 'workers_nation':
      return nationCount(player, cond.nation) >= cond.n;
    case 'same_nation':
      return state.nations.some(nat => nationCount(player, nat) >= cond.n);
    case 'distinct_nations':
      return distinctNations(player) >= cond.n;
    case 'all_tension_zero':
      return false; // non monotona (la Tensione risale) — valutato solo a fine partita, vedi endGame
    case 'activation_coins':
      return player.maxActivationCoins >= cond.n;
    case 'sotto_each':
      return DEPT_ROLES.every(r => player.depts[r].sotto.length >= cond.n);
    case 'sopra_each':
      return DEPT_ROLES.every(r => player.depts[r].sopra.length >= cond.n);
    case 'direzione': {
      const d = player.direzione;
      const c = cond.side === 'sopra' ? d.sopra.length : cond.side === 'sotto' ? d.sotto.length : d.sopra.length + d.sotto.length;
      return c >= cond.n;
    }
    case 'full_dept': {
      // minCount opzionale (default 1 = "un reparto a scelta", comportamento storico): quanti reparti devono
      // essere pieni contemporaneamente, non solo uno qualsiasi.
      const full = DEPT_ROLES.filter(r => player.depts[r].sopra.length >= cond.sopra && player.depts[r].sotto.length >= cond.sotto).length;
      return full >= (cond.minCount || 1);
    }
    case 'no_blocked_end':
      return false; // valutato solo a fine partita
    case 'contracts_mix': {
      const by = { small: 0, medium: 0, large: 0 };
      for (const c of player.contractsWon) by[c.size]++;
      return by.small >= (cond.small || 0) && by.medium >= (cond.medium || 0) && by.large >= (cond.large || 0);
    }
    case 'sector_leader': {
      const d = deptOfSector(player, cond.sector);
      const leads = DEPT_ROLES.every(r => r === d.role || d.prod >= player.depts[r].prod);
      const allMilestones = DEPT_ROLES.every(r => player.depts[r].prod >= state.milestonePos[r]);
      return leads && allMilestones;
    }
    case 'direzione_full':
      return player.direzione.sopra.length >= cond.sopra && player.direzione.sotto.length >= cond.sotto;
    default:
      return false;
  }
}

// Testo dell'obiettivo, generato dalla condizione — non un campo salvato: editarlo a mano su 96 obiettivi
// (32 tessere × 3) non regge, e un testo salvato può disallinearsi dalla condizione appena la cambi (era già
// successo). Unica fonte di verità: `cond`.
export function describeCond(cond) {
  const joinAnd = arr => arr.length <= 1 ? (arr[0] ?? '') : `${arr.slice(0, -1).join(', ')} e ${arr.at(-1)}`;
  switch (cond.type) {
    case 'milestones': {
      const parts = cond.sectors.map(s => {
        const sector = typeof s === 'string' ? s : s.sector;
        const level = typeof s === 'string' ? 1 : (s.milestone ?? 1);
        return level === 1 ? sector : `${sector} (milestone ${level})`;
      });
      return `Tracciati ${joinAnd(parts)} sviluppati fino alla milestone (icona Città)`;
    }
    case 'workers_nation':
      return `${cond.n} lavoratori ${cond.nation} installati in fabbrica`;
    case 'same_nation':
      return `${cond.n} lavoratori della stessa nazionalità installati in fabbrica`;
    case 'distinct_nations':
      return `${cond.n} lavoratori di nazionalità diverse tra loro installati in fabbrica`;
    case 'all_tension_zero': {
      const t = cond.targets || {};
      const [tz, sz, pz] = [t.terziario ?? 0, t.secondario ?? 0, t.primario ?? 0];
      if (tz === 0 && sz === 0 && pz === 0) return 'Tutti e 3 i Tracciati Tensione a 0 contemporaneamente';
      return `Tracciati Tensione a fine partita: Terziario ${tz}, Secondario ${sz}, Primario ${pz}, tutti contemporaneamente`;
    }
    case 'activation_coins':
      return `In una singola attivazione guadagni almeno ${cond.n} marchi`;
    case 'sotto_each':
      return cond.n === 1 ? 'Almeno 1 carta Sotto installata in ciascuno dei 3 reparti' : `Almeno ${cond.n} carte Sotto installate in ciascuno dei 3 reparti`;
    case 'sopra_each':
      return cond.n === 1 ? 'Almeno 1 carta Sopra installata in ciascuno dei 3 reparti' : `Almeno ${cond.n} carte Sopra installate in ciascuno dei 3 reparti`;
    case 'direzione':
      if (cond.side === 'sopra') return `${cond.n} carte Welfare (posizione Sopra) installate nella Direzione`;
      if (cond.side === 'sotto') return `${cond.n} carte Macchinario (posizione Sotto) installate nella Direzione`;
      return `${cond.n} carte (Welfare o Macchinario, posizione indifferente) installate nella Direzione`;
    case 'full_dept':
      return cond.minCount > 1
        ? `Almeno ${cond.minCount} reparti pieni (${cond.sopra} carte Sopra e ${cond.sotto} carte Sotto ciascuno)`
        : `In un reparto a scelta: almeno ${cond.sopra} carte Sopra e ${cond.sotto} carte Sotto`;
    case 'no_blocked_end':
      return 'A fine partita nessuna carta bloccata da Sciopero';
    case 'contracts_mix': {
      const parts = [];
      if (cond.small) parts.push(`${cond.small} piccole`);
      if (cond.medium) parts.push(`${cond.medium} medie`);
      if (cond.large) parts.push(`${cond.large} grandi`);
      return `Completa almeno ${parts.join(' + ') || '0'} commesse`;
    }
    case 'sector_leader':
      return `${cond.sector} è il tuo settore più sviluppato (o a pari merito), con tutte e 3 le milestone raggiunte`;
    case 'direzione_full':
      return `Direzione con almeno ${cond.sopra} carte Sopra e ${cond.sotto} carte Sotto`;
    default:
      return cond.type;
  }
}

function checkObjectives(state, player) {
  player.tile.objectives.forEach((obj, i) => {
    if (!player.achieved[i] && condMet(state, player, obj.cond)) {
      player.achieved[i] = true;
      log(state, `${player.name} completa un obiettivo del Piano Industriale (${obj.pv} PV): «${describeCond(obj.cond)}».`);
    }
  });
}
function checkObjectivesAll(state) { for (const p of state.players) checkObjectives(state, p); }

// Maggioranza territoriale (Borsa a fabbriche, opzionale): per un giacimento (casella-risorsa), chi ha più
// fabbriche del settore di quella risorsa sui suoi siti costruibili adiacenti vince il bonus. Pareggio → decide
// chi ha raggiunto la milestone del reparto assegnato a quel settore; pareggio anche lì → nessuno vince.
export function factoryMajorityWinner(state, rid, sector) {
  const adjB = (state.factoryMap.adj[rid] || []).filter(n => state.factoryHexById[n]?.type === 'costruibile');
  const counts = {};
  const neutral = state.borsaFabbriche?.neutralFactory;
  for (const n of adjB) {
    const f = state.hexFactory[n];
    if (f && (neutral || f.sector === sector)) counts[f.playerId] = (counts[f.playerId] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return null;
  const top = Object.keys(counts).filter(id => counts[id] === max).map(Number);
  if (top.length === 1) return top[0];
  const withMilestone = top.filter(id => {
    const d = deptOfSector(state.players.find(pl => pl.id === id), sector);
    return d && d.prod >= state.milestonePos[d.role];
  });
  return withMilestone.length === 1 ? withMilestone[0] : null;
}
function factoryMajorityPV(state, p) {
  const mb = state.borsaFabbriche?.majorityBonus;
  if (!state.borsaFabbriche?.enabled || !mb?.enabled) return 0;
  let pv = 0;
  for (const rid of Object.keys(state.hexResource)) {
    if (factoryMajorityWinner(state, rid, state.hexResource[rid]) === p.id) pv += mb.pv;
  }
  return pv;
}

// ---------- Fine partita ----------
// PV correnti di un giocatore (puro, non muta lo stato) — usato sia a fine partita sia per la timeline PV per round.
export function scorePlayer(state, p) {
  const pvContracts = p.contractsWon.reduce((a, c) => a + c.pv, 0);
  const pvObjectives = p.tile.objectives.reduce((a, o, i) => a + (p.achieved[i] ? o.pv : 0), 0);
  const pvTrack = trackPV(state, p);
  const pvCoins = Math.floor(p.coins / state.rules.coinsPerPV);
  const pvResources = Object.values(p.resources).reduce((a, n) => a + Math.floor(n / state.rules.resPerPV), 0);
  const blockedCount = DEPT_ROLES.reduce((a, r) => a + p.depts[r].blocked.length, 0);
  const pvStrikes = state.strikePenalty ? -state.strikePenaltyPV * blockedCount : 0; // ogni carta bloccata a fine partita costa PV
  const pvBorsa = p.pvBorsa || 0; // dividendi della Borsa a indici (0 se la meccanica è spenta)
  const pvFactoryMajority = factoryMajorityPV(state, p);
  const total = pvContracts + pvObjectives + pvTrack + pvCoins + pvResources + pvStrikes + pvBorsa + pvFactoryMajority;
  return { playerId: p.id, name: p.name, pvContracts, pvObjectives, pvTrack, pvCoins, pvResources, pvStrikes, pvBorsa, pvFactoryMajority, blockedCount, total, coins: p.coins, nContracts: p.contractsWon.length };
}

function endGame(state) {
  state.gameOver = true;
  // L'ultimo quadrimestre coincide con la fine partita: il Clock può fermarsi sotto la sua soglia
  // (fine per giro completato o per MAX_ROUNDS) e resterebbe non pagato. Qui si salda comunque.
  if (state.borsaIndici.enabled && state.quad < state.borsaIndici.cells.length) {
    payoutQuad(state);
    state.quad += 1;
  }
  // obiettivi valutati solo qui, non durante il turno: "nessuna carta bloccata" e "Tensioni a 0" descrivono lo
  // stato a fine partita, non un traguardo raggiunto una volta e per sempre (la Tensione, a differenza di
  // tracciati/carte/marchi, può risalire — non è monotona).
  for (const p of state.players) {
    p.tile.objectives.forEach((obj, i) => {
      if (p.achieved[i]) return;
      if (obj.cond.type === 'no_blocked_end') {
        const anyBlocked = DEPT_ROLES.some(r => p.depts[r].blocked.length > 0);
        if (!anyBlocked) p.achieved[i] = true;
      } else if (obj.cond.type === 'all_tension_zero') {
        // targets per reparto, editabili (default 0 se assente = comportamento storico "tutte a 0")
        const t = obj.cond.targets || {};
        if (DEPT_ROLES.every(r => p.depts[r].tension === (t[r] ?? 0))) p.achieved[i] = true;
      }
    });
  }
  const results = state.players.map(p => scorePlayer(state, p));
  results.sort((a, b) => b.total - a.total || b.coins - a.coins || b.nContracts - a.nContracts);
  state.results = results;
  log(state, `FINE PARTITA. Vince ${results[0].name} con ${results[0].total} PV.`);
}

// ---------- Turni ----------
function startTurn(state) {
  const p = currentPlayer(state);
  state.phase = 'move';
  state.contractsThisVisit = 0;
  state.borsaExitUsed = false;
  state.borsaRefreshUsed = false;
  state.borsaTileUsed = false;
  state.sellUsedThisVisit = 0;
  state.convertUsedThisVisit = 0;
  state.activationCoins = null;
  // Borsa a fabbriche: reddito passivo a inizio turno (1 risorsa del settore per fabbrica). Gate: passiveIncome.
  // Se spento, resta solo la risorsa immediata alla fondazione (doBuildFactory), niente rendita.
  if (state.borsaFabbriche.enabled && state.borsaFabbriche.passiveIncome !== false) {
    if (state.borsaFabbriche.neutralFactory) {
      for (const f of p.factories) for (const sec of adjacentSectors(state, f.hex)) addRes(p, sec, 1, 'fabbrica');
    } else {
      for (const f of p.factories) addRes(p, f.sector, 1, 'fabbrica');
      if (p.factories.length) log(state, `${p.name}: le fabbriche producono ${p.factories.map(f => RESOURCE_OF[f.sector]).join(' + ')}.`);
    }
  }
  // Produzione dei Macchinari (Direzione, lato Sotto) a inizio turno
  for (const m of p.direzione.sotto) {
    if (m.usesLeft > 0) {
      m.usesLeft -= 1;
      const wf = state.welfareById[m.id];
      for (const s of wf.perUse) addRes(p, s, 1, 'macchinari');
      log(state, `${p.name}: ${wf.name} produce ${wf.perUse.map(s => RESOURCE_OF[s]).join(' + ')} (usi rimasti ${m.usesLeft}).`);
    }
  }
  checkObjectives(state, p);
}

function finishTurn(state) {
  const p = currentPlayer(state);
  p.coinsHistory.push(p.coins);
  p.resHistory.push(totalResources(p));
  checkObjectivesAll(state);
  state.roundTurns += 1;
  const lastOfRound = state.roundTurns >= state.nPlayers;
  if (state.endImmediate || (state.finalRound && lastOfRound)) {
    endGame(state);
    return;
  }
  if (lastOfRound) {
    state.roundTurns = 0;
    state.turn += 1;
    // rete di sicurezza: se il Clock non può più avanzare (es. requisito milestone irraggiungibile
    // che blocca una taglia), la partita finirebbe mai. Cap round generoso (~3× la durata normale).
    if (state.turn > MAX_ROUNDS) { log(state, `Raggiunto il limite di ${MAX_ROUNDS} round: la partita si chiude d'ufficio.`); endGame(state); return; }
    if (state.snakeOrder) {
      state.dir = -state.dir;
      state.current = state.dir === 1 ? 0 : state.nPlayers - 1;
    } else {
      if (state.rotateStart) state.roundStart = (state.roundStart + 1) % state.nPlayers;
      state.current = state.roundStart;
    }
  } else {
    state.current = state.snakeOrder
      ? (state.current + state.dir + state.nPlayers) % state.nPlayers
      : (state.current + 1) % state.nPlayers;
  }
  startTurn(state);
}

function advanceClock(state, amount) {
  for (let i = 0; i < amount; i++) {
    state.clock += 1;
    // Refresh automatici da clock rimossi (test ipotesi bias posizione).
    // if (CLOCK_REFRESH.includes(state.clock)) refreshBanks(state, `Clock ${state.clock}`);
  }
  checkQuadClose(state); // i quadrimestri sono scanditi dal Clock: qui si pagano i dividendi
  if (!state.finalRound && state.clock >= state.clockThreshold) {
    state.finalRound = true;
    if (state.endOnTrigger) {
      state.endImmediate = true;
      log(state, `Il Clock raggiunge ${state.clock}/${state.clockThreshold}: la partita finisce con il giocatore che ha scatenato il trigger, poi conteggio finale.`);
    } else {
      log(state, `Il Clock raggiunge ${state.clock}/${state.clockThreshold}: si completa il giro corrente, poi conteggio finale.`);
    }
  }
}

function refreshBanks(state, cause) {
  for (const nat of state.bankIds) {
    const b = state.banks[nat];
    const d = bankDepth(nat); // le scoperte vanno in fondo, se ne scoprono altrettante (mercato Impiegati: tutte e 3)
    if (b.length > d) b.push(...b.splice(0, d));
  }
  log(state, `Refresh dei banchi (${cause}).`);
}

function refreshWelfareMarket(state, cause) {
  // rimette le carte scoperte in fondo al mazzo coperto, rivela le prossime — stesso schema di refreshBanks
  for (const id of state.welfareMarket) state.welfareDrawPile.push(id);
  state.welfareMarket = state.welfareDrawPile.splice(0, WELFARE_MARKET);
  log(state, `Refresh del mercato Welfare (${cause}).`);
}

// ---------- Mosse legali ----------
export function legalCommands(state) {
  if (state.gameOver) return [];
  const p = currentPlayer(state);
  const cmds = [];

  if (state.pending) {
    const pend = state.pending;
    if (pend.type === 'sciopero') {
      for (const id of pend.options) cmds.push({ type: 'strikeBlock', cardId: id });
    } else if (pend.type === 'trackTile') {
      cmds.push({ type: 'resolveTrackTile', use: false }); // rinuncia: lo slot resta vuoto, ricomprabile alla Borsa
      const owner = state.players[pend.playerId];
      for (const t of tileOptions(state, owner, pend.role, pend.market)) cmds.push({ type: 'resolveTrackTile', use: true, tileId: t.id });
    } else if (pend.type === 'effect') {
      cmds.push({ type: 'resolveEffect', use: false });
      const owner = state.players[pend.playerId];
      const F = formulaOf(WORKER_BY_ID[pend.cardId]);
      const giveScelta = F.f1?.tipo === 'risorsa' && F.f1?.settore === 'scelta';
      const takeScelta = F.f2?.tipo === 'risorsa' && F.f2?.settore === 'scelta';
      const canCoins = F.f1?.tipo === 'moneta' ? owner.coins >= F.f1.q : true;
      if (giveScelta && takeScelta) {
        for (const give of SECTORS) {
          if (owner.resources[RESOURCE_OF[give]] >= F.f1.q) {
            for (const take of SECTORS) if (take !== give) cmds.push({ type: 'resolveEffect', use: true, give, take });
          }
        }
      } else if (!giveScelta && takeScelta) {
        if (canCoins) for (const take of SECTORS) cmds.push({ type: 'resolveEffect', use: true, take });
      } else if (giveScelta && !takeScelta) {
        for (const give of SECTORS) if (owner.resources[RESOURCE_OF[give]] >= F.f1.q) cmds.push({ type: 'resolveEffect', use: true, give });
      }
    }
    return cmds;
  }

  if (state.phase === 'move') {
    for (const node of NODES) {
      if (node === p.node) continue; // nodo diverso ogni turno (Borsa inclusa: niente turni consecutivi in Borsa)
      if (node === 'Borsa') { cmds.push({ type: 'move', node, cost: 0 }); continue; }
      const occupants = state.players.filter(q => q.node === node).length;
      if (occupants >= 2) continue;
      const cost = moveCost(p, node, occupants);
      if (p.coins >= cost) cmds.push({ type: 'move', node, cost });
    }
    return cmds;
  }

  if (state.phase === 'action') {
    const node = p.node;
    if (node === 'Borsa') return borsaCommands(state, p);
    // Assumi (tutti i nodi perimetrali)
    for (const bank of state.nodeBanks[node]) {
      for (const cardId of bankMarket(state, bank)) {
        const w = WORKER_BY_ID[cardId];
        if (p.coins < w.v) continue;
        for (const place of placements(state, p, w)) cmds.push({ type: 'hire', bank, cardId, ...place });
      }
    }
    if (SECTORS.includes(node)) {
      cmds.push({ type: 'activate', sector: node });
    } else if (node === 'Servizi') {
      // Borsa a fabbriche (sostituisce gli indici quando enabled): fonda una fabbrica per ogni settore per cui
      // hai un credito-milestone, un posto libero adiacente a una risorsa dello stesso colore, e i marchi.
      if (state.borsaFabbriche.enabled) {
        for (const sector of factoryBuildableSectors(state, p)) {
          for (const hex of factoryBuildSpots(state, sector)) cmds.push({ type: 'buildFactory', sector, hex });
        }
      }
      // Borsa a indici: un'azione per indice per quadrimestre (÷ investitori conta i GIOCATORI, quindi
      // una seconda azione sullo stesso indice non farebbe nulla — non la generiamo proprio).
      if (!state.borsaFabbriche.enabled && state.borsaIndici.enabled && state.quad < state.borsaIndici.cells.length) {
        const price = state.borsaIndici.prices[state.quad] ?? Infinity;
        const owned = Object.keys(p.shares).length;
        if (owned < state.borsaIndici.maxSharesPerQuad && p.coins >= price) {
          for (const name of indexNames(state)) {
            if (!p.shares[name]) cmds.push({ type: 'buyShare', index: name });
          }
        }
      }
      if (state.servicesMode === 'struttura') {
        for (const idx of state.strutturaMarket) {
          if (p.coins < (state.strutturaCards[idx]?.cost ?? Infinity)) continue;
          // Sopra = avanzamento tracciati (potenza); Sotto = effetto passivo. Il giocatore sceglie il lato.
          if (p.direzione.sopra.length < state.slots.direzione.sopra) cmds.push({ type: 'buyStruttura', idx, side: 'sopra' });
          if (p.direzione.sotto.length < state.slots.direzione.sotto) cmds.push({ type: 'buyStruttura', idx, side: 'sotto' });
        }
      } else if (state.welfareEnabled) {
        for (const id of new Set(state.welfareMarket)) { // il mercato può avere due copie della stessa carta: un solo comando
          const wf = state.welfareById[id];
          if (p.coins < wf.v) continue;
          if (p.direzione.sopra.length < state.slots.direzione.sopra) cmds.push({ type: 'buyWelfare', cardId: id, side: 'sopra' });
          if (p.direzione.sotto.length < state.slots.direzione.sotto) cmds.push({ type: 'buyWelfare', cardId: id, side: 'sotto' });
        }
      }
    } else if (node === 'Sindacato') {
      cmds.push(...trattativaCommands(state, p));
    }
    cmds.push({ type: 'pass' }); // rinuncia all'azione (sempre possibile per non bloccare)
    return cmds;
  }

  if (state.phase === 'borsa') return borsaCommands(state, p);
  return [];
}

function placements(state, p, w) {
  const out = [];
  if (w.power) {
    // Impiegato (mazzo nuovo): occupa uno slot Sopra in Direzione, avanza entrambi i settori indicati.
    if (p.direzione.sopra.length < state.slots.direzione.sopra) out.push({ side: 'sopra', role: 'direzione' });
  } else {
    const dSopra = deptOfSector(p, w.sector);
    if (dSopra.sopra.length < state.slots[dSopra.role].sopra) out.push({ side: 'sopra', role: dSopra.role });
  }
  if (!w.power) {
    for (const role of DEPT_ROLES) {
      if (p.depts[role].sotto.length < state.slots[role].sotto) out.push({ side: 'sotto', role });
    }
  }
  return out;
}

function trattativaCommands(state, p) {
  const cmds = [];
  const T = state.trattativa;
  const opponents = state.players.filter(q => q.id !== p.id);
  for (const myRole of DEPT_ROLES) {
    for (const opp of opponents) {
      for (const oppRole of DEPT_ROLES) {
        const base = { type: 'trattativa', resetRole: myRole, targetPlayer: opp.id, targetRole: oppRole };
        // Sblocca una carta: opzionale, a pagamento, nessun requisito.
        cmds.push({ ...base, f2: null });
        if (T.unblock.enabled && p.coins >= T.unblock.cost) {
          for (const role of DEPT_ROLES) {
            for (const id of p.depts[role].blocked) cmds.push({ ...base, f2: 'unblock', f2role: role, f2card: id });
          }
        }
      }
    }
  }
  return cmds;
}

function borsaCommands(state, p) {
  const cmds = [];
  // Vendi e Scambia: 1 uso ciascuno per visita, tariffa unica. Nessun tier sbloccato dagli Impiegati.
  const sr = state.borsa.sell, cr = state.borsa.convert;
  if (sr.enabled && state.sellUsedThisVisit < 1) {
    for (const give of SECTORS) {
      if (p.resources[RESOURCE_OF[give]] < sr.give) continue;
      cmds.push({ type: 'exchange', kind: 'sell', ruleKey: 'sell', give, giveQty: sr.give, getQty: sr.get });
    }
  }
  if (cr.enabled && state.convertUsedThisVisit < 1) {
    for (const give of SECTORS) {
      if (p.resources[RESOURCE_OF[give]] < cr.give) continue;
      for (const take of SECTORS) if (take !== give) cmds.push({ type: 'exchange', kind: 'convert', ruleKey: 'convert', give, take, giveQty: cr.give, getQty: cr.get });
    }
  }
  // Alternativa alle Commesse: uscire con un bonus fisso e/o rinfrescare un mercato — esclusiva con
  // completare Commesse nella stessa visita (in entrambe le direzioni, vedi sotto).
  const exitPathOpen = state.contractsThisVisit === 0;
  if (state.borsaExit.enabled && exitPathOpen && !state.borsaExitUsed) {
    cmds.push({ type: 'borsaExit', coins: state.borsaExit.coins });
  }
  if (state.borsaRefresh.enabled && exitPathOpen && !state.borsaRefreshUsed) {
    cmds.push({ type: 'refreshMarket', target: 'welfare' });
    cmds.push({ type: 'refreshMarket', target: 'workers' });
  }
  // Ricerca e Sviluppo: il "secondo palazzo" della Borsa, mercato tile tracciato (2.0). Stessa esclusività
  // di bonus/refresh — alternativa alle Commesse nella stessa visita, ma combinabile con bonus/refresh.
  // Catalogo condiviso dai 3 reparti, mercato e scorta restano per reparto (vedi trackTileStock).
  if (exitPathOpen) {
    for (const role of DEPT_ROLES) {
      const d = p.depts[role];
      for (const [marketStr, pos] of Object.entries(state.tileSlotPos[role])) {
        const market = Number(marketStr);
        if (d.tileFills[pos]) continue; // slot già riempito
        if (d.prod < (state.marketUnlockPos[role][market] ?? Infinity)) continue; // milestone non ancora raggiunta
        for (const t of tileOptions(state, p, role, market)) cmds.push({ type: 'buyTrackTile', role, pos, tileId: t.id });
      }
    }
  }
  if (state.contractsThisVisit < MAX_CONTRACTS_PER_VISIT && !state.borsaExitUsed && !state.borsaRefreshUsed && !state.borsaTileUsed) {
    const ms = milestoneCount(state, p);
    for (const size of ['small', 'medium', 'large']) {
      if (ms < (state.contractMilestoneReq?.[size] || 0)) continue; // gate milestone per taglia
      state.contracts[size].active.forEach((slot, slotIndex) => {
        if (!slot) return;
        slot.card.reqs.forEach((req, reqIndex) => {
          if (slot.doneReq[reqIndex]) return;
          if (canPay(p, req)) cmds.push({ type: 'completeContract', size, slotIndex, reqIndex });
        });
      });
    }
  }
  cmds.push({ type: 'endTurn' });
  return cmds;
}

// quante milestone di tracciato ha raggiunto un giocatore (reparti con prod ≥ soglia milestone)
export function milestoneCount(state, p) {
  return DEPT_ROLES.filter(r => p.depts[r].prod >= state.milestonePos[r]).length;
}

// --- Effetti carte struttura (modalità 'struttura') ---
// Effetti su coppie di nodi: id "hire-1_A+B" / "freeSecond_A+B" (vecchio single-node "hire-1_A" resta valido).
const effectNodes = (e, prefix) => e.startsWith(prefix) ? e.slice(prefix.length).split('+') : [];
// sconto assunzione al nodo corrente: -1 per ogni carta hire-1 che copre questo nodo
function structHireDiscount(p, node) {
  return (p.struttura || []).filter(e => effectNodes(e, 'hire-1_').includes(node)).length;
}
// costo per entrare in un nodo: gratis se possiedi freeSecond che copre questo nodo ed entri come 2° occupante
function moveCost(p, node, occupants) {
  if (node === 'Borsa' || occupants === 0) return 0;
  if (occupants === 1 && (p.struttura || []).some(e => effectNodes(e, 'freeSecond_').includes(node))) return 0;
  return MOVE_COSTS[occupants];
}

function canPay(p, req) {
  const need = {};
  for (const s of req) need[s] = (need[s] || 0) + 1;
  return Object.entries(need).every(([s, n]) => p.resources[RESOURCE_OF[s]] >= n);
}

// ---------- Applicazione comandi ----------
// Clone ricorsivo per oggetti/array puri: molto più veloce di structuredClone sul hot path
// (l'AI chiama applyCommand a ogni lookahead). Le chiavi in STATIC_KEYS sono immutabili dopo
// initGame e vengono condivise per riferimento invece che clonate.
// borsaFabbriche/factoryMap/factoryHexById/factoryHexes/hexResource: geometria+config, scritte solo in
// initGame (verificato: nessun write nel path di applyCommand) → condivise per riferimento invece di clonate.
// L'occupazione delle fabbriche vive in hexFactory (mutabile), non qui.
const STATIC_KEYS = new Set(['tracks', 'milestonePos', 'marketUnlockPos', 'tileSlotPos', 'welfareById', 'trackTileById', 'rules', 'nations', 'nodeBanks', 'bankIds', 'borsaFabbriche', 'factoryMap', 'factoryHexById', 'factoryHexes', 'hexResource']);
function deepClone(o) {
  if (o === null || typeof o !== 'object') return o;
  if (Array.isArray(o)) { const n = o.length, a = new Array(n); for (let i = 0; i < n; i++) a[i] = deepClone(o[i]); return a; }
  const r = {};
  for (const k in o) r[k] = deepClone(o[k]);
  return r;
}
function cloneState(prev) {
  const s = {};
  for (const k in prev) s[k] = STATIC_KEYS.has(k) ? prev[k] : deepClone(prev[k]);
  return s;
}

export function applyCommand(prev, cmd) {
  const state = cloneState(prev);
  const p = currentPlayer(state);

  switch (cmd.type) {
    case 'strikeBlock': {
      const pend = state.pending;
      const owner = state.players[pend.playerId];
      const dept = owner.depts[pend.role];
      dept.blocked.push(cmd.cardId);
      const wBlk = WORKER_BY_ID[cmd.cardId];
      let setback = '';
      // Le carte Sopra avevano avanzato il tracciato del loro V all'assunzione: bloccandole lo si toglie.
      if (dept.sopra.includes(cmd.cardId)) {
        const floor = SETUP[dept.role].prod;
        const before = dept.prod;
        dept.prod = Math.max(floor, dept.prod - wBlk.v);
        if (dept.prod < before) setback = ` — tracciato ${dept.sector} indietro a ${dept.prod} (−${before - dept.prod})`;
      }
      log(state, `${owner.name} blocca «${wBlk.effectText}» (${wBlk.sector}) per lo Sciopero${setback}.`);
      state.pending = null;
      advancePending(state);
      if (!state.pending) afterResolution(state);
      return state;
    }
    case 'resolveTrackTile': {
      const pend = state.pending;
      const owner = state.players[pend.playerId];
      if (cmd.use) installTrackTile(state, owner, { role: pend.role, pos: pend.pos, tileId: cmd.tileId });
      else log(state, `${owner.name} rinuncia alla tile di ${owner.depts[pend.role].sector} (slot ${pend.pos}): resta comprabile alla Borsa.`);
      state.pending = null;
      advancePending(state);
      if (!state.pending) afterResolution(state);
      return state;
    }
    case 'resolveEffect': {
      const pend = state.pending;
      const owner = state.players[pend.playerId];
      const w = WORKER_BY_ID[pend.cardId];
      const F = formulaOf(w);
      if (cmd.use) {
        const giveSec = F.f1.tipo === 'risorsa' ? (F.f1.settore === 'scelta' ? cmd.give : sectorOf(F.f1, w)) : null;
        const takeSec = F.f2.tipo === 'risorsa' ? (F.f2.settore === 'scelta' ? cmd.take : sectorOf(F.f2, w)) : null;
        payF(state, owner, w, F, F.f1, giveSec);            // paga f1 (monete via Borsa, o risorsa → 'vendita'/'scambio')
        const gq = Number(F.f2?.q) || 0;                    // guardia: q mancante/NaN → nessun guadagno (no stato corrotto)
        if (gq > 0) {
          if (F.f2.tipo === 'moneta') addCoins(state, owner, gq, 'scambio');
          else if (RESOURCE_OF[takeSec]) convRes(owner, takeSec, gq, F.f1.tipo === 'moneta' ? 'acquisto' : 'scambio');
        }
        log(state, `${owner.name}: scambia (${w.effectText}).`);
      }
      state.pending = null;
      advancePending(state);
      if (!state.pending) afterResolution(state);
      return state;
    }
    case 'move': {
      const occupants = state.players.filter(q => q.node === cmd.node).length;
      spendCoins(p, 'movimento', moveCost(p, cmd.node, occupants)); // effetto struttura "2° posto gratis" incluso
      p.prevNode = p.node;
      p.node = cmd.node;
      p.nodeVisits[cmd.node] = (p.nodeVisits[cmd.node] || 0) + 1;
      state.phase = cmd.node === 'Borsa' ? 'borsa' : 'action';
      log(state, `${p.name} sposta il Procuratore a ${cmd.node}.`);
      return state;
    }
    case 'hire':
      return doHire(state, p, cmd);
    case 'activate':
      return doActivate(state, p, cmd.sector);
    case 'buyWelfare':
      return doBuyWelfare(state, p, cmd);
    case 'buyStruttura':
      return doBuyStruttura(state, p, cmd);
    case 'buyShare':
      return doBuyShare(state, p, cmd);
    case 'buildFactory':
      return doBuildFactory(state, p, cmd);
    case 'buyTrackTile':
      return doBuyTrackTile(state, p, cmd);
    case 'trattativa':
      return doTrattativa(state, p, cmd);
    case 'exchange': {
      const gq = cmd.giveQty ?? (cmd.kind === 'sell' ? 1 : 2), kq = cmd.getQty ?? 1;
      if (cmd.kind === 'sell') {
        spendRes(p, cmd.give, gq, 'vendita'); addCoins(state, p, kq, 'scambio');
        log(state, `${p.name} vende ${gq} ${RESOURCE_OF[cmd.give]} per ${kq} marchi.`);
        state.sellUsedThisVisit++;
      } else {
        spendRes(p, cmd.give, gq, 'scambio'); convRes(p, cmd.take, kq, 'scambio');
        log(state, `${p.name} scambia ${gq} ${RESOURCE_OF[cmd.give]} → ${kq} ${RESOURCE_OF[cmd.take]}.`);
        state.convertUsedThisVisit++;
      }
      checkObjectives(state, p);
      return state;
    }
    case 'completeContract':
      return doContract(state, p, cmd);
    case 'borsaExit':
      addCoins(state, p, cmd.coins, 'scambio');
      state.borsaExitUsed = true;
      log(state, `${p.name} esce dalla Borsa con ${cmd.coins} marchi.`);
      checkObjectives(state, p);
      return state;
    case 'refreshMarket':
      if (cmd.target === 'welfare') refreshWelfareMarket(state, `Borsa, ${p.name}`);
      else refreshBanks(state, `Borsa, ${p.name}`);
      state.borsaRefreshUsed = true;
      return state;
    case 'pass': {
      log(state, `${p.name} rinuncia all'azione.`);
      finishTurn(state);
      return state;
    }
    case 'endTurn': {
      finishTurn(state);
      return state;
    }
    default:
      throw new Error(`Comando sconosciuto: ${cmd.type}`);
  }
}

// dopo la coda di pending (effetti/scioperi) si chiude l'azione → fine turno
function afterResolution(state) {
  if (state.phase === 'resolving') {
    state.activationCoins !== null && recordActivation(state);
    finishTurn(state);
  }
}

function recordActivation(state) {
  const p = currentPlayer(state);
  if (state.activationCoins > p.maxActivationCoins) p.maxActivationCoins = state.activationCoins;
  state.activationCoins = null;
}

function doHire(state, p, cmd) {
  const w = WORKER_BY_ID[cmd.cardId];
  const bank = state.banks[cmd.bank];
  const i = bank.indexOf(cmd.cardId);
  if (i < 0 || i >= bankDepth(cmd.bank)) throw new Error('carta non scoperta nel banco');
  bank.splice(i, 1);
  const base = cmd.discount ? Math.max(0, w.v - (cmd.discountAmount ?? 1)) : w.v;
  spendCoins(p, w.power ? 'direzione' : 'lavoratori', Math.max(0, base - structHireDiscount(p, p.node))); // effetto struttura "-1 al nodo X"
  p.lastHireTurn = state.turn;
  const dept = p.depts[cmd.role];
  if (cmd.side === 'sopra' && w.power) {
    // Impiegato: occupa 1 slot Sopra in Direzione, avanza ENTRAMBI i settori indicati.
    p.direzione.sopra.push(w.id);
    if (p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] == null) p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] = state.turn;
    for (const [sector, amt] of Object.entries(w.power)) {
      advanceTrack(state, p, deptOfSector(p, sector), amt, 'assunzione Sopra (impiegato)');
    }
    p.lastDirTurn = state.turn;
    log(state, `${p.name} assume ${w.nation} [V${w.v}] in Direzione (Sopra): avanza ${Object.entries(w.power).map(([s, n]) => `${s} +${n}`).join(', ')}.`);
  } else if (cmd.side === 'sopra') {
    dept.sopra.push(w.id);
    if (dept.slotTurn.sopra[dept.sopra.length - 1] == null) dept.slotTurn.sopra[dept.sopra.length - 1] = state.turn;
    log(state, `${p.name} assume ${w.nation} ${w.sector} [V${w.v}] Sopra in ${dept.sector}.`);
    advanceTrack(state, p, dept, w.v, 'assunzione Sopra');
  } else {
    dept.sotto.push(w.id);
    if (dept.slotTurn.sotto[dept.sotto.length - 1] == null) dept.slotTurn.sotto[dept.sotto.length - 1] = state.turn;
    log(state, `${p.name} assume ${w.nation} ${w.sector || '(2 reparti)'} [V${w.v}] Sotto in ${dept.sector}: «${w.effectText || 'nessun bonus'}».`);
  }
  checkObjectives(state, p);
  if (!cmd.viaTrattativa) finishTurn(state);
  return state;
}

function doActivate(state, p, sector) {
  const dept = deptOfSector(p, sector);
  p.activations += 1;
  p.activationsBySector[sector] = (p.activationsBySector[sector] || 0) + 1;
  noteIndexEvent(state, 'attivazioni', sector);
  state.activationCoins = 0;
  log(state, `${p.name} attiva il reparto ${sector}.`);
  // 1. Tensione +1 (se il reparto non è vuoto)
  raiseTension(state, p, dept, 1, 'attivazione');
  // 2. Risorse dal tracciato
  trackProduction(state, p, dept);
  // 3. Carte Sotto non bloccate. Se factoryActivates è ON, ogni carta scatta N volte = fabbriche del settore
  // del reparto (floor 1 = comportamento normale, cap 3). Le fabbriche potenziano le attivazioni bonus.
  let sottoTimes = 1;
  if (state.borsaFabbriche.enabled && state.borsaFabbriche.factoryActivates) {
    const nFab = Math.max(1, factoryStrength(state, p, dept.sector));
    const cap = state.borsaFabbriche.factoryMultCap ?? 3;   // 0 = illimitato
    sottoTimes = cap > 0 ? Math.min(cap, nFab) : nFab;
  }
  const cards = dept.sotto.filter(id => !dept.blocked.includes(id));
  // passata BASE (1×): quello che scatterebbe anche senza fabbriche
  const c0 = p.coins, r0 = totalResources(p);
  for (const id of cards) applyCardEffect(state, p, dept, WORKER_BY_ID[id]);
  p.sottoVal.baseC += p.coins - c0; p.sottoVal.baseR += totalResources(p) - r0;
  // passate EXTRA (2ª/3ª) dovute alle fabbriche: il valore attribuito al moltiplicatore
  if (sottoTimes > 1) {
    const c1 = p.coins, r1 = totalResources(p);
    for (let t = 1; t < sottoTimes; t++) for (const id of cards) applyCardEffect(state, p, dept, WORKER_BY_ID[id]);
    p.sottoVal.extraC += p.coins - c1; p.sottoVal.extraR += totalResources(p) - r1;
  }
  // 4. Sciopero (dopo aver incassato)
  state.phase = 'resolving';
  checkStrike(state, p, dept);
  checkObjectives(state, p);
  if (!state.pending) {
    recordActivation(state);
    finishTurn(state);
  }
  return state;
}

// ===== Formula generica degli effetti carta lavoratore: (f1)(verbo)(f2) =====
// verbo: 'prendi' = guadagna f1 · 'scambia' = paga f1 → guadagna f2 · 'perOgni' = guadagna f1 × conteggio(f2).
// fattore risorsa/moneta: { q, tipo:'risorsa'|'moneta', settore } (settore: 'Tessile'.. | 'scelta' | 'carta').
// contatore (f2 di perOgni): { conta:'icona'|'nazione'|'tensione', kind?, di? }.
// I tipi legacy vengono convertiti al volo → nessuna migrazione dati, comportamento identico.
export function legacyToFormula(eff) {
  switch (eff.type) {
    case 'take_res':        return { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'carta' } };
    case 'take_coins':      return { verbo: 'prendi', f1: { q: eff.amount, tipo: 'moneta' } };
    case 'coin_per_nation': return { verbo: 'perOgni', f1: { q: eff.amount, tipo: 'moneta' }, f2: { conta: 'nazione' } };
    case 'coins_per_icon':  return { verbo: 'perOgni', f1: { q: eff.amount, tipo: 'moneta' }, f2: { conta: 'icona', kind: eff.icon.kind, di: eff.icon.value } };
    case 'res_per_tension': return { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'carta' }, f2: { conta: 'tensione' } };
    case 'swap_res_any':    return { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } };
    case 'buy_res_2m':      return { verbo: 'scambia', f1: { q: 2, tipo: 'moneta' }, f2: { q: 1, tipo: 'risorsa', settore: 'scelta' } };
    case 'swap_res_3m':     return { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { q: 3, tipo: 'moneta' } };
    default:                return { verbo: 'prendi', f1: { q: 0, tipo: 'moneta' } };
  }
}
export function formulaOf(w) { return w.effect?.verbo ? w.effect : legacyToFormula(w.effect); }

const sectorOf = (op, w) => (op.settore === 'carta' ? w.sector : op.settore);
function countOf(f2, owner, dept, welfareById) {
  if (f2.conta === 'tensione') return dept.tension;
  if (f2.conta === 'nazione') return distinctNations(owner, true);
  if (f2.conta === 'icona') return f2.kind === 'nation' ? nationCount(owner, f2.di, true) : iconCount(owner, f2.di, welfareById);
  // fabbrica: quante fabbriche possiede del settore del reparto in cui la carta è installata
  // (carta Sotto nel Tessile → conta le fabbriche Tessili sulla mappa). Vedi Borsa a fabbriche.
  if (f2.conta === 'fabbrica') return (owner.factories || []).filter(fac => fac.sector === dept.sector).length;
  return 0;
}
const coinGainTag = F => {
  if (F.verbo === 'scambia') return 'scambio';
  if (F.verbo !== 'perOgni') return 'lavFisso';
  if (F.f2.conta === 'nazione') return 'lavNazioni';
  if (F.f2.conta === 'tensione') return 'lavTensione';
  if (F.f2.conta === 'fabbrica') return 'lavFabbrica';
  return 'lavIcone';
};
function gainF(state, owner, w, F, op, mult) {
  const amt = (Number(op?.q) || 0) * mult;
  if (!(amt > 0)) return; // scarta NaN / q mancante / ≤0: una formula editata malformata è no-op, non corrompe lo stato
  if (op.tipo === 'moneta') { addCoins(state, owner, amt, coinGainTag(F)); return; }
  const sec = sectorOf(op, w);
  if (!RESOURCE_OF[sec]) return; // settore non valido (es. 'scelta' fuori dal pending, o vuoto) → no-op
  if (F.verbo === 'scambia') convRes(owner, sec, amt, F.f1.tipo === 'moneta' ? 'acquisto' : 'scambio');
  else addRes(owner, sec, amt, 'bonus');
}
const canPayF = (owner, w, op) => (op.tipo === 'moneta' ? owner.coins >= op.q : owner.resources[RESOURCE_OF[sectorOf(op, w)]] >= op.q);
function payF(state, owner, w, F, op, sector) {
  const q = Number(op?.q) || 0;
  if (q <= 0) return;
  if (op.tipo === 'moneta') { spendCoins(owner, 'borsa', q); return; }
  const sec = sector ?? sectorOf(op, w);
  if (!RESOURCE_OF[sec]) return; // settore non valido → no-op (niente risorse NaN)
  spendRes(owner, sec, q, F.f2?.tipo === 'moneta' ? 'vendita' : 'scambio');
}

// bucket di una formula 'scambia' (stessa classificazione di convRes/gainF): che tipo di conversione è.
export const convBucketOf = F => (F.f1.tipo === 'moneta' ? 'marchiRisorsa' : F.f2.tipo === 'moneta' ? 'risorsaMarchi' : 'risorsaRisorsa');

function applyCardEffect(state, owner, dept, w) {
  const F = formulaOf(w);
  // effetto con scelta di settore (risorsa 'scelta') → il giocatore risolve via pending
  if (F.verbo === 'scambia' && (F.f1?.settore === 'scelta' || F.f2?.settore === 'scelta')) {
    if (owner.convAttempts) owner.convAttempts[convBucketOf(F)]++; // pending offerto: opportunità, indipendente dall'uso
    state.pendingQueue.push({ type: 'effect', playerId: owner.id, cardId: w.id, role: dept.role });
    advancePending(state);
    return;
  }
  if (F.verbo === 'prendi') { gainF(state, owner, w, F, F.f1, 1); return; }
  if (F.verbo === 'perOgni') { const c = countOf(F.f2, owner, dept, state.welfareById); if (c > 0) gainF(state, owner, w, F, F.f1, c); return; }
  if (F.verbo === 'scambia') {
    if (owner.convAttempts) owner.convAttempts[convBucketOf(F)]++; // carta in gioco al momento dell'attivazione, affordabile o no
    if (canPayF(owner, w, F.f1)) { payF(state, owner, w, F, F.f1); gainF(state, owner, w, F, F.f2, 1); }
  }
}

// Compra un'azione dell'indice `cmd.index` per il quadrimestre corrente. Biglietto one-shot: paga solo
// alla chiusura di QUESTO quadrimestre, poi p.shares viene azzerato (vedi payoutQuad).
function doBuyShare(state, p, cmd) {
  const price = state.borsaIndici.prices[state.quad] ?? 0;
  p.borsaBuys.push({
    turn: state.turn, quad: state.quad, index: cmd.index,
    rankAtBuy: rankedIndices(state).indexOf(cmd.index),
    valueAtBuy: indexValue(state, cmd.index),
    investorsAtBuy: state.players.filter(q => q.shares[cmd.index]).length,
    price, coinsBefore: p.coins, nFree: indexNames(state).filter(n => !p.shares[n]).length,
  });
  spendCoins(p, 'azioni', price);
  p.shares[cmd.index] = true;
  const others = state.players.filter(q => q.id !== p.id && q.shares[cmd.index]).length;
  log(state, `${p.name} compra un'azione ${cmd.index} per ${price} ⓜ (Q${state.quad + 1}, indice a ${indexValue(state, cmd.index)}, ${others + 1} investitori).`);
  checkObjectives(state, p);
  finishTurn(state);
  return state;
}

// Fonda una fabbrica: paga il costo a scalare, consuma un credito del settore, occupa l'esagono,
// incassa subito 1 risorsa del settore. Poi produce +1 di quel settore a ogni startTurn.
// un sito è "conteso" se un vicino è già occupato da un AVVERSARIO (stesso giocatore non conta)
function isContestedSpot(state, hex, playerId) {
  return (state.factoryMap.adj[hex] || []).some(n => state.hexFactory[n] && state.hexFactory[n].playerId !== playerId);
}
function doBuildFactory(state, p, cmd) {
  const cost = factoryCost(state, p);
  const neutral = state.borsaFabbriche.neutralFactory;
  // scelta contesa vs alternative: quanti altri siti legali erano liberi da avversari (telemetria batchsim)
  const legal = factoryBuildSpots(state, cmd.sector);
  const chosenContested = isContestedSpot(state, cmd.hex, p.id);
  const nUncontestedAlt = legal.filter(h => h !== cmd.hex && !isContestedSpot(state, h, p.id)).length;
  (state.factoryChoiceLog ||= []).push({ chosenContested, nUncontestedAlt });
  spendCoins(p, 'azioni', cost);
  if (neutral) {
    // fabbrica NEUTRA: nessun credito, nessun settore proprio. hexFactory senza sector (le maggioranze
    // contano le fabbriche a prescindere dal colore); factories = {hex, turn}.
    state.hexFactory[cmd.hex] = { playerId: p.id };
    p.factories.push({ hex: cmd.hex, turn: state.turn });
    let got = [];
    if (state.borsaFabbriche.foundingResource) {  // 1 risorsa per colore adiacente distinto
      for (const sec of adjacentSectors(state, cmd.hex)) { addRes(p, sec, 1, 'fabbrica'); got.push(RESOURCE_OF[sec]); }
    }
    log(state, `${p.name} fonda una fabbrica su ${cmd.hex} per ${cost} ⓜ${got.length ? ` (incassa ${got.join(' + ')})` : ''}.`);
  } else {
    p.factoryCredits[cmd.sector] -= 1;
    state.hexFactory[cmd.hex] = { playerId: p.id, sector: cmd.sector };
    p.factories.push({ hex: cmd.hex, sector: cmd.sector, turn: state.turn });
    if (state.borsaFabbriche.foundingResource) addRes(p, cmd.sector, 1, 'fabbrica');
    log(state, `${p.name} fonda una fabbrica ${cmd.sector} su ${cmd.hex} per ${cost} ⓜ.`);
  }
  checkObjectives(state, p);
  finishTurn(state);
  return state;
}

function doBuyWelfare(state, p, cmd) {
  const wf = state.welfareById[cmd.cardId];
  spendCoins(p, 'direzione', wf.v);
  p.lastDirTurn = state.turn;
  const mi = state.welfareMarket.indexOf(cmd.cardId);
  if (mi >= 0) state.welfareMarket.splice(mi, 1); // rimuove UNA copia (col mazzo a copie multiple il filter le toglierebbe tutte)
  if (state.welfareDrawPile.length) state.welfareMarket.push(state.welfareDrawPile.shift()); // refresh dal mazzo
  if (cmd.side === 'sopra') {
    p.direzione.sopra.push(wf.id);
    if (p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] == null) p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] = state.turn;
    log(state, `${p.name} installa ${wf.name} [V${wf.v}] come Welfare (Sopra).`);
    advanceTrack(state, p, deptOfSector(p, wf.s1), wf.t1, wf.name);
    advanceTrack(state, p, deptOfSector(p, wf.s2), wf.t2, wf.name);
  } else {
    p.direzione.sotto.push({ id: wf.id, usesLeft: wf.usesMax });
    if (p.direzione.slotTurn.sotto[p.direzione.sotto.length - 1] == null) p.direzione.slotTurn.sotto[p.direzione.sotto.length - 1] = state.turn;
    if (p.firstMachineTurn == null) p.firstMachineTurn = state.turn; // turno del gate Borsa (1° Macchinario installato)
    log(state, `${p.name} installa ${wf.name} [V${wf.v}] come Macchinario (Sotto): ${wf.perUse.map(s => RESOURCE_OF[s]).join('+')} × ${wf.usesMax} turni.`);
  }
  checkObjectives(state, p);
  finishTurn(state);
  return state;
}

// Tile tracciato: riempie uno slot (7/11/15) già superato con l'effetto scelto. Non avanza `prod`
// (lo slot è alle spalle, non davanti) — niente advanceTrack. Il suo effetto scatta subito una tantum
// all'installazione (in più, non in sostituzione: produce comunque dalla prossima "Attiva reparto").
// Installazione vera e propria: condivisa dal trigger di raggiungimento (resolveTrackTile) e dalla Borsa
// (buyTrackTile). Il flag di esclusività con le Commesse appartiene solo al percorso Borsa, sta in doBuyTrackTile.
function installTrackTile(state, p, cmd) {
  const tile = state.trackTileById[cmd.tileId];
  const d = p.depts[cmd.role];
  spendRes(p, d.sector, tile.cost, 'tile'); // costo in risorse del proprio settore, non marchi
  d.tileFills[cmd.pos] = tile.id;
  if (state.trackTileCap.mode === 'limitato') state.trackTileStock[cmd.role][tile.id] = Math.max(0, (state.trackTileStock[cmd.role][tile.id] ?? 0) - 1);
  const g = cellGain(p, d, { [tile.cellType]: tile.amount }, state.welfareById);
  const acc = p.tileGains[tile.id] ?? (p.tileGains[tile.id] = { coins: 0, res: 0, uses: 0 });
  if (g?.coins) { addCoins(state, p, g.coins, 'trackTile'); acc.coins += g.coins; acc.uses++; log(state, `${p.name} installa la tile "${tile.name}" su ${d.sector} (pos.${cmd.pos}): +${g.coins} ⓜ subito.`); }
  else if (g?.res) { addRes(p, d.sector, g.res, 'trackTile'); acc.res += g.res; acc.uses++; log(state, `${p.name} installa la tile "${tile.name}" su ${d.sector} (pos.${cmd.pos}): +${g.res} ${RESOURCE_OF[d.sector]} subito.`); }
  else if (tile.cellType === 'pv') log(state, `${p.name} installa la tile "${tile.name}" su ${d.sector} (pos.${cmd.pos}): +${tile.amount} PV a fine partita.`);
  else log(state, `${p.name} installa la tile "${tile.name}" su ${d.sector} (pos.${cmd.pos}).`);
  checkObjectives(state, p);
}

function doBuyTrackTile(state, p, cmd) {
  installTrackTile(state, p, cmd);
  state.borsaTileUsed = true; // esclude le Commesse nella stessa visita (come bonus/refresh), ma non finisce il turno: si resta alla Borsa
  return state;
}

// modalità 'struttura': compra una carta al nodo e la installa in Direzione.
// Sopra = la potenza avanza i 3 tracciati (una volta). Sotto = l'effetto diventa passivo.
// Le carte in Direzione contano per welfareCount (sblocco azioni Sindacato), come i vecchi Welfare.
function doBuyStruttura(state, p, cmd) {
  const card = state.strutturaCards[cmd.idx];
  if (!card || !state.strutturaMarket.includes(cmd.idx)) throw new Error('carta struttura non disponibile');
  spendCoins(p, 'direzione', card.cost);
  p.lastDirTurn = state.turn;
  if (cmd.side === 'sopra') {
    p.direzione.sopra.push({ struttura: true, idx: cmd.idx });
    if (p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] == null) p.direzione.slotTurn.sopra[p.direzione.sopra.length - 1] = state.turn;
    for (const sector of SECTORS) {
      const n = card.power?.[sector] || 0;
      if (n > 0) advanceTrack(state, p, deptOfSector(p, sector), n, 'carta struttura');
    }
    log(state, `${p.name} installa una carta Struttura Sopra (costo ${card.cost}): potenza ${SECTORS.map(s => `${s[0]}${card.power?.[s] || 0}`).join('/')}.`);
  } else {
    p.direzione.sotto.push({ struttura: true, idx: cmd.idx, effect: card.effect });
    if (p.direzione.slotTurn.sotto[p.direzione.sotto.length - 1] == null) p.direzione.slotTurn.sotto[p.direzione.sotto.length - 1] = state.turn;
    if (p.firstMachineTurn == null) p.firstMachineTurn = state.turn; // turno del gate Borsa (1° Macchinario installato)
    p.struttura.push(card.effect);
    log(state, `${p.name} installa una carta Struttura Sotto (costo ${card.cost}): effetto ${card.effect}.`);
  }
  state.strutturaMarket = state.strutturaMarket.filter(i => i !== cmd.idx);
  checkObjectives(state, p);
  finishTurn(state);
  return state;
}

function doTrattativa(state, p, cmd) {
  log(state, `${p.name}: Trattativa sindacale.`);
  p.sindacato.trattative += 1;
  noteIndexEvent(state, 'trattative', 'Sindacato');
  const T = state.trattativa;
  // Azzera un proprio reparto (azione configurabile)
  if (T.resetOwn.enabled && p.coins >= T.resetOwn.cost) {
    spendCoins(p, 'sindacato', T.resetOwn.cost);
    const myDept = p.depts[cmd.resetRole];
    myDept.tension = 0;
    log(state, `${p.name} azzera la Tensione di ${myDept.sector}.`);
  }
  // +1 Tensione a un avversario (azione configurabile)
  if (T.attackOther.enabled && cmd.targetPlayer != null && p.coins >= T.attackOther.cost) {
    spendCoins(p, 'sindacato', T.attackOther.cost);
    const opp = state.players[cmd.targetPlayer];
    const oppDept = opp.depts[cmd.targetRole];
    raiseTension(state, opp, oppDept, 1, `Trattativa di ${p.name}`);
    checkStrike(state, opp, oppDept, true);
  }
  if (cmd.f2 === 'unblock' && state.trattativa.unblock.enabled) {
    p.sindacato.unblock += 1;
    const cost = state.trattativa.unblock.cost;
    spendCoins(p, 'sindacato', cost);
    const d = p.depts[cmd.f2role];
    d.blocked = d.blocked.filter(id => id !== cmd.f2card);
    // ripristina il V sul tracciato se la carta liberata è una Sopra (senza ripagare le caselle già riscosse,
    // per questo non passa da advanceTrack — ma le milestone tile vanno comunque controllate)
    if (d.sopra.includes(cmd.f2card)) {
      const before = d.prod;
      d.prod = Math.min(state.trackMax, d.prod + WORKER_BY_ID[cmd.f2card].v);
      checkTileUnlocks(state, p, d, before, d.prod);
    }
    log(state, `${p.name} paga ${cost} marchi e libera una carta in ${d.sector}.`);
  }
  state.phase = 'resolving';
  checkObjectives(state, p);
  if (!state.pending) finishTurn(state);
  return state;
}

function doContract(state, p, cmd) {
  const entry = state.contracts[cmd.size];
  const slotIndex = cmd.slotIndex ?? 0;
  const slot = entry.active[slotIndex];
  const req = slot.card.reqs[cmd.reqIndex];
  for (const s of req) spendRes(p, s, 1, 'commesse');
  p.resToContracts += req.length; // risorse convertite in commesse (per "risorse sprecate")
  slot.doneReq[cmd.reqIndex] = true;
  const place = state.singlePlace ? 0 : (slot.places[0] === null ? 0 : 1);
  slot.places[place] = p.id;
  const pv = slot.card.pv[place];
  p.contractsWon.push({ cardId: slot.card.id, size: cmd.size, place, pv, reqIndex: cmd.reqIndex, req: [...req], turn: state.turn });
  state.contractsThisVisit += 1;
  log(state, `${p.name} completa una Commessa ${cmd.size === 'small' ? 'piccola' : cmd.size === 'medium' ? 'media' : 'grande'} (${place + 1}° posto, ${pv} PV). Clock +1.`);
  // rinfresca quando la carta è esaurita: single-place o tutte le sue commesse completate
  if (state.singlePlace || slot.doneReq.every(Boolean)) {
    drawContract(entry, slotIndex);
    log(state, `Carta Commesse sostituita.`);
  }
  advanceClock(state, 1);
  checkObjectives(state, p);
  return state;
}
