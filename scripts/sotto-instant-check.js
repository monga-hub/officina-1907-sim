// Self-check del toggle "Installazione Sotto = azione immediata" (08/08/2026). Uso: node scripts/sotto-instant-check.js
// Verifica: con sottoInstantEffect ON, un hire "sotto" con effetto 'prendi' applica subito il guadagno
// (coins/risorse cambiano nello stesso comando); con OFF (default), il guadagno resta rimandato all'attivazione.
import assert from 'node:assert';
import fs from 'node:fs';
import { initGame, legalCommands, applyCommand, currentPlayer, WORKER_BY_ID, formulaOf, totalResources } from '../src/game/engine.js';

const ok = (c, m) => { assert.ok(c, m); console.log('✓ ' + m); };
const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const players = [{ name: 'P0', isAI: true }, { name: 'P1', isAI: true }];

// solo effetto 'prendi risorsa': il costo dell'assunzione si paga in marchi, un effetto 'prendi moneta'
// muoverebbe lo STESSO pool del costo e falserebbe il delta misurato sotto.
function findGainHire(state) {
  return legalCommands(state).find(c => {
    if (c.type !== 'hire' || c.side !== 'sotto') return false;
    const w = WORKER_BY_ID[c.cardId];
    const F = w && formulaOf(w);
    return F && F.verbo === 'prendi' && F.f1.tipo === 'risorsa';
  });
}

// il giocatore parte fuori da ogni nodo: cammina (primo comando 'move' disponibile) finché
// non compare un hire Sotto con effetto 'prendi' tra i comandi legali, poi lo applica.
function walkToGainHire(state, maxSteps = 30) {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    const cmd = findGainHire(s);
    if (cmd) return { state: s, cmd };
    const cmds = legalCommands(s);
    const move = cmds.find(c => c.type === 'move') || cmds[0];
    if (!move) break;
    s = applyCommand(s, move);
  }
  return { state: s, cmd: null };
}

for (const flag of [true, false]) {
  const s0 = initGame({ ...bl, sottoInstantEffect: flag, players });
  const { state: s, cmd } = walkToGainHire(s0);
  ok(!!cmd, `[flag=${flag}] trovato un hire Sotto con effetto 'prendi' tra i comandi legali`);
  const p = currentPlayer(s);
  const w = WORKER_BY_ID[cmd.cardId];
  const F = formulaOf(w);
  const before = totalResources(p);
  const s2 = applyCommand(s, cmd);
  const p2 = s2.players[p.id];
  const gained = totalResources(p2) - before;
  if (flag) ok(gained >= F.f1.q, `[flag=true] il guadagno (${F.f1.tipo} +${F.f1.q}) è applicato subito all'installazione Sotto`);
  else ok(gained < F.f1.q, `[flag=false] nessun guadagno immediato: la carta Sotto resta inerte finché il reparto non si attiva`);
}

console.log('\n✓ sotto-instant-check: toggle sottoInstantEffect ok');
