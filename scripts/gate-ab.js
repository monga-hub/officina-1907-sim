// A/B isolato sul cancello-milestone: stesse seed, solo milestoneGate cambia.
// Conferma se il cancello causa lo spread posti 🔴. Uso: node scripts/gate-ab.js [nGames] [nPlayers]
import { runOneGame } from '../src/game/batchsim.js';

const nGames = parseInt(process.argv[2] || '400', 10);
const P = parseInt(process.argv[3] || '4', 10);
const seedBase = 5000;

function batch(milestoneGate) {
  const wins = Array(P).fill(0);
  let ok = 0;
  for (let g = 0; g < nGames; g++) {
    const r = runOneGame({
      headless: true,
      seed: seedBase + g,
      players: Array.from({ length: P }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
      borsaFabbriche: { milestoneGate },
    });
    if (r.failed) continue;
    ok++;
    wins[r.results[0].playerId]++; // playerId = seat = ordine di turno
  }
  const wr = wins.map(w => w / ok);
  const spread = Math.max(...wr) - Math.min(...wr);
  return { ok, wr, spread };
}

const pct = x => (x * 100).toFixed(0) + '%';
const light = s => (s >= 0.20 ? '🔴' : s >= 0.10 ? '🟡' : '🟢');

for (const gate of [true, false]) {
  const b = batch(gate);
  console.log(`cancello ${gate ? 'ON ' : 'OFF'}: ${b.ok}/${nGames} · vittorie per posto ${b.wr.map(pct).join('/')} · spread ${pct(b.spread)} ${light(b.spread)}`);
}
