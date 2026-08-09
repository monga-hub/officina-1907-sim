// Net Race Value (metodo utente 09/08/2026, punto #13): rendimento NETTO dell'inseguire una singola race.
// Per ogni race ISOLATA (una alla volta) e ogni livello di incentivo, confronta a parità di seed il chaser
// (chi ha investito di più in quella race) con lo STESSO posto nella run a incentivo 0.
//   Net Race Value = PV totale con incentivo − PV totale del medesimo posto a incentivo 0
//   Costo opportunità = PV di gara ottenuti − Net Race Value  (quanto sacrifica altrove per il premio)
// Discrimina: scommessa (net>0, <racePV) · opportunistica (net≈racePV) · trappola (net<0 o net≪racePV).
// Uso: node scripts/race-net-value.js [nGames] [nPlayers]
import fs from 'node:fs';
import { runOneGame } from '../src/game/batchsim.js';

const N = parseInt(process.argv[2] || '60', 10);
const nPlayers = parseInt(process.argv[3] || '4', 10);
const LEVELS = [0, 2, 4, 8];
const SEED0 = 9000;

const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const RACES = [
  { id: 'race_same', type: 'sopra_same_nation', n: 3, label: 'A · 3 stessa nazionalità' },
  { id: 'race_dist', type: 'sopra_distinct_nations', n: 4, label: 'B · 4 nazionalità diverse' },
  { id: 'race_each', type: 'sopra_each_sector', n: 2, label: 'C · 2 per reparto' },
];
const players = Array.from({ length: nPlayers }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true }));
const pct = x => (100 * x).toFixed(0) + '%';
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

console.log(`Net Race Value — ${N} partite/livello, ${nPlayers} giocatori (base attesa win ${pct(1 / nPlayers)}), seed ${SEED0}..${SEED0 + N - 1}`);
console.log('Chaser = giocatore con più PV di gara. Net = PVtot(chaser@L) − PVtot(stesso posto@0). Opp.cost = PVrace − Net.\n');

for (const race of RACES) {
  // per la race ISOLATA: solo questo obiettivo attivo → il baseline (incentivo 0) isola il suo effetto
  const byLevel = {};
  for (const L of LEVELS) {
    const games = [];
    for (let i = 0; i < N; i++) {
      games.push(runOneGame({
        ...bl, nPlayers, players,
        raceObjectives: { enabled: true, podium: [7, 5, 3], list: [{ id: race.id, type: race.type, n: race.n, enabled: true }] },
        raceIncentive: L, raceCausality: L > 0,
        seed: SEED0 + i, headless: true,
      }));
    }
    byLevel[L] = games;
  }
  const base = byLevel[0];

  console.log(`### Race ${race.label}`);
  console.log('inc | %compl | deviaz | costo | PVrace | PVtot chaser | Net vs base | opp.cost | Win% chaser | n');
  console.log('----|--------|--------|-------|--------|--------------|-------------|----------|-------------|---');
  for (const L of LEVELS) {
    const games = byLevel[L];
    const completed = games.filter(g => g.race.list[0].claims.length).length;
    // chaser per partita = seat con più PV di gara (>0)
    const rows = games.map((g, i) => {
      const chaser = g.results.reduce((a, b) => ((b.pvRace || 0) > (a.pvRace || 0) ? b : a));
      if (!(chaser.pvRace > 0)) return null;
      const at0 = base[i].results.find(r => r.playerId === chaser.playerId);
      const net = chaser.total - (at0 ? at0.total : chaser.total);
      return { racePV: chaser.pvRace, total: chaser.total, net, win: chaser.playerId === g.results[0].playerId ? 1 : 0 };
    }).filter(Boolean);
    // deviazione/costo dal contrafattuale per-decisione (solo L>0; single race → aggregato = per-race)
    let deviaz = '—', costo = '—';
    if (L > 0) {
      const hd = games.reduce((a, g) => a + (g.raceCausal?.hireDecisions || 0), 0);
      const hc = games.reduce((a, g) => a + (g.raceCausal?.hireChanged || 0), 0);
      const ch = games.reduce((a, g) => a + (g.raceCausal?.changed || 0), 0);
      const cs = games.reduce((a, g) => a + (g.raceCausal?.costSum || 0), 0);
      deviaz = pct(hc / (hd || 1));
      costo = ch ? (cs / ch).toFixed(2) : '0.00';
    }
    const racePV = avg(rows.map(r => r.racePV));
    const tot = avg(rows.map(r => r.total));
    const net = L > 0 ? avg(rows.map(r => r.net)) : 0;
    const opp = L > 0 ? racePV - net : 0;
    const win = avg(rows.map(r => r.win));
    const netTxt = L > 0 ? (net >= 0 ? '+' : '') + net.toFixed(1) : 'baseline';
    const oppTxt = L > 0 ? opp.toFixed(1) : '—';
    console.log(`${String(L).padStart(3)} | ${pct(completed / games.length).padStart(6)} | ${String(deviaz).padStart(6)} | ${String(costo).padStart(5)} | ${racePV.toFixed(2).padStart(6)} | ${tot.toFixed(1).padStart(12)} | ${netTxt.padStart(11)} | ${oppTxt.padStart(8)} | ${pct(win).padStart(11)} | ${String(rows.length).padStart(2)}`);
  }
  console.log('');
}
console.log('Lettura: Net≈PVrace → quasi gratis (opportunistica) · 0<Net<PVrace → scommessa costosa · Net≤0 → trappola.');
console.log('Caveat: il chaser è selezionato sull\'esito (chi ha più PVrace@L); il confronto contiene selezione di popolazione,');
console.log('il baseline @0 congela il seed ma non la traiettoria degli altri. Segnale di direzione, non stima puntuale.');
