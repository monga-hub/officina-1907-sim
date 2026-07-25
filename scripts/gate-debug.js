// DEBUG ipotesi A: con cardGate ON, nei momenti "gate-limited" (spot fabbrica libero ma vicine(C) ≥ Sopra(C),
// quindi assumere una carta Sopra nel reparto di C sbloccherebbe una fabbrica) — quale score dà l'IA
// all'assunzione-che-sblocca vs produrre/trattativa/fabbrica? Se è sistematicamente bassa, il problema è la
// funzione di valutazione (non vede lo sblocco futuro), non le regole.
// Uso: node scripts/gate-debug.js [nMomenti] [--rollout]
import { readFileSync } from 'fs';
import { initGame, applyCommand, legalCommands, WORKER_BY_ID, deptOfSector } from '../src/game/engine.js';
import { chooseCommand, logDecision } from '../src/game/ai.js';

const wantRollout = process.argv.includes('--rollout');
const N = parseInt(process.argv.find(a => /^\d+$/.test(a)) || '8', 10);
const base = JSON.parse(readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
base.newWorkers = base.newWorkers || base.workers;
base.borsaFabbriche = { ...base.borsaFabbriche, cardGate: true };
const SEC = ['Tessile', 'Metallurgica', 'Chimica'];

const nearC = (s, p, C) => (p.factories || []).filter(f => (s.factoryMap.adj[f.hex] || []).some(nb => s.hexResource[nb] === C)).length;
const sopraC = (p, C) => { const d = deptOfSector(p, C); return d ? d.sopra.length : 0; };
const freeSpotAdj = (s, C) => s.factoryHexes.some(id => s.factoryHexById[id].type === 'costruibile' && !s.hexFactory[id] && (s.factoryMap.adj[id] || []).some(nb => s.hexResource[nb] === C));
// colori dove il gate morde A METÀ PARTITA: posto libero, vicine ≥ Sopra (bloccato), e ha già ≥2 fabbriche +
// ≥2 Sopra là — cioè la decisione "vado al 3° slot per sbloccare la 3ª fabbrica?" (il caso descritto).
const gatedColors = (s, p) => SEC.filter(C => freeSpotAdj(s, C) && nearC(s, p, C) >= sopraC(p, C) && sopraC(p, C) >= 2 && nearC(s, p, C) >= 2 && p.coins >= 1);
// una assunzione Sopra che alza il cap di C (carta del colore C, lato sopra)
const unlockingHire = (s, p, gated) => legalCommands(s).find(c => c.type === 'hire' && c.side === 'sopra' && gated.includes(WORKER_BY_ID[c.cardId]?.sector));

const rows = [];
for (let g = 0; g < 60 && rows.length < N; g++) {
  let s = initGame({ ...base, seed: 3000 + g, players: Array.from({ length: 4 }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })) });
  let steps = 0, capturedThisGame = false;
  while (!s.gameOver && steps < 20000 && rows.length < N && !capturedThisGame) {
    if (s.phase === 'action' && !s.pending) {
      const p = s.players[s.current];
      const gated = gatedColors(s, p);
      const uh = gated.length ? unlockingHire(s, p, gated) : null;
      if (uh) {
        const ld = logDecision(s, { depth: 6, rollouts: 1 }, 20);
        const label = `Assumi ${uh.cardId}`;
        const gTop = ld.greedy[0], gUnlock = ld.greedy.find(x => x.label === label);
        const rTop = ld.rollout[0], rUnlock = ld.rollout.find(x => x.label === label);
        rows.push({
          turn: s.turn, seat: s.current, colore: gated.join('+'),
          gTopLabel: gTop.label, gTop: gTop.score, gUnlock: gUnlock ? gUnlock.score : null,
          gRank: gUnlock ? ld.greedy.indexOf(gUnlock) + 1 : null,
          rTopLabel: rTop.label, rTop: rTop.score, rUnlock: rUnlock ? rUnlock.score : null,
          rRank: rUnlock ? ld.rollout.indexOf(rUnlock) + 1 : null,
          nCand: ld.greedy.length,
        });
        capturedThisGame = true;
      }
    }
    const c = chooseCommand(s); if (!c) break; s = applyCommand(s, c); steps++;
  }
}

if (!rows.length) { console.log('Nessun momento gate-limited con assunzione-Sopra-che-sblocca trovato.'); process.exit(0); }
console.log(`${rows.length} momenti gate-limited (spot libero, vicine ≥ Sopra, assunzione-Sopra disponibile che sbloccherebbe):\n`);
const f = x => x == null ? ' — ' : (x >= 0 ? '+' : '') + x.toFixed(2);
for (const r of rows) {
  console.log(`t${r.turn} seat${r.seat} [${r.colore}] · ${r.nCand} opzioni`);
  console.log(`  GREEDY  top: ${r.gTopLabel.padEnd(22)} ${f(r.gTop)}   |  assumi-sblocca: ${f(r.gUnlock)} (rank ${r.gRank}/${r.nCand})`);
  if (wantRollout) console.log(`  ROLLOUT top: ${r.rTopLabel.padEnd(22)} ${f(r.rTop)}   |  assumi-sblocca: ${f(r.rUnlock)} (rank ${r.rRank}/${r.nCand})`);
}
const gRanks = rows.filter(r => r.gRank != null);
const chosen1 = gRanks.filter(r => r.gRank === 1).length;
const avgGap = gRanks.reduce((a, r) => a + (r.gTop - r.gUnlock), 0) / gRanks.length;
console.log(`\nSINTESI (greedy): assunzione-che-sblocca è #1 in ${chosen1}/${gRanks.length} · gap medio dal top ${avgGap >= 0 ? '+' : ''}${avgGap.toFixed(2)}`);
if (wantRollout) {
  const rRanks = rows.filter(r => r.rRank != null);
  const r1 = rRanks.filter(r => r.rRank === 1).length;
  const rGap = rRanks.reduce((a, r) => a + (r.rTop - r.rUnlock), 0) / rRanks.length;
  console.log(`SINTESI (rollout d6): assunzione-che-sblocca è #1 in ${r1}/${rRanks.length} · gap medio dal top ${rGap >= 0 ? '+' : ''}${rGap.toFixed(2)}`);
}
