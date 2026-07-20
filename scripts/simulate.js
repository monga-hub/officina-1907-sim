// Partite headless: N AI giocano fino a fine partita. Uso: node scripts/simulate.js [nPartite] [nGiocatori]
import { initGame, applyCommand, legalCommands } from '../src/game/engine.js';
import { chooseCommand } from '../src/game/ai.js';

const nGames = parseInt(process.argv[2] || '5', 10);
const nPlayers = parseInt(process.argv[3] || '4', 10);
const MAX_STEPS = 20000;

let ok = 0;
for (let g = 0; g < nGames; g++) {
  const seed = 1000 + g;
  let state = initGame({
    seed,
    players: Array.from({ length: nPlayers }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
  });
  let steps = 0;
  try {
    while (!state.gameOver && steps < MAX_STEPS) {
      const cmd = chooseCommand(state);
      if (!cmd) throw new Error(`AI senza mossa: phase=${state.phase} pending=${JSON.stringify(state.pending)}`);
      const legal = legalCommands(state);
      const isLegal = legal.some(l => JSON.stringify(l) === JSON.stringify(cmd)) ||
        ['trattativa', 'resolveEffect', 'strikeBlock'].includes(cmd.type); // trattativa: parametri composti
      if (!isLegal && cmd.type !== 'pass') {
        throw new Error(`Comando non legale: ${JSON.stringify(cmd)} (phase=${state.phase})`);
      }
      state = applyCommand(state, cmd);
      steps++;
    }
    if (!state.gameOver) {
      console.error(`✗ seed ${seed}: partita non terminata in ${MAX_STEPS} step (clock ${state.clock}/${state.clockThreshold}, turno ${state.turn})`);
      continue;
    }
    const r = state.results;
    console.log(`✓ seed ${seed}: ${state.turn} turni, ${steps} step, clock ${state.clock}. ` +
      r.map(x => `${x.name}: ${x.total} PV (C${x.pvContracts}/O${x.pvObjectives}/T${x.pvTrack}/M${x.pvCoins}/R${x.pvResources})`).join(' · '));
    ok++;
  } catch (e) {
    console.error(`✗ seed ${seed} ERRORE dopo ${steps} step: ${e.message}\n${e.stack.split('\n').slice(1, 4).join('\n')}`);
  }
}
console.log(`\n${ok}/${nGames} partite completate.`);
process.exit(ok === nGames ? 0 : 1);
