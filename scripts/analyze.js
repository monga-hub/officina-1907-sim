// Analisi statistica: N partite AI con telemetria dettagliata.
// Uso: node scripts/analyze.js [nPartite] [nGiocatori]
import fs from 'node:fs';
import { initGame, applyCommand } from '../src/game/engine.js';
import { chooseCommand } from '../src/game/ai.js';
import { MILESTONE_POS } from '../src/game/data.js';

const N = parseInt(process.argv[2] || '100', 10);
const P = parseInt(process.argv[3] || '4', 10);
const coinsRepeat = !process.argv.includes('--no-coin-repeat');
// --tracks file.json: schema {terziario:[...17], secondario:[...17]} (primario = secondario)
const tIdx = process.argv.indexOf('--tracks');
let customTracks;
let milestonePos = MILESTONE_POS;
if (tIdx > -1) {
  const t = JSON.parse(fs.readFileSync(process.argv[tIdx + 1], 'utf8'));
  customTracks = { terziario: t.terziario, secondario: t.secondario, primario: t.secondario };
  milestonePos = Object.fromEntries(Object.entries(customTracks).map(([role, tr]) => {
    const i = tr.findIndex(c => c && c.milestone);
    return [role, i > 0 ? i : Infinity];
  }));
  console.log('Tracciati custom:', process.argv[tIdx + 1]);
}
// --equal-coins: tutti partono con 10 marchi (test compensazione ordine di turno)
const equalCoins = process.argv.includes('--equal-coins');
const MAX_STEPS = 60000;

const games = [];

for (let g = 0; g < N; g++) {
  let s = initGame({
    seed: 20000 + g, coinsRepeat, tracks: customTracks,
    startingCoins: equalCoins ? [10, 10, 10, 10] : undefined,
    players: Array.from({ length: P }, () => ({ isAI: true })),
  });
  const tel = {
    coinsByRound: [],            // [round][seat] = marchi a inizio round
    completions: [],             // {order, size, turn, seat, place}
    firstContract: Array(P).fill(null),
    turns: 0, clock: 0, sopra: 0, sotto: 0,
  };
  tel.coinsByRound[1] = s.players.map(p => p.coins);
  let steps = 0, lastTurn = 1;
  while (!s.gameOver && steps < MAX_STEPS) {
    const cmd = chooseCommand(s);
    const seat = s.current;
    const turnNow = s.turn;
    if (cmd.type === 'completeContract') {
      tel.completions.push({ order: tel.completions.length + 1, size: cmd.size, turn: turnNow, seat });
      if (tel.firstContract[seat] === null) tel.firstContract[seat] = turnNow;
    }
    if (cmd.type === 'hire') { cmd.side === 'sopra' ? tel.sopra++ : tel.sotto++; }
    if (cmd.type === 'trattativa' && cmd.f3 === 'buy') { cmd.f3side === 'sopra' ? tel.sopra++ : tel.sotto++; }
    s = applyCommand(s, cmd);
    if (s.turn !== lastTurn) {
      tel.coinsByRound[s.turn] = s.players.map(p => p.coins);
      lastTurn = s.turn;
    }
    steps++;
  }
  if (!s.gameOver) { console.error(`seed ${20000 + g} non terminata`); continue; }
  tel.turns = s.turn; tel.clock = s.clock;
  tel.results = s.results.map(r => ({ seat: r.playerId, total: r.total, C: r.pvContracts, O: r.pvObjectives, T: r.pvTrack, M: r.pvCoins, R: r.pvResources }));
  tel.tracks = s.players.map(p => ({
    pos: ['terziario', 'secondario', 'primario'].map(role => p.depts[role].prod),
    milestones: ['terziario', 'secondario', 'primario'].map(role => p.depts[role].prod >= milestonePos[role]),
  }));
  tel.activations = s.players.map(p => p.activations);
  games.push(tel);
}

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const med = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = x => (100 * x).toFixed(0) + '%';

console.log(`\n===== ${games.length} partite a ${P} giocatori — marchi tracciato: ${coinsRepeat ? 'ogni attivazione' : 'solo attraversamento'} =====\n`);

// 1. PV per posto (posto = ordine di turno, non classifica)
console.log('--- PV per posizione di turno ---');
console.log('Posto | Win% | PV tot | Commesse | Obiettivi | Tracciati | Marchi | Risorse');
for (let seat = 0; seat < P; seat++) {
  const rs = games.map(g => g.results.find(r => r.seat === seat));
  const wins = games.filter(g => g.results[0].seat === seat).length;
  console.log(`  ${seat + 1}°  | ${pct(wins / games.length).padStart(4)} | ${avg(rs.map(r => r.total)).toFixed(1).padStart(6)} | ${avg(rs.map(r => r.C)).toFixed(1).padStart(8)} | ${avg(rs.map(r => r.O)).toFixed(1).padStart(9)} | ${avg(rs.map(r => r.T)).toFixed(1).padStart(9)} | ${avg(rs.map(r => r.M)).toFixed(1).padStart(6)} | ${avg(rs.map(r => r.R)).toFixed(1)}`);
}

// 2. Durata
const turns = games.map(g => g.turns);
console.log(`\n--- Durata ---\nTurni a testa: media ${avg(turns).toFixed(1)}, mediana ${med(turns)}, min ${Math.min(...turns)}, max ${Math.max(...turns)} · Clock finale medio ${avg(games.map(g => g.clock)).toFixed(1)}`);
const totSopra = games.reduce((a, g) => a + g.sopra, 0), totSotto = games.reduce((a, g) => a + g.sotto, 0);
console.log(`Assunzioni: Sopra ${totSopra} (${pct(totSopra / (totSopra + totSotto))}) · Sotto ${totSotto} (${pct(totSotto / (totSopra + totSotto))})`);
console.log(`Attivazioni reparto per giocatore: media ${avg(games.flatMap(g => g.activations)).toFixed(1)}`);

// 3. Flusso di cassa: marchi posseduti a inizio round (media su giocatori e partite)
console.log('\n--- Marchi posseduti a inizio round (media di tutti i giocatori) ---');
const maxR = Math.max(...games.map(g => g.coinsByRound.length - 1));
const rows = [];
for (let r = 1; r <= maxR; r++) {
  const vals = [];
  for (const g of games) if (g.coinsByRound[r]) vals.push(...g.coinsByRound[r]);
  if (vals.length >= games.length) rows.push({ round: r, coins: avg(vals), n: vals.length / P });
}
for (const row of rows) {
  if (row.round === 1 || row.round % 3 === 0 || row.round === rows.length) {
    const bar = '█'.repeat(Math.round(row.coins / 2));
    console.log(`R${String(row.round).padStart(2)} | ${row.coins.toFixed(1).padStart(5)} ⓜ ${bar}  (${row.n.toFixed(0)} partite)`);
  }
}
console.log('CSV_CASSA:round,marchi_medi,partite');
for (const row of rows) console.log(`CSV_CASSA:${row.round},${row.coins.toFixed(2)},${row.n.toFixed(0)}`);

// 4. Prima commessa
console.log('\n--- Prima commessa (turno in cui ogni giocatore completa la sua prima) ---');
const firsts = games.flatMap(g => g.firstContract.filter(x => x !== null));
const never = games.reduce((a, g) => a + g.firstContract.filter(x => x === null).length, 0);
console.log(`Media turno ${avg(firsts).toFixed(1)}, mediana ${med(firsts)}, min ${Math.min(...firsts)}, max ${Math.max(...firsts)} · giocatori senza commesse: ${never}/${games.length * P} (${pct(never / (games.length * P))})`);

// 5. Ordine delle commesse per taglia
console.log('\n--- Quale taglia viene completata prima? ---');
const firstSize = { small: 0, medium: 0, large: 0 };
for (const g of games) if (g.completions[0]) firstSize[g.completions[0].size]++;
console.log(`Prima commessa della partita: piccola ${firstSize.small} (${pct(firstSize.small / games.length)}) · media ${firstSize.medium} (${pct(firstSize.medium / games.length)}) · grande ${firstSize.large} (${pct(firstSize.large / games.length)})`);
// turno medio di completamento per taglia
for (const size of ['small', 'medium', 'large']) {
  const ts = games.flatMap(g => g.completions.filter(c => c.size === size).map(c => c.turn));
  console.log(`${size.padEnd(6)}: ${ts.length} completamenti, turno medio ${ts.length ? avg(ts).toFixed(1) : '—'}`);
}

// 6. Contributo al Clock per taglia (ogni completamento = +1 clock)
console.log('\n--- Chi costruisce il Clock? ---');
const bySize = { small: 0, medium: 0, large: 0 };
let tot = 0;
for (const g of games) for (const c of g.completions) { bySize[c.size]++; tot++; }
for (const size of ['small', 'medium', 'large']) {
  console.log(`${size.padEnd(6)}: ${bySize[size]} tick (${pct(bySize[size] / tot)})`);
}

// 7. Sviluppo dei tre tracciati
console.log('\n--- Tracciati (posizione finale, max 16; milestone: terz 12, sec/prim 13) ---');
const allTracks = games.flatMap(g => g.tracks);
for (const [i, role] of ['terziario', 'secondario', 'primario'].entries()) {
  const ps = allTracks.map(t => t.pos[i]);
  const ms = allTracks.filter(t => t.milestones[i]).length;
  console.log(`${role.padEnd(10)}: pos media ${avg(ps).toFixed(1)}, mediana ${med(ps)} · milestone raggiunta ${pct(ms / allTracks.length)}`);
}
const mins = allTracks.map(t => Math.min(...t.pos));
const maxs = allTracks.map(t => Math.max(...t.pos));
console.log(`Tracciato PIÙ arretrato per giocatore: media ${avg(mins).toFixed(1)}, mediana ${med(mins)} · ≤4 (abbandonato): ${pct(mins.filter(x => x <= 4).length / mins.length)}`);
console.log(`Tracciato più avanzato: media ${avg(maxs).toFixed(1)}`);
const all3 = allTracks.filter(t => t.milestones.every(Boolean)).length;
const n3 = allTracks.filter(t => t.pos.every(x => x >= 8)).length;
console.log(`Tutte e 3 le milestone: ${pct(all3 / allTracks.length)} dei giocatori · tutti e 3 i tracciati almeno a metà (≥8): ${pct(n3 / allTracks.length)}`);
