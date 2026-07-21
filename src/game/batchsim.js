// Simulazione in serie nel browser: N partite tra AI + report testuale copiabile.
import { initGame, applyCommand, scorePlayer, WORKER_BY_ID, formulaOf, convBucketOf, describeCond, tileValue, bankMarket, legalCommands, indexNames, indexValue, factoryMajorityWinner } from './engine.js';
import { chooseCommand } from './ai.js';
import { SECTORS, OBJECTIVE_TILES, WELFARE, TRACK_TILES, IMPIEGATI_BANK, RESOURCE_OF, FACTORY_MAP } from './data.js';


// categoria azione per la heatmap: comando → colonna
// NB colonne storiche: 'Servizi' = nodo id Servizi (a schermo "Borsa"), 'Borsa' = nodo id Borsa (a schermo
// "Città") — vedi NODE_LABEL in data.js. buyShare avviene al nodo id Servizi → colonna 'Servizi'.
const ACTION_CAT = { hire: 'Assunzione', activate: 'Produzione', buyWelfare: 'Servizi', buyStruttura: 'Servizi', buyShare: 'Servizi', trattativa: 'Sindacato', completeContract: 'Borsa', exchange: 'Borsa', buyTrackTile: 'Borsa' };
// Il mercato Impiegati è un banco (quindi cmd.type 'hire') ma è l'azione del nodo Servizi. Contarlo tra le
// Assunzioni gonfia quella colonna (~7pp) e lascia Servizi inchiodata a 0, visto che le uniche azioni mappate
// lì — buyWelfare/buyStruttura — sono morte nel design 2.0 (welfareEnabled:false).
const catOf = cmd => (cmd.type === 'hire' && cmd.bank === IMPIEGATI_BANK ? 'Servizi' : ACTION_CAT[cmd.type]);
const HEAT_COLS = ['Assunzione', 'Produzione', 'Servizi', 'Sindacato', 'Borsa'];
const DEPT_ROLES_B = ['terziario', 'secondario', 'primario']; // per aggregare slotTurn sui 3 reparti
// firma leggibile del bonus lavoratore, dalla formula (funziona per carte legacy e formula-native)
function effSig(F) {
  if (F.verbo === 'prendi') return `prendi-${F.f1.tipo === 'moneta' ? 'marchi' : 'risorsa'}`;
  if (F.verbo === 'perOgni') return `${F.f1.tipo === 'moneta' ? 'marchi' : 'risorse'}×${F.f2.conta}`;
  if (F.verbo === 'scambia') return `scambia-${F.f1.tipo === 'moneta' ? 'marchi' : 'risorsa'}→${F.f2.tipo === 'moneta' ? 'marchi' : 'risorsa'}`;
  return '?';
}

// Marchi mai spesi, per partita: totale finali / totale disponibili (iniziali+guadagnati).
// UNA sola definizione, condivisa da DESIGN ALERT, sezione Economia e tabella indicatori — quando erano
// tre formule diverse lo stesso report stampava 24% e 16% con la stessa etichetta. NB: è un rapporto
// aggregato, non la media dei rapporti per giocatore: i due valori divergono parecchio perché i marchi
// non spesi si concentrano nei ricchi (vincitori ~2× i finali degli ultimi).
const unusedOf = g => {
  const got = g.econ.reduce((a, e) => a + e.start + e.gained, 0);
  return got ? g.econ.reduce((a, e) => a + e.final, 0) / got : 0;
};

const SIND_KEYS = ['trattative', 'unblock'];
const SIND_LABEL = { trattative: 'Tratt', unblock: 'Sblocca' };

const MAX_STEPS = 60000;

export function runOneGame(config) {
  let s = initGame(config);
  const P = s.nPlayers;
  // caselle ⓜ per posizione di tracciato (statico per la partita: dipende solo dal layout tracciati in config, non dallo stato) — Caso A vs B dell'autopsia accelerazione
  const coinCellFlag = {};
  for (const role of DEPT_ROLES_B) {
    coinCellFlag[role] = [];
    const track = s.tracks[role];
    for (let pos = 1; pos <= 16; pos++) { const cell = track[pos]; coinCellFlag[role][pos] = !!(cell && (cell.coins || cell.coinsPerIcon)); }
  }
  const tel = {
    coinsByRound: { 1: s.players.map(p => p.coins) },
    clockByRound: { 1: 0 },
    coinsGainedByRound: { 1: s.players.map(p => ({ ...p.coinsGainedBy })) }, // snapshot cumulativo per fonte, per l'autopsia dell'accelerazione
    coinsSpentByRound: { 1: s.players.map(p => ({ ...p.coinsSpentBy })) }, // idem per categoria di spesa: serve a datare "a cosa rinunci" per quadrimestre
    resGenByRound: { 1: s.players.map(p => ({ ...p.resGen })) }, // snapshot cumulativo risorse prodotte per settore, stesso pattern di coinsGainedByRound
    tracksByRound: { 1: s.players.map(p => DEPT_ROLES_B.map(r => p.depts[r].prod)) }, // posizione tracciato per round — quante caselle ⓜ sono "attive" (Caso A vs B)
    coinCellFlag,
    pvByRound: { 1: s.players.map(p => scorePlayer(s, p).total) }, // #1 timeline PV
    completions: [], firstContract: Array(P).fill(null),
    sopra: 0, sotto: 0,
    actions: [],   // {turn, cat} per la heatmap #3
    hires: [],     // {eff, seat} per bonus lavoratore #5
    exchange: { sell: 0, swap: 0 }, // azione Borsa fissa: sell=1 risorsa→3 marchi, swap=2 risorse→1 a scelta
    exchangeLog: [], // {turn, seat} per ogni azione Borsa — per misurare l'effetto del gate Macchinari nel tempo
    borsaExit: 0, borsaExitBySeat: Array(P).fill(0), // "esci con bonus fisso" invece delle Commesse (homebrew 13/07/2026)
    borsaRefresh: { welfare: 0, workers: 0 }, borsaRefreshBySeat: Array(P).fill(0), // refresh gratuito, per mercato scelto
    borsaVisits: [], // {turn, seat, didCommessa, didBonus, refreshTarget, conversions, coinsGained} — una per visita (vedi chiusura sotto)
    refreshLog: [], // {turn, seat, target, marketBefore, effective} — riempito post-partita (vedi sotto il loop)
    hireTurns: Array.from({ length: P }, () => []), // turni in cui quel seat ha assunto — per "refresh efficace"
    welfareBuyTurns: Array.from({ length: P }, () => []), // turni in cui quel seat ha comprato Welfare/Macchinario
    trackTileBuys: [], // {turn, seat, role, pos, tileId} — ogni acquisto di tile tracciato (2.0)
    turnSeat: { 1: s.current }, // turno → seat proprietario, per trovare "i prossimi 2 turni di quel giocatore"
    activateLog: [], // {turn, seat, sector} per ogni "Attiva reparto" — per contare produzioni residue dopo un acquisto Direzione (carta vs tempismo)
    sawSottoOption: Array(P).fill(false), // ha mai visto un Macchinario (Sotto) comprabile a Servizi? (accesso vs valore)
    strutturaSightings: 0, // quante volte il mercato Impiegati (mode 'struttura') non era vuoto quando un giocatore era a Servizi
    strutturaBuys: [], // {turn, seat} per ogni acquisto Impiegato (2.0, homebrew 15/07/2026)
    declineReasons: { risorsaRisorsa: {}, marchiRisorsa: {}, risorsaMarchi: {} }, // perché una conversione "a scelta" viene rifiutata
    blockedSurplusBySector: {}, // quando rifiuta per "nessuna commessa richiede": quale settore resta bloccato in eccesso
    blockedByCandidateCount: {}, // ...e quante commesse attive/sbloccate aveva davanti in quel momento (0/1/2/3+)
    blockedLog: [], // {turn, seat} degli stessi rifiuti — per collocarli nella fase di partita del giocatore (costruzione/conversione/finale)
    // pick-rate alto (92-99%): vincolo di cassa o valore uniforme? Ogni turno in cui la cima del banco al nodo
    // corrente è permettersela, registra se viene presa o no (e cosa fa invece), più il rapporto costo/marchi-in-mano.
    hireOffer: { total: 0, taken: 0, declinedInstead: {} },
    hireOfferByCostRatio: { low: { total: 0, taken: 0 }, mid: { total: 0, taken: 0 }, high: { total: 0, taken: 0 } },
    shareOffer: { total: 0, taken: 0, declinedInstead: {} }, // Borsa a indici: al nodo con azione pagabile, comprata o no?
    prodActByFab: { 0: 0, 1: 0, 2: 0, 3: 0 }, // ad ogni "Attiva reparto": fabbriche di quel settore possedute (0/1/2/3+)
    // Borsa a fabbriche: al nodo con un credito ma nessuna fabbrica fondata, PERCHÉ? (land-grab vs colore assente vs cassa)
    factoryBlocked: { spotsTaken: 0, noColorOnIsland: 0, cantAfford: 0, builtInstead: 0 },
  };
  // apparizioni per carta: quante volte una carta ENTRA nel mercato di un banco (cima per i banchi
  // lavoratori, una delle 3 scoperte per gli Impiegati), non quanti turni ci resta — così "apparsa"
  // misura l'esposizione al mercato, comparabile con "presa" per il vero pick-rate.
  tel.cardAppear = {};
  const bankSeen = {};
  const noteBankTop = bankId => {
    const prev = bankSeen[bankId] || new Set();
    const now = bankMarket(s, bankId);
    for (const id of now) if (!prev.has(id)) tel.cardAppear[id] = (tel.cardAppear[id] || 0) + 1;
    bankSeen[bankId] = new Set(now);
  };
  for (const b of s.bankIds) noteBankTop(b);

  // Superamento delle milestone che aprono i mercati tile: fotografa quante carte Sotto il giocatore ha
  // GIÀ installato in quel momento. Risponde a "le tile sostituiscono le carte Sotto?", a cui il conteggio
  // di fine partita non può rispondere (dice quante ce ne sono, non quando sono arrivate rispetto alla tile).
  // Osservato sullo stato, non sui comandi: coglie anche i reparti che superano la milestone senza poter
  // pagare la tile (nessun pending) — cioè proprio i casi che distinguono "non vuole" da "non può".
  const sottoTot = p => DEPT_ROLES_B.reduce((n, r) => n + p.depts[r].sotto.length, 0);
  const prodSeen = s.players.map(p => DEPT_ROLES_B.map(r => p.depts[r].prod));
  tel.milestoneSnap = [];
  const noteMilestoneCross = () => {
    s.players.forEach((p, seat) => DEPT_ROLES_B.forEach((role, ri) => {
      const from = prodSeen[seat][ri], to = p.depts[role].prod;
      if (to > from) {
        for (const [mStr, unlockPos] of Object.entries(s.marketUnlockPos[role] || {})) {
          if (unlockPos <= from || unlockPos > to) continue;
          tel.milestoneSnap.push({
            market: Number(mStr), seat, role, turn: s.turn,
            sottoTot: sottoTot(p), sottoDept: p.depts[role].sotto.length,
            pos: s.tileSlotPos[role]?.[Number(mStr)] ?? null,
            res: p.resources[RESOURCE_OF[p.depts[role].sector]], // risorse in mano: distingue "non vuole" da "non può"
          });
        }
      }
      prodSeen[seat][ri] = to;
    }));
  };

  let steps = 0, lastTurn = 1;
  let visit = null; // visita Borsa in corso: {turn, seat, didCommessa, didBonus, refreshTarget, conversions, coinsStart}
  const closeVisit = () => { if (visit) { tel.borsaVisits.push({ ...visit, coinsGained: s.players[visit.seat].coins - visit.coinsStart }); visit = null; } };
  while (!s.gameOver && steps < MAX_STEPS) {
    // osservazione pura (nessuna mutazione di stato): il giocatore corrente ha mai un Macchinario acquistabile in vista?
    const cp = s.players[s.current];
    if (s.phase === 'action' && cp.node === 'Servizi' && cp.direzione.sotto.length < s.slots.direzione.sotto) {
      const canSeeSotto = s.servicesMode === 'struttura'
        ? s.strutturaMarket.some(idx => cp.coins >= (s.strutturaCards[idx]?.cost ?? Infinity))
        : [...new Set(s.welfareMarket)].some(id => cp.coins >= s.welfareById[id].v);
      if (canSeeSotto) tel.sawSottoOption[s.current] = true;
    }
    // Impiegati (mode 'struttura'): quante volte il mercato aveva almeno una carta in vista a Servizi (a prescindere da slot/prezzo)
    if (s.phase === 'action' && cp.node === 'Servizi' && s.servicesMode === 'struttura' && s.strutturaMarket.length > 0) {
      tel.strutturaSightings++;
    }
    // offerta di assunzione al nodo corrente: le carte scoperte sono permettersele ORA (prima della scelta dell'IA)?
    const affordableTops = s.phase === 'action' && cp.node !== 'Borsa'
      ? (s.nodeBanks[cp.node] || [])
        .flatMap(bank => bankMarket(s, bank).map(cardId => ({ bank, cardId })))
        .filter(x => cp.coins >= WORKER_BY_ID[x.cardId].v)
      : [];
    const pendingBucket = s.pending?.type === 'effect' ? convBucketOf(formulaOf(WORKER_BY_ID[s.pending.cardId])) : null;
    // Borsa a indici: al nodo, con un'azione pagabile, ha comprato o no? (non-vuole vs non-può: qui PUÒ,
    // quindi ogni "no" è una scelta). Campiono PRIMA di chooseCommand come per hireOffer.
    const shareOffered = s.borsaIndici?.enabled && legalCommands(s).some(c => c.type === 'buyShare');
    // Borsa a fabbriche: al nodo Servizi con almeno un credito, perché non fonda? (land-grab / colore assente / cassa / fonda)
    if (s.borsaFabbriche?.enabled && cp.node === 'Servizi') {
      for (const sector of SECTORS) {
        if ((cp.factoryCredits[sector] || 0) <= 0) continue;
        const free = (s.factoryHexes || []).filter(id => s.factoryHexById[id].type === 'costruibile' && !s.hexFactory[id]
          && (s.factoryMap.adj[id] || []).some(nb => s.hexResource[nb] === sector));
        const colorOnIsland = Object.values(s.hexResource).includes(sector);
        if (free.length === 0) tel.factoryBlocked[colorOnIsland ? 'spotsTaken' : 'noColorOnIsland']++;
        else if (cp.coins < s.borsaFabbriche.costCurve[Math.min(cp.factories.length, s.borsaFabbriche.costCurve.length - 1)]) tel.factoryBlocked.cantAfford++;
        else tel.factoryBlocked.builtInstead++; // poteva, il resto lo dice se ha davvero fondato (cmd)
      }
    }
    const cmd = chooseCommand(s);
    if (!cmd) break;
    if (shareOffered) {
      tel.shareOffer.total++;
      if (cmd.type === 'buyShare') tel.shareOffer.taken++;
      else tel.shareOffer.declinedInstead[cmd.type] = (tel.shareOffer.declinedInstead[cmd.type] || 0) + 1;
    }
    if (affordableTops.length > 0) {
      const taken = cmd.type === 'hire' && affordableTops.some(x => x.bank === cmd.bank && x.cardId === cmd.cardId);
      tel.hireOffer.total++;
      const cheapest = affordableTops.reduce((a, b) => WORKER_BY_ID[a.cardId].v <= WORKER_BY_ID[b.cardId].v ? a : b);
      const ratio = cp.coins > 0 ? WORKER_BY_ID[cheapest.cardId].v / cp.coins : 1;
      const rBucket = tel.hireOfferByCostRatio[ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high'];
      rBucket.total++;
      if (taken) { tel.hireOffer.taken++; rBucket.taken++; }
      else tel.hireOffer.declinedInstead[cmd.type] = (tel.hireOffer.declinedInstead[cmd.type] || 0) + 1;
    }
    if (cmd.type === 'resolveEffect' && cmd.use === false && cmd.reason && pendingBucket) {
      const bucket = tel.declineReasons[pendingBucket];
      bucket[cmd.reason] = (bucket[cmd.reason] || 0) + 1;
      if (pendingBucket === 'risorsaRisorsa' && cmd.reason === 'nessuna commessa richiede altre risorse ora') {
        tel.blockedSurplusBySector[cmd.give] = (tel.blockedSurplusBySector[cmd.give] || 0) + 1;
        const cKey = cmd.nCandidates >= 3 ? '3+' : String(cmd.nCandidates);
        tel.blockedByCandidateCount[cKey] = (tel.blockedByCandidateCount[cKey] || 0) + 1;
        tel.blockedLog.push({ turn: s.turn, seat: s.current });
      }
    }
    if (cmd.type === 'completeContract') {
      tel.completions.push({ size: cmd.size, turn: s.turn });
      if (tel.firstContract[s.current] === null) tel.firstContract[s.current] = s.turn;
    }
    if (cmd.type === 'exchange') { tel.exchange[cmd.kind === 'sell' ? 'sell' : 'swap']++; tel.exchangeLog.push({ turn: s.turn, seat: s.current }); }
    if (cmd.type === 'borsaExit') { tel.borsaExit++; tel.borsaExitBySeat[s.current]++; }
    if (cmd.type === 'refreshMarket') { tel.borsaRefresh[cmd.target]++; tel.borsaRefreshBySeat[s.current]++; }
    if (cmd.type === 'activate') {
      tel.activateLog.push({ turn: s.turn, seat: s.current, sector: cmd.sector });
      // moltiplicatore effettivo: quante fabbriche di QUEL settore ho quando attivo QUEL reparto
      // (la media globale inganna: il moltiplicatore lavora sul singolo reparto attivato).
      if (s.borsaFabbriche?.enabled) {
        // forza verso il settore attivato: neutra conta le fabbriche adiacenti alle risorse di quel colore,
        // legacy le fabbriche taggate col settore.
        let nFab;
        if (s.borsaFabbriche.neutralFactory) {
          const mine = new Set((cp.factories || []).map(f => f.hex));
          nFab = Object.keys(s.hexResource).filter(rid => s.hexResource[rid] === cmd.sector)
            .reduce((a, rid) => a + (s.factoryMap.adj[rid] || []).filter(n => mine.has(n)).length, 0);
        } else {
          nFab = (cp.factories || []).filter(f => f.sector === cmd.sector).length;
        }
        tel.prodActByFab[Math.min(3, nFab)]++;
      }
    }
    if (cmd.type === 'hire') { cmd.side === 'sopra' ? tel.sopra++ : tel.sotto++; tel.hireTurns[s.current].push(s.turn); }
    if (cmd.type === 'buyStruttura') tel.strutturaBuys.push({ turn: s.turn, seat: s.current });
    if (cmd.type === 'buyWelfare') tel.welfareBuyTurns[s.current].push(s.turn);
    // due percorsi: trigger al raggiungimento della milestone (resolveTrackTile, oggi la quasi totalità) e
    // ripiego alla Borsa (buyTrackTile). Il seat del trigger è quello del pending, non s.current: il turno
    // può già essere passato al giocatore dopo quando il pending si risolve.
    if (cmd.type === 'buyTrackTile' || (cmd.type === 'resolveTrackTile' && cmd.use)) {
      const trigger = cmd.type === 'resolveTrackTile';
      const role = trigger ? s.pending.role : cmd.role;
      const pos = trigger ? s.pending.pos : cmd.pos;
      const seat = trigger ? s.pending.playerId : s.current;
      const market = Number(Object.entries(s.tileSlotPos[role]).find(([, p]) => p === pos)?.[0]);
      // quante tile poteva PAGARE in quel momento: con 1 sola non è una scelta, è l'unica che si permetteva.
      // Senza questo, una tile dominata ma economica sembra "scelta nel 40% dei casi" mentre è solo il ripiego.
      const nOpts = trigger
        ? legalCommands(s).filter(c => c.type === 'resolveTrackTile' && c.use).length
        : new Set(legalCommands(s).filter(c => c.type === 'buyTrackTile' && c.pos === pos && c.role === role).map(c => c.tileId)).size;
      // stato del motore AL MOMENTO dell'acquisto (idea dell'utente 19/07/2026): quando entra una tile in una
      // build, non solo cosa produce dopo. bp è il giocatore che compra, non necessariamente s.current: nel
      // percorso trigger il turno può essere già passato ad altri quando il pending si risolve (vedi sopra).
      const bp = s.players[seat];
      tel.trackTileBuys.push({
        turn: s.turn, seat, role, pos, tileId: cmd.tileId, market, via: trigger ? 'milestone' : 'borsa', scelta: nOpts > 1,
        sopra: DEPT_ROLES_B.reduce((n, r) => n + bp.depts[r].sopra.length, 0),
        sotto: sottoTot(bp),
        fabbriche: (bp.factories || []).length,
        direzione: bp.direzione.sopra.length + bp.direzione.sotto.length,
        milestone: DEPT_ROLES_B.filter(r => bp.depts[r].prod >= s.trackMax).length,
      });
    }
    if (cmd.type === 'trattativa' && cmd.f3 === 'buy') { cmd.f3side === 'sopra' ? tel.sopra++ : tel.sotto++; }
    // visita Borsa: raggruppa le azioni di scambio/commesse/uscita di un giocatore in una sola sosta —
    // per capire "quando entra in Borsa, cosa fa davvero prima di andarsene" (non solo conteggi globali).
    if (cp.node === 'Borsa' && cmd.type !== 'move') {
      if (!visit || visit.seat !== s.current || visit.turn !== s.turn) {
        closeVisit();
        visit = { turn: s.turn, seat: s.current, didCommessa: false, didBonus: false, didTile: false, refreshTarget: null, conversions: 0, coinsStart: cp.coins };
      }
      if (cmd.type === 'exchange') visit.conversions++;
      if (cmd.type === 'completeContract') visit.didCommessa = true;
      if (cmd.type === 'borsaExit') visit.didBonus = true;
      if (cmd.type === 'buyTrackTile') visit.didTile = true;
      if (cmd.type === 'refreshMarket') {
        visit.refreshTarget = cmd.target;
        const marketBefore = cmd.target === 'welfare'
          ? [...new Set(s.welfareMarket)].filter(id => cp.coins >= s.welfareById[id].v).length
          : s.bankIds.flatMap(nat => bankMarket(s, nat)).filter(id => cp.coins >= WORKER_BY_ID[id].v).length;
        tel.refreshLog.push({ turn: s.turn, seat: s.current, target: cmd.target, marketBefore });
      }
    } else if (visit) closeVisit(); // il giocatore ha lasciato la Borsa (raro senza endTurn, ma per sicurezza)
    // #3 heatmap: categorizza l'azione per fase
    const cat = catOf(cmd);
    if (cat) tel.actions.push({ turn: s.turn, cat });
    // #5 bonus lavoratore: registra l'effetto della carta assunta + chi
    if (cmd.type === 'hire' || (cmd.type === 'trattativa' && cmd.f3 === 'buy')) {
      const wcard = WORKER_BY_ID[cmd.cardId || cmd.f3card];
      if (wcard) tel.hires.push({ eff: effSig(formulaOf(wcard)), seat: s.current, nation: wcard.nation, sector: wcard.sector, turn: s.turn, cardId: wcard.id, deck: wcard.deck });
    }
    s = applyCommand(s, cmd);
    noteMilestoneCross();
    for (const b of s.bankIds) noteBankTop(b);
    if (s.turn !== lastTurn) {
      tel.coinsByRound[s.turn] = s.players.map(p => p.coins);
      tel.clockByRound[s.turn] = s.clock; // il clock muove solo con le commesse: serve a datare le soglie (quadrimestri)
      tel.coinsGainedByRound[s.turn] = s.players.map(p => ({ ...p.coinsGainedBy }));
      tel.coinsSpentByRound[s.turn] = s.players.map(p => ({ ...p.coinsSpentBy }));
      tel.resGenByRound[s.turn] = s.players.map(p => ({ ...p.resGen }));
      tel.tracksByRound[s.turn] = s.players.map(p => DEPT_ROLES_B.map(r => p.depts[r].prod));
      tel.pvByRound[s.turn] = s.players.map(p => scorePlayer(s, p).total);
      tel.turnSeat[s.turn] = s.current;
      lastTurn = s.turn;
    }
    steps++;
  }
  if (!s.gameOver) return { failed: true };
  closeVisit();
  // refresh efficace = quel seat compra Welfare (target welfare) o assume (target workers) entro i suoi
  // prossimi 2 turni (non turni globali: con 4 giocatori sono ~8 turni di calendario, ma solo 2 "suoi").
  for (const r of tel.refreshLog) {
    const ownTurns = [];
    for (let t = r.turn + 1; t <= s.turn && ownTurns.length < 2; t++) if (tel.turnSeat[t] === r.seat) ownTurns.push(t);
    const windowEnd = ownTurns.length ? ownTurns[ownTurns.length - 1] : r.turn;
    const log = r.target === 'welfare' ? tel.welfareBuyTurns[r.seat] : tel.hireTurns[r.seat];
    r.effective = log.some(t => t > r.turn && t <= windowEnd);
  }
  tel.turns = s.turn; tel.clock = s.clock;
  tel.results = s.results;
  tel.activations = s.players.map(p => p.activations);
  tel.nodeVisits = s.players.map(p => ({ ...p.nodeVisits }));
  tel.activationsBySector = s.players.map(p => ({ ...p.activationsBySector }));
  tel.sindacato = s.players.map(p => ({ ...p.sindacato }));
  tel.strikesByOpponent = s.players.map(p => p.strikesByOpponent);
  tel.tracks = s.players.map(p => ({
    pos: ['terziario', 'secondario', 'primario'].map(r => p.depts[r].prod),
    ms: ['terziario', 'secondario', 'primario'].map(r => p.depts[r].prod >= s.milestonePos[r]),
  }));
  // SEQUENZA DELLE SCELTE (idea utente 19/07/2026): turno in cui ogni reparto si completa (5/5, ultimo slot
  // Sopra/Sotto riempito) e turno di ogni fondazione fabbrica — per ricostruire "prima X poi Y" insieme a
  // milestone (tel.milestoneSnap) e acquisti tile (tel.trackTileBuys), già turno-timbrati sopra.
  tel.deptComplete = [];
  s.players.forEach((p, seat) => DEPT_ROLES_B.forEach(role => {
    const turns = [...p.depts[role].slotTurn.sopra, ...p.depts[role].slotTurn.sotto];
    if (turns.length && turns.every(t => t != null)) tel.deptComplete.push({ seat, role, turn: Math.max(...turns) });
  }));
  tel.factoryBuilds = s.players.flatMap((p, seat) => (p.factories || []).map(f => ({ seat, sector: f.sector, turn: f.turn })));
  tel.winner = s.results[0].playerId;
  tel.tiles = s.players.map(p => ({ id: p.tile.id, name: p.tile.name })); // #2 winrate per tessera
  tel.tileObjectives = s.players.map(p => p.tile.objectives.map((o, i) => ({ tile: p.tile.id, idx: i, done: !!p.achieved[i] }))); // completamento per obiettivo
  tel.resGen = s.players.map(p => ({ ...p.resGen }));   // #4 risorse prodotte per settore
  tel.resSpent = s.players.map(p => ({ ...p.resSpent })); // #4 risorse spese per settore
  tel.resGainedBy = s.players.map(p => ({ ...p.resGainedBy }));   // bilancio: da dove nascono le risorse
  tel.resSpentByCat = s.players.map(p => ({ ...p.resSpentByCat })); // bilancio: dove finiscono
  tel.convCount = s.players.map(p => ({ ...p.convCount })); // quante volte avviene ogni tipo di conversione (eventi, non ammontare)
  tel.convAttempts = s.players.map(p => ({ ...p.convAttempts })); // quante volte una carta 'scambia' era in gioco all'attivazione (usata o no)
  tel.convCards = s.players.map(p => // carte Sotto con formula 'scambia' installate a fine partita
    ['terziario', 'secondario', 'primario'].reduce((n, r) => n + p.depts[r].sotto.filter(id => formulaOf(WORKER_BY_ID[id]).verbo === 'scambia').length, 0));
  // economia marchi + sviluppo plance + commesse (taglia/turno) per gli aggregati "domande di design"
  tel.econ = s.players.map(p => ({ gained: p.coinsGained, start: p.coinsStart, final: p.coins, by: { ...p.coinsSpentBy }, src: { ...p.coinsGainedBy } }));
  // Borsa a indici: log dividendi per giocatore + valore finale di ogni indice (per vedere se divergono davvero)
  tel.borsaIndici = s.borsaIndici?.enabled ? {
    log: s.players.map(p => p.borsaLog.map(e => ({ ...e }))),
    buys: s.players.map(p => p.borsaBuys.map(e => ({ ...e }))),
    finalIdx: Object.fromEntries(indexNames(s).map(n => [n, indexValue(s, n)])),
    pv: s.players.map(p => p.pvBorsa),
    winnerSeat: s.results[0].playerId, // per "chi indovina il 1° indice vince?"
    nIdx: indexNames(s).length,
    quadBounds: s.borsaIndici.quadBounds.slice(),
    shareOffer: tel.shareOffer,
  } : null;
  // Borsa a fabbriche: land-grab, lock-out, economia del flusso
  if (s.borsaFabbriche?.enabled) {
    const buildable = s.factoryMap.hexes.filter(h => h.type === 'costruibile'); // mappa già per-count: tutti attivi
    tel.borsaFabbriche = {
      nGiocatori: s.nPlayers, hexTotali: s.factoryMap.hexes.length,
      factories: s.players.map(p => p.factories.map(f => ({ ...f }))),   // {hex,sector,turn} per seat
      creditsEarned: s.players.map(p => p.factoryCreditsEarned),
      resFromFactory: s.players.map(p => p.resGainedBy.fabbrica),
      spendAzioni: s.players.map(p => p.coinsSpentBy.azioni),
      winnerSeat: s.results[0].playerId,
      turns: s.turn, // per l'età: attivazioni ricevute = turns - fondazione
      buildableTotal: buildable.length,
      occupied: Object.keys(s.hexFactory).length,
      hexResource: { ...s.hexResource },                                 // colori assegnati (per lock-out per colore)
      blocked: tel.factoryBlocked,
      factoryActivates: !!s.borsaFabbriche.factoryActivates,
      prodActByFab: { ...tel.prodActByFab },                             // distribuzione fabbriche-del-settore all'attivazione
      // valore carte Sotto: base (1×) vs extra (moltiplicatore-fabbrica), in marchi e risorse — per l'IMPATTO
      sottoVal: s.players.reduce((a, p) => { a.baseC += p.sottoVal.baseC; a.baseR += p.sottoVal.baseR; a.extraC += p.sottoVal.extraC; a.extraR += p.sottoVal.extraR; return a; }, { baseC: 0, baseR: 0, extraC: 0, extraR: 0 }),
      coinsPerPV: s.rules.coinsPerPV, resPerPV: s.rules.resPerPV,
      // per giacimento (casella-risorsa): quanti siti costruibili adiacenti sono occupati — diffuso vs clusterizzato
      giacimenti: (() => {
        const g = { d0: 0, d1: 0, d2: 0, d3: 0, saturi: 0, inutil: 0, tot: 0 };
        for (const rid of Object.keys(s.hexResource)) {
          const adjB = (s.factoryMap.adj[rid] || []).filter(n => s.factoryHexById[n]?.type === 'costruibile');
          const occ = adjB.filter(n => s.hexFactory[n]).length;
          g.tot++;
          if (occ === 0) { g.d0++; g.inutil++; } else if (occ === 1) g.d1++; else if (occ === 2) g.d2++; else g.d3++;
          if (adjB.length > 0 && occ === adjB.length) g.saturi++;
        }
        return g;
      })(),
      // pressione territoriale: fabbriche a contatto diretto con un avversario + fondazioni che strappano
      // l'ultimo posto libero di un giacimento conteso (distingue saturazione lenta da saturazione contesa)
      pressione: (() => {
        const hexTurn = {};
        s.players.forEach(p => p.factories.forEach(f => { hexTurn[f.hex] = f.turn; }));
        const allHexes = Object.keys(s.hexFactory);
        let adjOpp = 0;
        for (const hex of allHexes) {
          const owner = s.hexFactory[hex].playerId;
          if ((s.factoryMap.adj[hex] || []).some(n => s.hexFactory[n] && s.hexFactory[n].playerId !== owner)) adjOpp++;
        }
        const lastSpotHexes = new Set();
        for (const rid of Object.keys(s.hexResource)) {
          const adjB = (s.factoryMap.adj[rid] || []).filter(n => s.factoryHexById[n]?.type === 'costruibile');
          if (adjB.length <= 1) continue; // giacimento con un solo posto: nessuna gara possibile
          const occ = adjB.filter(n => s.hexFactory[n]);
          if (occ.length !== adjB.length) continue; // non ancora saturo, "ultimo posto" non determinato
          lastSpotHexes.add(occ.reduce((a, b) => (hexTurn[b] > hexTurn[a] ? b : a)));
        }
        return { adjOpp, lastSpot: lastSpotHexes.size, tot: allHexes.length };
      })(),
      // maggioranza territoriale: per ogni giacimento, chi vince il bonus PV (o nessuno per pareggio/assenza)
      maggioranza: (() => {
        const mb = s.borsaFabbriche.majorityBonus;
        const m = { pv: mb?.pv || 0, vinti: 0, pareggio: 0, vuoti: 0, tot: 0 };
        for (const rid of Object.keys(s.hexResource)) {
          m.tot++;
          const w = factoryMajorityWinner(s, rid, s.hexResource[rid]);
          const adjB = (s.factoryMap.adj[rid] || []).filter(n => s.factoryHexById[n]?.type === 'costruibile');
          const anyFactory = adjB.some(n => s.hexFactory[n] && (s.borsaFabbriche.neutralFactory || s.hexFactory[n].sector === s.hexResource[rid]));
          if (w != null) m.vinti++; else if (anyFactory) m.pareggio++; else m.vuoti++;
        }
        return m;
      })(),
      // scelta contesa vs alternative: per ogni fondazione, quante alternative libere da avversari c'erano e se
      // nonostante questo si è scelto un sito già conteso (valore del sito vs scarsità reale di alternative)
      choiceLog: (s.factoryChoiceLog || []).slice(),
    };
  }
  // Impiegati (mode 'struttura'): quante carte possiede ogni giocatore a fine partita, sopra+sotto (side non conta, l'IA può installarla su entrambi)
  tel.impiegatiCount = s.players.map(p => p.direzione.sopra.filter(x => x?.struttura).length + p.direzione.sotto.filter(x => x?.struttura).length);
  tel.cards = s.players.map(p => ({
    depts: ['terziario', 'secondario', 'primario'].map(r => p.depts[r].sopra.length + p.depts[r].sotto.length),
    dirSopra: p.direzione.sopra.length, dirSotto: p.direzione.sotto.length,
  }));
  tel.sottoFinal = s.players.map(sottoTot);         // carte Sotto a fine partita: il "dopo" degli snapshot milestone
  tel.sottoCap = DEPT_ROLES_B.reduce((n, r) => n + s.slots[r].sotto, 0); // slot Sotto totali disponibili
  tel.contracts = s.players.map(p => p.contractsWon.map(c => ({ size: c.size, turn: c.turn })));
  tel.build = s.players.map(p => ({ lastHire: p.lastHireTurn, lastDir: p.lastDirTurn })); // #3 tempo di costruzione
  // turno di riempimento di ogni slot Sopra/Sotto (reparto, mediato sui 3 reparti) e Direzione (Welfare/Macchinario) — assorbimento marchi in fabbrica piena
  tel.slotTurn = {
    sopra: [0, 1, 2].map(i => DEPT_ROLES_B.flatMap(r => s.players.map(p => p.depts[r].slotTurn.sopra[i]))),
    sotto: [0, 1].map(i => DEPT_ROLES_B.flatMap(r => s.players.map(p => p.depts[r].slotTurn.sotto[i]))),
    // un indice per slot davvero esistente: con [0,1] fisso il 3° slot Direzione (cap 3) non veniva mai raccolto
    dirSopra: Array.from({ length: s.slots.direzione.sopra }, (_, i) => s.players.map(p => p.direzione.slotTurn.sopra[i])),
    dirSotto: Array.from({ length: s.slots.direzione.sotto }, (_, i) => s.players.map(p => p.direzione.slotTurn.sotto[i])),
  };
  tel.firstMachineTurn = s.players.map(p => p.firstMachineTurn); // turno del gate Borsa (1° Macchinario) per giocatore, null = mai
  // mercato tile (2.0): per ogni reparto/mercato, ha sbloccato (prod oltre la milestone) e con cosa ha riempito lo slot (null = vuoto)
  tel.marketSlots = s.players.map(p => DEPT_ROLES_B.map(r => [1, 2, 3].map(m => {
    const pos = s.tileSlotPos[r][m];
    return { unlocked: p.depts[r].prod >= s.marketUnlockPos[r][m], filled: p.depts[r].tileFills[pos] || null };
  })));
  // pos finale per SETTORE (Tessile/Metallurgica/Chimica), non per reparto (terziario/secondario/primario): le
  // plance assegnano i settori a reparti diversi per giocatore, quindi solo l'aggregazione per settore dice
  // se un settore è sistematicamente più facile da sviluppare — per reparto mescolerebbe settori diversi.
  tel.slots = s.slots; // cap merged dal motore (non cfg.slots, che può essere parziale): serve a chi legge le partite senza avere il cfg
  tel.trackBySector = s.players.map(p => Object.fromEntries(DEPT_ROLES_B.map(r => [p.depts[r].sector, p.depts[r].prod])));
  tel.tileValue = s.players.map(p => tileValue(s, p)); // quanto ha reso davvero ogni tile tracciato acquistata (non solo "comprata")
  tel.marketUnlockPos = s.marketUnlockPos; // soglie di sblocco mercato 1/2/3 per reparto — per il turno medio di raggiungimento
  tel.resToContracts = s.players.map(p => p.resToContracts); // risorse convertite in commesse (vs prodotte)
  tel.resFinal = s.players.map(p => Object.values(p.resources).reduce((a, b) => a + b, 0)); // risorse in mano a fine partita
  tel.resFinalByType = s.players.map(p => ({ ...p.resources })); // per calcolare il resto non convertibile in PV (vero spreco)
  tel.resPerPV = s.rules.resPerPV;
  tel.coinsPerPV = s.rules.coinsPerPV;
  tel.coinsFinalByPlayer = s.players.map(p => p.coins); // per il resto non convertibile in PV (vero spreco marchi)
  // commesse rimaste non completate a fine partita, per taglia (a mercato = visibili; nel mazzo = mai pescate)
  tel.contractsLeft = {};
  for (const size of ['small', 'medium', 'large']) {
    const c = s.contracts[size];
    tel.contractsLeft[size] = { market: c.active.filter(Boolean).length, deck: c.deck.length };
  }
  // #3 heatmap: normalizza le azioni in 4 quartili di partita (per-game), somma per colonna
  tel.heat = [0, 1, 2, 3].map(() => Object.fromEntries(HEAT_COLS.map(c => [c, 0])));
  const maxT = tel.turns || 1;
  for (const a of tel.actions) { const q = Math.min(3, Math.floor(4 * (a.turn - 1) / maxT)); tel.heat[q][a.cat]++; }
  return tel;
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = x => (100 * x).toFixed(0) + '%';

// Scheda-tessera Piano Industriale: win%, PV per fonte, completamento per obiettivo — condivisa dal report
// e dal "Ricalcola" dell'editor (stessa forma, dati diversi: tutto il batch vs un batch mirato su una tessera).
function aggregateTiles(games) {
  const agg = {};
  for (const g of games) g.tiles.forEach((t, seat) => {
    const a = agg[t.id] || (agg[t.id] = { id: t.id, name: t.name, games: 0, wins: 0, pvObj: 0, pvContracts: 0, pvTrack: 0, nContracts: 0, objDone: [0, 0, 0], objAppear: [0, 0, 0] });
    const r = g.results.find(x => x.playerId === seat);
    a.games++; if (seat === g.winner) a.wins++;
    a.pvObj += r.pvObjectives; a.pvContracts += r.pvContracts; a.pvTrack += r.pvTrack; a.nContracts += r.nContracts;
    (g.tileObjectives[seat] || []).forEach(o => { a.objAppear[o.idx]++; if (o.done) a.objDone[o.idx]++; });
  });
  return Object.values(agg).map(a => {
    const objRates = [0, 1, 2].map(i => (a.objAppear[i] ? a.objDone[i] / a.objAppear[i] : null));
    return {
      id: a.id, name: a.name, games: a.games, wins: a.wins, wr: a.wins / a.games,
      pvObjAvg: a.pvObj / a.games, pvContractsAvg: a.pvContracts / a.games, pvTrackAvg: a.pvTrack / a.games, nContractsAvg: a.nContracts / a.games,
      objRates, avgRate: avg(objRates.filter(r => r != null)),
    };
  });
}
// campione piccolo → poche stelle: soglie euristiche (design tool, non un test statistico) per non fidarsi di n<20.
export function starsFor(n) {
  const s = 1 + [10, 20, 35, 70].filter(t => n >= t).length;
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}
// "mattone" di un obiettivo: stessa condizione (stesso tipo + stessi parametri) ricorre su tessere diverse —
// "2 Macchinari" può comparire su 8 tessere. Guardarle una per tessera nasconde che il problema è nel mattone,
// non nella tessera che lo ospita: corretto una volta, sistema tutte le tessere che lo usano.
// cond.sectors per 'milestones': [{sector, milestone:1|2|3}] — retrocompatibile con vecchie tessere (stringa nuda = M1).
const msSectorLabel = s => (typeof s === 'string' ? s : `${s.sector}#${s.milestone ?? 1}`);
function condKey(cond) {
  switch (cond.type) {
    case 'milestones': return `milestones:${cond.sectors.map(msSectorLabel).sort().join(',')}`;
    case 'workers_nation': return `workers_nation:${cond.nation}:${cond.n}`;
    case 'direzione': return `direzione:${cond.side}:${cond.n}`;
    case 'full_dept': return `full_dept:${cond.sopra}:${cond.sotto}:${cond.minCount || 1}`;
    case 'all_tension_zero': { const t = cond.targets || {}; return `all_tension_zero:${t.terziario ?? 0}:${t.secondario ?? 0}:${t.primario ?? 0}`; }
    case 'contracts_mix': return `contracts_mix:${cond.small || 0}:${cond.medium || 0}:${cond.large || 0}`;
    case 'sector_leader': return `sector_leader:${cond.sector}`;
    case 'direzione_full': return `direzione_full:${cond.sopra}:${cond.sotto}`;
    default: return `${cond.type}:${cond.n ?? ''}`; // same_nation, distinct_nations, activation_coins, sotto_each, sopra_each, no_blocked_end
  }
}
function condLabel(cond) {
  switch (cond.type) {
    case 'milestones': return `Milestone ${cond.sectors.map(msSectorLabel).join('+')}`;
    case 'workers_nation': return `${cond.n} lavoratori ${cond.nation}`;
    case 'same_nation': return `${cond.n} lavoratori stessa nazione`;
    case 'distinct_nations': return `${cond.n} nazionalità diverse`;
    case 'all_tension_zero': { const t = cond.targets || {}; return `Tensioni ${t.terziario ?? 0}/${t.secondario ?? 0}/${t.primario ?? 0} a fine partita`; }
    case 'activation_coins': return `${cond.n} marchi/attivazione`;
    case 'sotto_each': return `${cond.n} Sotto in ogni reparto`;
    case 'sopra_each': return `${cond.n} Sopra in ogni reparto`;
    case 'direzione': return `${cond.n} ${cond.side === 'sotto' ? 'Macchinari' : cond.side === 'sopra' ? 'Welfare' : 'carte'} in Direzione`;
    case 'full_dept': return cond.minCount > 1 ? `${cond.minCount} reparti pieni (${cond.sopra}Sopra+${cond.sotto}Sotto)` : `Reparto pieno (${cond.sopra}Sopra+${cond.sotto}Sotto)`;
    case 'no_blocked_end': return 'Nessuna carta bloccata a fine partita';
    case 'contracts_mix': { const p = []; if (cond.small) p.push(`${cond.small}p`); if (cond.medium) p.push(`${cond.medium}m`); if (cond.large) p.push(`${cond.large}g`); return `Commesse ${p.join('+')}`; }
    case 'sector_leader': return `${cond.sector} leader + milestone`;
    case 'direzione_full': return `Direzione piena (${cond.sopra}Sopra+${cond.sotto}Sotto)`;
    default: return cond.type;
  }
}
// win% di una tessera è "sorprendente" se si allontana dall'atteso 1/P più di quanto il campione permetta —
// niente soglia fissa (dipende da P e da n): z-score di un test binomiale contro "ogni tessera vince quanto le altre".
export function winZ(wr, games, P) {
  const p0 = 1 / P;
  return (wr - p0) / Math.sqrt((p0 * (1 - p0)) / games);
}
// batch mirato su UNA tessera: la forza su un posto (rotante fra le partite per non confondere il vantaggio
// di tessera con quello di posto) così ogni partita è un'osservazione, invece di ~1 ogni 8 con l'estrazione normale.
export async function recalcTile(baseCfg, tile, { nGames = 150, seedBase, onProgress = () => {}, isCancelled = () => false } = {}) {
  const P = baseCfg.nPlayers ?? 4;
  const sb = seedBase ?? Math.floor(Math.random() * 100000);
  const games = [];
  for (let g = 0; g < nGames; g++) {
    if (isCancelled()) break;
    games.push(runOneGame({
      ...baseCfg,
      headless: true,
      seed: sb + g,
      players: Array.from({ length: P }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
      forcedTile: tile,
      forcedSeat: g % P,
    }));
    onProgress(g + 1, nGames);
    await new Promise(r => setTimeout(r, 0));
  }
  const rows = aggregateTiles(games.filter(x => !x.failed));
  return rows.find(r => r.id === tile.id) || null;
}
// indicatori di design: più alto = peggio (y=soglia gialla, r=rossa); lightTurn = banda (poco usato / dominante)
const light = (v, y, r) => (v >= r ? '🔴' : v >= y ? '🟡' : '🟢');
const lightTurn = q => (q > 0.40 ? '🔴' : q < 0.10 ? '🟡' : '🟢');

// RITMO — fase investimento → conversione, per giocatore. Usata dal report batch e dall'A/B diff.
// buildStop = ultima azione di costruzione; convStart = 1ª consegna dopo aver smesso di costruire;
// burst = CV dei gap tra consegne (alto = raffica finale, basso = consegne regolari).
function rhythm(g, seat) {
  const cs = [...g.contracts[seat]].filter(c => c.turn).sort((a, b) => a.turn - b.turn);
  const nc = cs.length;
  const buildStop = Math.max(g.build[seat].lastHire, g.build[seat].lastDir);
  const gaps = cs.slice(1).map((c, i) => c.turn - cs[i].turn);
  const mg = avg(gaps), cv = gaps.length && mg > 0 ? Math.sqrt(avg(gaps.map(x => (x - mg) ** 2))) / mg : null;
  return {
    firstC: nc ? cs[0].turn : null,
    firstL: (cs.find(c => c.size === 'large') || {}).turn ?? null,
    buildStop: buildStop || null,
    convStart: nc ? (cs.find(c => c.turn >= buildStop) || {}).turn ?? null : null,
    lastC: nc ? cs[nc - 1].turn : null,
    burst: cv,
  };
}

// STRATEGIE — classificazione euristica per giocatore-partita (soglie dichiarate nei report).
// NON archetipi appresi: quelli (cluster su migliaia di partite) restano Layer 3.
const STRATS = ['Rush commesse', 'Costruttore precoce', 'Convertitore continuo', 'Generalista', 'Nessuna commessa'];
function classify(g, seat) {
  const T = g.turns || 1, nc = g.contracts[seat].length;
  if (!nc) return 'Nessuna commessa';
  const r = rhythm(g, seat);
  if (r.firstC <= 0.35 * T && nc >= 3) return 'Rush commesse';
  if (r.buildStop && r.buildStop <= 0.55 * T && r.lastC >= 0.8 * T) return 'Costruttore precoce';
  if (r.burst != null && r.burst < 0.4 && nc >= 3) return 'Convertitore continuo';
  return 'Generalista';
}

function cellText(c) {
  if (!c) return '·';
  if (c.coins) return `${c.coins}m`;
  if (c.res) return 'R';
  if (c.coinsPerIcon) return 'm×carta';
  if (c.coinsPerTension) return 'm×tensione';
  if (c.resPerIcon) return 'R×carta';
  if (c.resPerTension) return 'R×tensione';
  if (c.pv) return `${c.pv}PV`;
  if (c.milestone) return `MILESTONE${c.opensMarket ? c.opensMarket : ''}`;
  if (c.tileSlot) return `slot${c.tileSlot}`;
  return '?';
}
function trackLine(track) {
  const parts = [];
  for (let pos = 1; pos < track.length; pos++) if (track[pos]) parts.push(`${pos}=${cellText(track[pos])}`);
  return parts.join(' ');
}

// ===== GERARCHIA DEL REPORT (20/07/2026) =====
// Il report faceva tre lavori insieme — descrivere una partita, diagnosticare il bilanciamento, offrire
// strumenti di design — e le cose importanti finivano sepolte nei dettagli. Qui NON si ricalcola nulla:
// i blocchi già prodotti vengono riordinati in 7 gruppi e marcati su 3 livelli di lettura.
//   🟢 core = si guarda a ogni A/B · 🔵 diagnostica = solo se qualcosa stona · ⚪ ricerca = di rado.
// Per aggiungere una sezione nuova basta una riga qui: senza, finisce in "ALTRO" (niente sparisce mai).
const REPORT_MAP = [
  // [frammento dell'intestazione, gruppo, livello]
  ['DESIGN ALERT', 1, '🟢'], ['INDICATORI FUORI RANGE', 1, '🟢'], ['DURATA', 1, '🟢'],

  ['ULTIMO SLOT REPARTO', 2, '🔵', 'Costruzione'], ['TEMPO DI COSTRUZIONE', 2, '🔵', 'Costruzione'],
  ['TRACCIATI (pos finale', 2, '🟢', 'Progressione'], ['DISTRIBUZIONE FINALE DEI TRACCIATI', 2, '🔵', 'Progressione'],
  ['DISTRIBUZIONE FINALE PER SETTORE', 2, '🔵', 'Progressione'], ['TURNO DI RAGGIUNGIMENTO MILESTONE', 2, '🟢', 'Progressione'],
  ['FABBRICA FINALE', 2, '🟢', 'Completamento'], ['DIREZIONE (carte installate', 2, '🟢', 'Completamento'],
  ['FABBRICA E NODI', 2, '🟢', 'Costruzione'], ['MERCATO TILE TRACCIATO', 2, '🔵', 'Progressione'], ['CARTE SOTTO vs TILE', 2, '🔵', 'Progressione'],
  // il moltiplicatore non parla della mappa ma del valore delle carte Sotto: sta nel motore
  ['BORSA A FABBRICHE — MOLTIPLICATORE', 2, '🔵', 'Completamento'],
  // blocco Direzione/Impiegati (storicamente "macchinari"): sviluppo del motore, non economia
  ['MACCHINARI: ACCESSO O VALORE', 2, '🔵', 'Costruzione'], ['MACCHINARI: CON vs SENZA', 2, '⚪', 'Costruzione'],
  ['MACCHINARI: CAUSA, SELEZIONE O SOGLIA', 2, '⚪', 'Costruzione'], ["RISORSE PRODOTTE DOPO L'ACQUISTO", 2, '⚪', 'Costruzione'],
  ['MACCHINARIO: GARANTITO DALLA FORMULA', 2, '⚪', 'Costruzione'], ['PV PER 5 MARCHI INVESTITI', 2, '🔵', 'Costruzione'],
  ['TEMPISTICA vs CARTA', 2, '⚪', 'Costruzione'],

  ['MARCHI MEDI A INIZIO ROUND', 3, '🔵', 'Accelerazione economica'], ['ECONOMIA MARCHI', 3, '🟢', 'Accelerazione economica'],
  ['BILANCIO MARCHI', 3, '🔵', 'Accelerazione economica'], ["DA DOVE NASCE L'ACCELERAZIONE", 3, '🔵', 'Accelerazione economica'],
  ['MARCHI MEDI PER ATTIVAZIONE', 3, '🔵', 'Accelerazione economica'], ['CASELLE ⓜ ATTIVE', 3, '🔵', 'Accelerazione economica'],
  ['PRODUZIONE PER FINESTRA', 3, '🔵', 'Accelerazione economica'], ['RISORSE PRODOTTE vs SPESE', 3, '🟢', 'Risorse'],
  ['DESTINAZIONE DELLE RISORSE', 3, '🟢', 'Risorse'], ['BILANCIO RISORSE', 3, '🔵', 'Risorse'],
  ['SCAMBI', 3, '🔵', 'Conversioni'], ['UTILIZZO DELLE CONVERSIONI', 3, '🔵', 'Conversioni'],
  ['CONVERSIONI DISPONIBILI vs USATE', 3, '🔵', 'Conversioni'], ['PERCHÉ NON CONVERTE', 3, '🔵', 'Conversioni'],
  ['NESSUNA COMMESSA RICHIEDE', 3, '🔵', 'Conversioni'], ['IN CHE FASE SUCCEDE', 3, '🔵', 'Conversioni'],
  ['GATE MACCHINARI', 3, '🔵', 'Conversioni'],

  ['PRIMA COMMESSA', 4, '🟢'], ['RITMO COMMESSE', 4, '🔵', 'Diagnostica'],
  ['COMMESSE — prima della partita', 4, '🔵', 'Diagnostica'], ['COMMESSE PER TAGLIA', 4, '🟢'],
  ['COMMESSE PER GIOCATORE', 4, '🟢'], ['EFFICIENZA MEDIA', 4, '🔵', 'Diagnostica'],
  ['ESCI SENZA COMMESSE', 4, '🔵', 'Diagnostica'],

  ['BORSA A FABBRICHE', 5, '🔵'],

  ['PV PER POSIZIONE DI TURNO', 6, '🟢', 'Posizione'], ['DISTRIBUZIONE PUNTEGGI', 6, '🟢', 'Posizione'],
  ['WIN RATE PER TESSERA', 6, '🔵', 'Obiettivi'], ['SCHEDA TESSERE', 6, '🔵', 'Obiettivi'],
  ['DISTRIBUZIONE TESSERE', 6, '🔵', 'Obiettivi'], ['OBIETTIVI PIANO INDUSTRIALE', 6, '🟢', 'Obiettivi'],
  ['FAMIGLIE DI OBIETTIVO', 6, '🟢', 'Obiettivi'], ['CLASSIFICA FACILITÀ', 6, '🔵', 'Obiettivi'],
  ['BONUS LAVORATORE', 6, '🔵', 'Carte'], ['PICK-RATE ALTO', 6, '🔵', 'Carte'],
  ['IDENTITÀ NAZIONALE', 6, '🔵', 'Carte'], ['VALORE REALE DELLE TILE', 6, '🔵', 'Tile'],
  ['BORSA A INDICI', 6, '⚪', 'Posizione'],

  ['CONTRADDIZIONI', 7, '⚪'], ['SORPRESE', 7, '⚪'], ['IPOTESI AUTOMATICHE', 7, '⚪'],
  ['TIMELINE PV', 7, '⚪'], ['RITMO DI GIOCO', 7, '⚪'],
  ['HEATMAP AZIONI', 7, '🔵'], ['DOVE FINISCONO I TURNI', 7, '🔵'],
  ['STRATEGIE OSSERVATE', 7, '⚪'], ['DIFFERENZA VINCITORI', 7, '⚪'],
  ['ORIGINE DEI PUNTI', 7, '⚪'], ['STATO DEL MOTORE', 7, '⚪'],
  ['TILE → COSA INSTALLA DOPO', 7, '⚪'], ['MOTORI → QUALI TILE', 7, '⚪'],
  ['AFFINITÀ TILE', 7, '⚪'], ['SEQUENZA DELLE SCELTE', 7, '⚪', 'Sempre'],
  ['MOTORI VINCENTI', 7, '⚪', 'Sempre'], ['MARCHI×FABBRICA', 7, '⚪', 'Approfondimento'],
];
// Ordine dei sotto-blocchi dentro un gruppo: racconta una storia invece di elencare metriche.
// Gruppo 2: costruisco → progredisco → completo. Gruppo 3: perché accelera → risorse → conversioni.
// Gruppo 7: 'Sempre' si stampa sempre, 'Approfondimento' solo con REPORT_RESEARCH_VERBOSE.
const REPORT_SUBGROUPS = {
  2: ['Costruzione', 'Progressione', 'Completamento'],
  3: ['Accelerazione economica', 'Risorse', 'Conversioni'],
  4: ['', 'Diagnostica'],
  6: ['Posizione', 'Tile', 'Obiettivi', 'Carte'],
  7: ['Sempre', 'Approfondimento'],
};
// Le analisi di Ricerca sono state preziose per capire il design, ma non si consultano dopo ogni
// modifica al regolamento: di default restano fuori. `cfg.researchVerbose` le riaccende al bisogno.
export const REPORT_RESEARCH_VERBOSE = false;

const REPORT_GROUPS = {
  1: 'DASHBOARD — com\'è andato questo batch?',
  2: 'MOTORE — come cresce il motore del giocatore?',
  3: 'ECONOMIA — come circolano marchi e risorse?',
  4: 'COMMESSE — quanto facilmente vengono completate?',
  5: 'MAPPA — la competizione territoriale è significativa?',
  6: 'BILANCIAMENTO — cosa conviene modificare?',
  7: 'RICERCA — quali pattern emergono? (laboratorio, non da leggere ogni volta)',
  8: 'ALTRO — sezioni non ancora classificate in REPORT_MAP',
};

// Riordina le righe già prodotte. Un blocco inizia a ogni riga "=== ... ===" o "— ... —" e finisce
// alla successiva. Le intestazioni di primo livello vecchie (=== 1. RITMO ... ===) sono contenitori
// vuoti nel nuovo schema e vengono scartate.
// ===== DATO vs MANUALE DEL DATO (20/07/2026) =====
// Le glosse fra parentesi spiegano COME leggere un blocco: preziose la prima volta, saltate dall'occhio
// alla centesima simulazione. Nel report normale ne resta una, condensata a una riga; in verbose tornano
// integrali. Nessun dato viene toccato: si comprime solo il commento.
// Una glossa = riga che inizia con "(" — può proseguire su più righe finché le parentesi non si chiudono.
function condenseNotes(lines, verbose) {
  if (verbose) return lines;
  const out = [];
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('(')) { out.push(lines[i]); continue; }
    // raccoglie la glossa completa: prosegue finché le parentesi non tornano in pari
    let buf = t, depth = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
    while (depth > 0 && i + 1 < lines.length) {
      i++; buf += ' ' + lines[i].trim();
      depth += (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
    }
    notes.push(buf);
  }
  if (!notes.length) return out;
  // prima frase della prima glossa, tagliata a una riga
  let first = notes[0].replace(/^\(|\)$/g, '').trim();
  const cut = first.search(/(?<=[.;])\s+[A-Z"«]/);
  if (cut > 0 && cut < 200) first = first.slice(0, cut).trim();
  if (first.length > 190) first = first.slice(0, 187).trimEnd() + '…';
  const extra = notes.length - 1;
  out.push(`(${first}${extra > 0 ? `  · +${extra} note in verbose` : ''})`);
  return out;
}

function organizeReport(preamble, body, dashboard, researchVerbose, verboseNotes) {
  const isHeader = l => /^\s*(===|—)/.test(l);
  const blocks = [];
  let cur = null;
  for (const line of body) {
    if (isHeader(line)) { cur = { head: line, lines: [] }; blocks.push(cur); }
    else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  const OLD_TOPS = /^\s*=== \d\./;
  const hitOf = b => REPORT_MAP.find(([frag]) => b.head.includes(frag));
  const groupOf = b => { const h = hitOf(b); return h ? h[1] : 8; };
  const subOf = b => { const h = hitOf(b); return (h && h[3]) || (h && h[1] === 7 ? 'Approfondimento' : ''); };

  const out = [...preamble, '', ...dashboard];
  let nascosti = 0;
  for (const gid of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let inGroup = blocks.filter(b => !OLD_TOPS.test(b.head) && groupOf(b) === gid);
    if (gid === 7 && !researchVerbose) {
      const prima = inGroup.length;
      inGroup = inGroup.filter(b => subOf(b) === 'Sempre');
      nascosti = prima - inGroup.length;
    }
    if (!inGroup.length) continue;
    if (gid !== 1) out.push('', '', '█'.repeat(3) + ' ' + REPORT_GROUPS[gid]);
    const subs = REPORT_SUBGROUPS[gid] || [''];
    const visti = new Set();
    for (const sub of subs) {
      const chunk = inGroup.filter(b => subOf(b) === sub);
      chunk.forEach(b => visti.add(b));
      if (!chunk.length) continue;
      if (sub) out.push('', `  ┌─ ${sub.toUpperCase()}`);
      for (const b of chunk) out.push('', `${(hitOf(b) || [])[2] || '⚪'} ${b.head.trim()}`, ...condenseNotes(b.lines, verboseNotes));
    }
    // blocchi con un sotto-gruppo non previsto: in coda, mai persi
    for (const b of inGroup.filter(b => !visti.has(b))) {
      out.push('', `${(hitOf(b) || [])[2] || '⚪'} ${b.head.trim()}`, ...condenseNotes(b.lines, verboseNotes));
    }
    if (gid === 7 && nascosti) {
      out.push('', `(${nascosti} analisi di ricerca non stampate — affinità tile, tile→famiglie, famiglie→tile, correlazioni.`,
        ' Servono a capire il design, non a leggere un A/B. Per vederle: cfg.researchVerbose = true.)');
    }
  }
  return out;
}


// ===== CONFIGURAZIONE — intestazione dell'esperimento (21/07/2026) =====
// Dump completo delle leve che cambiano il gioco, così due report si confrontano riga-per-riga e si
// distingue "differenza da regola cambiata" da "variabilità statistica". Il fingerprint in cima è un
// hash della config: stesso hash = stessa config (solo il seed/campione differisce); hash diverso = una
// regola è cambiata, e le righe sotto dicono quale.
function configFingerprint(obj) {
  const str = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, 8);
}
function configBlock(cfg, P) {
  const bf = cfg.borsaFabbriche || {};
  const tr = cfg.tracks?.terziario || [];
  const trackLen = tr.length - 1;
  const milestones = tr.map((c, i) => (c && c.milestone) ? i : null).filter(x => x != null).join('/');
  const ai = cfg.aiRollout ? `Rollout d${cfg.aiRollout.depth} r${cfg.aiRollout.rollouts}` : 'Greedy';
  // n nazionalità dell'obiettivo (dalle tessere: prima cond workers_nation)
  let natN = '?';
  const tiles = cfg.tiles || [];
  for (const t of tiles) for (const o of (t.objectives || [])) if (o.cond?.type === 'workers_nation') { natN = o.cond.n; break; }
  // moltiplicatore fabbrica: cap effettivo (0/1 = spento)
  const mult = !bf.factoryActivates ? 'OFF' : (bf.factoryMultCap ?? 3) <= 1 ? 'OFF (cap≤1)' : `×${bf.factoryMultCap ?? 3} max`;
  const factModel = bf.enabled === false ? 'SPENTE'
    : (bf.neutralFactory !== false ? `neutra${bf.milestoneGate ? '+cancello-milestone' : ''}` : 'legata-settore');

  // oggetto canonico per il fingerprint: SOLO le leve, niente seed/nGames/data
  const fp = configFingerprint({
    trackLen, milestones, contractPV: cfg.contractPV, conv: cfg.conversions,
    coins: (cfg.startingCoins || []).slice(0, P), strike: cfg.strikePenaltyPV,
    coinsRepeat: cfg.coinsRepeat, singlePlace: cfg.singlePlace,
    fact: { model: factModel, mult, cost: bf.costCurve, founding: bf.foundingResource, majority: bf.majorityBonus?.enabled ? bf.majorityBonus.pv : 0, passive: bf.passiveIncome },
    market: cfg.contractMarket, clock: cfg.clockThreshold, natN,
    tratt: cfg.trattativa, borsa: cfg.borsa,
  });

  const L = [];
  L.push('███ CONFIGURAZIONE — intestazione dell\'esperimento');
  L.push(`fingerprint  ${fp}   (stesso hash = stessa config · hash diverso = una regola è cambiata)`);
  L.push(`IA           ${ai} · ${P} giocatori`);
  L.push(`Tracciato    ${trackLen} caselle · milestone a ${milestones} · marchi/attivazione ${cfg.coinsRepeat ? 'sì' : 'no'}`);
  L.push(`Commesse     PV ${['small', 'medium', 'large'].map(s => cfg.contractPV[s].join('/')).join(' · ')} · ${cfg.singlePlace ? 'posto unico' : '1°+2°'} · mercato ${cfg.contractMarket ?? 2}/taglia · clock ${cfg.clockThreshold ? Object.values(cfg.clockThreshold).join('/') : '8/12/16'}`);
  L.push(`Fabbriche    ${factModel} · moltiplicatore ${mult} · costo ${bf.costCurve ? bf.costCurve.join('/') : '—'} · risorsa-fondazione ${bf.foundingResource !== false ? 'sì' : 'no'} · maggioranza ${bf.majorityBonus?.enabled ? bf.majorityBonus.pv + 'PV' : 'off'}`);
  L.push(`Economia     marchi iniziali ${(cfg.startingCoins || []).slice(0, P).join('/') || '10×' + P} · conversioni ${cfg.conversions?.coinsPerPV ?? 10}m=1PV, ${cfg.conversions?.resPerPV ?? 2}R=1PV · scioperi -${cfg.strikePenaltyPV ?? 3}PV`);
  L.push(`Obiettivi    nazionalità = ${natN} lavoratori`);
  return L;
}

export function formatReport(games, cfg) {
  const ok = games.filter(g => !g.failed);
  const P = cfg.nPlayers ?? ok[0]?.results?.length ?? 4; // fallback: deriva dai giocatori di una partita (config esportate senza nPlayers)
  const L = [];
  L.push(`OFFICINA 1907 — SIMULAZIONE ${ok.length}/${games.length} partite, ${P} AI (${new Date().toLocaleString('it-IT')})`);
  for (const line of configBlock(cfg, P)) L.push(line);
  L.push('Questo report non decide quali regole cambiare: individua fenomeni osservati e propone quali esperimenti valgono il prossimo A/B.');
  L.push('Livelli di evidenza: 🟢 osservazione · 🟡 correlazione · 🔵 causale (solo da A/B).');
  L.push('');
  if (!ok.length) {
    L.push('Nessuna partita valida.');
    if (games.length) L.push(`⚠ ${games.length} partite non terminate entro ${MAX_STEPS} step (escluse).`);
    return L.join('\n');
  }

  // ===== AGGREGATI CONDIVISI (alert, sezioni e domande leggono da qui) =====
  const SIZE_IT = { small: 'piccola', medium: 'media', large: 'grande' };
  const sd = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(x => (x - m) ** 2))); };
  const turns = ok.map(g => g.turns);
  const wins = Array.from({ length: P }, (_, s) => ok.filter(g => g.results[0].playerId === s).length / ok.length);
  const spread = Math.max(...wins) - Math.min(...wins);
  const firsts = ok.flatMap(g => g.firstContract.filter(x => x !== null));
  const never = ok.reduce((a, g) => a + g.firstContract.filter(x => x === null).length, 0);
  const neverShare = never / (ok.length * P);
  const firstSize = { small: 0, medium: 0, large: 0 };
  for (const g of ok) if (g.completions[0]) firstSize[g.completions[0].size]++;
  const bySize = { small: 0, medium: 0, large: 0 };
  let tot = 0;
  for (const g of ok) for (const c of g.completions) { bySize[c.size]++; tot++; }
  const grandiShare = bySize.large / (tot || 1);
  const allT = ok.flatMap(g => g.tracks);
  const mins = allT.map(t => Math.min(...t.pos));
  const abandoned = mins.filter(x => x <= 4).length / (mins.length || 1);
  const sopra = ok.reduce((a, g) => a + g.sopra, 0), sotto = ok.reduce((a, g) => a + g.sotto, 0);
  const actTot = {}; let actSum = 0;
  for (const g of ok) for (const a of g.actions) { actTot[a.cat] = (actTot[a.cat] || 0) + 1; actSum++; }
  const actShare = c => (actTot[c] || 0) / (actSum || 1);
  const domCat = HEAT_COLS.reduce((a, b) => (actShare(b) > actShare(a) ? b : a));
  const allEcon = ok.flatMap(g => g.econ);
  const gAvg = avg(allEcon.map(e => e.gained)), sAvg = avg(allEcon.map(e => e.start + e.gained - e.final)), rAvg = avg(allEcon.map(e => e.final));
  const unused = avg(ok.map(unusedOf)); // stessa definizione della tabella indicatori: un solo numero, non due
  const resProdAll = ok.reduce((a, g) => a + g.resGen.reduce((x, r) => x + SECTORS.reduce((y, sc) => y + (r[sc] || 0), 0), 0), 0);
  const resToC = ok.reduce((a, g) => a + g.resToContracts.reduce((x, v) => x + v, 0), 0);
  const notToContracts = resProdAll ? 1 - resToC / resProdAll : 0; // NON è spreco: include vendita/scambio, un canale di valore legittimo — vedi trueWasteShare sotto
  // vero spreco: risorse che a fine partita non hanno estratto NESSUN valore, in nessuna forma (né commesse, né vendita, né scambio, né conversione finale in PV)
  const trueWasteAmt = ok.reduce((a, g) => a + g.resFinalByType.reduce((x, rb) => x + Object.values(rb).reduce((y, n) => y + (n % (g.resPerPV || 2)), 0), 0), 0);
  const trueWasteShare = resProdAll ? trueWasteAmt / resProdAll : 0;
  const marketShare = Math.max(0, notToContracts - trueWasteShare); // venduta/scambiata: lascia il percorso commesse ma estrae valore altrove
  const allDir = ok.flatMap(g => g.cards);
  const dirSottoZero = allDir.filter(c => c.dirSotto === 0).length / (allDir.length || 1);
  // "piena" = al cap configurato, non il 2 storico: col cap a 3 il >=2 diceva "piena" a chi aveva uno slot libero
  const dirSopraCap = ok[0]?.slots?.direzione?.sopra ?? 3;
  const dirSopraFull = allDir.filter(c => c.dirSopra >= dirSopraCap).length / (allDir.length || 1);
  let easyShare = 0; // quota obiettivi completati >85%, calcolata nella sezione Bilanciamento
  // spesa marchi per categoria (economia, contraddizioni)
  const CATS = ['lavoratori', 'direzione', 'movimento', 'sindacato', 'borsa'];
  const catTot = {}; let spentSum = 0;
  for (const e of allEcon) for (const c of CATS) { catTot[c] = (catTot[c] || 0) + (e.by[c] || 0); spentSum += e.by[c] || 0; }
  const spendShare = c => (catTot[c] || 0) / (spentSum || 1);
  // fonti marchi: produzione per settore · salita tracciati · effetti lavoratore (per tipo) · vendita risorse
  const SRC = [...SECTORS, 'tracciati', 'lavFisso', 'lavNazioni', 'lavIcone', 'lavTensione', 'lavFabbrica', 'scambio', 'trackTile'];
  const srcTot = {}; let gainSum = 0;
  for (const e of allEcon) for (const k of SRC) { srcTot[k] = (srcTot[k] || 0) + (e.src?.[k] || 0); gainSum += e.src?.[k] || 0; }
  const srcShare = k => (srcTot[k] || 0) / (gainSum || 1);
  const repartoShare = SECTORS.reduce((a, s) => a + srcShare(s), 0);
  const lavShare = ['lavFisso', 'lavNazioni', 'lavIcone', 'lavTensione', 'lavFabbrica'].reduce((a, k) => a + srcShare(k), 0);
  const ms2plus = allT.filter(t => t.ms.filter(Boolean).length >= 2).length / (allT.length || 1);
  // strategie osservate: classify()/STRATS a livello modulo (condivise con evalStability)
  const stratAgg = Object.fromEntries(STRATS.map(s => [s, { n: 0, w: 0 }]));
  for (const g of ok) for (let seat = 0; seat < P; seat++) { const st = classify(g, seat); stratAgg[st].n++; if (seat === g.winner) stratAgg[st].w++; }
  // tessere e bonus lavoratore (bilanciamento + sorprese)
  const tileRows = aggregateTiles(ok).filter(t => t.games >= 3).sort((x, y) => y.wr - x.wr);
  // outlier statistico, non soglia fissa: quante deviazioni standard dal win% atteso (1/P) sotto un modello binomiale
  // "ogni tessera vince quanto le altre". A parità di scarto, una tessera con più partite è un outlier più solido
  // di una con poche — una soglia fissa (es. "≥50%") non lo distingue e o è troppo permissiva o troppo rigida a seconda di n.
  const tileZ = t => winZ(t.wr, t.games, P);
  // una tessera può essere forte in due modi indipendenti: vince tanto (tileZ) O i suoi obiettivi sono un regalo
  // (completamento medio anomalo). Qui non c'è un target teorico come 1/P: lo z è contro la distribuzione delle
  // ALTRE tessere del batch (stessa idea, popolazione diversa: "è anomala rispetto alle sue pari?").
  const rateMean = avg(tileRows.map(t => t.avgRate));
  const rateSd = Math.sqrt(avg(tileRows.map(t => (t.avgRate - rateMean) ** 2))) || 1e-9;
  const facilityZ = t => (t.avgRate - rateMean) / rateSd;
  const tileDefs = Object.fromEntries((cfg.tiles?.length ? cfg.tiles : OBJECTIVE_TILES).map(t => [t.id, t]));
  const tileById = Object.fromEntries(tileRows.map(t => [t.id, t]));
  const effAgg = {};
  for (const g of ok) for (const h of g.hires) {
    const a = effAgg[h.eff] || (effAgg[h.eff] = { picked: 0, wins: 0 });
    a.picked++; if (h.seat === g.winner) a.wins++;
  }
  const effRows = Object.entries(effAgg).map(([eff, a]) => ({ eff, ...a, wr: a.wins / a.picked })).sort((x, y) => y.picked - x.picked);
  // pick-rate per singola carta (non aggregato per firma-effetto): richiede cardId in tel.hires (mazzo nuovo 84 carte + mazzo legacy).
  const cardAgg = {};
  for (const g of ok) for (const h of g.hires) {
    if (!h.cardId) continue;
    const a = cardAgg[h.cardId] || (cardAgg[h.cardId] = { cardId: h.cardId, deck: h.deck, nation: h.nation, sector: h.sector, picked: 0, wins: 0, appear: 0 });
    a.picked++; if (h.seat === g.winner) a.wins++;
  }
  for (const g of ok) for (const [cardId, n] of Object.entries(g.cardAppear || {})) {
    const a = cardAgg[cardId] || (cardAgg[cardId] = { cardId, deck: WORKER_BY_ID[cardId]?.deck, nation: WORKER_BY_ID[cardId]?.nation, sector: WORKER_BY_ID[cardId]?.sector, picked: 0, wins: 0, appear: 0 });
    a.appear += n;
  }
  const cardRows = Object.values(cardAgg).map(a => ({ ...a, wr: a.picked ? a.wins / a.picked : 0, pickRate: a.appear ? a.picked / a.appear : null })).sort((x, y) => y.picked - x.picked);
  // identità nazionale: distribuzione Conversioni/Risorse/Marchi tra le carte assunte di ciascuna nazione —
  // risponde a "chi assume Italiani gioca davvero diverso da chi assume Tedeschi?" (bucket dedotto da effSig).
  const effBucket = eff => (eff.startsWith('scambia') ? 'conv' : eff.startsWith('marchi×') || eff === 'prendi-marchi' ? 'marchi' : 'risorse');
  const nationAgg = {};
  for (const g of ok) for (const h of g.hires) {
    if (!h.nation) continue;
    const a = nationAgg[h.nation] || (nationAgg[h.nation] = { conv: 0, marchi: 0, risorse: 0 });
    a[effBucket(h.eff)]++;
  }
  const nationRows = Object.entries(nationAgg).map(([nation, a]) => {
    const tot = a.conv + a.marchi + a.risorse || 1;
    return { nation, tot, conv: a.conv / tot, marchi: a.marchi / tot, risorse: a.risorse / tot };
  }).sort((x, y) => y.tot - x.tot);

  // ===== DESIGN ALERT — prima dove guardare, poi le evidenze =====
  const cvTurns = avg(turns) ? sd(turns) / avg(turns) : 0;
  const sevOf = (v, y, r) => (v >= r ? 2 : v >= y ? 1 : 0);
  const alerts = [
    { sev: sevOf(cvTurns, 0.15, 0.30), text: `Durata ${avg(turns).toFixed(1)} turni (min ${Math.min(...turns)}, max ${Math.max(...turns)}) — ${cvTurns < 0.15 ? 'stabile' : 'variabile'}.` },
    { sev: sevOf(spread, 0.10, 0.20), text: `Posti: spread vittorie ${pct(spread)} (${wins.map(pct).join('/')}).` },
    { sev: sevOf(actShare(domCat), 0.35, 0.40), text: `${domCat} occupa il ${pct(actShare(domCat))} delle azioni.` },
    { sev: sevOf(trueWasteShare, 0.10, 0.20), text: `Il ${pct(trueWasteShare)} delle risorse prodotte non genera alcun valore (vero spreco — vendita/scambio non conta).` },
    { sev: sevOf(abandoned, 0.20, 0.40), text: `Il ${pct(abandoned)} dei giocatori abbandona un tracciato (pos ≤4).` },
    { sev: sevOf(unused, 0.20, 0.30), text: `Il ${pct(unused)} dei marchi disponibili resta inutilizzato.` },
    { sev: sevOf(neverShare, 0.10, 0.20), text: `Il ${pct(neverShare)} dei giocatori chiude senza commesse.` },
    { sev: grandiShare < 0.05 ? 2 : grandiShare < 0.10 ? 1 : 0, text: `Peso grandi: ${pct(grandiShare)} dei completamenti (quanto pesano sul totale, non quante ne restano).` },
  ].sort((a, b) => b.sev - a.sev);
  L.push('=== DESIGN ALERT ===');
  for (const a of alerts) L.push(`${['🟢', '🟡', '🔴'][a.sev]} ${a.text}`);
  L.push('');

  // ===== POSSIBILI CONTRADDIZIONI — coppie di fatti veri insieme che chiedono spiegazione =====
  const contra = [];
  if (actShare('Borsa') >= 0.25 && unused >= 0.30)
    contra.push([`la Borsa assorbe il ${pct(actShare('Borsa'))} delle azioni, ma il ${pct(unused)} dei marchi resta inutilizzato`, 'forse la Borsa non è il vero collo di bottiglia (o ci si va per altro: risorse, conversioni)?']);
  if (abandoned >= 0.40 && ms2plus >= 0.50)
    contra.push([`il ${pct(abandoned)} dei giocatori abbandona un tracciato, ma il ${pct(ms2plus)} porta ad almeno 2 milestone`, 'i tracciati si usano solo fino alla milestone — il payoff post-milestone è debole?']);
  if (dirSopraFull >= 0.70 && spendShare('direzione') <= 0.20)
    contra.push([`la Direzione Sopra viene completata nel ${pct(dirSopraFull)} dei casi pur pesando solo il ${pct(spendShare('direzione'))} della spesa`, 'obbligo a buon mercato più che scelta?']);
  if (actShare('Produzione') >= 0.35 && trueWasteShare >= 0.20)
    contra.push([`la Produzione occupa il ${pct(actShare('Produzione'))} dei turni, ma il ${pct(trueWasteShare)} delle risorse non estrae alcun valore`, 'si produce oltre la domanda E oltre la capacità di vendita/scambio?']);
  if (contra.length) {
    L.push('=== ⚠ POSSIBILI CONTRADDIZIONI (coppie di fatti che chiedono spiegazione) ===');
    for (const [fact, q] of contra) { L.push(`⚠ ${fact}.`); L.push(`  → ${q}`); }
    L.push('');
  }

  // ===== SORPRESE — atteso vs osservato (🟡 correlazioni, non cause) =====
  const surprises = [];
  for (const st of STRATS) {
    const a = stratAgg[st]; if (!a.n) continue;
    const fShare = a.n / (ok.length * P), wShare = a.w / ok.length;
    if (fShare >= 0.05 && wShare - fShare >= 0.10 && wShare >= 1.5 * fShare)
      surprises.push(`atteso: vincitori ~ distribuzione del campo · osservato: ${st} è il ${pct(fShare)} del campo ma il ${pct(wShare)} dei vincitori → sovrarappresentata.`);
    if (fShare >= 0.15 && wShare <= 0.5 * fShare)
      surprises.push(`atteso: vincitori ~ distribuzione del campo · osservato: ${st} è il ${pct(fShare)} del campo ma solo il ${pct(wShare)} dei vincitori → sottorappresentata.`);
  }
  for (const t of tileRows) {
    if (t.games < 8) continue;
    const z = tileZ(t);
    if (z >= 2) surprises.push(`atteso: win% per tessera ~${pct(1 / P)} · osservato: ${t.id} ${pct(t.wr)} su ${t.games} partite (${z.toFixed(1)}σ) → outlier alto.`);
    if (z <= -2) surprises.push(`atteso: win% per tessera ~${pct(1 / P)} · osservato: ${t.id} ${pct(t.wr)} su ${t.games} partite (${z.toFixed(1)}σ) → outlier basso.`);
  }
  for (const e of effRows) {
    if (e.picked >= 30 && e.wr >= 1.5 / P) surprises.push(`atteso: win% di chi prende un bonus ~${pct(1 / P)} · osservato: ${e.eff} ${pct(e.wr)} (${e.picked} prese) → bonus sospetto forte.`);
  }
  if (surprises.length) {
    L.push('=== SORPRESE (atteso vs osservato · 🟡 correlazioni, da verificare con A/B) ===');
    for (const s of surprises.slice(0, 6)) L.push(`⚠ ${s}`);
    L.push('');
  }

  L.push(...batchAnalysis(ok, cfg, P, { bySize, tot, allT, sopra, sotto }));
  L.push('');

  // ==================================================================
  L.push('=== 1. RITMO DELLA PARTITA — come scorre una partita? ===');
  L.push('');
  L.push(`— DURATA — turni a testa: media ${avg(turns).toFixed(1)}, mediana ${med(turns)}, min ${Math.min(...turns)}, max ${Math.max(...turns)} · clock finale medio ${avg(ok.map(g => g.clock)).toFixed(1)} · ${(actSum / (ok.length * P || 1)).toFixed(1)} azioni/giocatore`);
  L.push(`— PRIMA COMMESSA — turno medio ${avg(firsts).toFixed(1)}, mediana ${med(firsts)} · giocatori senza commesse: ${never}/${ok.length * P} (${pct(neverShare)})`);
  L.push('');

  L.push('— TIMELINE PV (vincitore vs media campo) —');
  const pvMaxR = Math.max(...ok.map(g => Math.max(...Object.keys(g.pvByRound).map(Number))));
  for (let r = 1; r <= pvMaxR; r++) {
    if (r !== 1 && r % 3 !== 0) continue;
    const gamesWith = ok.filter(g => g.pvByRound[r]);
    if (gamesWith.length < ok.length * 0.5) break;
    const win = avg(gamesWith.map(g => g.pvByRound[r][g.winner]));
    const field = avg(gamesWith.map(g => avg(g.pvByRound[r].filter((_, i) => i !== g.winner))));
    L.push(`R${String(r).padStart(2)} | vincitore ${win.toFixed(1).padStart(5)} | campo ${field.toFixed(1).padStart(5)} | Δ ${(win - field).toFixed(1).padStart(5)}`);
  }
  L.push('(Δ crescente dal principio = il vincitore parte davanti; Δ che esplode a fine = rimonta/finale)');
  L.push('');

  // RITMO DI GIOCO (Layer 2) — vedi rhythm() a livello modulo (condivisa con l'A/B diff).
  const KEYS = [['firstC', 'Tempo 1ª commessa'], ['firstL', 'Tempo 1ª grande'], ['buildStop', 'Fine costruzione'], ['convStart', 'Inizio conversione'], ['lastC', 'Ultima commessa'], ['burst', 'Burstiness (CV gap)']];
  const rAgg = seatsOf => {
    const acc = Object.fromEntries(KEYS.map(([k]) => [k, []]));
    for (const g of ok) for (const seat of seatsOf(g)) { const r = rhythm(g, seat); for (const [k] of KEYS) if (r[k] != null) acc[k].push(r[k]); }
    return Object.fromEntries(KEYS.map(([k]) => [k, acc[k].length ? avg(acc[k]) : null]));
  };
  const rWin = rAgg(g => [g.winner]), rLast = rAgg(g => [g.results.at(-1).playerId]), rAll = rAgg(g => g.results.map(r => r.playerId));
  const f1 = v => (v == null ? '  — ' : v.toFixed(1).padStart(4));
  L.push('— RITMO DI GIOCO (fase investimento → conversione) —');
  L.push('indicatore            | vincitori | ultimi | campo');
  for (const [k, lab] of KEYS) L.push(`${lab.padEnd(21)} |    ${f1(rWin[k])}   |  ${f1(rLast[k])}  | ${f1(rAll[k])}`);
  if (rWin.buildStop != null && rWin.lastC != null)
    L.push(`(vincitori: smettono di costruire ~t${rWin.buildStop.toFixed(0)}, ultima commessa ~t${rWin.lastC.toFixed(0)} → ${(rWin.lastC - rWin.buildStop).toFixed(0)} turni di sola conversione)`);
  L.push('');

  // RITMO COMMESSE — gap medio fra completamenti consecutivi, per transizione di taglia
  const trans = {};
  for (const g of ok) for (let seat = 0; seat < P; seat++) {
    const cs = [...g.contracts[seat]].filter(c => c.turn).sort((a, b) => a.turn - b.turn);
    for (let i = 1; i < cs.length; i++) { const k = `${cs[i - 1].size}->${cs[i].size}`; (trans[k] = trans[k] || []).push(cs[i].turn - cs[i - 1].turn); }
  }
  const transRows = Object.entries(trans).filter(([, v]) => v.length >= Math.max(5, ok.length * 0.1)).sort((a, b) => b[1].length - a[1].length);
  if (transRows.length) {
    L.push('— RITMO COMMESSE (gap medio turni fra completamenti consecutivi) —');
    for (const [k, v] of transRows) { const [a, b] = k.split('->'); L.push(`${SIZE_IT[a]}→${SIZE_IT[b]}: ${avg(v).toFixed(1)} turni (${v.length} casi)`); }
    L.push('');
  }

  // TEMPO DI COSTRUZIONE — presto e poi sfrutta, oppure costruisce fino alla fine?
  const lastHireAll = ok.flatMap(g => g.build.map(b => b.lastHire)).filter(x => x > 0);
  const lastDirAll = ok.flatMap(g => g.build.map(b => b.lastDir)).filter(x => x > 0);
  const lastContractAll = ok.flatMap(g => g.contracts.map(cs => (cs.length ? Math.max(...cs.map(c => c.turn)) : 0))).filter(x => x > 0);
  L.push('— TEMPO DI COSTRUZIONE (turno medio dell\'ultima azione) —');
  L.push(`ultimo lavoratore (reparto): ${avg(lastHireAll).toFixed(1)} · ultima carta Direzione: ${lastDirAll.length ? avg(lastDirAll).toFixed(1) : '—'} · ultima commessa: ${avg(lastContractAll).toFixed(1)} · durata media ${avg(turns).toFixed(1)} round`);
  L.push('(se le ultime carte cadono a metà partita mentre le commesse proseguono: si costruisce presto e poi si sfrutta)');
  L.push('');

  // ULTIMO SLOT REPARTO/DIREZIONE — la fabbrica piena assorbe l'accelerazione marchi, o i marchi continuano a crescere a fabbrica già piena?
  const slotAvg = (key, idx) => { const v = ok.flatMap(g => g.slotTurn[key][idx]).filter(x => x != null); return v.length ? avg(v) : null; };
  const fmtSlot = v => v == null ? '—' : v.toFixed(1);
  L.push('— ULTIMO SLOT REPARTO/DIREZIONE (turno medio di riempimento) —');
  L.push(`Sopra: 1° ${fmtSlot(slotAvg('sopra', 0))} · 2° ${fmtSlot(slotAvg('sopra', 1))} · 3° ${fmtSlot(slotAvg('sopra', 2))}  (media sui 3 reparti)`);
  L.push(`Sotto: 1° ${fmtSlot(slotAvg('sotto', 0))} · 2° ${fmtSlot(slotAvg('sotto', 1))}  (media sui 3 reparti)`);
  // tanti slot quanti il cap configurato (col cap a 3 il 3° mancava dal report)
  const slotSeries = key => (ok[0]?.slotTurn[key] || []).map((_, i) => `${i + 1}° ${fmtSlot(slotAvg(key, i))}`).join(' · ');
  L.push(`Direzione Sopra: ${slotSeries('dirSopra')}`);
  if (cfg.welfareEnabled !== false) L.push(`Direzione Sotto (Macchinario): 1° ${fmtSlot(slotAvg('dirSotto', 0))} · 2° ${fmtSlot(slotAvg('dirSotto', 1))}`);
  L.push('(se tutti gli slot si riempiono ben prima di t31-40 (dove i marchi/attivazione accelerano di più, vedi sopra) mentre i marchi continuano a crescere, la fabbrica piena NON è il lavandino dell\'economia — l\'accelerazione continua a motore già completo.)');
  L.push('');

  L.push('— HEATMAP AZIONI PER FASE (% delle azioni della fase) —');
  L.push('Fase       | ' + HEAT_COLS.map(c => c.padStart(10)).join(' | '));
  ['1° quarto', '2° quarto', '3° quarto', 'finale'].forEach((label, q) => {
    const sums = HEAT_COLS.map(c => ok.reduce((a, g) => a + g.heat[q][c], 0));
    const qTot = sums.reduce((a, b) => a + b, 0) || 1;
    L.push(label.padEnd(10) + ' | ' + sums.map(v => pct(v / qTot).padStart(10)).join(' | '));
  });
  L.push('');

  L.push('— DOVE FINISCONO I TURNI (ripartizione azioni · 🟢20-40% 🟡<10% 🔴>40%) —');
  L.push(HEAT_COLS.map(c => `${lightTurn(actShare(c))} ${c} ${pct(actShare(c))}`).join(' · '));
  L.push('');

  // ==================================================================
  L.push('=== 2. ECONOMIA — il motore produce ricchezza sana? ===');
  L.push('');
  L.push('— MARCHI MEDI A INIZIO ROUND —');
  const maxR = Math.max(...ok.map(g => Math.max(...Object.keys(g.coinsByRound).map(Number))));
  for (let r = 1; r <= maxR; r++) {
    if (r !== 1 && r % 3 !== 0) continue;
    const vals = ok.flatMap(g => g.coinsByRound[r] || []);
    if (vals.length < ok.length * P * 0.5) break;
    const m = avg(vals);
    L.push(`R${String(r).padStart(2)} | ${m.toFixed(1).padStart(5)} m ${'█'.repeat(Math.min(40, Math.round(m / 2)))}`);
  }
  L.push('');

  L.push('— ECONOMIA MARCHI (media per giocatore) —');
  L.push(`guadagnati ${gAvg.toFixed(1)} · spesi ${sAvg.toFixed(1)} · rimasti ${rAvg.toFixed(1)} (${light(unused, 0.20, 0.30)} ${pct(unused)} del disponibile resta inutilizzato)`);
  L.push('spesa: ' + CATS.map(c => `${c} ${pct(spendShare(c))}`).join(' · '));
  L.push('(se la Direzione è una fetta minima e i marchi finiscono quasi tutti nei lavoratori, quei 5m di costo non ripagano)');
  L.push('("inutilizzato" sopra = marchi mai spesi durante il turno, ma a fine partita convertono comunque in PV — non necessariamente sprecati. Il vero spreco marchi, sotto, è il resto che non converte nemmeno lì.)');
  const trueWasteCoinsAmt = ok.reduce((a, g) => a + g.coinsFinalByPlayer.reduce((x, c) => x + (c % (g.coinsPerPV || 1)), 0), 0);
  const gainedTotAll = ok.reduce((a, g) => a + g.econ.reduce((x, e) => x + e.gained, 0), 0);
  const trueWasteCoinsShare = gainedTotAll ? trueWasteCoinsAmt / gainedTotAll : 0;
  L.push(`vero spreco marchi: ${trueWasteCoinsAmt} marchi a fine partita non convertono in PV nemmeno nella conversione finale (resto oltre coinsPerPV=${ok[0]?.coinsPerPV ?? '?'}) — ${light(trueWasteCoinsShare, 0.10, 0.20)} ${pct(trueWasteCoinsShare)} del guadagnato`);
  L.push('');

  L.push('— BILANCIO MARCHI — DA DOVE NASCE LA RICCHEZZA (media/giocatore · % dei marchi guadagnati) —');
  L.push('(fatto grezzo: risponde a "quale meccanismo immette ricchezza". In questo gioco i marchi entrano SOLO da queste vie — macchinari/Direzione/tessere/obiettivi danno risorse o PV, non marchi.)');
  const nP = allEcon.length || 1;
  const srcLine = (lab, k) => `  ${lab.padEnd(26)} +${(srcTot[k] / nP).toFixed(1).padStart(5)}  ${pct(srcShare(k)).padStart(4)}`;
  for (const s of [...SECTORS].sort((a, b) => (srcTot[b] || 0) - (srcTot[a] || 0))) L.push(srcLine(`produzione ${s}`, s));
  L.push(`  └ produzione reparto (caselle ⓜ del tracciato riprodotte attivando): ${pct(repartoShare)}`);
  L.push(srcLine('tracciati (bonus di salita)', 'tracciati'));
  L.push('  LAVORATORI (effetti carte Sotto del reparto), per tipo:');
  L.push(srcLine('  lav. «prendi N monete»', 'lavFisso'));
  L.push(srcLine('  lav. marchi × nazionalità', 'lavNazioni'));
  L.push(srcLine('  lav. marchi × icona', 'lavIcone'));
  L.push(srcLine('  lav. marchi × tensione', 'lavTensione'));
  L.push(srcLine('  lav. marchi × fabbrica', 'lavFabbrica'));
  L.push(`  └ lavoratori totale: ${pct(lavShare)} dei marchi`);
  L.push(srcLine('scambio (vendita risorse)', 'scambio'));
  L.push(srcLine('tile tracciato (trigger a installazione)', 'trackTile'));
  L.push(`  ─────────  FONTI +${gAvg.toFixed(1)}  →  IMPIEGHI −${sAvg.toFixed(1)}  →  residuo netto ${(gAvg - sAvg >= 0 ? '+' : '') + (gAvg - sAvg).toFixed(1)} (finali−iniziali)`);
  L.push('(NB: le caselle ⓜ del tracciato che riproducono ad ogni attivazione contano in "produzione"; "tracciati" = solo il bonus una-tantum di salita. Impieghi = riga "spesa" sopra.)');
  L.push('');

  // ===== DA DOVE NASCE L'ACCELERAZIONE — non "perché cresce", ma "quale fonte cresce più in fretta" =====
  // Il bilancio sopra è il totale a fine partita: non dice SE una fonte accelera o è costante nel tempo.
  // coinsGainedByRound[t][seat] = cumulativo per fonte al round t (snapshot già preso per coinsByRound/pvByRound,
  // qui solo scomposto per fonte). Confrontare finestre separa "produci di più a botta" da "produci più spesso" —
  // il totale finale non li distingue, il tasso per finestra sì.
  const SRC_GROUPS = {
    'Produzione reparto': SECTORS,
    'Lavoratori icona': ['lavIcone'],
    'Lavoratori nazione': ['lavNazioni'],
    'Lavoratori tensione': ['lavTensione'],
    'Lavoratori fissi': ['lavFisso'],
    'Vendita/scambio': ['scambio'],
    'Bonus tracciato': ['tracciati'],
  };
  const cumAt = (g, seat, round, keys) => {
    const avail = Object.keys(g.coinsGainedByRound).map(Number).filter(r => r <= round);
    if (!avail.length) return null;
    const snap = g.coinsGainedByRound[Math.max(...avail)][seat];
    return keys.reduce((a, k) => a + (snap[k] || 0), 0);
  };
  const WINDOWS = [[1, 20], [21, 30], [31, 40]];
  const rateFor = keys => WINDOWS.map(([lo, hi]) => {
    const vals = [];
    for (const g of ok) {
      if (g.turns < hi) continue; // solo partite arrivate almeno a fine finestra: confronto equo, non falsato da partite corte
      for (let seat = 0; seat < P; seat++) {
        const a = lo === 1 ? 0 : cumAt(g, seat, lo - 1, keys);
        const b = cumAt(g, seat, hi, keys);
        if (a == null || b == null) continue;
        vals.push((b - a) / (hi - lo + 1));
      }
    }
    return vals.length ? avg(vals) : null;
  });
  const accelRows = Object.entries(SRC_GROUPS)
    .map(([label, keys]) => ({ label, rates: rateFor(keys) }))
    .filter(r => r.rates.every(x => x != null && x >= 0))
    .map(r => ({ ...r, factor: r.rates[0] > 0.05 ? r.rates[2] / r.rates[0] : null }))
    .sort((a, b) => (b.factor ?? -1) - (a.factor ?? -1));
  let prodPerAct = null; // marchi/attivazione per finestra — usato anche sotto, in RISORSE vs MARCHI
  if (accelRows.length) {
    const nGameOk = ok.filter(g => g.turns >= 40).length;
    L.push(`=== DA DOVE NASCE L'ACCELERAZIONE (marchi/round per fonte, ${nGameOk} partite arrivate al turno 40) ===`);
    L.push('(non è una spiegazione del "perché": scompone il totale in fonti e mostra quale cresce più in fretta tra inizio e fine partita. Da qui l\'A/B si mira sulla fonte che accelera, non su tutte.)');
    L.push('Fonte                | t1-20 | t21-30 | t31-40 | fattore');
    for (const r of accelRows) L.push(`${r.label.padEnd(20)} | ${r.rates.map(x => x.toFixed(1).padStart(5)).join(' | ')} | ${r.factor == null ? '  —' : '×' + r.factor.toFixed(1)}`);
    L.push('(fattore = tasso t31-40 ÷ tasso t1-20. "—" = fonte trascurabile in t1-20 (<0.05/round), il rapporto non è significativo.)');
    L.push('');

    // Domanda 3 dell'utente: marchi per SINGOLA attivazione Produzione, per finestra — separa efficienza (guadagno
    // per attivazione) da frequenza (quante attivazioni). Stesso dato di "Produzione reparto" sopra, diviso per le
    // attivazioni effettive contate nella stessa finestra (già in tel.actions, nessuna telemetria nuova).
    prodPerAct = WINDOWS.map(([lo, hi]) => {
      let coinsSum = 0, actCount = 0, counted = false;
      for (const g of ok) {
        if (g.turns < hi) continue;
        counted = true;
        for (let seat = 0; seat < P; seat++) {
          const a = lo === 1 ? 0 : cumAt(g, seat, lo - 1, SECTORS);
          const b = cumAt(g, seat, hi, SECTORS);
          if (a != null && b != null) coinsSum += (b - a);
        }
        actCount += g.actions.filter(x => x.cat === 'Produzione' && x.turn >= lo && x.turn <= hi).length;
      }
      return counted && actCount ? coinsSum / actCount : null;
    });
    if (prodPerAct.every(x => x != null)) {
      L.push('— MARCHI MEDI PER ATTIVAZIONE PRODUZIONE, PER FINESTRA —');
      L.push(`t1-20: ${prodPerAct[0].toFixed(1)} · t21-30: ${prodPerAct[1].toFixed(1)} · t31-40: ${prodPerAct[2].toFixed(1)}`);
      L.push('(se questo numero cresce, ogni attivazione rende di più — caselle migliori del tracciato raggiunte col tempo. Se resta piatto mentre "Produzione reparto" sopra accelera, il motore non è più efficiente: si attiva più spesso e basta — guarda le azioni Produzione/round nella HEATMAP.)');
      L.push('');
    }
  }

  // Caso A (più caselle ⓜ raggiunte sul tracciato) vs Caso B (stesso numero di caselle, moltiplicatore più alto per casella — es. lavoratori×icona)
  const activeCellsAt = (g, seat, round) => {
    const avail = Object.keys(g.tracksByRound).map(Number).filter(r => r <= round);
    if (!avail.length) return null;
    const snap = g.tracksByRound[Math.max(...avail)][seat];
    let count = 0;
    DEPT_ROLES_B.forEach((role, i) => { for (let p = 1; p <= snap[i]; p++) if (g.coinCellFlag[role][p]) count++; });
    return count;
  };
  const cellsAtEnd = WINDOWS.map(([, hi]) => {
    const vals = [];
    for (const g of ok) { if (g.turns < hi) continue; for (let seat = 0; seat < P; seat++) { const v = activeCellsAt(g, seat, hi); if (v != null) vals.push(v); } }
    return vals.length ? avg(vals) : null;
  });
  if (cellsAtEnd.every(x => x != null)) {
    L.push('— CASELLE ⓜ ATTIVE (media a fine finestra) — Caso A vs Caso B dell\'accelerazione —');
    L.push(`t20: ${cellsAtEnd[0].toFixed(1)} · t30: ${cellsAtEnd[1].toFixed(1)} · t40: ${cellsAtEnd[2].toFixed(1)}`);
    L.push('(caselle che producono marchi già raggiunte sul tracciato: riproducono a ogni attivazione. Se cresce nello stesso ritmo di "Produzione reparto" sopra → l\'accelerazione nasce dalla posizione sul tracciato (Caso A). Se "marchi/attivazione" sopra cresce più di questo numero → il moltiplicatore per casella sta crescendo, non solo il conteggio caselle (Caso B, es. lavoratori×icona).)');
    L.push('');
  }

  // Risorse vs marchi per finestra: se crescono insieme è coerente col Caso A (posizione tracciato); se le risorse restano piatte mentre i marchi accelerano, la crescita è specifica ai marchi (lavoratori×icona/nazionalità), non alla produzione fisica.
  const resCumAt = (g, seat, round) => {
    const avail = Object.keys(g.resGenByRound).map(Number).filter(r => r <= round);
    if (!avail.length) return null;
    const snap = g.resGenByRound[Math.max(...avail)][seat];
    return SECTORS.reduce((a, k) => a + (snap[k] || 0), 0);
  };
  const resRate = WINDOWS.map(([lo, hi]) => {
    const vals = [];
    for (const g of ok) {
      if (g.turns < hi) continue;
      for (let seat = 0; seat < P; seat++) {
        const a = lo === 1 ? 0 : resCumAt(g, seat, lo - 1);
        const b = resCumAt(g, seat, hi);
        if (a != null && b != null) vals.push((b - a) / (hi - lo + 1));
      }
    }
    return vals.length ? avg(vals) : null;
  });
  if (resRate.every(x => x != null)) {
    L.push('— PRODUZIONE PER FINESTRA: RISORSE vs MARCHI —');
    L.push(`risorse/round       | ${resRate.map(x => x.toFixed(1).padStart(5)).join(' | ')}`);
    if (prodPerAct?.every(x => x != null)) L.push(`marchi/attivazione  | ${prodPerAct.map(x => x.toFixed(1).padStart(5)).join(' | ')}  (da MARCHI MEDI sopra, stessa scala di confronto)`);
    L.push('(colonne: t1-20 · t21-30 · t31-40. Se le risorse/round crescono quanto i marchi/attivazione, entrambe seguono la stessa causa — la posizione sul tracciato. Se le risorse restano piatte mentre i marchi accelerano, la crescita è specifica ai marchi.)');
    L.push('');
  }

  L.push('— RISORSE PRODOTTE vs SPESE (per settore) —');
  for (const sc of SECTORS) {
    const gen = ok.reduce((a, g) => a + g.resGen.reduce((x, r) => x + (r[sc] || 0), 0), 0);
    const spent = ok.reduce((a, g) => a + g.resSpent.reduce((x, r) => x + (r[sc] || 0), 0), 0);
    L.push(`${sc.padEnd(12)}: prodotte ${String(gen).padStart(6)} · spese ${String(spent).padStart(6)} · usate ${pct(spent / (gen || 1)).padStart(4)} · surplus ${gen - spent}`);
  }
  L.push('(un settore molto prodotto ma poco speso = risorsa in eccesso / commesse che non la chiedono)');
  L.push('');

  L.push('— DESTINAZIONE DELLE RISORSE — due canali di valore, non uno solo (commesse E vendita/scambio) —');
  L.push(`Commesse   ${pct(resToC / (resProdAll || 1)).padStart(4)}  (${resToC} risorse)`);
  L.push(`Mercato    ${pct(marketShare).padStart(4)}  (vendute o scambiate — estraggono valore altrove, non sprecate)`);
  L.push(`Perse      ${light(trueWasteShare, 0.10, 0.20)} ${pct(trueWasteShare).padStart(4)}  (${trueWasteAmt} risorse — vero spreco: nessun valore estratto in nessuna forma)`);
  L.push('(prodotte in totale: ' + resProdAll + '. "Mercato" NON è un problema: è il secondo canale di valorizzazione delle risorse, previsto dal design — vedi SCAMBI sotto per il dettaglio. Solo "Perse" segnala davvero uno spreco.)');
  L.push('');

  L.push('— BILANCIO RISORSE — DA DOVE NASCONO / DOVE VANNO (media/giocatore · % del rispettivo totale) —');
  L.push('(fatto grezzo, nessuna interpretazione: risponde a "quale meccanismo immette risorse, e dove finiscono")');
  const RSRC = ['produzione', 'tracciati', 'macchinari', 'bonus', 'acquisto', 'scambio', 'trackTile'];
  const RSINK = ['commesse', 'vendita', 'scambio', 'tile'];
  const rgTot = {}, rsTot = {}; let rgSum = 0, rsSum = 0;
  for (const g of ok) for (const rb of g.resGainedBy) for (const k of RSRC) { rgTot[k] = (rgTot[k] || 0) + (rb[k] || 0); rgSum += rb[k] || 0; }
  for (const g of ok) for (const sb of g.resSpentByCat) for (const k of RSINK) { rsTot[k] = (rsTot[k] || 0) + (sb[k] || 0); rsSum += sb[k] || 0; }
  const nPr = allEcon.length || 1;
  const resid = avg(ok.flatMap(g => g.resFinal));
  L.push('  FONTI                        IMPIEGHI');
  const srcLines = RSRC.map(k => `  ${k.padEnd(11)} +${(rgTot[k] / nPr).toFixed(1).padStart(5)}  ${pct((rgTot[k] || 0) / (rgSum || 1)).padStart(4)}`);
  const snkLines = RSINK.map(k => `  ${k.padEnd(9)} −${(rsTot[k] / nPr).toFixed(1).padStart(5)}  ${pct((rsTot[k] || 0) / (rsSum || 1)).padStart(4)}`);
  for (let i = 0; i < RSRC.length; i++) L.push(srcLines[i].padEnd(31) + (snkLines[i] || ''));
  L.push(`  ─────────  FONTI +${(rgSum / nPr).toFixed(1)}  →  IMPIEGHI −${(rsSum / nPr).toFixed(1)}  →  residuo +${resid.toFixed(1)} in mano a fine (→ conversione PV o sprecate)`);
  L.push('(produzione/tracciati/macchinari/bonus = create · acquisto/scambio = convertite da marchi/altre risorse. Per capire quale leva sposta una fonte: leverMap/indicatorTable.)');
  L.push('');

  L.push('— SCAMBI — CHE CONVERSIONI AVVENGONO DAVVERO (eventi, non ammontare) —');
  L.push('("scambio" nel bilancio sopra è un\'unica etichetta per 3 meccaniche diverse: qui sono separate.)');
  const convTot = { risorsaRisorsa: 0, marchiRisorsa: 0, risorsaMarchi: 0 };
  for (const g of ok) for (const cc of g.convCount) for (const k in convTot) convTot[k] += cc[k] || 0;
  const convSum = convTot.risorsaRisorsa + convTot.marchiRisorsa + convTot.risorsaMarchi;
  const convLine = (label, k) => L.push(`  ${label.padEnd(22)} ${String(convTot[k]).padStart(6)} eventi  ${pct((convTot[k] || 0) / (convSum || 1)).padStart(4)}  (${(convTot[k] / nPr).toFixed(1)}/giocatore)`);
  convLine('risorsa → risorsa', 'risorsaRisorsa');
  convLine('marchi → risorsa', 'marchiRisorsa');
  convLine('risorsa → marchi', 'risorsaMarchi');
  L.push('(conta l\'evento di scambio, non le unità mosse — vedi BILANCIO RISORSE sopra per le quantità.)');
  L.push('');

  L.push('— UTILIZZO DELLE CONVERSIONI — BORSA vs CARTE LAVORATORE (eventi/giocatore) —');
  const exSell = ok.reduce((a, g) => a + (g.exchange?.sell || 0), 0);
  const exSwap = ok.reduce((a, g) => a + (g.exchange?.swap || 0), 0);
  const lavRR = convTot.risorsaRisorsa - exSwap, lavRM = convTot.risorsaMarchi - exSell, lavMR = convTot.marchiRisorsa;
  L.push('BORSA (azione fissa nel menu, non richiede carte):');
  L.push(`  vendi risorsa → 3 marchi ........... ${(exSell / nPr).toFixed(1)}`);
  L.push(`  2 risorse → 1 a scelta ............. ${(exSwap / nPr).toFixed(1)}`);
  L.push('LAVORATORI (bonus delle carte Sotto installate, per direzione — non per quantità f1→f2):');
  L.push(`  risorsa → risorsa ................... ${(lavRR / nPr).toFixed(1)}`);
  L.push(`  marchi → risorsa ..................... ${(lavMR / nPr).toFixed(1)}`);
  L.push(`  risorsa → marchi ..................... ${(lavRM / nPr).toFixed(1)}`);
  L.push('(non ancora scomposto per quantità esatta f1→f2 di ogni carta, es. "1→1" vs "2→2" — richiederebbe una chiave per formula invece che per direzione.)');
  L.push('');

  L.push('=== BORSA: ESCI SENZA COMMESSE (homebrew 13/07/2026) — la scelta è reale o irrilevante? ===');
  const allVisits = ok.flatMap(g => g.borsaVisits.map(v => ({ ...v, totalTurns: g.turns })));
  const nVisits = allVisits.length || 1;
  const withCommessa = allVisits.filter(v => v.didCommessa).length;
  const withBonus = allVisits.filter(v => v.didBonus).length;
  L.push('Visite (per giocatore, per visita — mutuamente esclusive):');
  L.push(`  con commessa ................ ${pct(withCommessa / nVisits)}`);
  L.push(`  con bonus fisso .............. ${pct(withBonus / nVisits)}`);
  L.push('(se "con bonus" è vicino a 0, il bonus è troppo debole o l\'IA preferisce sempre le Commesse quando può — greedy completa una commessa appena possibile, vedi ai.js chooseBorsa step 1. Se sale al 30-50%, la scelta è reale.)');
  L.push('');

  L.push('Quando sceglie il bonus (posizione nella partita, % delle visite-con-bonus):');
  const timing = { 'prima metà': 0, 'seconda metà': 0, 'ultimi 5 turni': 0 };
  for (const v of allVisits) {
    if (!v.didBonus) continue;
    if (v.turn > v.totalTurns - 5) timing['ultimi 5 turni']++;
    else if (v.turn > v.totalTurns / 2) timing['seconda metà']++;
    else timing['prima metà']++;
  }
  const nBonus = withBonus || 1;
  for (const k of ['prima metà', 'seconda metà', 'ultimi 5 turni']) L.push(`  ${k.padEnd(16)} ${pct(timing[k] / nBonus)}`);
  L.push('(se cresce verso fine partita, il bonus funziona da acceleratore quando le Commesse non convengono più — non un rifiuto generico delle Commesse.)');
  L.push('');

  L.push('Refresh gratuito — quale mercato, ed è servito a qualcosa?');
  const allRefresh = ok.flatMap(g => g.refreshLog);
  const nRefresh = allRefresh.length || 1;
  const refreshWelfare = allRefresh.filter(r => r.target === 'welfare').length;
  const refreshWorkers = allRefresh.filter(r => r.target === 'workers').length;
  L.push(`  scelta: Welfare ${pct(refreshWelfare / nRefresh)} · banchi operai ${pct(refreshWorkers / nRefresh)}  (${allRefresh.length} refresh totali)`);
  const marketBuckets = { '0': 0, '1': 0, '2+': 0 };
  for (const r of allRefresh) marketBuckets[r.marketBefore >= 2 ? '2+' : String(r.marketBefore)]++;
  L.push(`  mercato PRIMA del refresh: 0 acquistabili ${pct(marketBuckets['0'] / nRefresh)} · 1 ${pct(marketBuckets['1'] / nRefresh)} · 2+ ${pct(marketBuckets['2+'] / nRefresh)}`);
  L.push('  (se refresha con 2+ carte già acquistabili, probabilmente sta sbagliando — il mercato non era morto.)');
  const effectiveCount = allRefresh.filter(r => r.effective).length;
  L.push(`  refresh efficace (porta a un acquisto Welfare/Assunzione entro i suoi 2 turni successivi): ${pct(effectiveCount / nRefresh)}`);
  L.push('  (il refresh in sé non vale niente — vale solo se cambia davvero una decisione a valle.)');
  L.push('');

  L.push('Conversioni durante la visita, prima di decidere (0 = entra solo per il bonus, non sfrutta la Borsa):');
  const convBuckets = { '0': 0, '1': 0, '2': 0, '3+': 0 };
  for (const v of allVisits) convBuckets[v.conversions >= 3 ? '3+' : String(v.conversions)]++;
  for (const k of ['0', '1', '2', '3+']) L.push(`  ${k.padEnd(4)} ${pct(convBuckets[k] / nVisits)}`);
  L.push('');

  const bonusCoinsAvg = avg(allVisits.filter(v => v.didBonus).map(v => v.coinsGained));
  L.push(`Marchi guadagnati per visita-con-bonus (bonus fisso + eventuali vendite prima): media ${bonusCoinsAvg.toFixed(1)}`);
  L.push('');

  L.push('— CONVERSIONI DISPONIBILI vs USATE — le carte lavoratore sono testo morto o no? —');
  const convCardsAvg = avg(ok.flatMap(g => g.convCards));
  const attTot = { risorsaRisorsa: 0, marchiRisorsa: 0, risorsaMarchi: 0 };
  for (const g of ok) for (const ca of g.convAttempts) for (const k in attTot) attTot[k] += ca[k] || 0;
  L.push(`carte conversione (formula 'scambia') installate a fine partita: ${convCardsAvg.toFixed(1)}/giocatore`);
  L.push('quante volte la carta era in gioco all\'attivazione (disponibile) vs quante volte si è davvero attivata (usata):');
  const utilLine = (label, k, used) => { const u = used / (attTot[k] || 1); return L.push(`  ${label.padEnd(18)} disponibile ${String(attTot[k]).padStart(6)}  ·  usata ${String(used).padStart(6)}  ·  ${light(1 - u, 0.5, 0.8)} ${pct(u)} utilizzo`); };
  utilLine('risorsa → risorsa', 'risorsaRisorsa', lavRR);
  utilLine('marchi → risorsa', 'marchiRisorsa', lavMR);
  utilLine('risorsa → marchi', 'risorsaMarchi', lavRM);
  L.push('(risorsa→risorsa e risorsa→marchi "a scelta": disponibile = quante volte proposta la scelta, usata = quante volte l\'IA ha accettato — riflette sia se conveniva sia se il giocatore poteva permettersela.');
  L.push(' marchi→risorsa e le carte a settore fisso: disponibile = quante volte la carta era in gioco all\'attivazione, usata = quante volte c\'erano abbastanza marchi/risorse per pagarla — nessuna scelta dell\'IA qui, solo un vincolo di cassa.)');
  L.push('(non ancora misurato: l\'azione Borsa fissa non ha un "disponibile" comparabile — è una scelta di nodo/turno, non un auto-fire — e se una risorsa convertita finisce davvero in una commessa, che richiede tracciare la singola unità.)');
  L.push('');

  L.push('— PERCHÉ NON CONVERTE — la ragione del rifiuto, non solo il conteggio (carte "a scelta") —');
  L.push('(letta direttamente dalla decisione dell\'IA nel momento in cui rifiuta, non ricostruita a posteriori: la causa esatta, non una correlazione.)');
  const reasonTot = { risorsaRisorsa: {}, marchiRisorsa: {}, risorsaMarchi: {} };
  for (const g of ok) for (const bk of Object.keys(reasonTot)) for (const [r, n] of Object.entries(g.declineReasons[bk] || {})) reasonTot[bk][r] = (reasonTot[bk][r] || 0) + n;
  for (const [label, bk] of [['risorsa → risorsa', 'risorsaRisorsa'], ['marchi → risorsa', 'marchiRisorsa'], ['risorsa → marchi', 'risorsaMarchi']]) {
    const reasons = reasonTot[bk];
    const tot = Object.values(reasons).reduce((a, b) => a + b, 0);
    if (!tot) continue;
    L.push(`  ${label}: ${tot} rifiuti`);
    for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) L.push(`    ${pct(n / tot).padStart(4)}  ${r} (${n})`);
  }
  L.push('(risorsa→risorsa: "nessun surplus da cedere" = non aveva niente in eccesso al momento; "nessuna commessa richiede altre risorse ora" = tutte le commesse attive/sbloccate hanno già ciò che serve — è distribuzione della domanda, non economia; "il surplus coincide col fabbisogno" = l\'unica risorsa in eccesso è anche l\'unica richiesta, scambio impossibile per costruzione.)');
  L.push('');

  const blockedTot = Object.values(ok.reduce((acc, g) => { for (const [k, n] of Object.entries(g.blockedSurplusBySector)) acc[k] = (acc[k] || 0) + n; return acc; }, {})).reduce((a, b) => a + b, 0);
  if (blockedTot) {
    L.push('— "NESSUNA COMMESSA RICHIEDE" — quanto è forte, e dove nasce —');
    L.push('(scompone i rifiuti "nessuna commessa richiede" di cui sopra: quale settore resta bloccato senza destinazione, e quante commesse aveva davanti in quel momento.)');
    const secTot = {};
    for (const g of ok) for (const [k, n] of Object.entries(g.blockedSurplusBySector)) secTot[k] = (secTot[k] || 0) + n;
    L.push('  settore in eccesso senza destinazione:');
    for (const [s, n] of Object.entries(secTot).sort((a, b) => b[1] - a[1])) L.push(`    ${s.padEnd(14)} ${pct(n / blockedTot).padStart(4)}  (${n})`);
    const candTot = {};
    for (const g of ok) for (const [k, n] of Object.entries(g.blockedByCandidateCount)) candTot[k] = (candTot[k] || 0) + n;
    L.push('  commesse attive/sbloccate in quel momento (quante ne aveva davanti quando ha rifiutato):');
    for (const k of ['0', '1', '2', '3+']) if (candTot[k]) L.push(`    ${k.padEnd(3)} commesse   ${pct(candTot[k] / blockedTot).padStart(4)}  (${candTot[k]})`);
    L.push('(se il rifiuto si concentra su 0-1 commesse davanti, il problema è quantità/varietà a mercato — leva: contractMarket/contractCount. Se succede anche con 3+ commesse davanti, il mercato è già vario ma nessuna di quelle in vista chiede quel settore — leva: struttura dei requisiti-commessa, non quantità.)');
    L.push('');

    L.push('— IN CHE FASE SUCCEDE — comportamento fisiologico o problema vero? —');
    L.push('(fase rispetto alla PROPRIA prima/ultima commessa completata in quella partita: se il rifiuto è quasi tutto in costruzione, prima di aver completato qualunque commessa, è normale non avere ancora un bersaglio — non un difetto da correggere.)');
    const phaseTot = { costruzione: 0, conversione: 0, finale: 0, 'mai una commessa': 0 };
    for (const g of ok) {
      for (const ev of g.blockedLog) {
        const cs = g.contracts[ev.seat];
        if (!cs.length) { phaseTot['mai una commessa']++; continue; }
        const first = Math.min(...cs.map(c => c.turn)), last = Math.max(...cs.map(c => c.turn));
        if (ev.turn < first) phaseTot.costruzione++;
        else if (ev.turn <= last) phaseTot.conversione++;
        else phaseTot.finale++;
      }
    }
    const phaseSum = Object.values(phaseTot).reduce((a, b) => a + b, 0) || 1;
    L.push(`  costruzione (prima della 1ª commessa propria) ... ${pct(phaseTot.costruzione / phaseSum).padStart(4)}  (${phaseTot.costruzione})`);
    L.push(`  conversione (tra 1ª e ultima commessa propria) .. ${pct(phaseTot.conversione / phaseSum).padStart(4)}  (${phaseTot.conversione})`);
    L.push(`  finale (dopo l'ultima commessa propria) ......... ${pct(phaseTot.finale / phaseSum).padStart(4)}  (${phaseTot.finale})`);
    if (phaseTot['mai una commessa']) L.push(`  giocatore che non completa mai una commessa ..... ${pct(phaseTot['mai una commessa'] / phaseSum).padStart(4)}  (${phaseTot['mai una commessa']})`);
    L.push('(se "costruzione" domina, il 78% visto sopra è in gran parte fisiologico: l\'IA viene interpellata su una conversione anche quando nessuna commessa esiste ancora per costruzione del motore stesso — la domanda arriva nel momento sbagliato, non la risposta. Se "conversione" o "finale" pesano parecchio, il rifiuto avviene anche a bersagli già in gioco: lì il problema è reale, non di tempismo.)');
    L.push('');
  }

  if (cfg.welfareEnabled !== false) {
  L.push('— IL GATE MACCHINARI SPOSTA LE AZIONI BORSA NEL TEMPO, O LE RIDUCE? —');
  L.push('(gate = turno in cui il giocatore installa il 1° Macchinario, cioè quando sblocca i tier Borsa. Chi non lo installa mai resta fuori da questa tabella — vedi DIREZIONE per quanti sono.)');
  let gateUnlocked = 0, gateNever = 0;
  const gateBuckets = { pre: { ev: 0, opp: 0 }, post3: { ev: 0, opp: 0 }, resto: { ev: 0, opp: 0 } };
  for (const g of ok) {
    for (let seat = 0; seat < g.firstMachineTurn.length; seat++) {
      const gate = g.firstMachineTurn[seat];
      if (gate == null) { gateNever++; continue; }
      gateUnlocked++;
      const final = g.turns;
      gateBuckets.pre.opp += Math.max(0, gate - 1);
      gateBuckets.post3.opp += Math.max(0, Math.min(3, final - gate + 1));
      gateBuckets.resto.opp += Math.max(0, final - gate - 2);
    }
    for (const e of g.exchangeLog) {
      const gate = g.firstMachineTurn[e.seat];
      if (gate == null) continue;
      const off = e.turn - gate;
      if (off < 0) gateBuckets.pre.ev++;
      else if (off < 3) gateBuckets.post3.ev++;
      else gateBuckets.resto.ev++;
    }
  }
  const gateRate = b => (b.opp ? b.ev / b.opp : 0);
  L.push(`giocatori che sbloccano almeno 1 Macchinario: ${gateUnlocked} · mai: ${gateNever} (${pct(gateNever / (gateUnlocked + gateNever || 1))})`);
  L.push('finestra (relativa al gate)  | eventi Borsa | round-giocatore | azioni Borsa/round');
  for (const [label, b] of [['prima del gate', gateBuckets.pre], ['3 turni dopo il gate', gateBuckets.post3], ['resto della partita', gateBuckets.resto]]) {
    L.push(`  ${label.padEnd(26)} ${String(b.ev).padStart(9)}      ${String(b.opp).padStart(11)}        ${gateRate(b).toFixed(2)}`);
  }
  L.push('("azioni Borsa/round" = eventi ÷ round-giocatore disponibili in quella finestra, normalizza finestre di lunghezza diversa. Un tasso "3 turni dopo" molto più alto di "prima" = il gate comprime l\'uso nel tempo, non lo riduce; se "resto" ≈ "prima", il gate non cambia la decisione a lungo termine, solo il timing iniziale.)');
  L.push('');
  }

  // EFFICIENZA MEDIA — vincitori davvero più efficienti degli ultimi?
  const collectEff = filterFn => {
    const prodC = [], resC = [];
    for (const g of ok) {
      const lastSeat = g.results.at(-1).playerId;
      for (let seat = 0; seat < P; seat++) {
        const nc = g.contracts[seat].length; if (!nc || !filterFn(g, seat, lastSeat)) continue;
        prodC.push(g.activations[seat] / nc);
        resC.push(SECTORS.reduce((a, sc) => a + (g.resGen[seat][sc] || 0), 0) / nc);
      }
    }
    return { prod: avg(prodC), res: avg(resC) };
  };
  const eAll = collectEff(() => true), eWin = collectEff((g, seat) => seat === g.winner), eLast = collectEff((g, seat, ls) => seat === ls);
  L.push('— EFFICIENZA MEDIA (per commessa completata) —');
  L.push(`Produzioni/commessa: media ${eAll.prod.toFixed(1)} · vincitori ${eWin.prod.toFixed(1)} · ultimi ${eLast.prod.toFixed(1)}`);
  L.push(`Risorse/commessa:    media ${eAll.res.toFixed(1)} · vincitori ${eWin.res.toFixed(1)} · ultimi ${eLast.res.toFixed(1)}`);
  L.push('(se vincitori < ultimi, i vincitori convertono meglio produzione in commesse)');
  L.push('');

  // ==================================================================
  L.push('=== 3. STRATEGIE — chi gioca come, e perché vince? ===');
  L.push('');
  L.push('— STRATEGIE OSSERVATE (🟢 classificazione euristica, soglie dichiarate — non archetipi appresi) —');
  L.push('definizioni: Rush = 1ª commessa entro il 35% della partita e ≥3 commesse · Costruttore precoce = fine costruzione entro il 55% e consegne oltre l\'80% · Convertitore continuo = consegne regolari (CV gap <0.4, ≥3 commesse) · Generalista = il resto');
  L.push('strategia             | % campo | % vincitori | win%');
  for (const st of STRATS) {
    const a = stratAgg[st]; if (!a.n) continue;
    L.push(`${st.padEnd(21)} | ${pct(a.n / (ok.length * P)).padStart(7)} | ${pct(a.w / ok.length).padStart(11)} | ${pct(a.w / a.n).padStart(4)}`);
  }
  L.push('(win% per strategia = 🟡 correlazione: l\'AI sceglie in base al contesto, non a caso — nessuna causa)');
  L.push('');

  // DIFFERENZA VINCITORI vs MEDIA CAMPO — cosa distingue davvero i vincitori
  const resSum = (g, s) => SECTORS.reduce((a, sc) => a + (g.resGen[s][sc] || 0), 0);
  const pvOf = (g, s, k) => g.results.find(r => r.playerId === s)[k];
  const winVsField = fn => {
    const w = [], f = [];
    for (const g of ok) {
      const wv = fn(g, g.winner); if (wv == null) continue;
      const others = []; for (let s = 0; s < P; s++) { if (s === g.winner) continue; const ov = fn(g, s); if (ov != null) others.push(ov); }
      if (!others.length) continue;
      w.push(wv); f.push(avg(others));
    }
    return { win: avg(w), field: avg(f) };
  };
  const dPct = (w, f) => (f ? `${w - f >= 0 ? '+' : ''}${(100 * (w - f) / f).toFixed(0)}%` : '—');
  const dPV = (w, f) => `${w - f >= 0 ? '+' : ''}${(w - f).toFixed(1)} PV`;
  const prodC = winVsField((g, s) => { const nc = g.contracts[s].length; return nc ? g.activations[s] / nc : null; });
  const resC = winVsField((g, s) => { const nc = g.contracts[s].length; return nc ? resSum(g, s) / nc : null; });
  const fin = winVsField((g, s) => g.econ[s].final);
  const obj = winVsField((g, s) => pvOf(g, s, 'pvObjectives'));
  const com = winVsField((g, s) => pvOf(g, s, 'pvContracts'));
  const trk = winVsField((g, s) => pvOf(g, s, 'pvTrack'));
  L.push('— DIFFERENZA VINCITORI vs MEDIA CAMPO —');
  L.push(`Produzioni/commessa: ${dPct(prodC.win, prodC.field)} (vinc ${prodC.win.toFixed(1)} vs ${prodC.field.toFixed(1)}) — negativo = vincitori più efficienti`);
  L.push(`Risorse/commessa:    ${dPct(resC.win, resC.field)} (vinc ${resC.win.toFixed(1)} vs ${resC.field.toFixed(1)})`);
  L.push(`Marchi finali:       ${dPct(fin.win, fin.field)} (vinc ${fin.win.toFixed(1)} vs ${fin.field.toFixed(1)})`);
  L.push(`PV Commesse:         ${dPV(com.win, com.field)} · PV Obiettivi: ${dPV(obj.win, obj.field)} · PV Tracciati: ${dPV(trk.win, trk.field)}`);
  L.push('');

  // ORIGINE DEI PUNTI — composizione % dei PV, vincitori vs ultimi
  const PVCH = [['pvContracts', 'Commesse'], ['pvObjectives', 'Obiettivi'], ['pvTrack', 'Tracciati'], ['pvCoins', 'Marchi'], ['pvResources', 'Risorse']];
  const originOf = seatFn => {
    const sums = Object.fromEntries(PVCH.map(([k]) => [k, 0])); let oTot = 0;
    for (const g of ok) { const r = g.results.find(rr => rr.playerId === seatFn(g)); for (const [k] of PVCH) { const v = Math.max(0, r[k]); sums[k] += v; oTot += v; } }
    return { sums, tot: oTot || 1 };
  };
  const oWin = originOf(g => g.winner), oLast = originOf(g => g.results.at(-1).playerId);
  L.push('— ORIGINE DEI PUNTI (composizione % dei PV) —');
  L.push('          | ' + PVCH.map(([, l]) => l.padStart(9)).join(' | '));
  L.push('vincitori | ' + PVCH.map(([k]) => pct(oWin.sums[k] / oWin.tot).padStart(9)).join(' | '));
  L.push('ultimi    | ' + PVCH.map(([k]) => pct(oLast.sums[k] / oLast.tot).padStart(9)).join(' | '));
  L.push('(dopo una modifica al regolamento: mostra se i vincitori vincono ancora sulle Commesse o se il gioco si è spostato)');
  L.push('');

  // ==================================================================
  L.push('=== 4. BILANCIAMENTO — le leve: posti, taglie, tracciati, tessere, bonus, reparti ===');
  L.push('');
  L.push('— PV PER POSIZIONE DI TURNO —');
  L.push('Posto | Win% | PV tot | Commesse | Obiettivi | Tracciati | Marchi | Risorse');
  for (let seat = 0; seat < P; seat++) {
    const rs = ok.map(g => g.results.find(r => r.playerId === seat));
    L.push(`  ${seat + 1}°  | ${pct(wins[seat]).padStart(4)} | ${avg(rs.map(r => r.total)).toFixed(1).padStart(6)} | ${avg(rs.map(r => r.pvContracts)).toFixed(1).padStart(8)} | ${avg(rs.map(r => r.pvObjectives)).toFixed(1).padStart(9)} | ${avg(rs.map(r => r.pvTrack)).toFixed(1).padStart(9)} | ${avg(rs.map(r => r.pvCoins)).toFixed(1).padStart(6)} | ${avg(rs.map(r => r.pvResources)).toFixed(1)}`);
  }
  L.push('');

  L.push('— DISTRIBUZIONE PUNTEGGI (per rango finale) —');
  L.push(Array.from({ length: P }, (_, r) => `${r + 1}° ${avg(ok.map(g => g.results[r]?.total ?? 0)).toFixed(1)}`).join(' · '));
  L.push(`ultimo classificato: ${avg(ok.map(g => g.results.at(-1).total)).toFixed(1)} · gap 1°-ultimo: ${avg(ok.map(g => g.results[0].total - g.results.at(-1).total)).toFixed(1)} · dev.std media entro-partita: ${avg(ok.map(g => sd(g.results.map(r => r.total)))).toFixed(1)}`);
  L.push('');

  // aggregati fabbrica/nodi: le vecchie tabelle per-posto (visite nodi, attivazioni, sindacato)
  // raccontavano la stessa storia di heatmap + PV per posizione — compresse in tre righe.
  L.push('— FABBRICA E NODI (aggregati) —');
  L.push(`Assunzioni: Sopra ${sopra} (${pct(sopra / (sopra + sotto || 1))}) · Sotto ${sotto} (${pct(sotto / (sopra + sotto || 1))}) · attivazioni reparto/giocatore: ${avg(ok.flatMap(g => g.activations)).toFixed(1)}`);
  L.push('attivazioni per settore (media/giocatore): ' + SECTORS.map(sc => `${sc} ${avg(ok.flatMap(g => g.activationsBySector.map(v => v[sc] || 0))).toFixed(1)}`).join(' · '));
  L.push('Sindacato (media/giocatore): ' + SIND_KEYS.map(k => `${SIND_LABEL[k]} ${avg(ok.flatMap(g => g.sindacato.map(v => v[k] || 0))).toFixed(1)}`).join(' · ') + ` · scioperi subiti ${avg(ok.flatMap(g => g.strikesByOpponent)).toFixed(1)}`);
  L.push('');

  L.push(`— COMMESSE — prima della partita: piccola ${pct(firstSize.small / ok.length)} · media ${pct(firstSize.medium / ok.length)} · grande ${pct(firstSize.large / ok.length)}`);
  for (const [size, label] of [['small', 'piccole'], ['medium', 'medie'], ['large', 'grandi']]) {
    const ts = ok.flatMap(g => g.completions.filter(c => c.size === size).map(c => c.turn));
    L.push(`${label.padEnd(8)}: ${bySize[size]} completamenti (${pct(bySize[size] / (tot || 1))} del clock), turno medio ${ts.length ? avg(ts).toFixed(1) : '—'}`);
  }
  L.push('');

  L.push('— COMMESSE PER TAGLIA (completate vs rimaste non completate) —');
  for (const [size, label] of [['small', 'piccole'], ['medium', 'medie'], ['large', 'grandi']]) {
    const done = bySize[size];
    const market = ok.reduce((a, g) => a + g.contractsLeft[size].market, 0);
    const inDeck = ok.reduce((a, g) => a + g.contractsLeft[size].deck, 0);
    const totCards = done + market + inDeck || 1;
    L.push(`${label.padEnd(8)}: completate ${done} (${pct(done / totCards)}) · a mercato non prese ${market} · mai pescate ${inDeck}`);
  }
  L.push('(molte grandi mai completate = troppo dure/care; molte piccole a mercato non prese = ignorate)');
  L.push('');

  const ncAll = ok.flatMap(g => g.contracts.map(cs => cs.length));
  const ncB = { '≤1': 0, 2: 0, 3: 0, 4: 0, 5: 0, '6+': 0 };
  for (const n of ncAll) ncB[n <= 1 ? '≤1' : n >= 6 ? '6+' : n]++;
  L.push('— COMMESSE PER GIOCATORE (distribuzione a fine partita) —');
  L.push(['≤1', 2, 3, 4, 5, '6+'].map(k => `${k}: ${pct(ncB[k] / (ncAll.length || 1))}`).join(' · ') + ` · media ${avg(ncAll).toFixed(1)}`);
  L.push('');

  L.push('— TRACCIATI (pos finale /16) —');
  ['terziario', 'secondario', 'primario'].forEach((role, i) => {
    L.push(`${role.padEnd(10)}: media ${avg(allT.map(t => t.pos[i])).toFixed(1)}, mediana ${med(allT.map(t => t.pos[i]))} · milestone ${pct(allT.filter(t => t.ms[i]).length / allT.length)}`);
  });
  L.push(`più arretrato: media ${avg(mins).toFixed(1)} · abbandonato (≤4): ${pct(abandoned)} · tutte e 3 le milestone: ${pct(allT.filter(t => t.ms.every(Boolean)).length / allT.length)}`);
  const msAll = ok.flatMap(g => g.tracks.map(t => t.ms.filter(Boolean).length));
  const msB = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const m of msAll) msB[m]++;
  L.push('milestone per giocatore: ' + [0, 1, 2, 3].map(k => `${k}: ${pct(msB[k] / (msAll.length || 1))}`).join(' · '));
  L.push('(questa "milestone" è la SOGLIA FINALE del proprio tracciato per reparto, non i 3 mercati tile sotto — sono due concetti diversi che condividono solo il nome.)');
  L.push('');

  // distribuzione finale, non solo la media — dice dove si concentrano i reparti, utile per calibrare qualsiasi milestone futura
  const posAll = allT.flatMap(t => t.pos);
  const posBucketOf = n => (n <= 3 ? '0–3' : n <= 7 ? '4–7' : String(n));
  const posKeys = ['0–3', '4–7', '8', '9', '10', '11', '12', '13', '14', '15', '16'];
  const posDist = Object.fromEntries(posKeys.map(k => [k, 0]));
  for (const n of posAll) posDist[posBucketOf(n)]++;
  L.push('— DISTRIBUZIONE FINALE DEI TRACCIATI (posizione /16, tutti i reparti insieme) —');
  L.push(posKeys.map(k => `${k}:${pct(posDist[k] / (posAll.length || 1))}`).join(' · '));
  L.push('(non la media — dove si concentrano davvero i reparti a fine partita, per calibrare qualsiasi milestone futura senza indovinare.)');
  L.push('');

  // stessa distribuzione ma per SETTORE (Tessile/Metallurgica/Chimica), non per reparto: le plance assegnano
  // i settori a reparti diversi per giocatore, quindi solo qui si vede se un settore è sistematicamente più
  // facile da sviluppare degli altri — la media da sola (10.5/10.1/9.5) non lo dice, la forma sì.
  const posBySector = Object.fromEntries(SECTORS.map(s => [s, Object.fromEntries(posKeys.map(k => [k, 0]))]));
  const nBySector = Object.fromEntries(SECTORS.map(s => [s, 0]));
  for (const g of ok) for (const bs of g.trackBySector) for (const sector of SECTORS) {
    if (!(sector in bs)) continue;
    posBySector[sector][posBucketOf(bs[sector])]++;
    nBySector[sector]++;
  }
  L.push('— DISTRIBUZIONE FINALE PER SETTORE (Tessile/Metallurgica/Chimica, non per reparto) —');
  L.push('Posizione'.padEnd(9) + ' | ' + SECTORS.map(s => s.padStart(12)).join(' | '));
  for (const k of posKeys) L.push(k.padEnd(9) + ' | ' + SECTORS.map(s => pct(posBySector[s][k] / (nBySector[s] || 1)).padStart(12)).join(' | '));
  L.push('(se un settore ha la coda a 14-16 molto più lunga degli altri, è sistematicamente più facile da sviluppare — non lo vede la sola media.)');
  L.push('');

  // turno medio di raggiungimento di ogni milestone (1/2/3) — non solo "raggiunta sì/no", il ritmo con cui ci si arriva
  const msTurns = { 1: [], 2: [], 3: [] };
  let msInstances = 0;
  for (const g of ok) {
    if (!g.marketUnlockPos) continue;
    const rounds = Object.keys(g.tracksByRound).map(Number).sort((a, b) => a - b);
    const nSeats = g.tracks.length;
    msInstances += nSeats * 3;
    for (let seat = 0; seat < nSeats; seat++) {
      for (let ri = 0; ri < 3; ri++) {
        const role = DEPT_ROLES_B[ri];
        for (const m of [1, 2, 3]) {
          const threshold = g.marketUnlockPos[role]?.[m];
          if (threshold == null || !isFinite(threshold)) continue;
          for (const t of rounds) {
            if (g.tracksByRound[t][seat][ri] >= threshold) { msTurns[m].push(t); break; }
          }
        }
      }
    }
  }
  if (msInstances) {
    L.push('— TURNO DI RAGGIUNGIMENTO MILESTONE (1/2/3, aggregato sui 3 reparti) —');
    for (const m of [1, 2, 3]) {
      const arr = msTurns[m];
      L.push(`Milestone ${m}: turno medio ${arr.length ? avg(arr).toFixed(1) : '—'}, mediana ${arr.length ? med(arr) : '—'} · raggiunta ${pct(arr.length / msInstances)}`);
    }
    L.push('(il ritmo della partita: se il gap 1→2 è molto più corto di 2→3, il motore rallenta verso fine partita, non all\'inizio.)');
    L.push('');
  }

  // --- Borsa a indici (17/07/2026) ---
  const biGames = ok.filter(g => g.borsaIndici);
  if (biGames.length) {
    const P = biGames[0].borsaIndici.pv.length;
    const names = Object.keys(biGames[0].borsaIndici.finalIdx);
    const nIdx = biGames[0].borsaIndici.nIdx;
    const bounds = biGames[0].borsaIndici.quadBounds;
    const allBuys = biGames.flatMap(g => g.borsaIndici.buys.flat());
    const allDivs = biGames.flatMap(g => g.borsaIndici.log.flat());

    L.push('=== BORSA A INDICI — PANORAMICA ===');
    const pvAll = biGames.flatMap(g => g.borsaIndici.pv);
    const cap = cfg.borsaIndici ? cfg.borsaIndici.cells.map(r => r.slice(0, nIdx).reduce((a, b) => a + b, 0)).reduce((a, b) => a + b, 0) : 0;
    const distrib = avg(pvAll) * P;
    L.push(`PV da dividendi: media ${avg(pvAll).toFixed(1)}/giocatore · ${distrib.toFixed(1)} distribuiti per partita su ${cap} sul tavolo (${pct(cap ? distrib / cap : 0)})`);
    L.push(`azioni comprate: ${(allBuys.length / biGames.length).toFixed(1)}/partita · dividendi pagati: ${(allDivs.length / biGames.length).toFixed(1)}/partita`);
    // spesa in azioni vs marchi finali (il sink funziona?)
    const spesaAz = avg(biGames.flatMap(g => g.econ.map(e => e.by.azioni || 0)));
    const finali = avg(biGames.flatMap(g => g.econ.map(e => e.final)));
    const guad = avg(biGames.flatMap(g => g.econ.map(e => e.gained)));
    L.push(`marchi: guadagnati ${guad.toFixed(1)} · spesi in azioni ${spesaAz.toFixed(1)} (${pct(guad ? spesaAz / guad : 0)}) · finali ${finali.toFixed(1)}`);
    L.push('');

    L.push('=== BORSA A INDICI — È UNA SCOMMESSA? (rango all\'acquisto vs alla chiusura) ===');
    // per ogni azione comprata, confronta il rango al momento dell'acquisto col rango del dividendo pagato
    // (stesso quad+index). Se il rango non cambia quasi mai, comprare non è una scommessa: la classifica
    // è già decisa quando compri, e il dilemma "su chi punto" non esiste.
    let matched = 0, changed = 0, up = 0, down = 0;
    const rankShift = {};
    for (const g of biGames) {
      for (let seat = 0; seat < P; seat++) {
        const divs = g.borsaIndici.log[seat];
        for (const b of g.borsaIndici.buys[seat]) {
          const d = divs.find(x => x.quad === b.quad && x.index === b.index);
          if (!d) { rankShift['non pagato (indice sceso fuori dai PV)'] = (rankShift['non pagato (indice sceso fuori dai PV)'] || 0) + 1; continue; }
          matched++;
          const shift = d.rank - b.rankAtBuy; // >0 = peggiorato (rango numerico più alto), <0 = migliorato
          if (shift !== 0) changed++;
          if (shift < 0) up++; else if (shift > 0) down++;
          const key = shift === 0 ? 'invariato' : shift < 0 ? `salito ${-shift}` : `sceso ${shift}`;
          rankShift[key] = (rankShift[key] || 0) + 1;
        }
      }
    }
    L.push(`azioni comprate e pagate: ${matched} · il rango è cambiato tra acquisto e chiusura nel ${pct(matched ? changed / matched : 0)} dei casi (salito ${pct(matched ? up / matched : 0)} · sceso ${pct(matched ? down / matched : 0)})`);
    L.push('distribuzione dello scostamento: ' + Object.entries(rankShift).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
    L.push('(se «invariato» domina, comprare non è una scommessa: quando compri la classifica è già decisa. Un dilemma vero richiede che il rango si muova spesso dopo l\'acquisto.)');
    L.push('');

    L.push('=== BORSA A INDICI — «NON VUOLE» vs «NON PUÒ» ===');
    const so = biGames.reduce((a, g) => { const s = g.borsaIndici.shareOffer; a.total += s.total; a.taken += s.taken; for (const [k, n] of Object.entries(s.declinedInstead)) a.dec[k] = (a.dec[k] || 0) + n; return a; }, { total: 0, taken: 0, dec: {} });
    L.push(`al nodo Borsa con un'azione pagabile: comprata ${pct(so.total ? so.taken / so.total : 0)} (${so.taken}/${so.total})`);
    if (Object.keys(so.dec).length) L.push('quando NON compra pur potendo → cosa fa invece: ' + Object.entries(so.dec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / (so.total - so.taken))}`).join(' · '));
    L.push('(qui il giocatore PUÒ sempre permettersela: ogni «no» è una preferenza, non un vincolo di cassa. Se compra quasi sempre, l\'azione è troppo forte rispetto alle alternative del nodo — o troppo economica.)');
    L.push('');

    L.push('=== BORSA A INDICI — AFFOLLAMENTO (il ÷investitori morde?) ===');
    const inv = {};
    for (const e of allDivs) inv[e.investors] = (inv[e.investors] || 0) + 1;
    const invTot = Object.values(inv).reduce((a, b) => a + b, 0) || 1;
    L.push('investitori per dividendo pagato: ' + [1, 2, 3, 4].map(k => `${k}→${pct((inv[k] || 0) / invTot)}`).join(' · '));
    // quanti PV si PERDONO per la divisione (se fossi stato solo su quella casella)
    const lostToSplit = allDivs.reduce((a, e) => a + (e.cell - e.pv), 0) / biGames.length;
    L.push(`PV "persi" per la divisione: ${lostToSplit.toFixed(1)}/partita (caselle non incassate perché divise o arrotondate)`);
    L.push('(se «1 investitore» domina, la repulsione funziona così bene che nessuno si affolla: il dilemma ÷investitori si scioglie da solo e la casella conta più della contesa.)');
    L.push('');

    L.push('=== BORSA A INDICI — ACQUISTI E RANGO SCELTO, PER QUADRIMESTRE ===');
    const byQ = {}, byRankQ = {};
    for (const b of allBuys) { byQ[b.quad + 1] = (byQ[b.quad + 1] || 0) + 1; const rk = b.rankAtBuy + 1; (byRankQ[b.quad + 1] = byRankQ[b.quad + 1] || {})[rk] = (byRankQ[b.quad + 1][rk] || 0) + 1; }
    L.push('Q | azioni | prezzo | rango scelto all\'acquisto (1°..' + nIdx + '°)');
    for (let q = 0; q < (cfg.borsaIndici?.cells.length || 4); q++) {
      const price = cfg.borsaIndici?.prices[q] ?? '—';
      const rk = byRankQ[q + 1] || {};
      const rkStr = Array.from({ length: nIdx }, (_, i) => `${i + 1}°:${rk[i + 1] || 0}`).join(' ');
      L.push(`Q${q + 1} | ${byQ[q + 1] || 0} | ${price}ⓜ | ${rkStr}`);
    }
    L.push('(se compra solo il 1°-2° rango, punta sui leader; se sparso su tutti i ranghi, scommette sulla rimonta di un indice arretrato — che è il gioco interessante.)');
    L.push('');

    L.push('=== BORSA A INDICI — GLI INDICI DIVERGONO O È UNA MONETINA? ===');
    L.push('valore finale medio: ' + names.map(n => `${n} ${avg(biGames.map(g => g.borsaIndici.finalIdx[n])).toFixed(1)}`).join(' · '));
    const spreads = biGames.map(g => { const v = names.map(n => g.borsaIndici.finalIdx[n]); return Math.max(...v) - Math.min(...v); });
    L.push(`spread max-min entro partita: media ${avg(spreads).toFixed(1)} (min ${Math.min(...spreads)}, max ${Math.max(...spreads)})`);
    // il Sindacato è su un'altra scala? (il nodo aperto ≈11 vs ≈6)
    if (names.includes('Sindacato')) {
      const sind = avg(biGames.map(g => g.borsaIndici.finalIdx.Sindacato));
      const sett = avg(biGames.flatMap(g => SECTORS.map(s => g.borsaIndici.finalIdx[s])));
      L.push(`Sindacato ${sind.toFixed(1)} vs media settori ${sett.toFixed(1)} — rapporto ${sett ? (sind / sett).toFixed(2) : '—'}× (>1.3 = scala diversa, vince sempre lui il 1° posto)`);
      const sindTop = biGames.filter(g => names.every(n => n === 'Sindacato' || g.borsaIndici.finalIdx.Sindacato >= g.borsaIndici.finalIdx[n])).length;
      L.push(`il Sindacato chiude 1° indice nel ${pct(sindTop / biGames.length)} delle partite`);
    }
    L.push('(medie quasi uguali + spread grande = simmetria aggregata sana, gli indici divergono davvero dentro la partita. Spread ~0 = classifica casuale.)');
    L.push('');

    L.push('=== BORSA A INDICI — CHI INDOVINA IL 1° INDICE VINCE? ===');
    // per ogni partita: il vincitore aveva investito, in ciascun quadrimestre, sull'indice che poi ha chiuso 1°?
    let winnerHitTop = 0, winnerBuys = 0, fieldHitTop = 0, fieldBuys = 0;
    for (const g of biGames) {
      const ws = g.borsaIndici.winnerSeat;
      for (let seat = 0; seat < P; seat++) {
        for (const b of g.borsaIndici.buys[seat]) {
          const d = g.borsaIndici.log[seat].find(x => x.quad === b.quad && x.index === b.index);
          const hitTop = d && d.rank === 0;
          if (seat === ws) { winnerBuys++; if (hitTop) winnerHitTop++; }
          else { fieldBuys++; if (hitTop) fieldHitTop++; }
        }
      }
    }
    L.push(`azioni che hanno chiuso 1° indice: vincitore ${pct(winnerBuys ? winnerHitTop / winnerBuys : 0)} · resto del campo ${pct(fieldBuys ? fieldHitTop / fieldBuys : 0)}`);
    L.push('(se il vincitore azzecca il 1° indice molto più del campo, la Borsa premia la lettura della classifica — è una leva di abilità. Se uguale, i dividendi sono rumore che si distribuisce a caso.)');
    L.push('');
  }

  // --- Borsa a fabbriche (18/07/2026) ---
  const fbGames = ok.filter(g => g.borsaFabbriche);
  if (fbGames.length) {
    const P = fbGames[0].borsaFabbriche.factories.length;
    const allF = fbGames.flatMap(g => g.borsaFabbriche.factories.flat());
    L.push('=== BORSA A FABBRICHE — PANORAMICA ===');
    L.push(`mappa ${fbGames[0].borsaFabbriche.nGiocatori}p (${fbGames[0].borsaFabbriche.hexTotali} esagoni) · fabbriche fondate: ${(allF.length / fbGames.length).toFixed(1)}/partita, ${(allF.length / (fbGames.length * P)).toFixed(1)}/giocatore`);
    L.push(`turno medio di fondazione: ${allF.length ? avg(allF.map(f => f.turn)).toFixed(1) : '—'}`);
    // guadagnati vs costruiti = tasso di realizzo dei crediti (lock-out se basso)
    const earned = avg(fbGames.flatMap(g => g.borsaFabbriche.creditsEarned));
    const built = allF.length / (fbGames.length * P);
    L.push(`crediti-milestone guadagnati ${earned.toFixed(1)}/giocatore · fabbriche costruite ${built.toFixed(1)} · realizzo ${pct(earned ? built / earned : 0)}`);
    L.push(`risorse dalle fabbriche: ${avg(fbGames.flatMap(g => g.borsaFabbriche.resFromFactory)).toFixed(1)}/giocatore · marchi spesi in fondazioni: ${avg(fbGames.flatMap(g => g.borsaFabbriche.spendAzioni)).toFixed(1)}`);
    const util = avg(fbGames.map(g => g.borsaFabbriche.occupied / g.borsaFabbriche.buildableTotal));
    L.push(`saturazione mappa: ${pct(util)} degli esagoni costruibili occupato (${avg(fbGames.map(g => g.borsaFabbriche.occupied)).toFixed(1)}/${fbGames[0].borsaFabbriche.buildableTotal})`);
    L.push('');

    L.push('=== BORSA A FABBRICHE — LAND-GRAB (vantaggio di chi fonda per primo?) ===');
    // fabbriche per posizione di turno + win% di quella posizione
    const bySeat = Array(P).fill(0), winBySeat = Array(P).fill(0), gamesBySeat = Array(P).fill(0);
    for (const g of fbGames) {
      g.borsaFabbriche.factories.forEach((fs, seat) => { bySeat[seat] += fs.length; });
      winBySeat[g.borsaFabbriche.winnerSeat]++;
      for (let s = 0; s < P; s++) gamesBySeat[s]++;
    }
    L.push('fabbriche per posizione: ' + bySeat.map((n, i) => `${i + 1}° ${(n / fbGames.length).toFixed(1)}`).join(' · '));
    L.push('vittorie per posizione: ' + winBySeat.map((n, i) => `${i + 1}° ${pct(n / fbGames.length)}`).join(' · '));
    // chi fonda per PRIMO in ogni partita, e vince?
    let firstFounderWins = 0, gamesWithFactory = 0;
    for (const g of fbGames) {
      let first = null, firstTurn = Infinity;
      g.borsaFabbriche.factories.forEach((fs, seat) => { for (const f of fs) if (f.turn < firstTurn) { firstTurn = f.turn; first = seat; } });
      if (first != null) { gamesWithFactory++; if (first === g.borsaFabbriche.winnerSeat) firstFounderWins++; }
    }
    L.push(`chi fonda per primo vince nel ${pct(gamesWithFactory ? firstFounderWins / gamesWithFactory : 0)} delle partite (atteso a caso: ${pct(1 / P)})`);
    L.push('(se le fabbriche si concentrano sulle prime posizioni e quelle vincono di più, il land-grab è un vantaggio di turn-order — il rischio segnalato.)');
    L.push('');

    L.push('=== BORSA A FABBRICHE — GIACIMENTI (diffuso o clusterizzato?) ===');
    L.push('(per ogni casella-risorsa: quanti dei suoi siti costruibili adiacenti sono occupati. Distingue "52% sparso ovunque" da "alcuni giacimenti saturi, altri vuoti".)');
    const gi = fbGames.reduce((a, g) => { const x = g.borsaFabbriche.giacimenti; for (const k in x) a[k] += x[k]; return a; }, { d0: 0, d1: 0, d2: 0, d3: 0, saturi: 0, inutil: 0, tot: 0 });
    const gt = gi.tot || 1;
    L.push(`siti costruibili occupati per giacimento:  0 ${pct(gi.d0 / gt)} · 1 ${pct(gi.d1 / gt)} · 2 ${pct(gi.d2 / gt)} · 3+ ${pct(gi.d3 / gt)}`);
    L.push(`giacimenti completamente saturi: ${pct(gi.saturi / gt)} · giacimenti inutilizzati (0 fabbriche adiacenti): ${pct(gi.inutil / gt)}`);
    L.push('(saturi alti + inutilizzati alti = competizione locale a macchie [clusterizzato]; entrambi bassi = saturazione diffusa e uniforme.)');
    L.push('');

    L.push('=== BORSA A FABBRICHE — PRESSIONE TERRITORIALE (chi compete con chi) ===');
    L.push('(non quante fabbriche, ma se nascono a contatto con un avversario o strappando l\'ultimo posto libero di un giacimento conteso.)');
    const pr = fbGames.reduce((a, g) => { const x = g.borsaFabbriche.pressione; a.adjOpp += x.adjOpp; a.lastSpot += x.lastSpot; a.tot += x.tot; return a; }, { adjOpp: 0, lastSpot: 0, tot: 0 });
    const prTot = pr.tot || 1;
    L.push(`fabbriche adiacenti a una fabbrica avversaria: ${pct(pr.adjOpp / prTot)}`);
    L.push(`fondazioni che occupano l'ultimo posto libero di un giacimento conteso (2+ posti, tutti presi): ${pct(pr.lastSpot / prTot)}`);
    L.push('(alto su entrambi = interazione indiretta reale sulla mappa, senza blocchi o attacchi espliciti.)');
    L.push('');

    L.push('=== BORSA A FABBRICHE — SCELTA CONTESA vs ALTERNATIVE (valore del sito o scarsità?) ===');
    L.push('(per ogni fondazione: quanti altri siti legali per quel settore erano liberi da avversari in quel momento, e se nonostante questo si è scelto comunque un sito già a contatto con un avversario.)');
    const allChoices = fbGames.flatMap(g => g.borsaFabbriche.choiceLog);
    const buckets = [['0', x => x === 0], ['1', x => x === 1], ['2-3', x => x >= 2 && x <= 3], ['4+', x => x >= 4]];
    const cTot = allChoices.length || 1;
    for (const [label, pred] of buckets) {
      const inBucket = allChoices.filter(c => pred(c.nUncontestedAlt));
      const contestedRate = inBucket.length ? inBucket.filter(c => c.chosenContested).length / inBucket.length : 0;
      L.push(`  ${label} alternative libere da avversari: ${pct(inBucket.length / cTot)} delle fondazioni · di queste, ha scelto comunque un sito conteso: ${pct(contestedRate)}`);
    }
    L.push('(se anche con 2+ alternative libere l\'IA sceglie spesso il sito conteso, il valore del sito/l\'euristica domina sulla "maggioranza facile" — non è la mappa a mancare di spazio.)');
    L.push('');

    if (fbGames[0].borsaFabbriche.maggioranza.pv > 0 || fbGames.some(g => g.borsaFabbriche.maggioranza.vinti > 0)) {
      L.push('=== BORSA A FABBRICHE — MAGGIORANZA TERRITORIALE (bonus PV per giacimento) ===');
      const mg = fbGames.reduce((a, g) => { const x = g.borsaFabbriche.maggioranza; a.vinti += x.vinti; a.pareggio += x.pareggio; a.vuoti += x.vuoti; a.tot += x.tot; return a; }, { vinti: 0, pareggio: 0, vuoti: 0, tot: 0 });
      const mgTot = mg.tot || 1;
      L.push(`bonus configurato: ${fbGames[0].borsaFabbriche.maggioranza.pv} PV/giacimento`);
      L.push(`giacimenti assegnati (un vincitore netto o per milestone): ${pct(mg.vinti / mgTot)} · pareggio irrisolto (nessuno prende PV): ${pct(mg.pareggio / mgTot)} · nessuna fabbrica del settore: ${pct(mg.vuoti / mgTot)}`);
      L.push(`PV medi distribuiti/giocatore: ${(mg.vinti * fbGames[0].borsaFabbriche.maggioranza.pv / (fbGames.length * fbGames[0].borsaFabbriche.factories.length)).toFixed(1)}`);
      L.push('(pareggio alto = il bonus si annulla spesso da solo — il rischio di un secondo asse di punteggio che non paga mai.)');
      L.push('');
    }

    L.push('=== BORSA A FABBRICHE — LOCK-OUT (credito senza sbocco) ===');
    const b = fbGames.reduce((a, g) => { for (const k in g.borsaFabbriche.blocked) a[k] = (a[k] || 0) + g.borsaFabbriche.blocked[k]; return a; }, {});
    const bTot = Object.values(b).reduce((x, y) => x + y, 0) || 1;
    L.push('al nodo con un credito ma senza fondare, motivo: ' + Object.entries(b).map(([k, v]) => `${k} ${pct(v / bTot)}`).join(' · '));
    L.push('  (spotsTaken = posti presi da altri [land-grab] · noColorOnIsland = quel colore non è uscito nel setup [lock-out da random] · cantAfford = marchi · builtInstead = poteva e verosimilmente ha fondato)');
    // copertura colori nel setup (il rischio 2p): quante partite hanno tutti e 3 i colori sull'isola attiva
    let allColors = 0;
    for (const g of fbGames) { const cols = new Set(Object.values(g.borsaFabbriche.hexResource)); if (SECTORS.every(s => cols.has(s))) allColors++; }
    L.push(`setup con tutti e 3 i colori presenti: ${pct(allColors / fbGames.length)} delle partite (se < 100% in 2p, un settore può restare senza fabbriche)`);
    L.push('');

    L.push('=== BORSA A FABBRICHE — ETÀ (la rendita ripaga? le ultime nascono troppo tardi?) ===');
    // per ORDINE di costruzione (1ª/2ª/3ª... del giocatore): turno medio + attivazioni ricevute (turns partita - fondazione)
    const ord = {};
    for (const g of fbGames) for (const fs of g.borsaFabbriche.factories) fs.forEach((f, k) => {
      (ord[k + 1] = ord[k + 1] || []).push({ turno: f.turn, att: g.borsaFabbriche.turns - f.turn });
    });
    L.push('Fabbrica | n | turno costr. | attivazioni ricevute');
    for (const k of Object.keys(ord).map(Number).sort((a, b) => a - b)) {
      const a = ord[k];
      L.push(`  ${k}ª      | ${a.length} | ${avg(a.map(x => x.turno)).toFixed(1)} | ${avg(a.map(x => x.att)).toFixed(1)}`);
    }
    L.push('(se la n-esima nasce tardi e riceve poche attivazioni, il costo/tempo-residuo è la leva, non la mappa.)');
    L.push('');

    L.push('=== BORSA A FABBRICHE — MOLTIPLICATORE EFFETTIVO ALL\'ATTIVAZIONE ===');
    L.push(`(quante fabbriche di QUEL settore possiede il giocatore quando attiva QUEL reparto — è questo che moltiplica le carte Sotto, non la media globale. factoryActivates ${fbGames[0].borsaFabbriche.factoryActivates ? 'ON' : 'OFF'}.)`);
    const pab = fbGames.reduce((a, g) => { for (const k of [0, 1, 2, 3]) a[k] += g.borsaFabbriche.prodActByFab[k] || 0; return a; }, { 0: 0, 1: 0, 2: 0, 3: 0 });
    const pabTot = pab[0] + pab[1] + pab[2] + pab[3] || 1;
    L.push(`attivazioni di reparto campionate: ${pabTot}`);
    L.push(`  0 fabbriche (×1): ${pct(pab[0] / pabTot)}`);
    L.push(`  1 fabbrica  (×1): ${pct(pab[1] / pabTot)}`);
    L.push(`  2 fabbriche (×2): ${pct(pab[2] / pabTot)}`);
    L.push(`  3+ fabbriche(×3): ${pct(pab[3] / pabTot)}`);
    L.push(`→ il moltiplicatore supera 1× solo nel ${pct((pab[2] + pab[3]) / pabTot)} delle attivazioni (2+ fabbriche dello stesso settore).`);
    // IMPATTO: quanto valore Sotto nasce dalle attivazioni-extra (non solo quanto spesso). Il ×2 potrebbe
    // cadere sulle produzioni più ricche → peso economico ≠ frequenza. PV-equiv per confrontare marchi e risorse.
    const sv = fbGames.reduce((a, g) => { const s = g.borsaFabbriche.sottoVal; a.baseC += s.baseC; a.baseR += s.baseR; a.extraC += s.extraC; a.extraR += s.extraR; return a; }, { baseC: 0, baseR: 0, extraC: 0, extraR: 0 });
    const cpv = fbGames[0].borsaFabbriche.coinsPerPV, rpv = fbGames[0].borsaFabbriche.resPerPV;
    const basePV = sv.baseC / cpv + sv.baseR / rpv, extraPV = sv.extraC / cpv + sv.extraR / rpv, totPV = basePV + extraPV || 1;
    L.push(`IMPATTO — valore carte Sotto (PV-equiv): base ${basePV.toFixed(0)} · extra dal moltiplicatore ${extraPV.toFixed(0)} → l'extra è il ${pct(extraPV / totPV)} del valore Sotto totale`);
    L.push(`(se l'extra% è molto > della frequenza ${pct((pab[2] + pab[3]) / pabTot)}, il ×2 cade sulle produzioni ricche e conta più di quanto sembri; se ≈ o < , è marginale sul serio.)`);
    L.push('');

    L.push('=== BORSA A FABBRICHE — SPECIALIZZA O DIVERSIFICA? ===');
    // la fabbrica produce il proprio settore: rafforza il colore forte. Le risorse extra vanno in commesse o muoiono?
    const resFab = avg(fbGames.flatMap(g => g.borsaFabbriche.resFromFactory));
    L.push(`ogni fabbrica sforna il PROPRIO settore (specializzazione). Risorse da fabbrica ${resFab.toFixed(1)}/giocatore — vedi "% risorse sprecate" e "RISORSE PRODOTTE vs SPESE" sopra per capire se finiscono in commesse o in surplus morto.`);
    L.push('');
  }

  L.push('=== MERCATO TILE TRACCIATO — quanto viene usato? (2.0, homebrew 14/07/2026) ===');
  L.push('(sblocco = il reparto ha raggiunto la milestone che apre il mercato; "compra" = tra chi sblocca, quanti riempiono davvero lo slot invece di lasciarlo vuoto.)');
  const trackTileById = Object.fromEntries((cfg.trackTiles && cfg.trackTiles.length ? cfg.trackTiles : TRACK_TILES).map(t => [t.id, t]));
  const buysByMarket = { 1: [], 2: [], 3: [] };
  for (const g of ok) for (const b of g.trackTileBuys) if (buysByMarket[b.market]) buysByMarket[b.market].push({ ...b, winner: b.seat === g.winner });
  for (let mi = 0; mi < 3; mi++) {
    const market = mi + 1;
    const slots = ok.flatMap(g => g.marketSlots.flatMap(seatSlots => seatSlots.map(deptSlots => deptSlots[mi])));
    const unlocked = slots.filter(x => x.unlocked);
    const filled = unlocked.filter(x => x.filled);
    const buys = buysByMarket[market];
    L.push(`Mercato ${market}: sblocca ${pct(unlocked.length / (slots.length || 1))} dei reparti · tra chi sblocca, compra ${pct(filled.length / (unlocked.length || 1))}${buys.length ? ` · turno medio acquisto ${avg(buys.map(b => b.turn)).toFixed(1)}` : ''}`);
    // elenca OGNI tile del catalogo di questo mercato, anche quelle mai scelte (0%): senza, una tile
    // dominata sparisce dal report e "non esiste" diventa indistinguibile da "nessuno la prende".
    const byTile = {};
    for (const b of buys) (byTile[b.tileId] ??= []).push(b);
    const catalog = Object.values(trackTileById).filter(t => t.market === market);
    // "presa" ≠ "scelta": separa le volte in cui c'era un'alternativa pagabile da quelle in cui era
    // l'unica che il giocatore si permetteva. Una tile dominata ma economica risulta altrimenti
    // "scelta nel 40% dei casi" quando in realtà è solo il ripiego di chi è a corto di risorse.
    const vere = buys.filter(b => b.scelta);
    L.push(`  ${'Tile'.padEnd(24)} | Prese | Scelte con entrambe | Obbligate | win%`);
    for (const t of catalog) {
      const bs = byTile[t.id] || [];
      const mie = bs.filter(b => b.scelta).length;
      const quota = vere.length ? pct(mie / vere.length) : '—';
      const win = bs.length ? pct(bs.filter(b => b.winner).length / bs.length) : '—';
      L.push(`  ${t.name.padEnd(24)} | ${String(bs.length).padStart(5)} | ${quota.padStart(19)} | ${String(bs.length - mie).padStart(9)} | ${win}${bs.length ? '' : '   ← mai presa'}`);
    }
    if (buys.length) L.push(`  ("Scelte con entrambe" = quota sulle sole ${vere.length} prese in cui un'altra tile era pagabile. Una tile con tante Prese ma 0% qui non è preferita: è il ripiego di chi non poteva permettersi l'altra.)`);
    if (!catalog.length) L.push('  (nessuna tile definita per questo mercato)');
  }
  L.push('');

  // La tile sostituisce le carte Sotto, o si aggiunge? Il conteggio Sotto a fine partita non lo dice: dice
  // quante ce ne sono, non QUANDO sono arrivate rispetto alla tile. Qui si guarda il momento esatto in cui
  // il reparto supera la milestone, e quante carte Sotto arrivano DOPO — separando chi la tile l'ha presa
  // da chi no. Se chi prende la tile ne installa sistematicamente meno dopo, la tile sta sostituendo.
  L.push('— CARTE SOTTO vs TILE — la tile anticipa o ritarda l\'investimento nelle carte Sotto? —');
  const snaps = ok.flatMap(g => g.milestoneSnap.map(m => ({
    ...m,
    sottoFine: g.sottoFinal[m.seat],
    presa: !!g.marketSlots[m.seat][DEPT_ROLES_B.indexOf(m.role)][m.market - 1].filled,
  })));
  const cap = ok[0]?.sottoCap ?? 6;
  if (!snaps.length) L.push('(nessuna milestone-mercato raggiunta nel batch)');
  for (let market = 1; market <= 3; market++) {
    const ms = snaps.filter(x => x.market === market);
    if (!ms.length) { L.push(`Milestone ${market}: mai raggiunta`); continue; }
    const line = (label, arr) => arr.length
      ? `${label}: Sotto già installate ${avg(arr.map(x => x.sottoTot)).toFixed(2)}/${cap} · poi ne arrivano +${avg(arr.map(x => x.sottoFine - x.sottoTot)).toFixed(2)} (turno medio ${avg(arr.map(x => x.turn)).toFixed(1)}, ${arr.length} casi)`
      : `${label}: nessun caso`;
    L.push(line(`Milestone ${market}`, ms));
    L.push('  ' + line('  con tile', ms.filter(x => x.presa)));
    L.push('  ' + line('  senza tile', ms.filter(x => !x.presa)));
    const senza = ms.filter(x => !x.presa);
    if (senza.length) L.push(`    (chi non la prende aveva ${avg(senza.map(x => x.res)).toFixed(1)} risorse del settore in mano: se è ~0 non è una scelta, è che non poteva pagarla)`);
  }
  L.push('(«con/senza tile» NON è un esperimento controllato: chi prende la tile è anche chi aveva risorse — 🟡 correlazione. Un divario grande qui giustifica un A/B con le tile spente, non una conclusione.)');
  L.push('');

  // quanto ha reso ogni tile REALMENTE (non solo "comprata") — coins/res prodotti + PV equivalenti sulla stessa scala
  const tvByTile = {};
  for (const g of ok) for (const pv of g.tileValue) for (const [tileId, v] of Object.entries(pv)) (tvByTile[tileId] ??= []).push(v);
  if (Object.keys(tvByTile).length) {
    const coinsPerPV = cfg.conversions?.coinsPerPV ?? 3, resPerPV = cfg.conversions?.resPerPV ?? 2;
    L.push('— VALORE REALE DELLE TILE — non solo "comprata", quanto ha reso davvero —');
    L.push('(PV equivalenti = coins/coinsPerPV + res/resPerPV + pv diretti — stessa conversione della fine partita, per confrontare tile di tipo diverso sulla stessa scala.)');
    for (const [tileId, vs] of Object.entries(tvByTile)) {
      const tile = trackTileById[tileId];
      const name = tile ? tile.name : tileId;
      const avgCoins = avg(vs.map(v => v.coins)), avgRes = avg(vs.map(v => v.res)), avgPv = avg(vs.map(v => v.pv));
      const pvEq = avgPv + avgCoins / coinsPerPV + avgRes / resPerPV;
      L.push(`  ${name.padEnd(24)} usi medi ${avg(vs.map(v => v.uses)).toFixed(1)} · +${avgCoins.toFixed(1)}ⓜ · +${avgRes.toFixed(1)} risorse · +${avgPv.toFixed(1)}PV diretti · ≈${pvEq.toFixed(1)} PV equiv./copia`);
    }
    L.push('(se una tile "molto scelta" ha un PV equivalente basso, viene comprata ma non rende — controlla se è davvero forte o solo un\'abitudine.)');
    L.push('');
  }

  // Stato del motore AL MOMENTO dell'acquisto (idea dell'utente 19/07/2026, voluta PRIMA delle combo: usa
  // tutti gli acquisti di quella tile, non incrocia due famiglie — molto più robusto a n piccoli). Risponde
  // a "quando entra questa tile in una build?", non solo "cosa produce dopo".
  const allBuysState = ok.flatMap(g => g.trackTileBuys);
  const buyMetric = k => avg(allBuysState.map(b => b[k]));
  const baselineState = { sopra: buyMetric('sopra'), sotto: buyMetric('sotto'), fabbriche: buyMetric('fabbriche'), direzione: buyMetric('direzione'), milestone: buyMetric('milestone') };
  const byTileState = {};
  for (const b of allBuysState) (byTileState[b.tileId] ??= []).push(b);
  const stateRows = Object.entries(byTileState).filter(([, arr]) => arr.length >= 5).map(([tileId, arr]) => ({
    tileId, name: trackTileById[tileId]?.name || tileId, n: arr.length,
    sopra: avg(arr.map(b => b.sopra)), sotto: avg(arr.map(b => b.sotto)), fabbriche: avg(arr.map(b => b.fabbriche)),
    direzione: avg(arr.map(b => b.direzione)), milestone: avg(arr.map(b => b.milestone)),
  }));
  // Profilo di fase (idea dell'utente 19/07/2026): non un'etichetta hardcoded per tile, uno z-score composito
  // sulle 5 metriche sopra, contro la stessa popolazione di baselineState — dove cade quella tile nel ciclo
  // di vita di una partita emerge dal dato, non da una regola scritta a mano.
  const stateMetrics = ['sopra', 'sotto', 'fabbriche', 'direzione', 'milestone'];
  const stateSd = Object.fromEntries(stateMetrics.map(k => {
    const m = baselineState[k];
    return [k, Math.sqrt(avg(allBuysState.map(b => (b[k] - m) ** 2))) || 1e-9];
  }));
  const compositeZ = row => avg(stateMetrics.map(k => (row[k] - baselineState[k]) / stateSd[k]));
  const profileOf = z => (z <= -0.35 ? 'Apertura' : z >= 0.35 ? 'Chiusura' : 'Midgame');
  if (stateRows.length) {
    L.push('— STATO DEL MOTORE ALL\'ACQUISTO — quando entra questa tile in una build? —');
    L.push('(per ogni tile: media di Sopra/Sotto/Fabbriche/Direzione/Milestone del giocatore nel momento in cui la compra, vs media di TUTTI gli acquisti di qualunque tile. Profilo = z-score medio delle 5 metriche contro quella stessa media — non è una regola scritta a mano, emerge dal confronto. Solo tile con ≥5 acquisti registrati.)');
    L.push('Tile                     |    n | Sopra | Sotto | Fabbr. | Direz. | Milestone |     z | Profilo');
    for (const t of stateRows) {
      const z = compositeZ(t);
      L.push(`${t.name.padEnd(24)} | ${String(t.n).padStart(4)} | ${t.sopra.toFixed(1).padStart(5)} | ${t.sotto.toFixed(1).padStart(5)} | ${t.fabbriche.toFixed(1).padStart(6)} | ${t.direzione.toFixed(1).padStart(6)} | ${t.milestone.toFixed(1).padStart(9)} | ${((z >= 0 ? '+' : '') + z.toFixed(2)).padStart(6)} | ${profileOf(z)}`);
    }
    L.push(`${'media di popolazione'.padEnd(24)} |    — | ${baselineState.sopra.toFixed(1).padStart(5)} | ${baselineState.sotto.toFixed(1).padStart(5)} | ${baselineState.fabbriche.toFixed(1).padStart(6)} | ${baselineState.direzione.toFixed(1).padStart(6)} | ${baselineState.milestone.toFixed(1).padStart(9)} |     — | —`);
    L.push('(molto sopra la media = entra tardi, in build già sviluppate. Molto sotto = entra presto, spesso la prima scelta disponibile. Milestone è 0-3: quanti reparti hanno già raggiunto la propria soglia finale. Soglie profilo ±0.35σ: solo per separare i tre gruppi in un report leggibile, non un confine di design.)');
    L.push('');
  }

  // Correlazione tile → famiglie di bonus installate DOPO (idea dell'utente 19/07/2026): la tile orienta
  // davvero la costruzione del motore, o resta economia isolata? Confronta il mix di famiglie-bonus
  // installate dopo l'acquisto di ogni tile con il mix medio di popolazione (tutte le assunzioni, di
  // chiunque, di qualunque tile). 🟡 correlazione: chi compra quella tile può già essere orientato
  // diversamente a prescindere dalla tile — serve un A/B con la tile spenta per la causa.
  const allHiresPop = ok.flatMap(g => g.hires);
  const baselineShare = {};
  for (const h of allHiresPop) baselineShare[h.eff] = (baselineShare[h.eff] || 0) + 1;
  for (const k of Object.keys(baselineShare)) baselineShare[k] /= allHiresPop.length || 1;
  const tileAfter = {};
  for (const g of ok) {
    const buysBySeat = {};
    for (const b of g.trackTileBuys) (buysBySeat[b.seat] ??= []).push(b);
    for (const h of g.hires) {
      const buys = buysBySeat[h.seat];
      if (!buys) continue;
      for (const b of buys) {
        if (h.turn <= b.turn) continue; // solo le assunzioni DOPO l'acquisto della tile
        const t = (tileAfter[b.tileId] ??= { total: 0, byEff: {} });
        t.total++;
        t.byEff[h.eff] = (t.byEff[h.eff] || 0) + 1;
      }
    }
  }
  const tileAfterRows = Object.entries(tileAfter).filter(([, t]) => t.total >= 20).map(([tileId, t]) => {
    const name = trackTileById[tileId]?.name || tileId;
    const deltas = Object.entries(t.byEff)
      .map(([eff, n]) => ({ eff, share: n / t.total, delta: n / t.total - (baselineShare[eff] || 0) }))
      .sort((a, b) => b.delta - a.delta);
    return { tileId, name, total: t.total, deltas };
  });
  if (tileAfterRows.length) {
    L.push('— TILE → COSA INSTALLA DOPO — la tile orienta il motore o resta economia isolata? —');
    L.push('(per ogni tile: famiglie-bonus installate DOPO l\'acquisto, scarto in punti percentuali dal mix medio di popolazione. Solo tile con ≥20 assunzioni successive registrate.)');
    for (const t of tileAfterRows) {
      const notable = t.deltas.filter(d => Math.abs(d.delta) >= 0.05);
      const desc = notable.length
        ? notable.map(d => `${d.eff} ${d.delta >= 0 ? '+' : ''}${pct(d.delta)}`).join(' · ')
        : 'nessuna famiglia si scosta ≥5pp dalla media — probabile pura economia, non orienta il motore';
      L.push(`  ${t.name.padEnd(24)} (${t.total} assunzioni dopo) — ${desc}`);
    }
    L.push('(scarto grande e coerente su più batch = la tile indirizza davvero la costruzione del motore, non solo l\'economia. Scarto piccolo o incoerente = probabilmente rumore di chi già giocava così.)');
    L.push('');
  }

  // MOTORI → QUALI TILE COMPRANO (idea utente 19/07/2026, complemento del blocco sopra): non "cosa produce la
  // tile dopo" ma "chi ha già questo motore, quali tile cerca?". Stesso taglio causale (solo famiglie
  // installate PRIMA dell'acquisto), guardato dal verso opposto — un giocatore con più copie della stessa
  // famiglia conta una volta sola per acquisto (set, non conteggio carte) per non pesare la cassa profonda.
  const baselineTileShare = {};
  for (const g of ok) for (const b of g.trackTileBuys) baselineTileShare[b.tileId] = (baselineTileShare[b.tileId] || 0) + 1;
  const totalTileBuys = Object.values(baselineTileShare).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(baselineTileShare)) baselineTileShare[k] /= totalTileBuys;
  const familyBefore = {};
  for (const g of ok) {
    const hiresBySeat = {};
    for (const h of g.hires) (hiresBySeat[h.seat] ??= []).push(h);
    for (const b of g.trackTileBuys) {
      const hs = hiresBySeat[b.seat];
      if (!hs) continue;
      const famsBefore = new Set(hs.filter(h => h.turn < b.turn).map(h => h.eff));
      for (const eff of famsBefore) {
        const f = (familyBefore[eff] ??= { total: 0, byTile: {} });
        f.total++;
        f.byTile[b.tileId] = (f.byTile[b.tileId] || 0) + 1;
      }
    }
  }
  const familyBeforeRows = Object.entries(familyBefore).filter(([, f]) => f.total >= 20).map(([eff, f]) => {
    const deltas = Object.entries(f.byTile)
      .map(([tileId, n]) => ({ name: trackTileById[tileId]?.name || tileId, share: n / f.total, delta: n / f.total - (baselineTileShare[tileId] || 0) }))
      .sort((a, b) => b.delta - a.delta);
    return { eff, total: f.total, deltas };
  });
  if (familyBeforeRows.length) {
    L.push('— MOTORI → QUALI TILE COMPRANO — chi ha già questa famiglia di bonus, quali tile cerca dopo? —');
    L.push('(per ogni famiglia-bonus: mix di tile acquistate DA CHI L\'AVEVA GIÀ INSTALLATA, scarto in punti percentuali dal mix medio di popolazione. Solo famiglie con ≥20 acquisti successivi registrati.)');
    for (const f of familyBeforeRows) {
      const notable = f.deltas.filter(d => Math.abs(d.delta) >= 0.05);
      const desc = notable.length
        ? notable.map(d => `${d.name} ${d.delta >= 0 ? '+' : ''}${pct(d.delta)}`).join(' · ')
        : 'nessuna tile si scosta ≥5pp dalla media — probabile scelta indifferente al motore già in mano';
      L.push(`  ${f.eff.padEnd(20)} (${f.total} acquisti dopo) — ${desc}`);
    }
    L.push('(scarto grande e coerente = quel motore cerca attivamente certe tile, non solo le installa a caso. Confrontato col blocco sopra: se tile→famiglia e famiglia→tile puntano nella stessa coppia, è un ciclo di rinforzo — la tile porta al motore E il motore cerca quella tile.)');
    L.push('');
  }

  // AFFINITÀ TILE ↔ FAMIGLIE BONUS (idea utente 19/07/2026): correlazione atemporale, non chi-viene-prima — per
  // ogni coppia (tile, famiglia) quanto spesso convivono nello stesso giocatore a fine partita, contro quanto
  // ci si aspetterebbe se la scelta della tile fosse indipendente dal motore (tasso di presenza della famiglia
  // in tutta la popolazione di giocatori).
  const playerFamilies = {};
  let totalPlayerInstances = 0;
  const familyPresenceCount = {};
  ok.forEach((g, gIdx) => {
    const P2 = g.results?.length ?? 4;
    const famBySeat = Array.from({ length: P2 }, () => new Set());
    for (const h of g.hires) famBySeat[h.seat]?.add(h.eff);
    for (let seat = 0; seat < P2; seat++) {
      playerFamilies[`${gIdx}-${seat}`] = famBySeat[seat];
      totalPlayerInstances++;
      for (const eff of famBySeat[seat]) familyPresenceCount[eff] = (familyPresenceCount[eff] || 0) + 1;
    }
  });
  const familyPresenceRate = {};
  for (const [eff, n] of Object.entries(familyPresenceCount)) familyPresenceRate[eff] = n / (totalPlayerInstances || 1);
  const tileFamily = {};
  ok.forEach((g, gIdx) => {
    for (const b of g.trackTileBuys) {
      const fams = playerFamilies[`${gIdx}-${b.seat}`];
      if (!fams) continue;
      const t = (tileFamily[b.tileId] ??= { total: 0, byEff: {} });
      t.total++;
      for (const eff of fams) t.byEff[eff] = (t.byEff[eff] || 0) + 1;
    }
  });
  const affinityRows = Object.entries(tileFamily).filter(([, t]) => t.total >= 20).map(([tileId, t]) => {
    const name = trackTileById[tileId]?.name || tileId;
    const deltas = Object.entries(t.byEff)
      .map(([eff, n]) => ({ eff, share: n / t.total, delta: n / t.total - (familyPresenceRate[eff] || 0) }))
      .sort((a, b) => b.delta - a.delta);
    return { tileId, name, total: t.total, deltas };
  });
  if (affinityRows.length) {
    L.push('— AFFINITÀ TILE ↔ FAMIGLIE BONUS (atemporale) — con quali motori convive questa tile a fine partita? —');
    L.push('(per ogni tile: dei giocatori che l\'hanno comprata, quota che finisce con ciascuna famiglia-bonus installata (in qualunque ordine), scarto dal tasso di quella famiglia in TUTTA la popolazione. Solo tile con ≥20 acquisti registrati.)');
    for (const a of affinityRows) {
      const notable = a.deltas.filter(d => Math.abs(d.delta) >= 0.05);
      const desc = notable.length
        ? notable.map(d => `${d.eff} ${d.delta >= 0 ? '+' : ''}${pct(d.delta)}`).join(' · ')
        : 'nessuna famiglia si scosta ≥5pp dal tasso di popolazione — build attorno a questa tile non riconoscibile';
      L.push(`  ${a.name.padEnd(24)} (${a.total} acquisti) — ${desc}`);
    }
    L.push('(coppie con scarto grande e ripetuto su più batch = build naturali del gioco ("motore fabbrica", "motore marchi", ecc.). Se tutte le tile hanno scarti piccoli e incoerenti, le tile si combinano con le famiglie in modo sostanzialmente casuale — nessuna identità di build emerge ancora dal catalogo.)');
    L.push('');
  }

  // SEQUENZA DELLE SCELTE — mini catena di Markov (idea utente 19/07/2026, voluta PRIMA del Livello 3/cluster):
  // non "chi vince" ma "chi fa X prima di Y". 4 tipi di evento: Milestone raggiunta, Tile acquistata, Fabbrica
  // fondata, Reparto completato (5/5). Per ogni giocatore, eventi ordinati per turno, poi transizioni fra tipi
  // consecutivi — un giocatore con 5 eventi genera 4 transizioni, non un log completo della partita.
  const seqTypes = ['Milestone', 'Tile', 'Fabbrica', 'Reparto'];
  const transCount = {};
  seqTypes.forEach(a => seqTypes.forEach(b => { transCount[`${a}>${b}`] = 0; }));
  const trigramCount = {};
  let seqPlayers = 0, seqPlayersWithEvents = 0, seqEvents = 0;
  for (const g of ok) {
    const P2 = g.results?.length ?? 4;
    const bySeat = Array.from({ length: P2 }, () => []);
    for (const m of g.milestoneSnap || []) bySeat[m.seat]?.push({ turn: m.turn, type: 'Milestone' });
    for (const b of g.trackTileBuys || []) bySeat[b.seat]?.push({ turn: b.turn, type: 'Tile' });
    for (const f of g.factoryBuilds || []) bySeat[f.seat]?.push({ turn: f.turn, type: 'Fabbrica' });
    for (const d of g.deptComplete || []) bySeat[d.seat]?.push({ turn: d.turn, type: 'Reparto' });
    for (const evs of bySeat) {
      seqPlayers++;
      if (!evs.length) continue;
      seqPlayersWithEvents++;
      evs.sort((a, b) => a.turn - b.turn);
      seqEvents += evs.length;
      for (let i = 0; i < evs.length - 1; i++) transCount[`${evs[i].type}>${evs[i + 1].type}`]++;
      for (let i = 0; i < evs.length - 2; i++) {
        const key = `${evs[i].type} → ${evs[i + 1].type} → ${evs[i + 2].type}`;
        trigramCount[key] = (trigramCount[key] || 0) + 1;
      }
    }
  }
  const totalTrans = Object.values(transCount).reduce((a, b) => a + b, 0);
  if (totalTrans >= 20) {
    L.push('— SEQUENZA DELLE SCELTE (mini catena di Markov) — non "chi vince", ma cosa viene prima di cosa —');
    L.push(`(4 tipi di evento: Milestone raggiunta, Tile acquistata, Fabbrica fondata, Reparto completato (5/5). Eventi di ogni giocatore ordinati per turno → transizioni fra tipi consecutivi. ${seqPlayersWithEvents}/${seqPlayers} giocatori con ≥1 evento, media ${(seqEvents / (seqPlayersWithEvents || 1)).toFixed(1)} eventi/giocatore, ${totalTrans} transizioni totali.)`);
    L.push('da \\ a        | Milestone |   Tile | Fabbrica | Reparto');
    for (const a of seqTypes) {
      const rowTot = seqTypes.reduce((n, b) => n + transCount[`${a}>${b}`], 0);
      const cells = seqTypes.map(b => (rowTot ? pct(transCount[`${a}>${b}`] / rowTot) : '  —')).map(s => s.padStart(9));
      L.push(`${a.padEnd(13)} | ${cells.join(' | ')}`);
    }
    L.push('(percentuali per riga: dato un evento di tipo A, cosa succede SUBITO dopo tra i 4 tipi tracciati. Riga tutta "—" = quel tipo non è mai seguito da un altro evento tracciato prima di fine partita.)');
    const topTri = Object.entries(trigramCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topTri.length) {
      L.push('Catene di 3 eventi più frequenti:');
      for (const [chain, n] of topTri) L.push(`  ${chain}  (${n} volte)`);
    }
    L.push('(🟡 correlazione, non causale: una sequenza frequente dice come giocano i vincenti popolazione, non che un evento causi il successivo — utile per riconoscere build ricorrenti prima del clustering, non per attribuire merito.)');
    L.push('');
  }

  // MOTORI VINCENTI — Top 25% vs Bottom 25% (idea utente 19/07/2026, voluta PRIMA del clustering): non "quali
  // motori sono riconoscibili" ma "quali fanno anche vincere". Confronto diretto sulle metriche già raccolte
  // nelle sezioni sopra (fabbriche, tile, famiglie-bonus, milestone, economia finale), nessun algoritmo nuovo.
  // Riusa playerFamilies/familyPresenceRate già costruiti per AFFINITÀ (stesso scope di formatReport).
  const perfRows = [];
  ok.forEach((g, gIdx) => {
    const fabBySeat = {}, deptBySeat = {};
    for (const f of g.factoryBuilds || []) fabBySeat[f.seat] = (fabBySeat[f.seat] || 0) + 1;
    for (const d of g.deptComplete || []) deptBySeat[d.seat] = (deptBySeat[d.seat] || 0) + 1;
    const tileBySeat = {};
    for (const b of g.trackTileBuys || []) {
      const name = trackTileById[b.tileId]?.name || '';
      const bucket = /marchi/i.test(name) ? 'marchi' : /risors/i.test(name) ? 'risorsa' : /pv/i.test(name) ? 'pv' : 'altro';
      (tileBySeat[b.seat] ??= { marchi: 0, risorsa: 0, pv: 0, altro: 0 })[bucket]++;
    }
    for (const r of g.results) {
      const seat = r.playerId;
      const fams = playerFamilies[`${gIdx}-${seat}`] || new Set();
      perfRows.push({
        total: r.total,
        fabbriche: fabBySeat[seat] || 0,
        repartiCompleti: deptBySeat[seat] || 0,
        tileMarchi: tileBySeat[seat]?.marchi || 0,
        tileRisorsa: tileBySeat[seat]?.risorsa || 0,
        milestoneCount: g.tracks?.[seat]?.ms?.filter(Boolean).length ?? 0,
        coinsFinal: g.coinsFinalByPlayer?.[seat] ?? 0,
        resFinal: g.resFinal?.[seat] ?? 0,
        hasMarchiFabbrica: fams.has('marchi×fabbrica'),
        hasMarchiIcona: fams.has('marchi×icona'),
        hasRisorseFabbrica: fams.has('risorse×fabbrica'),
        hasRisorseIcona: fams.has('risorse×icona'),
      });
    }
  });
  perfRows.sort((a, b) => b.total - a.total);
  const perfQ = Math.floor(perfRows.length * 0.25);
  if (perfQ >= 10) {
    const top = perfRows.slice(0, perfQ), bottom = perfRows.slice(-perfQ);
    const numRow = (label, key) => [label, avg(top.map(r => r[key])), avg(bottom.map(r => r[key])), 'num'];
    const rateRow = (label, key) => [label, avg(top.map(r => r[key] ? 1 : 0)), avg(bottom.map(r => r[key] ? 1 : 0)), 'rate'];
    const rows = [
      numRow('Punteggio (PV)', 'total'),
      numRow('Fabbriche fondate', 'fabbriche'),
      numRow('Reparti completi (0-3)', 'repartiCompleti'),
      numRow('Tile "a marchi" comprate', 'tileMarchi'),
      numRow('Tile "a risorsa" comprate', 'tileRisorsa'),
      numRow('Milestone raggiunte (0-3)', 'milestoneCount'),
      numRow('Marchi finali', 'coinsFinal'),
      numRow('Risorse finali', 'resFinal'),
      rateRow('con marchi×fabbrica installata', 'hasMarchiFabbrica'),
      rateRow('con marchi×icona installata', 'hasMarchiIcona'),
      rateRow('con risorse×fabbrica installata', 'hasRisorseFabbrica'),
      rateRow('con risorse×icona installata', 'hasRisorseIcona'),
    ];
    L.push(`— MOTORI VINCENTI: TOP 25% vs BOTTOM 25% (${perfQ} giocatori-partita per gruppo, su ${perfRows.length}) — questo motore è solo riconoscibile o è anche quello che vince? —`);
    L.push('Variabile                        |   Top 25% | Bottom 25% |       Δ');
    for (const [label, t, b, kind] of rows) {
      const fmt = kind === 'rate' ? pct : (n => n.toFixed(1));
      const d = t - b;
      const dFmt = kind === 'rate' ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}pp` : `${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
      L.push(`${label.padEnd(33)} | ${fmt(t).padStart(9)} | ${fmt(b).padStart(10)} | ${dFmt.padStart(7)}`);
    }
    L.push('(🟡 correlazione, non causale: dice cosa distingue davvero i motori vincenti da quelli perdenti, non cosa li fa vincere — skill dell\'IA e seed si confondono con la metrica. Δ grande e coerente su più batch = candidato forte per un A/B mirato. Δ piccolo = quella metrica non distingue vincitori da perdenti, anche se è "riconoscibile" nelle sezioni sopra.)');
    L.push('');
  }

  // MARCHI×FABBRICA: MOLTIPLICATORE O ACCELERATORE? (idea utente 19/07/2026, verifica del finding sopra) — chi
  // ha la carta costruisce anche più fabbriche (acceleratore di strategia, spinge a investire di più
  // nell'infrastruttura) o le fabbriche sono uguali e cambia solo la resa (moltiplicatore puro sulla stessa
  // base)? Riusa playerFamilies già costruito per AFFINITÀ, stesso scope di formatReport.
  const mfRows = [];
  ok.forEach((g, gIdx) => {
    const fabBySeat = {};
    for (const f of g.factoryBuilds || []) fabBySeat[f.seat] = (fabBySeat[f.seat] || 0) + 1;
    const P2 = g.results?.length ?? 4;
    for (let seat = 0; seat < P2; seat++) {
      const fams = playerFamilies[`${gIdx}-${seat}`] || new Set();
      const r = g.results.find(x => x.playerId === seat);
      const src = g.econ?.[seat]?.src || {};
      const coinsFromProd = SECTORS.reduce((n, s) => n + (src[s] || 0), 0);
      mfRows.push({
        has: fams.has('marchi×fabbrica'),
        fabbriche: fabBySeat[seat] || 0,
        attivazioni: g.activations?.[seat] ?? 0,
        coinsFromProd,
        total: r?.total ?? 0,
      });
    }
  });
  const withMF = mfRows.filter(r => r.has), withoutMF = mfRows.filter(r => !r.has);
  if (withMF.length >= 10 && withoutMF.length >= 10) {
    L.push(`— MARCHI×FABBRICA: MOLTIPLICATORE O ACCELERATORE? (${withMF.length} con la carta vs ${withoutMF.length} senza) —`);
    L.push('(se le fabbriche sono simili tra i due gruppi ma i marchi da produzione esplodono, è un moltiplicatore puro sulla resa. Se chi ha la carta fonda anche più fabbriche, è un acceleratore di strategia — spinge a investire di più nell\'infrastruttura, non solo a spremerla meglio.)');
    L.push('Variabile                      |    Con |  Senza |      Δ');
    const mfRow = (label, key) => {
      const c = avg(withMF.map(r => r[key])), s = avg(withoutMF.map(r => r[key]));
      const d = c - s;
      L.push(`${label.padEnd(31)} | ${c.toFixed(1).padStart(6)} | ${s.toFixed(1).padStart(6)} | ${(d >= 0 ? '+' : '') + d.toFixed(1)}`);
    };
    mfRow('Fabbriche fondate', 'fabbriche');
    mfRow('Produzioni attivate', 'attivazioni');
    mfRow('Marchi ottenuti da produzione', 'coinsFromProd');
    mfRow('PV finali', 'total');
    const fabRatio = avg(withoutMF.map(r => r.fabbriche)) > 0 ? avg(withMF.map(r => r.fabbriche)) / avg(withoutMF.map(r => r.fabbriche)) : null;
    const coinRatio = avg(withoutMF.map(r => r.coinsFromProd)) > 0 ? avg(withMF.map(r => r.coinsFromProd)) / avg(withoutMF.map(r => r.coinsFromProd)) : null;
    if (fabRatio != null && coinRatio != null) {
      const verdict = coinRatio > fabRatio + 0.3 ? 'MOLTIPLICATORE: i marchi da produzione crescono molto più delle fabbriche — la carta spreme meglio l\'infrastruttura esistente, non ne motiva di nuova.'
        : fabRatio > coinRatio + 0.3 ? 'ACCELERATORE: le fabbriche crescono quanto o più dei marchi — chi prende la carta investe di più nell\'infrastruttura, non solo la sfrutta meglio.'
        : 'MISTO: fabbriche e marchi crescono in proporzione simile — probabilmente entrambi gli effetti insieme, non isolabili da questo confronto da solo.';
      L.push(`(rapporto fabbriche con/senza ×${fabRatio.toFixed(2)}, rapporto marchi-da-produzione con/senza ×${coinRatio.toFixed(2)} → ${verdict})`);
    }
    L.push('(🟡 correlazione: chi installa ×fabbrica può già essere un giocatore più forte in generale — questo confronto isola SU COSA si concentra il vantaggio, non conferma che la carta lo causi. Per quello serve un A/B con la carta rimossa dal mazzo.)');
    L.push('');
  }

  L.push(`— WIN RATE PER TESSERA (Piano Industriale) — ${tileRows.length} tessere con ≥3 apparizioni —`);
  L.push('Tessera | partite | win% | affidabilità');
  for (const t of tileRows) L.push(`${t.id.padEnd(4)} ${t.name.padEnd(12)} | ${String(t.games).padStart(6)} | ${pct(t.wr).padStart(4)} | ${starsFor(t.games)}`);
  if (tileRows.length > 1) L.push(`(migliore ${tileRows[0].id} ${pct(tileRows[0].wr)} vs peggiore ${tileRows.at(-1).id} ${pct(tileRows.at(-1).wr)} — se il gap è grande, tessere sbilanciate. Affidabilità = solo il campione (n partite), non dice se lo scarto è vero — vedi SCHEDA TESSERE sotto per gli outlier.)`);
  L.push('');

  // SCHEDA TESSERE — solo gli outlier, su due assi indipendenti: vince troppo/poco (tileZ) o gli obiettivi sono
  // un regalo/un muro (facilityZ). Una tessera può vincere "normale" (25%) e comunque essere un problema di design
  // se completa il 98% degli obiettivi — il win% da solo non lo vedrebbe.
  const tileOutliers = tileRows.filter(t => t.games >= 8 && (Math.abs(tileZ(t)) >= 2 || Math.abs(facilityZ(t)) >= 2));
  if (tileOutliers.length) {
    L.push(`— SCHEDA TESSERE: OUTLIER (win% o completamento a ≥2σ dalla norma, ≥8 partite) — da dove nasce lo scarto —`);
    for (const t of tileOutliers) {
      const def = tileDefs[t.id];
      const wz = tileZ(t), fz = facilityZ(t);
      const tags = [Math.abs(wz) >= 2 && 'PRESTAZIONI', Math.abs(fz) >= 2 && 'FACILITÀ'].filter(Boolean).join(' + ');
      L.push(`${t.id} ${t.name} — win ${pct(t.wr)} su ${t.games} partite (${wz.toFixed(1)}σ win · ${fz.toFixed(1)}σ facilità) [${tags}] ${starsFor(t.games)}`);
      t.objRates.forEach((rate, i) => {
        const cond = def?.objectives?.[i]?.cond;
        const text = cond ? describeCond(cond) : '?';
        const pv = def?.objectives?.[i]?.pv ?? '?';
        L.push(`  obiettivo${i + 1} (${pv}PV) ${rate == null ? '—' : pct(rate).padStart(4)}  «${text}»`);
      });
      L.push(`  PV medi: obiettivi ${t.pvObjAvg.toFixed(1)} · commesse ${t.pvContractsAvg.toFixed(1)} · tracciati ${t.pvTrackAvg.toFixed(1)} · commesse/partita ${t.nContractsAvg.toFixed(1)}`);
    }
    L.push('(PRESTAZIONI = vince più/meno del dovuto — guarda i PV medi: se sono alti anche fuori dagli obiettivi, il vantaggio è nella strategia che incentiva, non nella tessera. FACILITÀ = i suoi obiettivi sono più facili/duri delle altre 31 tessere — se un obiettivo è molto più alto degli altri due, è quello a spiegarlo: abbassa il suo PV o alza la soglia.)');
    L.push('');
  }
  // DISTRIBUZIONE TESSERE — l'obiettivo non è azzerare t18, è che quasi tutte stiano in banda 🟢 e pochissime 🔴
  const distBuckets = { '🟢': 0, '🟡': 0, '🔴': 0 };
  for (const t of tileRows) {
    if (t.games < 8) continue;
    const cz = Math.max(Math.abs(tileZ(t)), Math.abs(facilityZ(t)));
    distBuckets[cz >= 2 ? '🔴' : cz >= 1 ? '🟡' : '🟢']++;
  }
  const distN = distBuckets['🟢'] + distBuckets['🟡'] + distBuckets['🔴'];
  if (distN) {
    L.push(`— DISTRIBUZIONE TESSERE (${distN} con ≥8 partite, max tra i due z-score) —`);
    L.push(`🟢 normali (<1σ): ${distBuckets['🟢']} · 🟡 lievi (1-2σ): ${distBuckets['🟡']} · 🔴 outlier (≥2σ): ${distBuckets['🔴']}`);
    L.push('(bersaglio: la maggioranza in 🟢, solo poche tessere in 🔴 — non serve arrivare a zero 🔴, serve che restino eccezioni.)');
    L.push('');
  }

  // OBIETTIVI PIANO INDUSTRIALE — completamento per singolo obiettivo
  const objAgg = {};
  for (const g of ok) for (const arr of g.tileObjectives) for (const o of arr) {
    const key = `${o.tile}#${o.idx + 1}`;
    const a = objAgg[key] || (objAgg[key] = { appear: 0, done: 0 });
    a.appear++; if (o.done) a.done++;
  }
  const objRows = Object.entries(objAgg).filter(([, a]) => a.appear >= 3).map(([key, a]) => ({ key, rate: a.done / a.appear, appear: a.appear })).sort((x, y) => y.rate - x.rate);
  if (objRows.length) {
    const N = objRows.length;
    const easy = objRows.filter(o => o.rate > 0.85), bal = objRows.filter(o => o.rate >= 0.40 && o.rate <= 0.85), hard = objRows.filter(o => o.rate < 0.40);
    easyShare = easy.length / N;
    const fmt = list => list.slice(0, 10).map(o => `${o.key} ${pct(o.rate)}`).join(' · ') + (list.length > 10 ? ` · +${list.length - 10} altri` : '');
    L.push(`— OBIETTIVI PIANO INDUSTRIALE (${N} obiettivi, ≥3 apparizioni) — completati in media ${pct(avg(objRows.map(o => o.rate)))} —`);
    L.push(`${light(easy.length / N, 0.3, 0.5)} troppo facili (>85%): ${easy.length} · 🟢 bilanciati (40-85%): ${bal.length} · troppo difficili (<40%): ${hard.length}`);
    if (easy.length) L.push('facili: ' + fmt(easy));
    if (hard.length) L.push('difficili: ' + fmt(hard));
    L.push('');

    // FAMIGLIE DI OBIETTIVO — stessa condizione, tessere diverse: 32 tessere × 3 obiettivi non sono 96 cose
    // indipendenti, sono ricombinazioni di poche decine di "mattoni" (stesso tipo+parametri). Se un mattone è
    // sbilanciato lo è su OGNI tessera che lo usa — corretto una volta, sistema tutte insieme. Le tessere che
    // restano outlier (SCHEDA TESSERE sopra) a mattoni bilanciati sono un problema di sinergia, non di mattone.
    const famAgg = {};
    for (const [key, a] of Object.entries(objAgg)) {
      const [tileId, idxStr] = key.split('#');
      const cond = tileDefs[tileId]?.objectives?.[Number(idxStr) - 1]?.cond;
      if (!cond) continue;
      const fk = condKey(cond);
      const f = famAgg[fk] || (famAgg[fk] = { label: condLabel(cond), tiles: new Set(), done: 0, appear: 0 });
      f.tiles.add(tileId); f.done += a.done; f.appear += a.appear;
    }
    const famRows = Object.values(famAgg).filter(f => f.appear >= 3).map(f => {
      const wins = [...f.tiles].map(id => tileById[id]?.wr).filter(w => w != null);
      return { label: f.label, nTiles: f.tiles.size, rate: f.done / f.appear, winAvg: wins.length ? avg(wins) : null };
    }).sort((a, b) => a.rate - b.rate);
    if (famRows.length) {
      L.push(`— FAMIGLIE DI OBIETTIVO (${famRows.length} mattoni distinti, ≥3 apparizioni) — bilancia questi, non le 96 combinazioni —`);
      L.push('mattoni                          | tessere | completamento | win medio tessere');
      for (const f of famRows) {
        const flag = f.rate > 0.85 || f.rate < 0.40 ? '🔴' : '🟢';
        L.push(`${f.label.padEnd(33)} | ${String(f.nTiles).padStart(7)} | ${flag} ${pct(f.rate).padStart(4)}     | ${f.winAvg == null ? '  —' : pct(f.winAvg).padStart(4)}`);
      }
      L.push('(bersaglio: la maggior parte 40-85% di completamento — un mattone fuori qui è fuori su OGNI tessera che lo contiene, non è colpa della tessera specifica. "win medio tessere" alto con completamento normale = probabile sinergia con gli altri obiettivi della stessa tessera, non un problema del mattone da solo — guarda quali tessere lo ospitano in SCHEDA TESSERE.)');
      L.push('');
    }

    // completamento medio per TESSERA (individua le tessere "regalo"): riusa tileRows, già ha objRates/avgRate per tessera.
    const facilityRows = [...tileRows].sort((a, b) => b.avgRate - a.avgRate);
    if (facilityRows.length) {
      L.push('— CLASSIFICA FACILITÀ (obiettivi 1/2/3 · media · z vs le altre tessere) — 8 con media più alta ("regalo") —');
      for (const t of facilityRows.slice(0, 8)) L.push(`${t.id.padEnd(4)} ${t.objRates.map(r => (r == null ? '  —' : pct(r).padStart(4))).join(' / ')} · media ${pct(t.avgRate)} · ${facilityZ(t).toFixed(1)}σ`);
      L.push('');
    }
  }

  L.push('— BONUS LAVORATORE (frequenza scelta + win% di chi lo prende) —');
  L.push('Bonus                | preso | win%');
  for (const e of effRows) L.push(`${e.eff.padEnd(20)} | ${String(e.picked).padStart(5)} | ${pct(e.wr).padStart(4)}`);
  // usa cfg.workers (il mazzo davvero in gioco), non WORKER_BY_ID: è globale e mutato dentro ogni initGame nei
  // worker della simulazione, ma nel thread principale (dove formatReport gira) resta al suo valore di import —
  // i 75 lavoratori del mazzo Classico ritirato — e faceva risultare "mai scelti" carte/effetti mai davvero in gioco.
  const workerPool = cfg.workers && cfg.workers.length ? cfg.workers : Object.values(WORKER_BY_ID);
  const allSigs = [...new Set(workerPool.map(w => effSig(formulaOf(w))))];
  const neverPicked = allSigs.filter(k => !effAgg[k]);
  if (neverPicked.length) L.push(`Mai scelti: ${neverPicked.join(', ')}`);
  L.push('');

  if (cardRows.length) {
    L.push('— BONUS LAVORATORE PER CARTA (singola carta · pick rate = presa/apparsa, la vera forza) —');
    L.push('Carta      | Mazzetto | Nazione     | Settore       | apparsa | presa | pick% | win%');
    const byPickRate = [...cardRows].sort((x, y) => (y.pickRate ?? -1) - (x.pickRate ?? -1));
    for (const c of byPickRate) L.push(`${c.cardId.padEnd(10)} | ${(c.deck ?? '—').toString().padEnd(8)} | ${(c.nation ?? '—').padEnd(11)} | ${(c.sector ?? '—').padEnd(13)} | ${String(c.appear).padStart(7)} | ${String(c.picked).padStart(5)} | ${(c.pickRate == null ? '  —' : pct(c.pickRate)).padStart(5)} | ${pct(c.wr).padStart(4)}`);
    const allCardIds = workerPool.map(w => w.id);
    const neverPickedCards = allCardIds.filter(id => !cardAgg[id]?.picked);
    if (neverPickedCards.length) L.push(`Mai scelte: ${neverPickedCards.join(', ')}`);
    L.push('');
  }

  if (ok.some(g => g.hireOffer?.total)) {
    L.push('— PICK-RATE ALTO: VINCOLO DI CASSA O VALORE UNIFORME? (ogni turno con una carta in cima al banco permettersela) —');
    L.push('(non "quante carte apparse", ma "quante volte poteva permettersela e cosa ha fatto": presa, o qualcos\'altro invece?)');
    const hoTot = ok.reduce((acc, g) => { acc.total += g.hireOffer.total; acc.taken += g.hireOffer.taken; for (const [k, n] of Object.entries(g.hireOffer.declinedInstead)) acc.declined[k] = (acc.declined[k] || 0) + n; return acc; }, { total: 0, taken: 0, declined: {} });
    L.push(`presa quando permettersela: ${pct(hoTot.taken / hoTot.total)} (${hoTot.taken}/${hoTot.total})`);
    const declTot = Object.values(hoTot.declined).reduce((a, b) => a + b, 0);
    if (declTot) {
      L.push('scartata pur potendo permettersela → cosa fa invece:');
      for (const [k, n] of Object.entries(hoTot.declined).sort((a, b) => b[1] - a[1])) L.push(`  ${pct(n / declTot).padStart(4)}  ${k} (${n})`);
    }
    L.push('per rapporto costo/marchi-in-mano (la carta costa poco o quasi tutto quel che hai?):');
    const ratioTot = { low: { total: 0, taken: 0 }, mid: { total: 0, taken: 0 }, high: { total: 0, taken: 0 } };
    for (const g of ok) for (const k of ['low', 'mid', 'high']) { ratioTot[k].total += g.hireOfferByCostRatio[k].total; ratioTot[k].taken += g.hireOfferByCostRatio[k].taken; }
    const ratioLabel = { low: 'costo <34% dei marchi', mid: 'costo 34-67% dei marchi', high: 'costo ≥67% dei marchi' };
    for (const k of ['low', 'mid', 'high']) if (ratioTot[k].total) L.push(`  ${ratioLabel[k].padEnd(24)} pick-rate ${pct(ratioTot[k].taken / ratioTot[k].total).padStart(4)}  (${ratioTot[k].taken}/${ratioTot[k].total})`);
    L.push('(se il pick-rate resta alto anche nel bucket "costo ≥67%", il costo non è il vincolo — alzarlo non cambierebbe la decisione. Se cala col crescere del costo, il costo conta davvero. Se "scartata" è quasi sempre vuoto, l\'IA non rifiuta mai un\'offerta permettersela: nessuna azione alternativa la batte mai, a prescindere dalla carta.)');
    L.push('');
  }

  if (nationRows.length) {
    L.push('— IDENTITÀ NAZIONALE (che tipo di carte assume chi prende quella nazione: Conversioni/Risorse/Marchi) —');
    L.push('("no" alla domanda: se le % sono simili tra nazioni, sono solo estetiche. Pattern diversi = identità di design reale.)');
    L.push('Nazione      | assunzioni | conversioni | risorse | marchi');
    for (const r of nationRows) L.push(`${r.nation.padEnd(12)} | ${String(r.tot).padStart(10)} | ${pct(r.conv).padStart(11)} | ${pct(r.risorse).padStart(7)} | ${pct(r.marchi).padStart(6)}`);
    L.push('');
  }

  // FABBRICA FINALE — quanto viene davvero sviluppata (reparti pieni?)
  const allDepts = ok.flatMap(g => g.cards.flatMap(c => c.depts));
  const dBucket = n => (n >= 5 ? '5' : n === 4 ? '4' : n === 3 ? '3' : '≤2');
  const dDist = { 5: 0, 4: 0, 3: 0, '≤2': 0 };
  for (const n of allDepts) dDist[dBucket(n)]++;
  L.push('— FABBRICA FINALE (sviluppo dei reparti, cap 5 = 3 Sopra + 2 Sotto) —');
  const nDepts = allDepts.length || 1;
  L.push(`Completati (5/5): ${pct(dDist['5'] / nDepts)} · Quasi completi (4/5): ${pct(dDist['4'] / nDepts)} · Medi (3/5): ${pct(dDist['3'] / nDepts)} · Poco sviluppati (≤2): ${pct(dDist['≤2'] / nDepts)}`);
  L.push('');

  // DIREZIONE — Sopra e Sotto: la gente compra davvero entrambe?
  const distr = arr => { const d = { 0: 0, 1: 0, 2: 0, '3+': 0 }; for (const n of arr) d[n >= 3 ? '3+' : n]++; return d; };
  const dirS = distr(allDir.map(c => c.dirSopra));
  const dirT = distr(allDir.map(c => c.dirSotto));
  const nDir = allDir.length || 1;
  const dirCap = cfg.slots?.direzione ?? { sopra: 3, sotto: 0 }; // Direzione = solo Impiegati Sopra
  L.push(`— DIREZIONE (carte installate, cap ${dirCap.sopra}+${dirCap.sotto}) —`);
  const domBucket = d => { const k = [0, 1, 2, '3+'].reduce((a, b) => (d[b] >= d[a] ? b : a)); return `${pct(d[k] / nDir)} = ${k} cart${k === 1 ? 'a' : 'e'}`; };
  L.push(`Sopra: ${domBucket(dirS)} (` + [0, 1, 2, '3+'].map(k => `${k}:${pct(dirS[k] / nDir)}`).join(' ') + ')');
  L.push(`Sotto: ${domBucket(dirT)} (` + [0, 1, 2, '3+'].map(k => `${k}:${pct(dirT[k] / nDir)}`).join(' ') + ')');
  L.push('');

  if (cfg.welfareEnabled !== false) {
  L.push('— MACCHINARI: ACCESSO O VALORE? — perché una parte del campo non ne installa —');
  L.push('("mai visto" = non ha mai avuto un Macchinario acquistabile in vista quando era a Servizi → problema di ACCESSO, non di scelta. "Visto ma ignorato" = poteva comprarlo, non l\'ha fatto → problema di VALORE, l\'IA lo giudica non conveniente rispetto alle alternative.)');
  const allSaw = ok.flatMap(g => g.sawSottoOption);
  let neverSeenM = 0, seenIgnoredM = 0, installedM = 0;
  for (let i = 0; i < allDir.length; i++) {
    if (allDir[i].dirSotto > 0) installedM++;
    else if (allSaw[i]) seenIgnoredM++;
    else neverSeenM++;
  }
  L.push(`  mai visto un Macchinario acquistabile ......... ${pct(neverSeenM / nDir).padStart(5)}  (${neverSeenM})`);
  L.push(`  visto ma ignorato (mai installato) ............ ${pct(seenIgnoredM / nDir).padStart(5)}  (${seenIgnoredM})`);
  L.push(`  installato (≥1 Macchinario) .................... ${pct(installedM / nDir).padStart(5)}  (${installedM})`);
  L.push('');

  L.push('— MACCHINARI: CON vs SENZA — la media nasconde due giochi diversi? —');
  const mGroups = { senza: [], con: [] };
  for (const g of ok) {
    const exBySeat = Array(g.cards.length).fill(0);
    for (const e of g.exchangeLog) exBySeat[e.seat]++;
    for (let seat = 0; seat < g.cards.length; seat++) {
      const rec = {
        durata: g.turns,
        borsa: exBySeat[seat],
        commesse: g.contracts[seat].length,
        vittoria: g.results[0].playerId === seat ? 1 : 0,
        vendute: g.resSpentByCat[seat]?.vendita || 0,
      };
      (g.cards[seat].dirSotto > 0 ? mGroups.con : mGroups.senza).push(rec);
    }
  }
  const mAvg = (arr, k) => avg(arr.map(r => r[k]));
  L.push(`  metrica                      senza Macchinario   con Macchinario   (n=${mGroups.senza.length} / ${mGroups.con.length})`);
  for (const [label, k, isPct] of [['durata (turni)', 'durata', false], ['azioni Borsa/giocatore', 'borsa', false], ['commesse/giocatore', 'commesse', false], ['% vittorie', 'vittoria', true], ['risorse vendute/giocatore', 'vendute', false]]) {
    const sv = mAvg(mGroups.senza, k), cv = mAvg(mGroups.con, k);
    const f = isPct ? pct : (x => x.toFixed(1));
    L.push(`  ${label.padEnd(28)} ${f(sv).padStart(10)}        ${f(cv).padStart(10)}`);
  }
  L.push('(se le due colonne divergono parecchio, la media generale del report sta mediando due popolazioni diverse — le metriche aggregate sopra vanno lette con cautela.)');
  L.push('');

  L.push('— MACCHINARI: CAUSA, SELEZIONE O SOGLIA? — quando arriva il vantaggio —');
  L.push('(3 letture compatibili con "chi li ha vince di più": A-causa (il macchinario stesso aiuta a vincere), B-selezione (chi è già forte se li può permettere), C-soglia (serve un motore già maturo per sfruttarli). Non distingue tra loro da sola, ma restringe.)');
  const firstMWin = [], firstMField = [];
  const mCountWin = { 0: 0, 1: 0, 2: 0 }, mCountAll = { 0: 0, 1: 0, 2: 0 };
  for (const g of ok) {
    const winnerSeat = g.results[0].playerId;
    for (let seat = 0; seat < g.firstMachineTurn.length; seat++) {
      const t = g.firstMachineTurn[seat];
      if (t != null) (seat === winnerSeat ? firstMWin : firstMField).push(t);
      const n = Math.min(2, g.cards[seat].dirSotto);
      mCountAll[n]++;
      if (seat === winnerSeat) mCountWin[n]++;
    }
  }
  L.push(`turno medio 1° Macchinario: vincitori ${firstMWin.length ? avg(firstMWin).toFixed(1) : 'n/d'} (n=${firstMWin.length}) · resto del campo ${firstMField.length ? avg(firstMField).toFixed(1) : 'n/d'} (n=${firstMField.length})`);
  L.push('(se i vincitori lo installano molto prima del campo, è più coerente con A/causa o C/soglia raggiunta presto. Se il turno è simile ma vincono comunque di più, è più coerente con B/selezione — un giocatore già forte lo aggiunge senza che sia lui a farli vincere.)');
  L.push('vittorie per numero di Macchinari a fine partita:');
  for (const n of [0, 1, 2]) {
    L.push(`  ${n} Macchinari: win% ${pct(mCountAll[n] ? mCountWin[n] / mCountAll[n] : 0).padStart(4)}  (n=${mCountAll[n]})`);
  }
  L.push('(se il vantaggio compare già con 1 solo Macchinario, il primo è già sufficiente — più coerente con A/causa. Se compare solo a 2, servono entrambi per contare — più coerente con C/soglia: non basta averne uno, serve un motore che li sfrutti entrambi.)');
  L.push('');
  }

  // ===== RESA DELLA DIREZIONE — risorse prodotte (mele con mele), poi PV come misura indiretta =====
  if (cfg.welfareEnabled !== false) {
  // Macchinario (Sotto) e Welfare (Sopra) NON sono confrontabili sugli stessi PV: il Macchinario spara risorse
  // garantite a inizio turno per usesMax turni (automatico, zero scelta — vedi startTurn); il Welfare dà un bump
  // ONE-TIME al tracciato (advanceTrack) il cui ritorno dipende da quante volte quel reparto viene attivato DOPO
  // l'acquisto — una scelta dell'AI, non garantita — e da quanti turni restano. Confrontarli sullo stesso "PV/5
  // marchi" confonde "la carta rende poco" con "la carta è stata comprata tardi". Prima le risorse (il livello
  // meccanico, quasi deterministico), poi i PV (il livello a valle, dove entrano mercato/conversioni/durata).
  const pvAt = (g, seat, round) => {
    const avail = Object.keys(g.pvByRound).map(Number).filter(r => r <= round);
    if (!avail.length) return null;
    return g.pvByRound[Math.max(...avail)][seat];
  };
  const resGenAt = (g, seat, round) => {
    const avail = Object.keys(g.resGenByRound).map(Number).filter(r => r <= round);
    if (!avail.length) return null;
    return resSumOf(g.resGenByRound[Math.max(...avail)][seat]);
  };
  const finalPV = (g, seat) => g.results.find(r => r.playerId === seat)?.total ?? null;
  const finalResGen = (g, seat) => resSumOf(g.resGen[seat]);
  const avgCardCost = avg((cfg.welfare?.length ? cfg.welfare : WELFARE).map(w => w.v)) || 5;
  const DIR_EVENTS = [
    ['Welfare 1 (Direzione Sopra, 1ª carta)', 'dirSopra', 0],
    ['Welfare 2 (Direzione Sopra, 2ª carta)', 'dirSopra', 1],
    ['Macchinario 1 (Direzione Sotto, 1ª carta)', 'dirSotto', 0],
    ['Macchinario 2 (Direzione Sotto, 2ª carta)', 'dirSotto', 1],
  ];
  L.push('— RISORSE PRODOTTE DOPO L\'ACQUISTO (Direzione) — stesso turno, stessa partita, comprato vs non ancora —');
  L.push('(per ogni carta: risorse totali generate DA QUEL MOMENTO in poi da chi la compra, contro chi, nella STESSA partita e allo STESSO turno, non l\'ha ancora comprata. Isola il vantaggio già accumulato prima dell\'acquisto e il ritmo della partita — non un A/B randomizzato, ma il confronto più stretto possibile senza rigiocare la partita due volte.)');
  const dirResults = {};
  for (const [label, side, idx] of DIR_EVENTS) {
    const treatedPV = [], controlPV = [], treatedRes = [], controlRes = [];
    for (const g of ok) {
      const turns = g.slotTurn?.[side]?.[idx];
      if (!turns) continue;
      const purchaseTurns = new Set(turns.filter(t => t != null));
      for (let seat = 0; seat < turns.length; seat++) {
        const t = turns[seat];
        if (t == null) continue;
        const pvB = pvAt(g, seat, t), pvA = finalPV(g, seat);
        const rB = resGenAt(g, seat, t), rA = finalResGen(g, seat);
        if (pvB != null && pvA != null) treatedPV.push(pvA - pvB);
        if (rB != null && rA != null) treatedRes.push(rA - rB);
      }
      for (const T of purchaseTurns) {
        for (let seat = 0; seat < turns.length; seat++) {
          const own = turns[seat];
          if (own != null && own <= T) continue; // aveva già comprato a quel turno: non è controllo valido
          const pvB = pvAt(g, seat, T), pvA = finalPV(g, seat);
          const rB = resGenAt(g, seat, T), rA = finalResGen(g, seat);
          if (pvB != null && pvA != null) controlPV.push(pvA - pvB);
          if (rB != null && rA != null) controlRes.push(rA - rB);
        }
      }
    }
    dirResults[label] = { treatedPV, controlPV, treatedRes, controlRes };
    if (treatedRes.length >= 20 && controlRes.length >= 20) {
      const gT = avg(treatedRes), gC = avg(controlRes), diff = gT - gC;
      L.push(`${label.padEnd(42)} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} risorse  (dopo acquisto: ${gT.toFixed(1)}, n=${treatedRes.length} · controllo: ${gC.toFixed(1)}, n=${controlRes.length})`);
    } else {
      L.push(`${label.padEnd(42)} dati insufficienti (n=${treatedRes.length}/${controlRes.length})`);
    }
  }
  L.push('');

  L.push('— MACCHINARIO: GARANTITO DALLA FORMULA vs REALMENTE OTTENUTO —');
  L.push('(il Macchinario è deterministico — non serve un gruppo di controllo: paga perUse risorse a inizio turno per usesMax turni, automatico. "Garantito" = usesMax×perUse se il giocatore avesse avuto tutti i turni; "realizzato" = risorse effettive via resGainedBy.macchinari, che include il taglio se la partita finisce prima di esaurire gli usi.)');
  const welfareDeck = cfg.welfare?.length ? cfg.welfare : WELFARE;
  const avgUsesMax = avg(welfareDeck.map(w => w.usesMax));
  const avgPerUseLen = avg(welfareDeck.map(w => (w.perUse || []).length));
  const machineOwners = ok.flatMap(g => g.resGainedBy.map((rb, seat) => ({ n: Math.min(2, g.cards[seat].dirSotto), macchinari: rb.macchinari })).filter(x => x.n > 0));
  const realizedAvg = avg(machineOwners.map(x => x.macchinari / x.n)); // per macchinario posseduto
  const guaranteedAvg = avgUsesMax * avgPerUseLen;
  L.push(`garantito (formula): ${guaranteedAvg.toFixed(1)} risorse/carta · realizzato (osservato, per carta posseduta): ${realizedAvg.toFixed(1)} risorse/carta  (${pct(realizedAvg / (guaranteedAvg || 1))} del garantito, n=${machineOwners.length} carte)`);
  L.push('(se il realizzato è molto sotto il garantito, molte partite finiscono prima che il Macchinario esaurisca i suoi usi — comprato tardi, non un difetto della carta.)');
  L.push('');

  L.push('— PV PER 5 MARCHI INVESTITI (Direzione) — misura indiretta, non ROI puro: leggere insieme a RISORSE sopra —');
  L.push('(stesso metodo delle risorse, ma sui PV finali. Se le risorse sopra sono positive/forti ma i PV qui sono deboli o negativi, il problema NON è la carta: è a valle — mercato, conversioni, o l\'AI che non sfrutta le risorse in più. Se anche le risorse sono deboli, il problema è la carta stessa.)');
  for (const [label] of DIR_EVENTS) {
    const { treatedPV, controlPV } = dirResults[label];
    if (treatedPV.length >= 20 && controlPV.length >= 20) {
      const gT = avg(treatedPV), gC = avg(controlPV), diff = gT - gC, per5 = diff / avgCardCost * 5;
      L.push(`${label.padEnd(42)} ${per5 >= 0 ? '+' : ''}${per5.toFixed(1)} PV/5 marchi  (dopo acquisto: ${gT.toFixed(1)} PV, n=${treatedPV.length} · controllo: ${gC.toFixed(1)} PV, n=${controlPV.length})`);
    } else {
      L.push(`${label.padEnd(42)} dati insufficienti`);
    }
  }
  L.push(`(costo medio carta usato per la normalizzazione: ${avgCardCost.toFixed(1)} marchi. "Controllo" = altri giocatori della stessa partita, allo stesso turno, che non avevano ancora comprato quella carta specifica — non "senza quella carta", ma "non ancora quella carta": chi controlla potrebbe comprarla il turno dopo, o spendere quei marchi altrove.)`);
  L.push('');

  L.push('— TEMPISTICA vs CARTA — quanto pesa il MOMENTO dell\'acquisto —');
  L.push('(la carta non può ridurre la produzione futura per costruzione (avanza solo il tracciato, mai indietro) — se il delta risorse sopra è negativo, sta misurando la scelta "comprare ora invece di fare altro", non la carta in sé. Qui: turno medio d\'acquisto e produzioni residue — quante "Attiva reparto" restano DOPO l\'acquisto per trasformare il bonus in produzione. Poche produzioni residue = la carta non ha avuto il tempo materiale di ripagarsi, è tempismo. Molte produzioni residue e ritorno ancora debole = è la carta.)');
  for (const [label, side, idx] of DIR_EVENTS) {
    const buyTurns = [], prodAfter = [], turnsLeft = [];
    for (const g of ok) {
      const turns = g.slotTurn?.[side]?.[idx];
      if (!turns) continue;
      for (let seat = 0; seat < turns.length; seat++) {
        const t = turns[seat];
        if (t == null) continue;
        buyTurns.push(t);
        turnsLeft.push(Math.max(0, g.turns - t));
        prodAfter.push(g.activateLog.filter(a => a.seat === seat && a.turn > t).length);
      }
    }
    if (buyTurns.length) {
      L.push(`${label.padEnd(42)} turno medio acquisto: ${avg(buyTurns).toFixed(1)} · turni residui: ${avg(turnsLeft).toFixed(1)} · produzioni residue: ${avg(prodAfter).toFixed(1)}  (n=${buyTurns.length})`);
    } else {
      L.push(`${label.padEnd(42)} dati insufficienti`);
    }
  }
  L.push('');
  }

  // ==================================================================
  // 5. INDICATORI FUORI RANGE — scostamenti dai bersagli (i bersagli sono del designer, editabili).
  // Niente diagnosi, niente teoria: solo la distanza osservata. Le leve che li muovono → indicatorTable (misura, non ipotizza).
  const devs = indicatorDeviations(games, cfg.indicatorTargets);
  const fVi = (v, u) => (u === '%' ? pct(v) : v.toFixed(1));
  const fDi = (x, u) => (x >= 0 ? '+' : '') + (u === '%' ? (100 * x).toFixed(0) + 'pp' : x.toFixed(1));
  L.push('=== 5. INDICATORI FUORI RANGE — scostamenti dai bersagli ===');
  L.push('(🟢 dato osservato vs un bersaglio che decidi TU in INDICATOR_TARGETS. Il simulatore misura la distanza, non sa quale sia il valore giusto.)');
  L.push('Indicatore                        | Target   | Valore | Stato | Scostamento');
  for (const d of devs) {
    const bar = d.out ? '█'.repeat(Math.min(10, Math.max(1, Math.round(d.dist / (d.range[1] || 1) * 10)))) : '';
    const sc = d.out ? `${bar} ${fDi(d.side === 'sopra' ? d.dist : -d.dist, d.unit)} ${d.side}` : '—';
    L.push(`${d.label.padEnd(33)} | ${fmtTarget(d.range, d.unit).padStart(8)} | ${fVi(d.value, d.unit).padStart(6)} | ${d.out ? '🔴' : '🟢'}    | ${sc}`);
  }
  const nOut = devs.filter(d => d.out).length;
  L.push('');
  L.push(nOut
    ? `${nOut} indicatori fuori range. Per scoprire quali leve li riavvicinano (MISURATO, non ipotizzato): indicatorTable(cfg, leve).`
    : 'Tutti gli indicatori entro i bersagli correnti.');
  L.push('(i bersagli sono placeholder tuoi: modificali in INDICATOR_TARGETS. Il simulatore non li conosce, li confronta soltanto.)');

  if (games.length > ok.length) L.push(`\n⚠ ${games.length - ok.length} partite non terminate entro ${MAX_STEPS} step (escluse).`);

  // ===== DASHBOARD: i 10 numeri che si guardano dopo ogni A/B =====
  // Ricalcolati qui dalle stesse fonti delle sezioni, non "presi" da variabili intermedie: così restano
  // corretti anche se un blocco sopra viene spostato o rimosso.
  const nPG = ok.length * P || 1;
  const dashCards = ok.flatMap(g => g.cards || []);
  const dashDepts = dashCards.flatMap(c => c.depts || []);
  const dashTracks = ok.flatMap(g => g.tracks || []);
  // factories è per-giocatore (array di array): .flat() prima di contare, come la sezione Mappa.
  // Senza, .length conta i giocatori (sempre P) e il rapporto/giocatore esce fisso a 1.0.
  const dashFactories = ok.reduce((n, g) => n + (g.borsaFabbriche?.factories?.flat().length || 0), 0);
  const dashPV = ok.flatMap(g => (g.results || []).map(r => r.pv ?? r.total ?? 0));
  const dashContracts = ok.reduce((n, g) => n + (g.contracts || []).reduce((m, c) => m + c.length, 0), 0);
  // vincitore, distanza dall'ultimo e resa del canale "grandi": i tre numeri che dicono se la partita
  // ha avuto una corsa vera o è finita in fotocopia.
  const dashPVperGame = ok.map(g => (g.results || []).map(r => r.pv ?? r.total ?? 0)).filter(a => a.length);
  const dashWin = dashPVperGame.map(a => Math.max(...a));
  const dashGap = dashPVperGame.map(a => Math.max(...a) - Math.min(...a));
  const dashLargeDone = ok.reduce((n, g) => n + (g.contracts || []).reduce((m, c) => m + c.filter(x => x.size === 'large').length, 0), 0);
  const dashLargeTot = dashLargeDone + ok.reduce((n, g) => n + (g.contractsLeft?.large?.market || 0) + (g.contractsLeft?.large?.deck || 0), 0);
  const row = (k, v) => `${k.padEnd(22)}${v}`;
  const dashboard = [
    '=== DASHBOARD ===',
    row('PARTITE', `${ok.length}`),
    row('Durata', `${avg(ok.map(g => g.turns)).toFixed(1)} turni`),
    row('PV medi', dashPV.length ? avg(dashPV).toFixed(0) : '—'),
    row('Commesse', `${(dashContracts / nPG).toFixed(1)} / giocatore`),
    row('Fabbriche', `${(dashFactories / nPG).toFixed(1)} / giocatore`),
    row('Lavoratori', `${(dashDepts.reduce((a, n) => a + n, 0) / nPG).toFixed(1)} / giocatore`),
    row('Impiegati', `${(dashCards.reduce((a, c) => a + (c.dirSopra || 0) + (c.dirSotto || 0), 0) / nPG).toFixed(1)} / giocatore`),
    row('Reparti completi', dashDepts.length ? pct(dashDepts.filter(n => n >= 5).length / dashDepts.length) : '—'),
    row('Milestone complete', dashTracks.length ? pct(dashTracks.filter(t => t.ms?.every(Boolean)).length / dashTracks.length) : '—'),
    row('Risorse sprecate', pct(trueWasteShare)),
    '',
    row('PV vincitore', dashWin.length ? avg(dashWin).toFixed(0) : '—'),
    row('Gap 1°-4°', dashGap.length ? avg(dashGap).toFixed(0) : '—'),
    row('Completamento grandi', dashLargeTot ? pct(dashLargeDone / dashLargeTot) : '—'),
    '',
    'Livelli: 🟢 core (ogni A/B) · 🔵 diagnostica (se qualcosa stona) · ⚪ ricerca (di rado).',
  ];

  const firstHeader = L.findIndex(l => /^\s*(===|—)/.test(l));
  if (firstHeader < 0) return L.join('\n');
  const verbose = cfg.verbose ?? false;
  return organizeReport(
    L.slice(0, firstHeader), L.slice(firstHeader), dashboard,
    cfg.researchVerbose ?? verbose ?? REPORT_RESEARCH_VERBOSE,
    verbose,
  ).join('\n');
}

// Ipotesi auto-generate dai numeri aggregati, PESATE per livello di evidenza e confidenza.
// Tier: 🟢 osservazione (fatto grezzo) · 🟡 correlazione (vero, non causale) · 🔵 causale (solo se manipolato in un A/B).
// In un singolo batch il 🔵 NON compare: nulla è stato manipolato qui. Confidenza ★ = campione × forza dell'effetto.
// Tono: il simulatore INVITA a verificare, non conclude "è sbagliato".
function batchAnalysis(ok, cfg, P, extra) {
  const n = ok.length;
  const A = ['— IPOTESI AUTOMATICHE (🟢 osservazione · 🟡 correlazione · 🔵 causale) —'];
  A.push('(🔵 causale non emerge da un singolo batch: solo dagli A/B — es. milestone/gate. Confidenza ★ = campione × effetto.)');
  if (n === 0) { A.push('🟢 [☆☆☆☆] Nessuna partita valida.'); return A; }
  // stelle: 1 base · +1 se n≥50 · +1 se n≥150 · +1 se effetto forte (≥0.25 su scala 0..1)
  const conf = eff => { let s = 1; if (n >= 50) s++; if (n >= 150) s++; if (eff >= 0.25) s++; s = Math.min(4, s); return '★'.repeat(s) + '☆'.repeat(4 - s); };
  const tag = (tier, eff, text) => A.push(`${tier} [${conf(eff)}] ${text}`);
  const seatVal = getter => Array.from({ length: P }, (_, s) => avg(ok.map(g => getter(g.results.find(r => r.playerId === s)))));
  const wins = Array.from({ length: P }, (_, s) => ok.filter(g => g.results[0].playerId === s).length / n);
  const maxW = Math.max(...wins), minW = Math.min(...wins);
  const bestSeat = wins.indexOf(maxW), worstSeat = wins.indexOf(minW);
  const spread = maxW - minW;

  // 1. equità posti
  if (spread <= 0.10) tag('🟢', spread, `Posti equilibrati: vittorie ${wins.map(pct).join('/')}, spread ${pct(spread)} — entro il rumore per n=${n}.`);
  else tag('🟡', spread, `Posizione↔vittoria: ${bestSeat + 1}° ${pct(maxW)} vs ${worstSeat + 1}° ${pct(minW)} (spread ${pct(spread)}). Correlazione — il simulatore suggerisce un A/B a setup identico per distinguere turn-order (causale) da campione.`);

  // 2. canale del vantaggio (correlazione, non causa)
  if (spread > 0.10) {
    const comps = [['pvContracts', 'Commesse'], ['pvObjectives', 'Obiettivi'], ['pvTrack', 'Tracciati'], ['pvCoins', 'Marchi']];
    let bestGap = null;
    for (const [k, lab] of comps) {
      const v = seatVal(r => r[k]);
      const gap = v[bestSeat] - v[worstSeat];
      if (!bestGap || Math.abs(gap) > Math.abs(bestGap.gap)) bestGap = { lab, gap, hi: v[bestSeat], lo: v[worstSeat] };
    }
    tag('🟡', Math.min(1, Math.abs(bestGap.gap) / 10), `Il vantaggio del ${bestSeat + 1}° si concentra sui ${bestGap.lab} (${bestGap.hi.toFixed(1)} vs ${bestGap.lo.toFixed(1)}, Δ ${bestGap.gap.toFixed(1)} PV). Correlazione, non causa.`);
  }

  // 3. mix commesse (osservazione + invito)
  const grandiShare = extra.bySize.large / (extra.tot || 1);
  tag('🟢', Math.min(1, Math.abs(0.2 - grandiShare) * 3), `Mix completamenti: grandi ${pct(grandiShare)}, medie ${pct(extra.bySize.medium / extra.tot)}, piccole ${pct(extra.bySize.small / extra.tot)}.${grandiShare < 0.15 ? ' Il simulatore suggerisce: valutare se il canale grandi è usato quanto voluto.' : ''}`);

  // 5. azioni Sindacato quasi mai scelte
  const sindAll = k => avg(ok.flatMap(g => g.sindacato.map(v => v[k] || 0)));
  const dead = [];
  if (sindAll('unblock') < 0.1) dead.push('sblocca-carta');
  if (dead.length) tag('🟢', 0.3, `Azioni Sindacato quasi mai scelte dall'AI: ${dead.join(', ')}. Suggerisce: situazionali, o poco preziose rispetto alle alternative?`);

  // 6. equilibrio Sopra/Sotto
  const spQ = extra.sopra / (extra.sopra + extra.sotto || 1);
  if (spQ > 0.7 || spQ < 0.3) tag('🟡', Math.abs(spQ - 0.5) * 2, `Assunzioni sbilanciate Sopra/Sotto: ${pct(spQ)}/${pct(1 - spQ)}.`);

  // 7. Direzione Sotto poco comprata
  const allDir = ok.flatMap(g => g.cards);
  const dirSottoZero = allDir.filter(c => c.dirSotto === 0).length / (allDir.length || 1);
  if (cfg.welfareEnabled !== false && dirSottoZero > 0.6) tag('🟢', dirSottoZero, `Direzione Sotto poco comprata: ${pct(dirSottoZero)} finisce con 0 Macchinari. Suggerisce: valutare se il lato Sotto offre valore competitivo (o A/B su costo/potenza per stabilirlo).`);
  // "piena" = al cap configurato, non il 2 storico: col cap a 3 il >=2 diceva "piena" a chi aveva uno slot libero
  const dirSopraCap = ok[0]?.slots?.direzione?.sopra ?? 3;
  const dirSopraFull = allDir.filter(c => c.dirSopra >= dirSopraCap).length / (allDir.length || 1);
  if (dirSopraFull > 0.8) tag('🟢', dirSopraFull, `Direzione Sopra quasi sempre riempita (${pct(dirSopraFull)} a ${dirSopraCap} carte): il lato Sopra è chiaramente conveniente.`);

  return A;
}

// ===== A/B DIFF HARNESS (Layer 1-2) =====
// Motore generale: confronta due esperimenti, non sa cosa sia una commessa.
// Ogni metrica è calcolata PER PARTITA (media tra i giocatori della partita) → n valori per lato
// → SE di Welch → z = |Δ|/SE. Segnale ★ = effetto × stabilità × centralità.
// Centralità (a mano, unica conoscenza di dominio qui): 3 = condizioni di vittoria / flusso commesse,
// 2 = economia/ritmo/milestone, 1 = contorno. I protocolli diagnostici (L3-5) verranno costruiti SOPRA
// diffMetrics(), non dentro.

const sdev = a => { const m = avg(a); return Math.sqrt(avg(a.map(x => (x - m) ** 2))); };
const resSumOf = r => SECTORS.reduce((a, sc) => a + (r[sc] || 0), 0);
const rhythmAvg = (g, key) => { const v = g.contracts.map((_, s) => rhythm(g, s)[key]).filter(x => x != null); return v.length ? avg(v) : null; };
const perContract = (g, num) => { const v = g.contracts.map((cs, s) => (cs.length ? num(s) / cs.length : null)).filter(x => x != null); return v.length ? avg(v) : null; };

// [label, centralità 1-3, area (per LEVE OSSERVATE), unità (''|'%'), fn(partita) → valore|null]
const AB_METRICS = [
  // punteggio / condizioni di vittoria (3)
  ['PV totali (media)', 3, 'Punteggio', '', g => avg(g.results.map(r => r.total))],
  ['PV da commesse', 3, 'Punteggio', '', g => avg(g.results.map(r => r.pvContracts))],
  ['PV da obiettivi', 3, 'Punteggio', '', g => avg(g.results.map(r => r.pvObjectives))],
  ['PV da tracciati', 3, 'Punteggio', '', g => avg(g.results.map(r => r.pvTrack))],
  ['PV da marchi', 2, 'Punteggio', '', g => avg(g.results.map(r => r.pvCoins))],
  ['PV da risorse', 2, 'Punteggio', '', g => avg(g.results.map(r => r.pvResources))],
  ['gap 1°-ultimo', 3, 'Punteggio', '', g => g.results[0].total - g.results.at(-1).total],
  // flusso commesse (3)
  ['durata (turni)', 3, 'Ritmo', '', g => g.turns],
  ['commesse/giocatore', 3, 'Mercato commesse', '', g => avg(g.contracts.map(cs => cs.length))],
  ['turno 1ª commessa', 3, 'Mercato commesse', '', g => { const f = g.firstContract.filter(x => x !== null); return f.length ? avg(f) : null; }],
  ['turno 1ª grande', 3, 'Mercato commesse', '', g => { const ts = g.contracts.map(cs => cs.filter(c => c.size === 'large').map(c => c.turn)).filter(a => a.length).map(a => Math.min(...a)); return ts.length ? avg(ts) : null; }],
  ...[['small', 'piccole'], ['medium', 'medie'], ['large', 'grandi']].map(([size, lab]) => [
    `% ${lab} completate`, 3, 'Mercato commesse', '%', g => {
      const done = g.completions.filter(c => c.size === size).length;
      const left = g.contractsLeft[size], tot = done + left.market + left.deck;
      return tot ? done / tot : null;
    }]),
  ['peso grandi (sui completamenti)', 2, 'Mercato commesse', '%', g => (g.completions.length ? g.completions.filter(c => c.size === 'large').length / g.completions.length : null)],
  // milestone (2)
  ...['terziario', 'secondario', 'primario'].map((lab, i) => [`milestone ${lab}`, 2, 'Tracciati', '%', g => g.tracks.filter(t => t.ms[i]).length / g.tracks.length]),
  ['tutte e 3 le milestone', 2, 'Tracciati', '%', g => g.tracks.filter(t => t.ms.every(Boolean)).length / g.tracks.length],
  // economia (2)
  ['marchi guadagnati', 2, 'Economia', '', g => avg(g.econ.map(e => e.gained))],
  ['marchi spesi', 2, 'Economia', '', g => avg(g.econ.map(e => e.start + e.gained - e.final))],
  ['marchi finali', 2, 'Economia', '', g => avg(g.econ.map(e => e.final))],
  ['marchi inutilizzati (quota)', 2, 'Economia', '%', unusedOf],
  ['risorse prodotte/giocatore', 2, 'Economia', '', g => avg(g.resGen.map(resSumOf))],
  ['risorse → commesse/giocatore', 2, 'Economia', '', g => avg(g.resToContracts)],
  // vero spreco = nessun valore estratto in nessuna forma (né commesse, né vendita/scambio, né conversione finale).
  // NON il semplice "non arriva a commessa": quello include vendita/scambio, un secondo canale di valore legittimo nel design.
  ['risorse sprecate/giocatore', 2, 'Economia', '', g => avg(g.resFinalByType.map(rb => Object.values(rb).reduce((a, n) => a + (n % (g.resPerPV || 2)), 0)))],
  ['% risorse sprecate', 2, 'Economia', '%', g => { const prod = g.resGen.reduce((a, r) => a + resSumOf(r), 0); if (!prod) return null; const w = g.resFinalByType.reduce((a, rb) => a + Object.values(rb).reduce((x, n) => x + (n % (g.resPerPV || 2)), 0), 0); return w / prod; }],
  ['produzioni/commessa', 2, 'Economia', '', g => perContract(g, s => g.activations[s])],
  ['risorse/commessa', 2, 'Economia', '', g => perContract(g, s => resSumOf(g.resGen[s]))],
  // ritmo (2)
  ['fine costruzione', 2, 'Ritmo', '', g => rhythmAvg(g, 'buildStop')],
  ['inizio conversione', 2, 'Ritmo', '', g => rhythmAvg(g, 'convStart')],
  ['burstiness consegne', 1, 'Ritmo', '', g => rhythmAvg(g, 'burst')],
  // contorno (1)
  ...HEAT_COLS.map(c => [`% azioni ${c}`, 1, 'Azioni/nodi', '%', g => (g.actions.length ? g.actions.filter(a => a.cat === c).length / g.actions.length : null)]),
  ['assunzioni Sopra (quota)', 1, 'Azioni/nodi', '%', g => { const t = g.sopra + g.sotto; return t ? g.sopra / t : null; }],
  ['attivazioni/giocatore', 1, 'Azioni/nodi', '', g => avg(g.activations)],
  ['risorse finali in mano', 1, 'Economia', '', g => avg(g.resFinal)],
  ['Direzione Sopra piena (2)', 1, 'Direzione', '%', g => g.cards.filter(c => c.dirSopra >= 2).length / g.cards.length],
];

// Segnale 0-5: 0 = entro il rumore (z<2). Poi effetto relativo (3/2/1) + stabilità extra (z≥4) + centralità (0-2), cap 5.
function abStars(rel, z, c) {
  if (z < 2) return 0;
  let s = rel >= 0.5 ? 3 : rel >= 0.25 ? 2 : rel >= 0.10 ? 1 : 0;
  if (z >= 4) s++;
  s += c - 1;
  return Math.max(1, Math.min(5, s));
}

// Diffa due batch già eseguiti → righe strutturate (base per report testuale e futuri protocolli L3-5).
export function diffMetrics(gamesA, gamesB) {
  const okA = gamesA.filter(g => !g.failed), okB = gamesB.filter(g => !g.failed);
  const rows = [];
  for (const [label, c, area, unit, fn] of AB_METRICS) {
    const a = okA.map(fn).filter(v => v != null && isFinite(v));
    const b = okB.map(fn).filter(v => v != null && isFinite(v));
    if (a.length < 5 || b.length < 5) { rows.push({ label, c, area, unit, thin: true, nA: a.length, nB: b.length }); continue; }
    const mA = avg(a), mB = avg(b), d = mB - mA;
    const se = Math.sqrt(sdev(a) ** 2 / a.length + sdev(b) ** 2 / b.length);
    const z = se > 0 ? Math.abs(d) / se : d ? Infinity : 0;
    const rel = Math.abs(d) / Math.max(Math.abs(mA), Math.abs(mB), 1e-9);
    rows.push({ label, c, area, unit, mA, mB, d, se, z, rel, stars: abStars(rel, z, c) });
  }
  return rows;
}

export function formatAbReport(gamesA, gamesB, cfgA = {}, cfgB = {}) {
  const rows = diffMetrics(gamesA, gamesB);
  const okA = gamesA.filter(g => !g.failed).length, okB = gamesB.filter(g => !g.failed).length;
  const fV = (r, v) => (r.unit === '%' ? (100 * v).toFixed(0) + '%' : v.toFixed(1));
  const fD = r => (r.d >= 0 ? '+' : '') + (r.unit === '%' ? (100 * r.d).toFixed(0) + 'pp' : r.d.toFixed(1));
  const fSE = r => (r.unit === '%' ? (100 * r.se).toFixed(1) + 'pp' : r.se.toFixed(2));
  const signal = rows.filter(r => !r.thin && r.stars > 0).sort((x, y) => y.stars - x.stars || y.rel - x.rel);
  const noise = rows.filter(r => !r.thin && r.stars === 0).sort((x, y) => y.z - x.z);
  const thin = rows.filter(r => r.thin);

  const L = [];
  L.push(`OFFICINA 1907 — A/B DIFF — A: ${cfgA.label ?? 'config A'} (${okA} partite) vs B: ${cfgB.label ?? 'config B'} (${okB} partite) · seed appaiati`);
  L.push('Le differenze sono CAUSALI 🔵 rispetto al pacchetto di modifiche A→B (una leva per volta = attribuzione pulita).');
  L.push('Il MECCANISMO non è dedotto qui: il diff osserva, non interpreta (protocolli diagnostici: livello successivo).');
  L.push('');
  // LEVE OSSERVATE: quante metriche di ciascuna area si muovono, e quanto forte — non importanza assoluta
  const areaAgg = {};
  for (const r of rows) { if (r.thin) continue; const a = areaAgg[r.area] || (areaAgg[r.area] = { sum: 0, n: 0, moved: 0 }); a.n++; a.sum += r.stars; if (r.stars > 0) a.moved++; }
  const areaRows = Object.entries(areaAgg).map(([area, a]) => ({ area, mean: a.sum / a.n, moved: a.moved, n: a.n })).sort((x, y) => y.mean - x.mean);
  L.push('— LEVE OSSERVATE (quante metriche dell\'area si muovono, e quanto forte — non importanza assoluta) —');
  for (const a of areaRows) {
    const st = a.moved ? Math.min(5, Math.max(1, Math.round(a.mean))) : 0;
    L.push(`${'★'.repeat(st)}${'☆'.repeat(5 - st)}  ${a.area.padEnd(17)} (${a.moved}/${a.n} metriche mosse)`);
  }
  L.push('');
  L.push('— ANOMALIE OSSERVATE (Δ = B−A · segnale = effetto × stabilità × centralità) —');
  L.push('Metrica                          |      A |      B |      Δ |   ±SE | Segnale');
  for (const r of signal) {
    L.push(`${r.label.padEnd(32)} | ${fV(r, r.mA).padStart(6)} | ${fV(r, r.mB).padStart(6)} | ${fD(r).padStart(6)} | ${fSE(r).padStart(5)} | ${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}`);
  }
  if (!signal.length) L.push('(nessuna differenza sopra la soglia di rumore: le due config sono indistinguibili su queste metriche)');
  L.push('');
  L.push(`— ENTRO IL RUMORE (|z| < 2) — ${noise.length} metriche —`);
  if (noise.length) L.push(noise.map(r => `${r.label} (Δ${fD(r)})`).join(' · '));
  if (thin.length) L.push(`— CAMPIONE INSUFFICIENTE — ${thin.map(r => `${r.label} (${r.nA}/${r.nB})`).join(' · ')}`);
  return L.join('\n');
}

// Gira due batch con gli stessi seed e diffa gli indicatori. onProgress(fatte, totali) cumulativo sui due lati.
export async function abReport(cfgA, cfgB, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = cfgA.seedBase ?? cfgB.seedBase ?? Math.floor(Math.random() * 100000);
  const nTot = cfgA.nGames + cfgB.nGames;
  const gamesA = await runBatch({ ...cfgA, seedBase }, d => onProgress(d, nTot), isCancelled);
  const gamesB = await runBatch({ ...cfgB, seedBase }, d => onProgress(cfgA.nGames + d, nTot), isCancelled);
  return formatAbReport(gamesA, gamesB, cfgA, cfgB);
}

// ===== MAPPA DELLE LEVE — il "cartografo del design" =====
// Effetti PRINCIPALI, una leva alla volta contro lo stesso baseline (seed appaiati, baseline girato una volta sola).
// NON rileva interazioni tra leve (es. gate × milestone): per quelle serve un fattoriale, non incluso.
// Non ottimizza nulla: produce la mappa. Gli obiettivi restano del designer.
// levers: [{ label, cfg }] — cfg completo della variante (tipicamente { ...base, manopola: valore }).
export async function leverMap(baseCfg, levers, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = baseCfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nTot = (levers.length + 1) * baseCfg.nGames;
  let done = 0;
  const track = d => onProgress(done + d, nTot);
  const gamesBase = await runBatch({ ...baseCfg, seedBase }, track, isCancelled);
  done += baseCfg.nGames;
  const AREAS = [...new Set(AB_METRICS.map(m => m[2]))];
  const matrix = [];
  for (const lv of levers) {
    if (isCancelled()) break;
    const games = await runBatch({ ...lv.cfg, seedBase, nGames: baseCfg.nGames, nPlayers: baseCfg.nPlayers }, track, isCancelled);
    done += baseCfg.nGames;
    const rows = diffMetrics(gamesBase, games);
    const byArea = {};
    for (const r of rows) { if (r.thin) continue; const a = byArea[r.area] || (byArea[r.area] = { sum: 0, n: 0, moved: 0 }); a.n++; a.sum += r.stars; if (r.stars > 0) a.moved++; }
    const cells = Object.fromEntries(AREAS.map(ar => { const a = byArea[ar]; return [ar, a && a.moved ? Math.min(5, Math.max(1, Math.round(a.sum / a.n))) : 0]; }));
    const top = rows.filter(r => !r.thin && r.stars > 0).sort((x, y) => y.stars - x.stars || y.rel - x.rel).slice(0, 3);
    matrix.push({ label: lv.label, cells, top });
  }
  const L = [];
  L.push(`OFFICINA 1907 — MAPPA DELLE LEVE — ${matrix.length} leve × ${baseCfg.nGames} partite vs baseline (seed appaiati)`);
  L.push('Effetti principali, una leva alla volta. NON rileva interazioni (es. gate × milestone): per quelle serve un fattoriale.');
  L.push('Cella = forza media del segnale nell\'area (0-5 · "·" = nessuna metrica mossa). 🔵 causale rispetto alla singola leva.');
  L.push('Questa è la mappa, non una raccomandazione: quale fenomeno muovere lo decide il designer.');
  L.push('');
  const W = Math.max(...AREAS.map(a => a.length));
  L.push('leva'.padEnd(28) + '| ' + AREAS.map(a => a.padStart(W)).join(' | '));
  for (const m of matrix) L.push(m.label.padEnd(28) + '| ' + AREAS.map(a => String(m.cells[a] || '·').padStart(W)).join(' | '));
  L.push('');
  L.push('— LEVA PRIMARIA PER FENOMENO (dove guardare per muovere un\'area) —');
  for (const ar of AREAS) {
    const best = matrix.reduce((x, y) => (y.cells[ar] > (x?.cells[ar] ?? 0) ? y : x), null);
    L.push(`${ar.padEnd(17)}: ${best && best.cells[ar] ? `${best.label} (${best.cells[ar]}/5)` : '— nessuna leva testata la muove'}`);
  }
  L.push('');
  L.push('— EFFETTO DOMINANTE PER LEVA (top 3 metriche sopra il rumore) —');
  for (const m of matrix) L.push(`${m.label.padEnd(28)}: ` + (m.top.length ? m.top.map(r => `${r.label} ${r.d >= 0 ? '+' : ''}${r.unit === '%' ? (100 * r.d).toFixed(0) + 'pp' : r.d.toFixed(1)}`).join(' · ') : 'nulla sopra il rumore'));
  return L.join('\n');
}

// ===== SENSIBILITÀ DI UNA LEVA — sweep lungo la manopola =====
// Stessa leva a N valori ordinati; diff tra passi CONSECUTIVI (seed appaiati).
// Risponde a: la leva è robusta (effetto graduale) o instabile (esplode in un punto)?
// Profilo con definizioni operative dichiarate:
//   robustezza    = 5 − effetto max di un singolo passo (5 = nessun passo violento)
//   linearità     = uniformità degli effetti tra i passi (5 = ogni passo muove uguale)
//   prevedibilità = coerenza di segno: le metriche mosse in ≥2 passi vanno sempre nella stessa direzione?
//   interazioni   = NON misurabile da uno sweep (serve fattoriale) — dichiarato, non stimato.
// steps: [{ label, cfg }] ordinati lungo la manopola (cfg completi).
export async function leverSweep(sweepLabel, steps, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = steps[0].cfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nGames = steps[0].cfg.nGames;
  const nTot = steps.length * nGames;
  let done = 0;
  const batches = [];
  for (const st of steps) {
    if (isCancelled()) break;
    batches.push(await runBatch({ ...st.cfg, seedBase, nGames }, d => onProgress(done + d, nTot), isCancelled));
    done += nGames;
  }
  const pairs = [];
  for (let i = 0; i + 1 < batches.length; i++) {
    const rows = diffMetrics(batches[i], batches[i + 1]);
    const live = rows.filter(r => !r.thin);
    const moved = live.filter(r => r.stars > 0);
    const meanStars = live.length ? live.reduce((a, r) => a + r.stars, 0) / live.length : 0;
    const top = [...moved].sort((x, y) => y.stars - x.stars || y.rel - x.rel)[0];
    pairs.push({ from: steps[i].label, to: steps[i + 1].label, rows, live: live.length, moved: moved.length, meanStars, top });
  }
  const fD = r => (r.d >= 0 ? '+' : '') + (r.unit === '%' ? (100 * r.d).toFixed(0) + 'pp' : r.d.toFixed(1));
  const L = [];
  L.push(`OFFICINA 1907 — SENSIBILITÀ LEVA: ${sweepLabel} — ${steps.length} passi × ${nGames} partite (seed appaiati, diff tra passi consecutivi)`);
  L.push('Ogni riga = effetto 🔵 causale di UN passo della manopola. Robusta = effetto graduale · instabile = esplode in un punto.');
  L.push('');
  L.push('passo                        | metriche mosse | segnale medio | effetto top');
  for (const p of pairs)
    L.push(`${`${p.from} → ${p.to}`.padEnd(28)} | ${`${p.moved}/${p.live}`.padStart(14)} | ${p.meanStars.toFixed(2).padStart(13)} | ${p.top ? `${p.top.label} ${fD(p.top)}` : '—'}`);
  L.push('');
  const E = pairs.map(p => p.meanStars);
  const maxE = Math.max(...E), meanE = avg(E);
  const cv = meanE > 0 ? sdev(E) / meanE : 0;
  const robust = 5 - Math.min(5, Math.round(maxE));
  const linear = meanE > 0 ? 5 - Math.min(5, Math.round(5 * Math.min(1, cv))) : 5;
  const dirs = {};
  for (const p of pairs) for (const r of p.rows) if (!r.thin && r.stars > 0) (dirs[r.label] = dirs[r.label] || []).push(Math.sign(r.d));
  const multi = Object.values(dirs).filter(a => a.length >= 2);
  const coherent = multi.filter(a => a.every(s => s === a[0])).length;
  const predict = multi.length ? Math.round(5 * (coherent / multi.length)) : null;
  const bar = n => (n == null ? '— (nessuna metrica mossa in ≥2 passi)' : '█'.repeat(n) + '░'.repeat(5 - n));
  L.push('— PROFILO LEVA —');
  L.push(`robustezza    ${bar(robust)}  (passo più violento: segnale medio ${maxE.toFixed(2)})`);
  L.push(`linearità     ${bar(linear)}  (uniformità degli effetti tra passi, CV ${cv.toFixed(2)})`);
  L.push(`prevedibilità ${bar(predict)}${multi.length ? `  (${coherent}/${multi.length} metriche coerenti di segno lungo lo sweep)` : ''}`);
  L.push('interazioni   non misurabili da uno sweep (serve fattoriale)');
  return L.join('\n');
}

// ===== SCOPERTA DELLE LEVE — dai parametri alle leve latenti =====
// Inverso di leverMap: perturba N PARAMETRI uno alla volta vs lo stesso baseline; ogni parametro
// ottiene una FIRMA (vettore segno×segnale su tutte le metriche); parametri con firme simili
// (coseno ≥ soglia) finiscono nella stessa FAMIGLIA = candidata leva latente, SENZA nome.
// Epistemica: effetti per-parametro 🔵 causali; il raggruppamento è 🟡 — firma simile nell'intorno
// di QUESTO baseline, non identità dimostrata. Il nome (e la conferma) restano al designer.
export async function discoverLevers(baseCfg, params, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = baseCfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nGames = baseCfg.nGames;
  const nTot = (params.length + 1) * nGames;
  let done = 0;
  const gamesBase = await runBatch({ ...baseCfg, seedBase }, d => onProgress(done + d, nTot), isCancelled);
  done += nGames;
  const labels = AB_METRICS.map(m => m[0]);
  const sigs = [];
  for (const p of params) {
    if (isCancelled()) break;
    const games = await runBatch({ ...p.cfg, seedBase, nGames, nPlayers: baseCfg.nPlayers }, d => onProgress(done + d, nTot), isCancelled);
    done += nGames;
    const rows = diffMetrics(gamesBase, games);
    const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));
    const vec = labels.map(l => { const r = byLabel[l]; return r && !r.thin && r.stars > 0 ? Math.sign(r.d) * r.stars : 0; });
    sigs.push({ label: p.label, vec, rows });
  }
  const dot = (u, v) => u.reduce((a, x, i) => a + x * v[i], 0);
  const cos = (u, v) => { const nn = Math.sqrt(dot(u, u)) * Math.sqrt(dot(v, v)); return nn ? dot(u, v) / nn : 0; };
  const n = sigs.length;
  const sim = sigs.map(a => sigs.map(b => cos(a.vec, b.vec)));
  const TH = 0.5;
  const parent = sigs.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sim[i][j] >= TH) parent[find(i)] = find(j);
  const groups = {};
  sigs.forEach((s, i) => { const r = find(i); (groups[r] = groups[r] || []).push(i); });
  const fams = Object.values(groups).filter(g => g.length >= 2).sort((a, b) => b.length - a.length);
  const solos = Object.values(groups).filter(g => g.length === 1).flat();
  const fD = r => (r.d >= 0 ? '+' : '') + (r.unit === '%' ? (100 * r.d).toFixed(0) + 'pp' : r.d.toFixed(1));

  const L = [];
  L.push(`OFFICINA 1907 — SCOPERTA LEVE — ${n} parametri × ${nGames} partite vs baseline (seed appaiati)`);
  L.push('Parametri ≠ leve: qui si cercano FAMIGLIE di parametri con la stessa firma di comportamento.');
  L.push(`Una famiglia = candidata leva latente 🟡 (firme simili intorno a QUESTO baseline, coseno ≥ ${TH}). Il nome lo dai tu.`);
  L.push('');
  L.push('— MATRICE DI SOMIGLIANZA (coseno tra firme) —');
  L.push('     ' + sigs.map((_, i) => `P${i + 1}`.padStart(6)).join(''));
  sigs.forEach((s, i) => L.push(`P${i + 1}`.padEnd(5) + sim[i].map(v => v.toFixed(2).padStart(6)).join('')));
  sigs.forEach((s, i) => L.push(`P${i + 1} = ${s.label}`));
  L.push('');
  fams.forEach((g, fi) => {
    const shared = labels.map((l, li) => ({ l, vals: g.map(i => sigs[i].vec[li]) })).filter(x => x.vals.every(v => v !== 0));
    const strength = shared.length ? avg(shared.map(x => avg(x.vals.map(Math.abs)))) : 0;
    const bars = Math.min(5, Math.max(1, Math.round(strength)));
    L.push(`FAMIGLIA ${fi + 1} — forza ${'█'.repeat(bars)}${'░'.repeat(5 - bars)} — candidata leva latente (da nominare)`);
    L.push(`  parametri che la controllano: ${g.map(i => sigs[i].label).join(' · ')}`);
    if (shared.length) L.push('  coinvolge (metriche mosse da TUTTI i membri): ' + shared.map(x => `${x.l} ${x.vals.every(v => v > 0) ? '↑' : x.vals.every(v => v < 0) ? '↓' : '↔'}`).join(' · '));
    else L.push('  (nessuna metrica mossa da tutti i membri: famiglia debole, somiglianza solo parziale)');
    L.push('');
  });
  if (!fams.length) L.push('Nessuna famiglia trovata: le firme dei parametri testati sono tutte diverse.\n');
  L.push('— PARAMETRI ISOLATI (firma unica: probabilmente leve a sé) —');
  for (const i of solos) {
    const top = sigs[i].rows.filter(r => !r.thin && r.stars > 0).sort((x, y) => y.stars - x.stars || y.rel - x.rel).slice(0, 3);
    L.push(`${sigs[i].label.padEnd(28)}: ${top.length ? top.map(r => `${r.label} ${fD(r)}`).join(' · ') : 'nessun effetto sopra il rumore'}`);
  }
  return L.join('\n');
}

// ===== INDICATORI × LEVE — lo scostamento è il punto di partenza, non la diagnosi =====
// Un indicatore = una metrica osservata (già in AB_METRICS) + un BERSAGLIO che decidi TU (INDICATOR_TARGETS, editabile).
// Il simulatore misura la distanza dal bersaglio (🟢 fatto); poi, girando le leve, MISURA quali lo muovono
// (🔵 causale per singola leva, seed appaiati) e verso dove. Non dice "è colpa di X": mostra effetti misurati.
// I bersagli, i nomi e la scelta della leva restano del designer: il simulatore non sa quale sia il valore giusto.
export const INDICATOR_TARGETS = {
  'marchi inutilizzati (quota)':      [0.20, 0.30],
  '% risorse sprecate':               [0,    0.25],
  '% azioni Servizi':                 [0.10, 0.20],
  'peso grandi (sui completamenti)': [0.20, 0.30],
  'durata (turni)':                   [30,   35],
};

const AB_BY_LABEL = Object.fromEntries(AB_METRICS.map(m => [m[0], m]));
// unità per indicatore ('%' o '' assoluto) — per l'editor dei bersagli in UI
export const INDICATOR_UNITS = Object.fromEntries(Object.keys(INDICATOR_TARGETS).map(k => [k, AB_BY_LABEL[k]?.[3] || '']));
const distTo = ([lo, hi], x) => Math.max(0, lo - x, x - hi);
export function fmtTarget([lo, hi], unit) {
  const f = v => (unit === '%' ? pct(v) : v.toFixed(0));
  if (lo <= 0) return `<${f(hi)}`;
  if (!isFinite(hi)) return `>${f(lo)}`;
  return `${f(lo)}–${f(hi)}`;
}

// Scostamenti dal bersaglio — sola osservazione (un batch). Righe ordinate: fuori range prima.
export function indicatorDeviations(games, targets = INDICATOR_TARGETS) {
  const ok = games.filter(g => !g.failed);
  const rows = [];
  for (const [label, range] of Object.entries(targets)) {
    const m = AB_BY_LABEL[label];
    if (!m) continue;
    const unit = m[3], fn = m[4];
    const vals = ok.map(fn).filter(v => v != null && isFinite(v));
    if (!vals.length) continue;
    const value = avg(vals);
    const dist = distTo(range, value);
    const side = value > range[1] ? 'sopra' : value < range[0] ? 'sotto' : '';
    rows.push({ label, unit, range, value, out: dist > 0, dist, side });
  }
  return rows.sort((a, b) => b.dist - a.dist);
}

// Leve che muovono l'indicatore d, con stelle/verso; toward = riducono la distanza dal bersaglio (misurato).
function leversFor(d, leverRows) {
  const out = [];
  for (const lr of leverRows) {
    const r = lr.byLabel[d.label];
    if (!r || r.thin || r.stars <= 0) continue;
    const toward = distTo(d.range, r.mB) < distTo(d.range, r.mA) - 1e-9;
    out.push({ label: lr.label, stars: r.stars, d: r.d, toward });
  }
  return out.sort((a, b) => b.stars - a.stars || Math.abs(b.d) - Math.abs(a.d));
}

// Il cruscotto di calibrazione: per ogni indicatore fuori range, quali leve lo riavvicinano (MISURATO) e verso dove.
// Riusa leverMap/diffMetrics: baseline una volta, poi ogni leva vs baseline (seed appaiati). Nessuna teoria — misure.
// levers: [{ label, cfg }], come leverMap. La leva "giusta" la sceglie il designer; qui c'è solo l'effetto misurato.
export async function indicatorTable(baseCfg, levers, targets = INDICATOR_TARGETS, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = baseCfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nTot = (levers.length + 1) * baseCfg.nGames;
  let done = 0;
  const track = d => onProgress(done + d, nTot);
  const gamesBase = await runBatch({ ...baseCfg, seedBase }, track, isCancelled);
  done += baseCfg.nGames;
  const devs = indicatorDeviations(gamesBase, targets);
  const leverRows = [];
  for (const lv of levers) {
    if (isCancelled()) break;
    const games = await runBatch({ ...lv.cfg, seedBase, nGames: baseCfg.nGames, nPlayers: baseCfg.nPlayers }, track, isCancelled);
    done += baseCfg.nGames;
    leverRows.push({ label: lv.label, byLabel: Object.fromEntries(diffMetrics(gamesBase, games).map(r => [r.label, r])) });
  }
  const fD = (x, u) => (x >= 0 ? '+' : '') + (u === '%' ? (100 * x).toFixed(0) + 'pp' : x.toFixed(1));
  const fV = (v, u) => (u === '%' ? pct(v) : v.toFixed(1));

  const L = [];
  L.push(`OFFICINA 1907 — INDICATORI × LEVE — ${levers.length} leve × ${baseCfg.nGames} partite vs baseline (seed appaiati)`);
  L.push('Scostamento dal bersaglio = 🟢 fatto. Effetto di una leva = 🔵 causale per quella leva (una per volta). Bersagli e scelta finale: del designer.');
  L.push('');
  L.push('Indicatore                        | Target   | Valore | Stato | Leve che riavvicinano (misurate)');
  for (const d of devs) {
    const top = d.out ? leversFor(d, leverRows).filter(x => x.toward).slice(0, 3) : [];
    const leve = !d.out ? '—' : top.length ? top.map(x => `${x.label} ${'★'.repeat(x.stars)}`).join(' · ') : 'nessuna leva testata la riavvicina';
    L.push(`${d.label.padEnd(33)} | ${fmtTarget(d.range, d.unit).padStart(8)} | ${fV(d.value, d.unit).padStart(6)} | ${d.out ? '🔴' : '🟢'}    | ${leve}`);
  }
  for (const d of devs.filter(x => x.out)) {
    L.push('');
    L.push(`INDICATORE  ${d.label}  ${fV(d.value, d.unit)}  (target ${fmtTarget(d.range, d.unit)}, 🔴 ${fD(d.side === 'sopra' ? d.dist : -d.dist, d.unit)} ${d.side})`);
    const ranked = leversFor(d, leverRows);
    const toward = ranked.filter(x => x.toward), away = ranked.filter(x => !x.toward);
    L.push('  leve che lo riavvicinano al target (le più forti prima):');
    if (toward.length) toward.slice(0, 5).forEach((x, i) => L.push(`  ${i + 1} ${x.label.padEnd(26)} ${'★'.repeat(x.stars)}${'☆'.repeat(5 - x.stars)}  (${fD(x.d, d.unit)})`));
    else L.push('  nessuna leva testata lo riavvicina — le leve provate non bastano, o serve una leva non in lista');
    if (away.length) L.push('  ⚠ lo spingono più fuori: ' + away.slice(0, 3).map(x => `${x.label} ${'★'.repeat(x.stars)} (${fD(x.d, d.unit)})`).join(' · '));
  }
  L.push('');
  L.push('("riavvicina" = la leva riduce la distanza dal bersaglio, misurata su questo batch. Robustezza/linearità di una leva: leverSweep. Interazioni: fattoriale.)');
  return L.join('\n');
}

// ===== DUELLO DI IPOTESI — tenere vivi più modelli finché un A/B non ne falsifica uno =====
// Gli stessi dati ammettono più spiegazioni causali. Il simulatore NON sceglie una radice e non
// inventa i modelli: registra le ipotesi del DESIGNER ed esegue, per ciascuna, l'A/B che la metterebbe
// alla prova. Ogni ipotesi dichiara: "se il mio modello è vero, questo INTERVENTO deve muovere questo
// INDICATORE in questa DIREZIONE". Il sim misura il movimento reale (🔵 causale) e dice: previsione retta
// o violata. Falsificare è più forte di confermare: un modello che "regge" è solo non-ancora-falsificato.
// hyps: [{ nome, intervento: { label, cfg }, indicatore: <label di AB_METRICS>, verso: 'giu'|'su'|'invariato' }]
export async function hypothesisDuel(baseCfg, hyps, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = baseCfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nTot = (hyps.length + 1) * baseCfg.nGames;
  let done = 0;
  const track = d => onProgress(done + d, nTot);
  const gamesBase = await runBatch({ ...baseCfg, seedBase }, track, isCancelled);
  done += baseCfg.nGames;
  const results = [];
  for (const h of hyps) {
    if (isCancelled()) break;
    const games = await runBatch({ ...h.intervento.cfg, seedBase, nGames: baseCfg.nGames, nPlayers: baseCfg.nPlayers }, track, isCancelled);
    done += baseCfg.nGames;
    results.push({ h, row: diffMetrics(gamesBase, games).find(r => r.label === h.indicatore) });
  }
  const fD = r => (!r || r.thin ? 'n/d' : (r.d >= 0 ? '+' : '') + (r.unit === '%' ? (100 * r.d).toFixed(0) + 'pp' : r.d.toFixed(1)));
  const verdict = (h, r) => {
    if (!r || r.thin) return { ok: null, nota: 'campione insufficiente sull\'indicatore' };
    const moved = r.stars > 0, want = h.verso === 'giu' ? -1 : h.verso === 'su' ? 1 : 0;
    if (h.verso === 'invariato') return moved ? { ok: false, nota: `previsto invariato, invece ${fD(r)} (${'★'.repeat(r.stars)})` } : { ok: true, nota: 'previsto invariato, resta nel rumore' };
    if (!moved) return { ok: false, nota: `previsto ${h.verso}, invece nessun effetto sopra il rumore` };
    if (Math.sign(r.d) === want) return { ok: true, nota: `previsto ${h.verso}, osservato ${fD(r)} (${'★'.repeat(r.stars)})` };
    return { ok: false, nota: `previsto ${h.verso}, osservato verso OPPOSTO ${fD(r)}` };
  };
  const L = [];
  L.push(`OFFICINA 1907 — DUELLO DI IPOTESI — ${hyps.length} modelli concorrenti × ${baseCfg.nGames} partite (seed appaiati)`);
  L.push('Gli stessi dati ammettono più spiegazioni. Il sim non sceglie: esegue l\'A/B che falsificherebbe ciascuna. Ipotesi e previsioni sono del designer.');
  L.push('');
  const survivors = [];
  for (const { h, row } of results) {
    const v = verdict(h, row);
    if (v.ok !== false) survivors.push(h.nome);
    L.push(`IPOTESI: ${h.nome}`);
    L.push(`  esperimento:  ${h.intervento.label}`);
    L.push(`  previsione:   "${h.indicatore}" → ${h.verso}`);
    L.push(`  esito:        ${v.ok === false ? '✖ FALSIFICATA' : v.ok === true ? '✔ regge (non falsificata)' : '· inconcludente'} — ${v.nota}`);
    L.push('');
  }
  if (survivors.length > 1) L.push(`ESITO: ${survivors.length} modelli ancora compatibili (${survivors.join(' · ')}). Dati insufficienti per preferirne uno — serve un altro esperimento discriminante.`);
  else if (survivors.length === 1) L.push(`ESITO: sopravvive un solo modello — ${survivors[0]}. Gli altri sono stati falsificati dai dati.`);
  else L.push('ESITO: tutti i modelli proposti falsificati. Nessuno spiega i dati: serve una nuova ipotesi.');
  L.push('(un modello che "regge" NON è dimostrato vero: è solo non ancora falsificato. Un "inconcludente" chiede più partite.)');
  return L.join('\n');
}

// ===== STABILITÀ — il "dunque": questo gioco assomiglia al gioco che VUOI? =====
// La stabilità non è assoluta: dipende dal gioco che vuoi ottenere. Nessuna spec "ufficiale":
// si sceglie (o si deriva da partite che piacciono) un PROFILO DI DESIGN, e il simulatore misura
// la distanza da quel profilo. Linguaggio descrittivo, mai normativo: un gioco lontano dal profilo
// può essere ottimo — è solo un altro gioco.
export const DESIGN_PROFILES = {
  classico:    { label: 'Classico',    durata: [30, 35], minStrategie: 3, maxWinStrategia: 0.45, minTagliaShare: 0.15, maxGapUltimo: 25, maxIgnorato: 0.70 },
  economico:   { label: 'Economico',   durata: [25, 30], minStrategie: 2, maxWinStrategia: 0.50, minTagliaShare: 0.25, maxGapUltimo: 30, maxIgnorato: 0.70 },
  interattivo: { label: 'Interattivo', durata: [20, 30], minStrategie: 3, maxWinStrategia: 0.40, minTagliaShare: 0.10, maxGapUltimo: 20, maxIgnorato: 0.50 },
};

const SIZE_LABEL = { small: 'piccole', medium: 'medie', large: 'grandi' };

// indicatori grezzi condivisi da evalStability e profileFrom
function measureIndicators(games, nPlayers) {
  const ok = games.filter(g => !g.failed);
  const P = nPlayers, n = ok.length;
  if (!n) return null;
  const dur = avg(ok.map(g => g.turns));
  const agg = Object.fromEntries(STRATS.map(s => [s, { n: 0, w: 0 }]));
  for (const g of ok) for (let s = 0; s < P; s++) { const st = classify(g, s); agg[st].n++; if (s === g.winner) agg[st].w++; }
  const tot = n * P;
  const compList = STRATS.filter(s => s !== 'Nessuna commessa' && agg[s].n / tot >= 0.10 && agg[s].n && agg[s].w / agg[s].n >= 0.15);
  const wrs = STRATS.filter(s => agg[s].n >= 20).map(s => agg[s].w / agg[s].n);
  const maxWr = wrs.length ? Math.max(...wrs) : 0;
  const bySize = { small: 0, medium: 0, large: 0 }; let ct = 0;
  for (const g of ok) for (const c of g.completions) { bySize[c.size]++; ct++; }
  const shares = Object.fromEntries(Object.entries(bySize).map(([k, v]) => [k, v / (ct || 1)]));
  const rarest = Object.keys(shares).reduce((a, b) => (shares[b] < shares[a] ? b : a));
  const gap = avg(ok.map(g => g.results[0].total - g.results.at(-1).total));
  const SYS = [
    ['Servizi', (g, s) => (g.nodeVisits[s].Servizi || 0) > 0],
    ['Sindacato', (g, s) => (g.nodeVisits[s].Sindacato || 0) > 0],
    ['Borsa', (g, s) => (g.nodeVisits[s].Borsa || 0) > 0],
    ['Direzione', (g, s) => g.cards[s].dirSopra + g.cards[s].dirSotto > 0],
  ];
  const ignored = SYS.map(([name, used]) => { let z = 0; for (const g of ok) for (let s = 0; s < P; s++) if (!used(g, s)) z++; return { name, share: z / tot }; });
  const worst = ignored.reduce((a, b) => (b.share > a.share ? b : a));
  // indicatori estesi per fenomeni e salute
  const actTot = {}; let actSum = 0;
  for (const g of ok) for (const a of g.actions) { actTot[a.cat] = (actTot[a.cat] || 0) + 1; actSum++; }
  const actShares = Object.fromEntries(HEAT_COLS.map(c => [c, (actTot[c] || 0) / (actSum || 1)]));
  const weakCats = HEAT_COLS.filter(c => actShares[c] <= 0.10);
  const allEcon = ok.flatMap(g => g.econ);
  const coinsFinal = avg(allEcon.map(e => e.final));
  const unused = coinsFinal / (avg(allEcon.map(e => e.start + e.gained)) || 1);
  const resProd = ok.reduce((a, g) => a + g.resGen.reduce((x, r) => x + SECTORS.reduce((y, sc) => y + (r[sc] || 0), 0), 0), 0);
  // vero spreco: nessun valore estratto in nessuna forma (né commesse, né vendita/scambio, né conversione finale) —
  // NON la quota "non arriva a commessa": quella include vendita/scambio, un canale di valore legittimo.
  const trueWasteAmt = ok.reduce((a, g) => a + g.resFinalByType.reduce((x, rb) => x + Object.values(rb).reduce((y, n) => y + (n % (g.resPerPV || 2)), 0), 0), 0);
  const wasteShare = resProd ? trueWasteAmt / resProd : 0;
  const allDir = ok.flatMap(g => g.cards);
  const dirSottoZero = allDir.filter(c => c.dirSotto === 0).length / (allDir.length || 1);
  // "piena" = al cap configurato, non il 2 storico: col cap a 3 il >=2 diceva "piena" a chi aveva uno slot libero
  const dirSopraCap = ok[0]?.slots?.direzione?.sopra ?? 3;
  const dirSopraFull = allDir.filter(c => c.dirSopra >= dirSopraCap).length / (allDir.length || 1);
  const wins = Array.from({ length: P }, (_, s) => ok.filter(g => g.results[0].playerId === s).length / n);
  const spread = Math.max(...wins) - Math.min(...wins);
  const turns = ok.map(g => g.turns);
  const cvTurns = avg(turns) ? sdev(turns) / avg(turns) : 0;
  const allT = ok.flatMap(g => g.tracks);
  const abandoned = allT.map(t => Math.min(...t.pos)).filter(x => x <= 4).length / (allT.length || 1);
  return { n, dur, compList, maxWr, shares, rarest, gap, ignored, worst, actShares, weakCats, coinsFinal, unused, wasteShare, dirSottoZero, dirSopraFull, wins, spread, cvTurns, abandoned };
}

// Compatibilità di un batch con un profilo. Per ogni criterio: centrato/fuori, valore misurato,
// distanza relativa dal bersaglio (per le priorità) e DOVE intervenire (non come).
export function evalStability(games, nPlayers, profile) {
  const m = measureIndicators(games, nPlayers);
  if (!m) return { crit: [], met: 0, n: 0, vicinanza: 0, m: null };
  const crit = [];
  const add = (label, ok, value, dist, fix) => crit.push({ label, ok, value, dist: ok ? 0 : Math.max(0, dist), fix });
  const [lo, hi] = profile.durata;
  add(`durata ${lo}-${hi} round`, m.dur >= lo && m.dur <= hi, m.dur.toFixed(1),
    m.dur < lo ? (lo - m.dur) / lo : (m.dur - hi) / hi, m.dur < lo ? 'aumentare la durata' : 'ridurre la durata');
  add(`≥${profile.minStrategie} strategie competitive (campo ≥10%, win ≥15%)`, m.compList.length >= profile.minStrategie, `${m.compList.length} (${m.compList.join(', ') || '—'})`,
    (profile.minStrategie - m.compList.length) / profile.minStrategie, `rendere competitiva una ${m.compList.length + 1}ª strategia`);
  add(`nessuna strategia >${pct(profile.maxWinStrategia)} win`, m.maxWr <= profile.maxWinStrategia, `max ${pct(m.maxWr)}`,
    (m.maxWr - profile.maxWinStrategia) / profile.maxWinStrategia, 'indebolire la strategia dominante');
  const minShare = Math.min(...Object.values(m.shares));
  add(`nessuna taglia <${pct(profile.minTagliaShare)} dei completamenti`, minShare >= profile.minTagliaShare, Object.entries(m.shares).map(([k, v]) => `${SIZE_LABEL[k]} ${pct(v)}`).join(' · '),
    (profile.minTagliaShare - minShare) / profile.minTagliaShare, `aumentare la presenza delle ${SIZE_LABEL[m.rarest]}`);
  add(`ultimo entro ${profile.maxGapUltimo} PV dal primo`, m.gap <= profile.maxGapUltimo, m.gap.toFixed(1),
    (m.gap - profile.maxGapUltimo) / profile.maxGapUltimo, 'ridurre il distacco dell\'ultimo');
  add(`nessun sistema ignorato dal >${pct(profile.maxIgnorato)} dei giocatori`, m.worst.share <= profile.maxIgnorato, m.ignored.map(i => `${i.name} ${pct(i.share)}`).join(' · '),
    (m.worst.share - profile.maxIgnorato) / (profile.maxIgnorato || 1), `reintegrare ${m.worst.name}`);
  const met = crit.filter(c => c.ok).length;
  const vicinanza = avg(crit.map(c => 1 - Math.min(1, c.dist)));
  return { crit, met, n: crit.length, vicinanza, m };
}

// "Questa è la partita che voglio": deriva un profilo da un batch che ti piace — bande attorno all'osservato.
export function profileFrom(games, nPlayers, label = 'derivato') {
  const m = measureIndicators(games, nPlayers);
  if (!m) return null;
  const minShare = Math.min(...Object.values(m.shares));
  return {
    label,
    durata: [Math.floor(m.dur - 2), Math.ceil(m.dur + 2)],
    minStrategie: Math.max(1, m.compList.length),
    maxWinStrategia: Math.min(0.9, Math.round((m.maxWr + 0.10) * 100) / 100),
    minTagliaShare: Math.max(0.03, Math.round((minShare - 0.05) * 100) / 100),
    maxGapUltimo: Math.ceil(m.gap + 5),
    maxIgnorato: Math.min(0.9, Math.round((m.worst.share + 0.15) * 100) / 100),
  };
}

// "Perché non coincide": priorità per distanza relativa; impatto = quota dello scarto totale.
function whyNot(ev) {
  const off = ev.crit.filter(c => !c.ok && c.dist > 0).sort((a, b) => b.dist - a.dist);
  if (!off.length) return ['Il profilo è raggiunto: nessuno scarto da spiegare.'];
  const totD = off.reduce((a, c) => a + c.dist, 0);
  const L = ['— PERCHÉ NON COINCIDE (priorità: dove intervenire, non come) —'];
  off.slice(0, 3).forEach((c, i) => L.push(`${i + 1}. ${c.fix} (impatto stimato ${pct(c.dist / totD)} dello scarto)`));
  if (off.length > 3) L.push(`Le altre ${off.length - 3} differenze sono marginali.`);
  L.push('(per il COME: leverMap/leverSweep sui parametri candidati)');
  return L;
}

// Diagnosi: compatibilità col profilo + fragilità per parametro (perturbazioni ±1) + priorità.
// Fragilità = criteri che CAMBIANO STATO (×2: la natura del gioco cambia) + deriva media delle metriche.
// perts: [{ param, steps: [{ label, cfg }] }] — tipicamente i due passi −1/+1 del parametro.
export async function stabilityReport(baseCfg, perts, profile, onProgress = () => {}, isCancelled = () => false) {
  const seedBase = baseCfg.seedBase ?? Math.floor(Math.random() * 100000);
  const nGames = baseCfg.nGames;
  const nTot = (perts.reduce((a, p) => a + p.steps.length, 0) + 1) * nGames;
  let done = 0;
  const gamesBase = await runBatch({ ...baseCfg, seedBase }, d => onProgress(done + d, nTot), isCancelled);
  done += nGames;
  const baseEval = evalStability(gamesBase, baseCfg.nPlayers, profile);
  const out = [];
  for (const p of perts) {
    let flips = 0, drift = 0; const det = [];
    for (const st of p.steps) {
      if (isCancelled()) break;
      const games = await runBatch({ ...st.cfg, seedBase, nGames, nPlayers: baseCfg.nPlayers }, d => onProgress(done + d, nTot), isCancelled);
      done += nGames;
      const ev = evalStability(games, baseCfg.nPlayers, profile);
      const f = ev.crit.filter((c, i) => c.ok !== baseEval.crit[i]?.ok);
      const live = diffMetrics(gamesBase, games).filter(r => !r.thin);
      const ms = live.length ? live.reduce((a, r) => a + r.stars, 0) / live.length : 0;
      flips = Math.max(flips, f.length); drift = Math.max(drift, ms);
      det.push(`  ${st.label.padEnd(24)}: ${f.length ? `${f.length} criteri cambiano stato (${f.map(c => c.label.split(' ')[0]).join(', ')})` : 'nessun criterio cambia'} · deriva ${ms.toFixed(2)}`);
    }
    out.push({ param: p.param, frag: Math.min(5, flips * 2 + Math.round(drift)), det });
  }
  out.sort((a, b) => b.frag - a.frag);

  const L = [];
  L.push(`OFFICINA 1907 — DIAGNOSI DI PROFILO — profilo "${profile.label ?? 'custom'}" · baseline + ${perts.length} parametri perturbati ±1 × ${nGames} partite (seed appaiati)`);
  L.push('Il profilo descrive il gioco che VUOI. La diagnosi misura la distanza, non giudica: un gioco lontano dal profilo può essere ottimo — è solo un altro gioco.');
  L.push('');
  L.push(`— COMPATIBILITÀ COL PROFILO "${profile.label ?? 'custom'}" (baseline) —`);
  for (const c of baseEval.crit) L.push(`${c.ok ? '✓' : '✗'} ${c.label.padEnd(52)} → ${c.value}`);
  const bars = Math.round(baseEval.vicinanza * 6);
  L.push(`Profilo raggiunto: ${baseEval.met}/${baseEval.n} · vicinanza ${'█'.repeat(bars)}${'░'.repeat(6 - bars)} ${pct(baseEval.vicinanza)}`);
  L.push('');
  L.push(...whyNot(baseEval));
  L.push('');
  L.push('— FRAGILITÀ PER PARAMETRO (peggiore dei due versi · criteri che cambiano stato ×2 + deriva) —');
  for (const o of out) {
    L.push(`${'█'.repeat(o.frag)}${'░'.repeat(5 - o.frag)}  ${o.param.padEnd(26)} ${o.frag >= 4 ? 'instabile' : o.frag >= 2 ? 'moderata' : 'stabile'}`);
    L.push(...o.det);
  }
  L.push('');
  const fragile = out.filter(o => o.frag >= 4);
  if (baseEval.met === baseEval.n && !fragile.length) L.push('DIAGNOSI: il gioco coincide col profilo ed è robusto alle perturbazioni testate.');
  else if (baseEval.met === baseEval.n) L.push(`DIAGNOSI: il gioco coincide col profilo ma è delicato su: ${fragile.map(o => o.param).join(' · ')} — piccoli ritocchi lì possono farlo uscire dal profilo.`);
  else L.push(`DIAGNOSI: vicinanza ${pct(baseEval.vicinanza)} — le priorità sopra dicono dove intervenire; la fragilità dice quali parametri maneggiare con cura mentre lo fai.`);
  L.push('(robustezza = rispetto alle perturbazioni TESTATE intorno a questo baseline, non garanzia globale)');
  return L.join('\n');
}

// ===== FENOMENI — diagnosi per problemi, non per sistemi =====
// Libreria hand-authored: ogni regola combina più indizi in una diagnosi 🟡 (pattern su correlazioni,
// non causa dimostrata). Le "leve probabili" sono ipotesi da verificare con leverMap/leverSweep;
// gli "esperimenti suggeriti" sono candidati A/B, non raccomandazioni.
// Campi: bene = verso in cui il valore migliora ('giu'|'su') · unit per lo storico.
const PHENOMENA = [
  {
    id: 'produzione-dominante', nome: 'La Produzione monopolizza il costo-opportunità', bene: 'giu', unit: '%',
    test: m => m.actShares.Produzione >= 0.35,
    valore: m => m.actShares.Produzione,
    forza: m => Math.min(5, 2 + Math.round((m.actShares.Produzione - 0.35) * 20) + (m.weakCats.length ? 1 : 0)),
    indizi: m => [`Produzione ${pct(m.actShares.Produzione)} delle azioni`, ...m.weakCats.map(c => `${c} ${pct(m.actShares[c])}`), `Direzione Sotto a 0 carte: ${pct(m.dirSottoZero)}`],
    leve: ['potenza Produzione', 'costo Produzione', 'valore Servizi', 'valore Macchinari'],
  },
  {
    id: 'economia-sovrabbondante', nome: 'Economia sovrabbondante: si accumula più di quanto si spende', bene: 'giu', unit: '%',
    test: m => m.unused >= 0.30 || m.wasteShare >= 0.30,
    valore: m => Math.max(m.unused, m.wasteShare),
    forza: m => Math.min(5, 1 + Math.round(4 * Math.max(m.unused, m.wasteShare))),
    indizi: m => [`${pct(m.unused)} dei marchi resta inutilizzato`, `${pct(m.wasteShare)} delle risorse non diventa commessa`, `marchi finali medi ${m.coinsFinal.toFixed(1)}`],
    leve: ['conversione finale (m/PV)', 'costi (lavoratori, Direzione, movimento)', 'premi in marchi dei tracciati', 'mercato commesse'],
  },
  {
    id: 'direzione-sbilanciata', nome: 'Direzione sbilanciata: Sopra obbligata, Sotto ignorato', bene: 'giu', unit: '%',
    test: m => m.dirSopraFull >= 0.70 && m.dirSottoZero >= 0.60,
    valore: m => m.dirSottoZero,
    forza: m => Math.min(5, Math.round(2 + 2 * m.dirSottoZero + (m.dirSopraFull >= 0.9 ? 1 : 0))),
    indizi: m => [`Direzione Sopra piena nel ${pct(m.dirSopraFull)} dei casi`, `Direzione Sotto a 0 carte nel ${pct(m.dirSottoZero)}`],
    leve: ['costo dei Macchinari', 'potenza (usi / risorse per uso)', 'timing (quando conviene installarli)', 'accessibilità (copie nel mazzo, mercato)'],
  },
  {
    id: 'taglia-marginalizzata', nome: 'Una taglia di commesse è marginalizzata', bene: 'su', unit: '%',
    test: m => Math.min(...Object.values(m.shares)) < 0.15,
    valore: m => Math.min(...Object.values(m.shares)),
    forza: m => Math.min(5, 2 + Math.round((0.15 - Math.min(...Object.values(m.shares))) * 20)),
    indizi: m => [Object.entries(m.shares).map(([k, v]) => `${SIZE_LABEL[k]} ${pct(v)}`).join(' · '), `taglia più rara: ${SIZE_LABEL[m.rarest]}`],
    leve: ['PV della taglia rara', 'gate milestone per taglia', 'composizione del mercato commesse'],
  },
  {
    id: 'tracciati-usa-e-getta', nome: 'Tracciati usa-e-getta: si corre a una milestone e si abbandona il resto', bene: 'giu', unit: '%',
    test: m => m.abandoned >= 0.40,
    valore: m => m.abandoned,
    forza: m => Math.min(5, 1 + Math.round(4 * m.abandoned)),
    indizi: m => [`${pct(m.abandoned)} dei giocatori abbandona un tracciato (pos ≤4)`, `milestone raggiunte: terziario/secondario/primario variabili (vedi Bilanciamento)`],
    leve: ['payoff post-milestone', 'posizione milestone', 'caselle PV sui tracciati'],
  },
  {
    id: 'monocultura-strategica', nome: 'Monocultura strategica: meno di 3 strade competitive', bene: 'su', unit: '',
    test: m => m.compList.length < 3,
    valore: m => m.compList.length,
    forza: m => Math.min(5, 5 - m.compList.length),
    indizi: m => [`strategie competitive: ${m.compList.length} (${m.compList.join(', ') || '—'})`, `winrate massimo per strategia: ${pct(m.maxWr)}`],
    leve: ['gate per taglia (aprono strade diverse)', 'economia (rende competitivo l\'accumulo)', 'timing commesse'],
  },
  {
    id: 'vantaggio-di-posto', nome: 'Vantaggio di posto: l\'ordine di turno pesa troppo', bene: 'giu', unit: '%',
    test: m => m.spread >= 0.20,
    valore: m => m.spread,
    forza: m => Math.min(5, 1 + Math.round(m.spread * 10)),
    indizi: m => [`vittorie per posto: ${m.wins.map(pct).join('/')}`, `spread ${pct(m.spread)}`],
    leve: ['marchi iniziali per posto', 'ordine nel round', 'primo accesso ai mercati'],
  },
];

// Grafo causale IPOTIZZATO tra fenomeni (hand-authored, 🟡): radice → effetto, con motivazione.
// Non è conoscenza dimostrata: è l'ipotesi migliore compatibile coi dati, che un A/B può demolire.
const PHEN_EDGES = [
  { da: 'produzione-dominante', a: 'economia-sovrabbondante', perche: 'si produce oltre la domanda delle commesse', falsifica: 'se abbassando la Produzione l\'accumulo resta invariato → teoria respinta' },
  { da: 'produzione-dominante', a: 'direzione-sbilanciata', perche: 'il costo-opportunità va in lavoratori/attivazioni: i Macchinari non entrano mai nella spesa', falsifica: 'se aumentando il valore dei Macchinari la Direzione cambia senza toccare la Produzione → la Produzione non era la radice' },
  { da: 'economia-sovrabbondante', a: 'direzione-sbilanciata', perche: 'la spesa non trova sbocchi competitivi: i Macchinari sono lo sbocco che perde', falsifica: 'se drenando i marchi (conversione/costi) il Sotto resta ignorato → teoria respinta' },
  { da: 'taglia-marginalizzata', a: 'monocultura-strategica', perche: 'sparita una taglia, spariscono le strade che ci si appoggiano', falsifica: 'se riequilibrando le taglie la varietà strategica non cambia → teoria respinta' },
];

// Applica le regole agli indicatori → fenomeni attivi con valore/forza/indizi calcolati.
export function detectPhenomena(m) {
  if (!m) return [];
  return PHENOMENA.filter(p => p.test(m)).map(p => ({
    id: p.id, nome: p.nome, bene: p.bene, unit: p.unit,
    v: p.valore(m), forza: Math.max(1, Math.min(5, p.forza(m))),
    indizi: p.indizi(m), leve: p.leve,
  }));
}

// Salute 0-100 per area (definizioni operative dichiarate nel report).
export function healthScores(m) {
  const clamp = x => Math.max(0, Math.min(100, Math.round(x)));
  return {
    Economia: clamp(100 * (1 - Math.min(1, (m.unused + m.wasteShare) / 2 / 0.5))),
    Varietà: clamp(100 * Math.min(1, m.compList.length / 3) * (m.maxWr > 0.45 ? 0.45 / m.maxWr : 1)),
    Mercato: clamp(100 * Math.min(1, Math.min(...Object.values(m.shares)) * 3)),
    Durata: clamp(100 * (1 - Math.min(1, m.cvTurns / 0.3))),
    Direzione: clamp(100 * (1 - m.dirSottoZero)),
    Equità: clamp(100 * (1 - Math.min(1, m.spread / 0.3))),
  };
}

// Storico dei fenomeni: il gioco confrontato con sé stesso nel tempo.
// Persiste in localStorage (browser); in node degrada a vuoto — i probe possono passare/salvare il JSON da soli.
const HISTORY_KEY = 'officina1907-fenomeni-v1';
export function loadPhenomenaHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } }
export function savePhenomenaHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-50))); } catch { /* niente storage: no-op */ } }
export function clearPhenomenaHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch { /* no-op */ } }

// Esegue N partite cedendo il controllo alla UI tra una e l'altra.
export async function runBatch(cfg, onProgress, isCancelled) {
  const games = [];
  const seedBase = cfg.seedBase ?? Math.floor(Math.random() * 100000);
  for (let g = 0; g < cfg.nGames; g++) {
    if (isCancelled()) break;
    // initGame ignora le chiavi che non conosce (nGames/nPlayers/seedBase): spread di tutto il cfg.
    const tel = runOneGame({
      ...cfg,
      headless: true, // niente log di partita: cloni più leggeri, telemetria invariata
      seed: seedBase + g,
      players: Array.from({ length: cfg.nPlayers }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
    });
    games.push(tel);
    onProgress(g + 1, cfg.nGames);
    await new Promise(r => setTimeout(r, 0));
  }
  return games;
}
