// Diagnosi bias di posizione: N partite con le impostazioni del report utente 22:31,
// telemetria per posto per individuare il meccanismo che favorisce un seat.
import { initGame, applyCommand } from '../src/game/engine.js';
import { chooseCommand } from '../src/game/ai.js';

const N = parseInt(process.argv[2] || '200', 10);
const SEED_BASE = parseInt(process.argv[3] || '50000', 10);
const END_ON_TRIGGER = process.argv.includes('--end-on-trigger');
const ROTATE_START = process.argv.includes('--rotate-start');
const SINGLE_PLACE = process.argv.includes('--single-place');
const DISCOUNT_BUY = process.argv.includes('--discount-buy'); // abilita acquisto scontato (default OFF)
const NO_STRIKE_PENALTY = process.argv.includes('--no-strike-penalty');
const STRIKE_PV_ARG = (() => { const i = process.argv.indexOf('--strike-pv'); return i >= 0 ? Number(process.argv[i + 1]) : undefined; })();
const P = 4;

// tracciati del report 07/07 22:31
const T = null;
const terziario = [null, { coins: 1 }, T, { coins: 1 }, T, T, T, { pv: 2 }, T, { coins: 1 }, T, { res: 1 }, { milestone: true }, T, T, { pv: 3 }, { coins: 1 }];
const secprim = [null, { res: 1 }, T, { coins: 1 }, T, T, T, { pv: 2 }, T, { res: 1 }, T, { coins: 1 }, { milestone: true }, T, T, { pv: 3 }, { coins: 1 }];
const cfgBase = {
  tracks: { terziario, secondario: secprim, primario: secprim },
  contractPV: { small: [5, 3], medium: [9, 7], large: [15, 13] },
  conversions: { coinsPerPV: 5, resPerPV: 2 },
  startingCoins: [10, 10, 10, 10],
  endOnTrigger: END_ON_TRIGGER,
  rotateStart: ROTATE_START,
  singlePlace: SINGLE_PLACE,
  trattativa: DISCOUNT_BUY ? { buyDiscount: { enabled: true } } : undefined,
  strikePenalty: !NO_STRIKE_PENALTY,
  strikePenaltyPV: STRIKE_PV_ARG,
};

const S = () => Array(P).fill(0);
const agg = {
  wins: S(), pv: S(), pvObj: S(), pvContr: S(), pvTrack: S(), pvCoins: S(),
  attacksReceived: S(),      // +1 tensione da Trattativa avversaria
  strikesSuffered: S(),      // scelte di blocco (sciopero) subite
  blockedFinal: S(),         // carte ancora bloccate a fine partita
  slot2Paid: S(),            // mosse pagate (secondo slot)
  hires: S(), welfare: S(), trattative: S(), activations: S(), contracts: S(),
  firstPlaces: S(),          // podi 1°
  sells: S(),                // vendite 1R→3m in Borsa
  endTrigger: S(),           // chi ha fatto scattare il finale (clock a soglia)
  turns: S(),                // turni giocati per posto
};

for (let g = 0; g < N; g++) {
  const SAME_SETUP = process.argv.includes('--same-setup');
  const players = Array.from({ length: P }, () => ({ isAI: true, boardId: SAME_SETUP ? 'p1' : undefined }));
  let s = initGame({ ...cfgBase, seed: SEED_BASE + g, players });
  let steps = 0;
  while (!s.gameOver && steps++ < 60000) {
    const cmd = chooseCommand(s);
    const cur = s.current;
    if (cmd.type === 'trattativa') { agg.trattative[cur]++; agg.attacksReceived[cmd.targetPlayer]++; }
    if (cmd.type === 'strikeBlock') agg.strikesSuffered[s.pending.playerId]++;
    if (cmd.type === 'move' && cmd.cost > 0) agg.slot2Paid[cur]++;
    if (cmd.type === 'hire') agg.hires[cur]++;
    if (cmd.type === 'buyWelfare') agg.welfare[cur]++;
    if (cmd.type === 'activate') agg.activations[cur]++;
    if (cmd.type === 'completeContract') agg.contracts[cur]++;
    if (cmd.type === 'exchange' && cmd.kind === 'sell') agg.sells[cur]++;
    const wasFinal = s.finalRound;
    s = applyCommand(s, cmd);
    if (!wasFinal && s.finalRound) agg.endTrigger[cur]++;
  }
  if (!s.gameOver) { console.error('non terminata', SEED_BASE + g); continue; }
  agg.wins[s.results[0].playerId]++;
  for (const r of s.results) {
    agg.pv[r.playerId] += r.total; agg.pvObj[r.playerId] += r.pvObjectives;
    agg.pvContr[r.playerId] += r.pvContracts; agg.pvTrack[r.playerId] += r.pvTrack; agg.pvCoins[r.playerId] += r.pvCoins;
  }
  s.players.forEach((p, i) => {
    agg.blockedFinal[i] += ['terziario', 'secondario', 'primario'].reduce((a, role) => a + p.depts[role].blocked.length, 0);
    agg.firstPlaces[i] += p.contractsWon.filter(c => c.place === 0).length;
    agg.turns[i] += p.coinsHistory.length;
  });
}

console.log(`${N} partite, seed base ${SEED_BASE}. Medie per posto (1°..4°):`);
const fmt = a => a.map(x => (x / N).toFixed(2).padStart(7)).join(' ');
for (const [k, label] of [
  ['wins', 'vittorie (frazione)'], ['pv', 'PV totali'], ['pvContr', 'PV commesse'], ['pvObj', 'PV obiettivi'],
  ['pvTrack', 'PV tracciati'], ['pvCoins', 'PV marchi'],
  ['attacksReceived', 'attacchi Trattativa RICEVUTI'], ['strikesSuffered', 'scioperi subiti'],
  ['blockedFinal', 'carte bloccate a fine'], ['slot2Paid', 'mosse pagate (slot 2)'],
  ['hires', 'assunzioni'], ['welfare', 'welfare comprati'], ['trattative', 'trattative fatte'],
  ['activations', 'attivazioni'], ['contracts', 'commesse completate'], ['firstPlaces', 'podi 1°'],
  ['sells', 'vendite 1R→3m'], ['endTrigger', 'innesca fine partita'], ['turns', 'turni giocati'],
]) {
  console.log(label.padEnd(30), fmt(agg[k]));
}
