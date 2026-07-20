// Decision log: confronto Greedy vs Rollout sulle stesse mosse candidate — per capire DOVE le due IA
// divergono, non solo il risultato finale.
// Uso: node scripts/decisionlog.js [--depth N] [--rollouts N] [--seed N] [--uniform5] MODE
//   MODE (uno dei tre):
//   --turn N        gioca greedy fino al turno N (o al primo Macchinario acquistabile se omesso), un solo log
//   --turns 1,5,10  STESSA partita: continua in greedy e stampa un log a ciascun turno della lista
//   (default)       forza --tile su seat 0 e ferma al primo momento in cui assumere un lavoratore
//                   --nation è tra le candidate legali — per capire se l'IA lo scarta per scelta (Greedy
//                   basso ma Rollout alto = miopia corretta dal lookahead) o anche a orizzonte lungo (carta debole)
//   --tile pf11     tessera da live-config.json da forzare su seat 0 (default pf11, Tessile+Polacchi)
//   --nation NAME   nazionalità del lavoratore da cercare come candidata (default Polacchi)
//   --uniform5      forza usesMax=5 su tutte le carte Welfare (il deck dove il segnale AI è forte)
import { readFileSync } from 'fs';
import { initGame, applyCommand, legalCommands, WORKER_BY_ID } from '../src/game/engine.js';
import { WELFARE } from '../src/game/data.js';
import { chooseCommand, logDecision } from '../src/game/ai.js';

function argVal(flag, def) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; }
const depth = parseInt(argVal('--depth', '4'), 10);
const rollouts = parseInt(argVal('--rollouts', '1'), 10);
const seed = parseInt(argVal('--seed', '1000'), 10);
const fixedTurn = argVal('--turn', null);
const turnsList = argVal('--turns', null);
const uniform5 = process.argv.includes('--uniform5');
const tileId = argVal('--tile', 'pf11');
const nation = argVal('--nation', 'Polacchi');
const MAX_STEPS = 30000;

const welfare = uniform5 ? WELFARE.map(w => ({ ...w, usesMax: 5 })) : undefined;
const liveCfg = JSON.parse(readFileSync(new URL('./live-config.json', import.meta.url)));
const forcedTile = liveCfg.tiles.find(t => t.id === tileId);
if (!forcedTile) { console.error(`Tessera ${tileId} non trovata in live-config.json`); process.exit(1); }

function newGame() {
  return initGame({
    seed, welfare, players: Array.from({ length: 4 }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
    forcedTile, forcedSeat: 0,
  });
}
const isNationHireLegal = state => state.current === 0 && legalCommands(state).some(c => c.type === 'hire' && WORKER_BY_ID[c.cardId]?.nation === nation);

if (turnsList) {
  // stessa partita, un log ad ogni turno della lista, poi la partita continua in greedy verso il prossimo
  const targets = turnsList.split(',').map(Number).sort((a, b) => a - b);
  let state = newGame();
  let steps = 0;
  for (const target of targets) {
    let reached = state.turn >= target && state.phase === 'action';
    while (!state.gameOver && !reached && steps < MAX_STEPS) {
      const cmd = chooseCommand(state);
      if (!cmd) break;
      state = applyCommand(state, cmd);
      steps++;
      reached = state.turn >= target && state.phase === 'action';
    }
    if (!reached) { console.error(`Partita finita (turno ${state.turn}) prima del turno ${target}.`); break; }
    console.log(`--- target turno ${target} ---`);
    console.log(logDecision(state, { depth, rollouts }).text);
  }
  process.exit(0);
}

let state = newGame();
let steps = 0, found = false;
while (!state.gameOver && steps < MAX_STEPS) {
  if (state.phase === 'action') {
    found = fixedTurn ? state.turn >= Number(fixedTurn) : isNationHireLegal(state);
    if (found) break;
  }
  const cmd = chooseCommand(state);
  if (!cmd) break;
  state = applyCommand(state, cmd);
  steps++;
}

if (!found) {
  console.error(fixedTurn
    ? `Partita finita (turno ${state.turn}) prima di raggiungere il turno ${fixedTurn}.`
    : `Nessun momento con un lavoratore ${nation} candidato per seat 0 (tessera ${tileId}) trovato in ${steps} step (seed ${seed}). Prova un altro --seed.`);
  process.exit(1);
}

const log = logDecision(state, { depth, rollouts });
console.log(log.text);
