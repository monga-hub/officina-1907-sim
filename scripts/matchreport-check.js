// Self-check del report narrativo: gioca una partita reale, verifica che le funzioni non lancino
// e producano output non vuoto. Uso: node scripts/matchreport-check.js
import { initGame, applyCommand, legalCommands, factoryMajorityWinner } from '../src/game/engine.js';
import { chooseCommand } from '../src/game/ai.js';
import { buildStory, buildEvents, buildDiagnosis, buildAnomalies, economy, factoryStats, matchHeadline, matchNormality, matchTurningPoints, matchLesson, productionCadence } from '../src/game/matchReport.js';
import assert from 'node:assert';

let state = initGame({ seed: 42, players: Array.from({ length: 4 }, (_, i) => ({ name: ['Primo','Secondo','Terzo','Quarto'][i], isAI: true })) });
let steps = 0;
while (!state.gameOver && steps < 20000) { const c = chooseCommand(state); if (!c) break; state = applyCommand(state, c); steps++; }
assert(state.gameOver, 'partita non terminata');
assert(Array.isArray(state.results) && state.results.length === 4, 'results mancanti');

const story = buildStory(state), events = buildEvents(state), diag = buildDiagnosis(state), anom = buildAnomalies(state);
for (const [name, out] of [['story', story], ['events', events], ['anomalies', anom]]) {
  assert(Array.isArray(out), `${name} non è un array`);
  for (const line of out) assert(typeof line === 'string' && line.length, `${name}: riga vuota/non stringa`);
}
assert(diag.length >= 1 && diag[0].head && Array.isArray(diag[0].reasons) && diag[0].reasons.length, 'diagnosi vincitore vuota');
for (const p of state.players) { const e = economy(p); assert(typeof e.resPerC === 'string' && typeof e.resPerCNum === 'number', 'economy shape'); }

// La mappa mostra i giacimenti vinti: verifica che combacino col PV di maggioranza del motore.
const mb = state.borsaFabbriche?.majorityBonus;
if (state.borsaFabbriche?.enabled && mb?.enabled) {
  const wonBy = {};
  for (const rid of Object.keys(state.hexResource || {})) { const w = factoryMajorityWinner(state, rid, state.hexResource[rid]); if (w != null) wonBy[w] = (wonBy[w] || 0) + 1; }
  for (const x of state.results) {
    const expected = (wonBy[x.playerId] || 0) * mb.pv;
    assert.strictEqual(x.pvFactoryMajority, expected, `maggioranza ${x.name}: mappa ${expected} ≠ motore ${x.pvFactoryMajority}`);
  }
  console.log('✓ giacimenti mappa = PV maggioranza motore (' + Object.values(wonBy).reduce((a, b) => a + b, 0) + ' vinti)');
}

// factoryStats: coerenza interna
const fs = factoryStats(state);
assert(fs.saturation >= 0 && fs.saturation <= 1, 'saturazione fuori [0,1]');
assert(fs.landGrabShare >= 0 && fs.landGrabShare <= 1, 'land-grab fuori [0,1]');
assert(fs.perPlayer.reduce((a, x) => a + x.n, 0) === state.players.reduce((a, p) => a + (p.factories || []).length, 0), 'conteggio fabbriche non torna');
if (fs.majOn) assert(fs.perPlayer.reduce((a, x) => a + x.giacimenti, 0) === fs.giacimenti.won, 'giacimenti vinti per-giocatore ≠ totale');
console.log('✓ factoryStats OK — saturazione ' + Math.round(100 * fs.saturation) + '% · land-grab ' + Math.round(100 * fs.landGrabShare) + '%');

// le componenti PV mostrate devono sommare al totale (Fabbriche/Borsa inclusi)
for (const x of state.results) {
  const sum = x.pvContracts + x.pvObjectives + x.pvTrack + (x.pvFactoryMajority || 0) + (x.pvBorsa || 0) + x.pvCoins + x.pvResources + (x.pvStrikes || 0);
  assert.strictEqual(sum, x.total, `PV ${x.name}: componenti ${sum} ≠ totale ${x.total}`);
}
console.log('✓ componenti PV = totale (Fabbriche/Borsa incluse)');

const headline = matchHeadline(state), norm = matchNormality(state), tp = matchTurningPoints(state);
assert(typeof headline === 'string' && headline.length > 10, 'headline vuoto');
assert(['🟢', '🟡'].includes(norm.level) && typeof norm.label === 'string', 'normalità shape');
assert(Array.isArray(tp) && tp.length >= 1, 'turning points vuoti');
// ciclo del motore: per chi ha ≥2 commesse, #intervalli = #commesse e ogni conteggio ≥0
const cad = productionCadence(state);
for (const c of cad) if (c.seq.length) { assert(c.seq.length === c.nc, `cadence ${c.name}: intervalli ${c.seq.length} ≠ commesse ${c.nc}`); assert(c.seq.every(n => n >= 0), 'cadence negativa'); }
console.log('✓ diagnostico OK (headline/normalità/svolte/ciclo)');

console.log('✓ matchReport OK — partita di ' + state.turn + ' turni');
console.log('\n▶ ' + headline);
console.log(norm.level + ' Partita ' + norm.label + (norm.reasons.length ? ' — ' + norm.reasons.join(' · ') : ''));
console.log('\n🔀 SVOLTE:'); tp.forEach(x => console.log('  ' + x));
console.log('\n📖 STORIA:'); story.forEach(s => console.log('  • ' + s));
console.log('\n⏱ EVENTI:'); events.forEach(e => console.log('  ' + e));
console.log('\n🎯 PERCHÉ:'); diag.forEach(d => { console.log('  ' + d.head); d.reasons.forEach(x => console.log('    – ' + x)); });
console.log('\n⚠ ANOMALIE:'); anom.forEach(a => console.log('  ' + a));
