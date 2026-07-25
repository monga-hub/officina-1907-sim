// Report narrativo della SINGOLA partita: la racconta, non la archivia.
// Tutto derivato dallo stato finale (state.results, state.players, state.log) — nessuna modifica al motore.
// Consumato da EndScreen.jsx (UI + testo copiabile). Aggregato multi-partita = batchsim.js (resta scientifico).
import { SECTORS } from './data.js';
import { factoryMajorityWinner } from './engine.js';

const SIZE_F = { small: 'piccola', medium: 'media', large: 'grande' };
const firstContractTurn = p => { const t = p.contractsWon.map(c => c.turn).filter(Boolean); return t.length ? Math.min(...t) : null; };
const nthFactoryTurn = (p, n) => { const t = (p.factories || []).map(f => f.turn).filter(Boolean).sort((a, b) => a - b); return t.length >= n ? t[n - 1] : null; };

// Efficienza economica: quanto un giocatore ha CONVERTITO produzione in punti (non solo accumulato).
export function economy(p) {
  const resProd = SECTORS.reduce((a, s) => a + (p.resGen?.[s] || 0), 0);
  const resSpent = SECTORS.reduce((a, s) => a + (p.resSpent?.[s] || 0), 0);
  const gained = p.coinsGained || 0;
  const spent = (p.coinsStart || 0) + gained - p.coins; // marchi spesi = iniziali + guadagnati − finali
  const nc = p.contractsWon.length;
  const per = x => (nc > 0 ? (x / nc).toFixed(1) : '—');
  // cadenza commesse: sequenza dei turni + gap (la media sola inganna con 2-3 commesse)
  const turns = p.contractsWon.map(c => c.turn).filter(Boolean).sort((a, b) => a - b);
  const gaps = turns.slice(1).map((t, i) => t - turns[i]);
  const span = turns.length ? `t${turns[0]}${turns.length > 1 ? `→t${turns[turns.length - 1]}` : ''}` : '—';
  const seqStr = turns.length ? turns.map(t => 't' + t).join('→') : '—';
  const gapStr = gaps.length ? gaps.join('/') : '—';
  return {
    resProd, resSpent, effRes: resProd > 0 ? Math.round((100 * resSpent) / resProd) : 0,
    gained, spent, final: p.coins, prod: p.activations, nc,
    prodPerC: per(p.activations), resPerC: per(resProd), resPerCNum: nc > 0 ? resProd / nc : 0, span, seqStr, gapStr,
    start: p.coinsStart || 0,
    by: p.coinsSpentBy || { lavoratori: 0, direzione: 0, sindacato: 0, borsa: 0, movimento: 0 },
  };
}

// 1. STORIA — 4-6 righe che dicono cosa ha reso interessante QUESTA partita.
export function buildStory(state) {
  const r = state.results, players = state.players, T = state.turn, S = [];
  const byPlayer = r.map(x => players[x.playerId]);
  // apertura: prima commessa in assoluto sul tavolo
  const opener = byPlayer.map(p => ({ p, t: firstContractTurn(p) })).filter(x => x.t != null).sort((a, b) => a.t - b.t)[0];
  if (opener) {
    const c0 = opener.p.contractsWon.filter(c => c.turn === opener.t)[0];
    S.push(`${opener.p.name} apre per primo con una commessa ${SIZE_F[c0?.size] || ''} al turno ${opener.t}.`);
  }
  // motore migliore: più commesse (tie-break meno risorse/commessa)
  const eng = byPlayer.map(p => ({ p, nc: p.contractsWon.length, e: economy(p) }))
    .sort((a, b) => b.nc - a.nc || a.e.resPerCNum - b.e.resPerCNum)[0];
  if (eng && eng.nc >= 3 && eng.p !== opener?.p) S.push(`${eng.p.name} costruisce il motore più prolifico: ${eng.nc} commesse completate.`);
  // ritardatario: prima commessa molto tardiva
  const lag = byPlayer.map(p => ({ p, t: firstContractTurn(p) })).sort((a, b) => (b.t ?? 999) - (a.t ?? 999))[0];
  if (lag && lag.t != null && lag.t > 0.4 * T) S.push(`${lag.p.name} resta indietro a lungo: prima commessa solo al turno ${lag.t}.`);
  else if (lag && lag.t == null) S.push(`${lag.p.name} chiude senza completare nessuna commessa.`);
  // finale: grandi commesse del vincitore nell'ultimo terzo
  const win = players[r[0].playerId];
  const bigLate = win.contractsWon.filter(c => c.size === 'large' && c.turn && c.turn > 0.6 * T).sort((a, b) => a.turn - b.turn);
  if (bigLate.length) S.push(`Nel finale ${win.name} chiude ${bigLate.length === 1 ? 'una grande' : bigLate.length + ' grandi'} (${bigLate.map(c => 't' + c.turn).join(', ')}) e tiene il vantaggio.`);
  // troppo tardi: un altro completa una grande sul filo di lana
  const other = r.slice(1).map(x => players[x.playerId])
    .map(p => ({ p, c: p.contractsWon.filter(c => c.size === 'large' && c.turn).sort((a, b) => b.turn - a.turn)[0] }))
    .filter(x => x.c && x.c.turn > 0.9 * T).sort((a, b) => b.c.turn - a.c.turn)[0];
  if (other) S.push(`${other.p.name} completa una grande al turno ${other.c.turn}, ma ormai è tardi.`);
  return S;
}

// 2. MOMENTI DECISIVI — timeline sintetica, solo eventi con un turno.
export function buildEvents(state) {
  const players = state.players, E = [];
  const allC = players.flatMap(p => p.contractsWon.map(c => ({ ...c, name: p.name })));
  const firstAny = allC.filter(c => c.turn).sort((a, b) => a.turn - b.turn)[0];
  if (firstAny) E.push(`prima commessa completata: t${firstAny.turn} (${firstAny.name}, ${SIZE_F[firstAny.size]})`);
  const larges = allC.filter(c => c.size === 'large' && c.turn).sort((a, b) => a.turn - b.turn);
  if (larges.length) { E.push(`prima grande commessa: t${larges[0].turn} (${larges[0].name})`); E.push(`ultima grande commessa: t${larges[larges.length - 1].turn} (${larges[larges.length - 1].name})`); }
  const firstFactory = players.flatMap(p => (p.factories || []).map(f => ({ ...f, name: p.name }))).filter(f => f.turn).sort((a, b) => a.turn - b.turn)[0];
  if (firstFactory) E.push(`prima fabbrica fondata: t${firstFactory.turn} (${firstFactory.name})`);
  const to3 = players.map(p => ({ name: p.name, t: nthFactoryTurn(p, 3) })).filter(x => x.t != null).sort((a, b) => a.t - b.t)[0];
  if (to3) E.push(`primo a 3 fabbriche: t${to3.t} (${to3.name})`);
  // primo sciopero: dal log (best-effort, non essenziale)
  const strike = (state.log || []).find(l => /scioper/i.test(l.text));
  if (strike) E.push(`primo sciopero: t${strike.turn}`);
  return E;
}

// Timeline dei sorpassi RICOSTRUITA dai PV-commesse (unica fonte PV con turni; è anche il canale dominante).
// Serve a "punto di svolta" e "deciso presto/tardi". Il leader-per-commesse può non essere il vincitore
// finale (obiettivi/tracciati/fabbriche si contano a fine partita): quel disallineamento è di per sé un segnale.
function contractLeadTimeline(state) {
  const players = state.players;
  const evs = players.flatMap(p => p.contractsWon.filter(c => c.turn).map(c => ({ turn: c.turn, pid: p.id, name: p.name, size: c.size, pv: c.pv })))
    .sort((a, b) => a.turn - b.turn || (a.size === 'large' ? 1 : 0) - (b.size === 'large' ? 1 : 0));
  const run = Object.fromEntries(players.map(p => [p.id, 0]));
  let leader = null, lastChange = 0; const steps = [];
  for (const e of evs) {
    run[e.pid] += e.pv;
    let best = -1, who = null, second = -1;
    for (const p of players) { const v = run[p.id]; if (v > best) { second = best; best = v; who = p.id; } else if (v > second) second = v; }
    const changed = who !== leader;
    if (changed && leader !== null && best > second) lastChange = e.turn; // solo sorpasso vero (vantaggio stretto, non pareggio)
    steps.push({ ...e, leader: who, best, second, changed, mine: run[e.pid] });
    leader = who;
  }
  return { steps, lastChange, finalLeader: leader };
}

// PV da commesse per commessa completata (efficienza di conversione del motore in punti).
const pvPerContract = x => (x.nContracts > 0 ? x.pvContracts / x.nContracts : 0);

// resa: PV totali per produzione (attivazione) — quanto ogni azione di produzione è diventata punteggio.
const pvPerProd = (state, x) => { const pr = economy(state.players[x.playerId]).prod; return pr > 0 ? x.total / pr : 0; };

// 3. COSA MOSTRANO I DATI — solo osservazioni (numeri a confronto), niente interpretazioni causali.
// Il "perché" (motore migliore / timing decisivo) va in matchLesson, dichiarato come lettura, non come fatto.
export function buildDiagnosis(state) {
  const r = state.results, players = state.players, T = state.turn, D = [];
  const win = r[0], winP = players[win.playerId];
  const wReasons = [];
  // conversione PV/commessa (fatto)
  const winPpc = pvPerContract(win), othersPpc = r.slice(1).map(pvPerContract).filter(v => v > 0);
  if (winPpc > 0 && othersPpc.length) wReasons.push(`${win.nContracts} commesse a ${winPpc.toFixed(0)} PV l'una (gli altri ${Math.min(...othersPpc).toFixed(0)}–${Math.max(...othersPpc).toFixed(0)})`);
  // resa PV/produzione (fatto) — NON "motore più grande": distingue chi produce da chi converte
  const effs = r.map(x => pvPerProd(state, x)), winEff = pvPerProd(state, win);
  wReasons.push(`${economy(winP).prod} produzioni → ${win.total} PV = ${winEff.toFixed(1)} PV/produzione${winEff >= Math.max(...effs) ? ' (la resa migliore del tavolo)' : ''}`);
  // grandi nel finale (fatto, niente "quando il motore era pronto")
  const bigLate = winP.contractsWon.filter(c => c.size === 'large' && c.turn && c.turn > 0.6 * T).sort((a, b) => a.turn - b.turn);
  if (bigLate.length) wReasons.push(`${bigLate.length} grand${bigLate.length === 1 ? 'e completata' : 'i completate'} nel finale (${bigLate.map(c => 't' + c.turn).join(', ')})`);
  if ((win.pvObjectives || 0) > 0) wReasons.push(`${win.pvObjectives} PV dal Piano`);
  if ((win.pvFactoryMajority || 0) > 0) wReasons.push(`${win.pvFactoryMajority} PV da maggioranze fabbriche`);
  if ((winP.strikesByOpponent ?? 0) >= 3) wReasons.push(`${winP.strikesByOpponent} scioperi subiti`);
  D.push({ head: `${win.name} (1°) — i numeri:`, reasons: wReasons });
  // contrasto istruttivo: chi ha PRODOTTO di più, con la sua resa (fatto, non giudizio)
  if (r.length > 1) {
    const topProd = [...r].sort((a, b) => economy(players[b.playerId]).prod - economy(players[a.playerId]).prod)[0];
    if (topProd.playerId !== win.playerId) {
      const tp = players[topProd.playerId];
      D.push({ head: `${tp.name} ha prodotto di più del vincitore:`, reasons: [
        `${economy(tp).prod} produzioni → ${topProd.total} PV = ${pvPerProd(state, topProd).toFixed(1)} PV/produzione`,
        `il vincitore: ${economy(winP).prod} produzioni → ${winEff.toFixed(1)} PV/produzione — più produzioni non è più punti`,
      ] });
    } else {
      const last = r[r.length - 1], lastP = players[last.playerId], lReasons = [];
      const ft = firstContractTurn(lastP);
      if (ft == null) lReasons.push('nessuna commessa completata');
      else if (ft > 0.4 * T) lReasons.push(`prima commessa a t${ft} (oltre il 40% della partita)`);
      if (last.nContracts <= 2) lReasons.push(`${last.nContracts} commesse in tutto`);
      if (economy(lastP).final >= 20) lReasons.push(`${economy(lastP).final}ⓜ non convertiti`);
      if (lReasons.length) D.push({ head: `${lastP.name} (ultimo) — i numeri:`, reasons: lReasons });
    }
  }
  return D;
}

// 4. ANOMALIE — solo vere deviazioni ("uh."), non curiosità. 🟡 insolito · 🟢 sano notevole.
export function buildAnomalies(state) {
  const r = state.results, players = state.players, T = state.turn, A = [];
  const win = r[0];
  // vincitore con pochissime commesse
  if (win.nContracts <= 2) A.push(`🟡 ${win.name} vince con sole ${win.nContracts} commesse.`);
  // vincitore senza nessuna grande
  if (players[win.playerId].contractsWon.every(c => c.size !== 'large')) A.push(`🟡 ${win.name} vince senza chiudere una sola grande commessa.`);
  // chi fa più commesse NON vince
  const mostC = [...r].sort((a, b) => b.nContracts - a.nContracts)[0];
  if (mostC.playerId !== win.playerId && mostC.nContracts > win.nContracts) A.push(`🟡 ${mostC.name} fa più commesse di tutti (${mostC.nContracts}) ma arriva ${r.indexOf(mostC) + 1}°.`);
  for (const x of r) {
    const p = players[x.playerId], e = economy(p);
    // molte commesse ma zero obiettivi
    if (x.nContracts >= 3 && x.pvObjectives === 0) A.push(`🟡 ${p.name}: ${x.nContracts} commesse ma zero obiettivi del Piano.`);
    // arriva a metà partita senza una commessa
    const ft = firstContractTurn(p);
    if (ft != null && ft > 0.45 * T) A.push(`🟡 ${p.name} arriva a t${ft} senza una commessa.`);
    else if (ft == null) A.push(`🟡 ${p.name} chiude la partita senza nessuna commessa.`);
    // molti marchi lasciati sul tavolo
    if (e.final >= 25) A.push(`🟡 ${p.name} termina con ${e.final}ⓜ non convertiti.`);
  }
  // sano notevole
  if (r.length > 1) { const m = r[0].total - r[1].total; if (m <= 6) A.push(`🟢 Vittoria decisa da soli ${m} PV.`); }
  // dedup + cap
  return [...new Set(A)].slice(0, 6);
}

// 5. TITOLO — una frase OSSERVATIVA: dove/quando si è decisa la partita, coi numeri. Niente causa presunta.
export function matchHeadline(state) {
  const r = state.results, players = state.players, T = state.turn;
  const win = r[0], winP = players[win.playerId];
  const tl = contractLeadTimeline(state);
  const contractLeaderIsWinner = tl.finalLeader === win.playerId;
  const nFlips = tl.steps.filter((s, i) => s.changed && i > 0 && s.best > s.second).length;
  const bigLate = winP.contractsWon.filter(c => c.size === 'large' && c.turn && c.turn > 0.6 * T).sort((a, b) => a.turn - b.turn);
  const margin = r.length > 1 ? win.total - r[1].total : null;
  if (!contractLeaderIsWinner) return `A punti-commessa era davanti ${players[tl.finalLeader]?.name}; ${win.name} ha chiuso primo con ${win.pvObjectives} PV di Piano e ${win.pvFactoryMajority || 0} di maggioranze.`;
  if (nFlips >= 3) return `Leadership contesa: ${nFlips} sorpassi, ultimo a t${tl.lastChange} (${Math.round(100 * tl.lastChange / T)}% della partita)${margin != null ? `, vinta di ${margin} PV` : ''}.`;
  if (tl.lastChange > 0.7 * T && bigLate.length) return `Differenza emersa nel finale: ${win.name} chiude ${bigLate.length} grand${bigLate.length === 1 ? 'e' : 'i'} tra t${bigLate[0].turn} e t${bigLate[bigLate.length - 1].turn}.`;
  if (tl.lastChange > 0 && tl.lastChange < 0.4 * T) return `${win.name} in testa dal turno ${tl.lastChange}, mai più superato.`;
  return `${win.name} vince con ${win.total} PV${margin != null ? `, ${margin} sul 2°` : ''}.`;
}

// 8. COSA IMPARARE — l'UNICA frase interpretativa, dichiarata come tale. Ancorata ai numeri della partita.
export function matchLesson(state) {
  const r = state.results, players = state.players, T = state.turn;
  const win = r[0];
  const tl = contractLeadTimeline(state);
  const nFlips = tl.steps.filter((s, i) => s.changed && i > 0 && s.best > s.second).length;
  const ch = { comm: 0, piano: 0, trk: 0, fab: 0 };
  for (const x of r) { ch.comm += x.pvContracts; ch.piano += x.pvObjectives; ch.trk += x.pvTrack; ch.fab += x.pvFactoryMajority || 0; }
  const tot = ch.comm + ch.piano + ch.trk + ch.fab || 1;
  const bigLate = players[win.playerId].contractsWon.filter(c => c.size === 'large' && c.turn && c.turn > 0.6 * T).length;
  if (nFlips >= 3 && bigLate) return `Le grandi commesse del finale hanno ribaltato la leadership più volte: un motore efficiente non basta senza una conversione tempestiva in punti.`;
  if (ch.fab / tot >= 0.15) return `Le maggioranze territoriali hanno inciso parecchio (${ch.fab} PV, ${Math.round(100 * ch.fab / tot)}% dei PV di canale): la mappa non è un contorno.`;
  if (ch.piano / tot >= 0.30) return `Il Piano Industriale ha deciso più delle commesse (${Math.round(100 * ch.piano / tot)}% dei PV di canale).`;
  if (ch.piano / tot < 0.12) return `Il Piano Industriale ha pesato poco rispetto alle commesse (${Math.round(100 * ch.piano / tot)}% dei PV di canale).`;
  if (tl.finalLeader !== win.playerId) return `Chi guidava a punti-commessa non ha vinto: i canali secondari hanno spostato l'esito.`;
  return `Partita decisa dalle commesse, senza un canale secondario determinante.`;
}

// 6. NORMALITÀ — questa partita è rappresentativa o un'eccezione? Soglie EURISTICHE dalla baseline 75-partite
// (non un test statistico: si tarano a mano — sono la stessa cosa degli "indicatorTargets" del batch, ma per 1 partita).
const NORMAL = { winnerPV: [65, 110], winnerContracts: [3, 6], gap: [10, 55], durata: [33, 48], grandiTavolo: [2, 12] };
export function matchNormality(state) {
  const r = state.results, players = state.players, T = state.turn, reasons = [];
  const win = r[0];
  if (win.total < NORMAL.winnerPV[0]) reasons.push(`vincitore con soli ${win.total} PV (tipico ${NORMAL.winnerPV[0]}+)`);
  if (win.total > NORMAL.winnerPV[1]) reasons.push(`vincitore molto alto: ${win.total} PV`);
  if (win.nContracts < NORMAL.winnerContracts[0]) reasons.push(`vincitore con sole ${win.nContracts} commesse`);
  const grandi = players.reduce((a, p) => a + p.contractsWon.filter(c => c.size === 'large').length, 0);
  if (grandi < NORMAL.grandiTavolo[0]) reasons.push(`solo ${grandi} grandi completate sul tavolo`);
  if (r.length > 1) { const gap = win.total - r[r.length - 1].total; if (gap < NORMAL.gap[0]) reasons.push(`classifica cortissima (gap ${gap})`); if (gap > NORMAL.gap[1]) reasons.push(`gap enorme 1°-ultimo (${gap})`); }
  if (T < NORMAL.durata[0]) reasons.push(`partita corta (${T} turni)`); if (T > NORMAL.durata[1]) reasons.push(`partita lunga (${T} turni)`);
  return { level: reasons.length ? '🟡' : '🟢', label: reasons.length ? 'atipica' : 'nella norma', reasons };
}

// 7. DECISIONI CHE HANNO CAMBIATO LA PARTITA — solo i sorpassi VERI (cambio di leader), poi l'esito. Da PV-commesse.
export function matchTurningPoints(state) {
  const tl = contractLeadTimeline(state), T = state.turn, r = state.results, L = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const s = tl.steps[i];
    if (s.changed && i > 0 && s.best > s.second) L.push(`t${s.turn} · ${s.name} passa in testa con una ${SIZE_F[s.size]} (+${s.pv}) — ${s.best} vs ${s.second} PV-commesse`);
  }
  const win = r[0], margin = r.length > 1 ? win.total - r[1].total : null;
  const when = tl.lastChange === 0 ? 'chi va in testa non viene più superato' : `ultimo sorpasso a t${tl.lastChange} (${Math.round(100 * tl.lastChange / T)}% della partita)`;
  L.push(`Esito: ${win.name} vince${margin != null ? ` di ${margin} PV` : ''} — ${when}.`);
  return L;
}

// 9. CICLO DEL MOTORE — produzioni (attivazioni) spese tra una commessa e la successiva.
// Engine builder sano: la sequenza CALA (es. 6→4→3→2, ogni ciclo costa meno azioni). Piatta (5→5→5) =
// il motore non riduce il costo-in-azioni di una nuova commessa. Serve p.activationTurns (turni delle attivazioni).
export function productionCadence(state) {
  const players = state.players;
  const per = players.map(p => {
    const cs = p.contractsWon.map(c => c.turn).filter(Boolean).sort((a, b) => a - b);
    const acts = (p.activationTurns || []).slice().sort((a, b) => a - b);
    if (cs.length < 2) return { name: p.name, color: p.color, seq: [], trend: null, nc: cs.length };
    // produzioni con turno nell'intervallo (commessa i-1, commessa i]; la prima usa (avvio, c1]
    const seq = [];
    let prev = 0;
    for (const t of cs) { seq.push(acts.filter(a => a > prev && a <= t).length); prev = t; }
    // trend: confronto media prima metà vs seconda metà degli intervalli (esclude l'avvio-1ª, spesso anomalo)
    const body = seq.slice(1);
    let trend = null, delta = null;
    if (body.length >= 2) {
      const h = Math.floor(body.length / 2);
      const firstH = body.slice(0, h), lastH = body.slice(-h);
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      delta = +(avg(lastH) - avg(firstH)).toFixed(1);
      trend = delta <= -0.75 ? 'cala' : delta >= 0.75 ? 'sale' : 'piatto';
    }
    return { name: p.name, color: p.color, seq, trend, delta, nc: cs.length };
  });
  return per;
}

// 5. TELEMETRICA FABBRICHE (singola partita) — da p.factories/hexFactory/adj, non dall'aggregato batch.
export function factoryStats(state) {
  const players = state.players, mb = state.borsaFabbriche?.majorityBonus;
  const majOn = state.borsaFabbriche?.enabled && mb?.enabled;
  const hexById = state.factoryHexById || {};
  const active = new Set(state.factoryHexes || []);
  // land-grab: una fabbrica è "a contatto" se un esagono adiacente ha una fabbrica avversaria
  const adjEnemy = (hex, ownerId) => (state.factoryMap?.adj?.[hex] || []).some(n => { const f = state.hexFactory?.[n]; return f && f.playerId !== ownerId; });
  // giacimenti: vinti da qualcuno / pareggio (ha fabbriche ma nessun vincitore) / vuoto
  let won = 0, tie = 0, empty = 0;
  const wonBy = {};
  if (majOn) for (const rid of Object.keys(state.hexResource || {})) {
    const w = factoryMajorityWinner(state, rid, state.hexResource[rid]);
    const anyAdj = (state.factoryMap?.adj?.[rid] || []).some(n => state.hexFactory?.[n]);
    if (w != null) { won++; wonBy[w] = (wonBy[w] || 0) + 1; }
    else if (anyAdj) tie++; else empty++;
  }
  const perPlayer = players.map(p => {
    const facs = p.factories || [];
    const turns = facs.map(f => f.turn).filter(Boolean).sort((a, b) => a - b);
    const bySector = {}; for (const f of facs) bySector[f.sector] = (bySector[f.sector] || 0) + 1;
    const contested = facs.filter(f => adjEnemy(f.hex, p.id)).length;
    return {
      id: p.id, name: p.name, color: p.color,
      n: facs.length, turns, avgTurn: turns.length ? +(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1) : null,
      bySector, nSectors: Object.keys(bySector).length,
      creditsEarned: p.factoryCreditsEarned || 0, contested,
      giacimenti: wonBy[p.id] || 0, majPV: majOn ? (wonBy[p.id] || 0) * mb.pv : 0,
    };
  });
  // saturazione mappa: esagoni costruibili occupati / totali attivi
  const buildable = [...active].filter(id => hexById[id]?.type === 'costruibile');
  const occupied = buildable.filter(id => state.hexFactory?.[id]).length;
  const totalFac = perPlayer.reduce((a, x) => a + x.n, 0);
  const totalContested = perPlayer.reduce((a, x) => a + x.contested, 0);
  return {
    perPlayer, majOn,
    saturation: buildable.length ? occupied / buildable.length : 0, occupied, buildableTot: buildable.length,
    landGrabShare: totalFac ? totalContested / totalFac : 0,
    giacimenti: { won, tie, empty }, majPvEach: mb?.pv || 0,
  };
}
