// Test causale delle race (metodo utente 09/08/2026). Due output:
//  (1) MATRICE PER-RACE: per ogni obiettivo, riga per livello di incentivo, con descrittive + causali
//      (#7 piazzamenti race-attributable ISOLATI per singola race via contrafattuale che esclude UN obiettivo
//       alla volta, costo deviazione, claim indotti vs baseline stesso seed).
//  (2) TRAIETTORIA: come cambia l'ESITO finale (PV/win/commesse/milestone/reparti) al salire dell'incentivo.
// Uso: node scripts/race-causality.js [nGames] [nPlayers]
// NB: i livelli >0 fanno (1 + #race) chooseCommand extra per decisione → lento. Parti con N piccolo.
import fs from 'node:fs';
import { runOneGame } from '../src/game/batchsim.js';

const N = parseInt(process.argv[2] || '60', 10);
const nPlayers = parseInt(process.argv[3] || '4', 10);
const LEVELS = [0, 2, 4, 8]; // baseline / X / 2X / 4X
const SEED0 = 9000;

const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const RACES = [
  { id: 'race_same', type: 'sopra_same_nation', n: 3, enabled: true, label: 'A · 3 stessa nazionalità' },
  { id: 'race_dist', type: 'sopra_distinct_nations', n: 4, enabled: true, label: 'B · 4 nazionalità diverse' },
  { id: 'race_each', type: 'sopra_each_sector', n: 2, enabled: true, label: 'C · 2 per reparto' },
];
const players = Array.from({ length: nPlayers }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true }));
const pct = x => (100 * x).toFixed(0) + '%';
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// gira N partite/livello sugli STESSI seed (baseline 0 confrontabile seed-per-seed)
const byLevel = {};
for (const lvl of LEVELS) {
  const games = [];
  for (let i = 0; i < N; i++) {
    games.push(runOneGame({
      ...bl, nPlayers, players,
      raceObjectives: { enabled: true, podium: [7, 5, 3], list: RACES.map(({ id, type, n, enabled }) => ({ id, type, n, enabled })) },
      raceIncentive: lvl, raceCausality: lvl > 0,
      seed: SEED0 + i, headless: true,
    }));
  }
  byLevel[lvl] = games;
}
const base = byLevel[0];

console.log(`Race causality — ${N} partite/livello, ${nPlayers} giocatori, seed ${SEED0}..${SEED0 + N - 1}, livelli ${LEVELS.join('/')}\n`);

// ---------- (1) MATRICE PER-RACE ----------
for (const race of RACES) {
  console.log(`### Race ${race.label}`);
  console.log('liv | %compl | turno | 1°/2°/3° | qualif | claim | #7 attrib | costo dev | indotti');
  console.log('----|--------|-------|----------|--------|-------|-----------|-----------|--------');
  for (const lvl of LEVELS) {
    const games = byLevel[lvl];
    const objs = games.map(g => g.race.list.find(it => it.id === race.id));
    const completed = objs.filter(o => o.claims.length).length;
    const allTurns = objs.flatMap(o => o.claimTurns);
    const placeTurns = [0, 1, 2].map(pl => { const ts = objs.map(o => o.claimTurns[pl]).filter(t => t != null); return ts.length ? avg(ts).toFixed(1) : '—'; }).join('/');
    const qualif = avg(objs.map(o => o.qualified.length));
    const claim = avg(objs.map(o => o.claims.length));
    // #7 per-race + costo (solo livelli >0)
    let attrib = '—', cost = '—';
    if (lvl > 0) {
      const hd = games.reduce((a, g) => a + (g.raceCausal?.hireDecisions || 0), 0);
      const hc = games.reduce((a, g) => a + (g.raceCausal?.byRace?.[race.id]?.hireChanged || 0), 0);
      const ch = games.reduce((a, g) => a + (g.raceCausal?.byRace?.[race.id]?.changed || 0), 0);
      const cs = games.reduce((a, g) => a + (g.raceCausal?.byRace?.[race.id]?.costSum || 0), 0);
      attrib = `${pct(hc / (hd || 1))} (${hc}/${hd})`;
      cost = ch ? (cs / ch).toFixed(2) : '0.00';
    }
    // indotti: claim (seat) a questo livello che NON ci sono al baseline 0 sullo stesso seed
    let induced = 0, spont = 0;
    if (lvl > 0) {
      games.forEach((g, i) => {
        const now = new Set((g.race.list.find(it => it.id === race.id)?.claims) || []);
        const was = new Set((base[i].race.list.find(it => it.id === race.id)?.claims) || []);
        for (const seat of now) (was.has(seat) ? spont++ : induced++);
      });
    }
    const indTxt = lvl > 0 ? `${pct(induced / ((induced + spont) || 1))} (${induced}/${induced + spont})` : 'baseline';
    console.log(`${String(lvl).padStart(3)} | ${pct(completed / games.length).padStart(6)} | ${(allTurns.length ? avg(allTurns).toFixed(1) : '—').padStart(5)} | ${placeTurns.padStart(8)} | ${qualif.toFixed(2).padStart(6)} | ${claim.toFixed(2).padStart(5)} | ${attrib.padEnd(9)} | ${String(cost).padStart(9)} | ${indTxt}`);
  }
  console.log('');
}

// ---------- (2) TRAIETTORIA: esito finale vs incentivo ----------
console.log('### Traiettoria — esito finale al salire dell\'incentivo');
console.log('incentivo | PV vincitore | Win% top-chaser | Commesse/gioc | Milestone/gioc | Reparti 5/5 /gioc');
console.log('----------|--------------|-----------------|---------------|----------------|------------------');
for (const lvl of LEVELS) {
  const games = byLevel[lvl];
  const winPV = avg(games.map(g => g.results[0].total));
  // top-chaser = giocatore con più PV di gara; vince se è il vincitore della partita
  const topChaserWin = avg(games.map(g => {
    const top = g.results.reduce((a, b) => ((b.pvRace || 0) > (a.pvRace || 0) ? b : a));
    return top.playerId === g.results[0].playerId ? 1 : 0;
  }));
  const contracts = avg(games.flatMap(g => g.results.map(r => r.nContracts)));
  const milestones = avg(games.flatMap(g => g.tracks.map(t => t.ms.filter(Boolean).length)));
  const deptsFull = avg(games.flatMap(g => g.tracks.map(t => [0, 1, 2].filter(r => t.sopra[r] + t.sotto[r] === g.slotCap[r]).length)));
  console.log(`   ${String(lvl).padStart(4)}   | ${winPV.toFixed(1).padStart(12)} | ${pct(topChaserWin).padStart(15)} | ${contracts.toFixed(2).padStart(13)} | ${milestones.toFixed(2).padStart(14)} | ${deptsFull.toFixed(2).padStart(17)}`);
}
console.log('\nLettura traiettoria: decisioni cambiate ma esito stabile = buona interazione · PV/win su forte = leva strategica · esito peggiora = trappola · win dominato = troppo forte.');
console.log('NB: "Win% top-chaser" base attesa = ' + pct(1 / nPlayers) + ' (se inseguire non aiuta né danneggia).');
