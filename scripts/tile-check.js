// Self-check delle tile-tracciato a formula {verbo,f1,f2} (29/07/2026). Uso: node scripts/tile-check.js
// Verifica: migrazione legacy cellType→formula, PV di fine partita (tipo 'punti'), e che scambia/PV/scelta
// girino in partita intera senza crash. Le tile usano la stessa grammatica delle carte operaio.
import assert from 'node:assert';
import fs from 'node:fs';
import { initGame, tileEffect, describeTileEffect, trackPV } from '../src/game/engine.js';
import { runOneGame } from '../src/game/batchsim.js';

const ok = (c, m) => { assert.ok(c, m); console.log('✓ ' + m); };
const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url))); bl.newWorkers = bl.workers;

// 1. migrazione legacy cellType → formula
let e = tileEffect({ cellType: 'coins', amount: 3 });
ok(e.verbo === 'prendi' && e.f1.tipo === 'moneta' && e.f1.q === 3, 'migra coins → prendi 3 moneta');
e = tileEffect({ cellType: 'resPerIcon', amount: 2 });
ok(e.verbo === 'perOgni' && e.f1.settore === 'carta' && e.f2.conta === 'icona' && e.f2.di === 'carta', 'migra resPerIcon → perOgni risorsa/carta × icona');
e = tileEffect({ cellType: 'pv', amount: 6 });
ok(e.verbo === 'prendi' && e.f1.tipo === 'punti' && e.f1.q === 6, 'migra pv → prendi 6 punti');
const fx = { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'carta' }, f2: { q: 2, tipo: 'moneta' } };
ok(tileEffect({ effect: fx }) === fx && describeTileEffect({ effect: fx }).includes('→'), 'tile già-formula invariata; describe mostra la freccia');

// 2. PV di fine partita: una tile 'punti' su una casella raggiunta conta in trackPV
const s = initGame({ ...bl, players: [{ name: 'P0', isAI: true }, { name: 'P1', isAI: true }],
  trackTiles: [{ id: 'ttPV', market: 1, name: '5PV', effect: { verbo: 'prendi', f1: { q: 5, tipo: 'punti' } }, cost: 0, copies: 4 }] });
const p = s.players[0], d = p.depts.terziario;
d.prod = Math.max(d.prod, 7);                 // prima porta il tracciato oltre lo slot (espone le celle del template)
const before = trackPV(s, p);                 // baseline col template pos.7 (tileSlot, 0 PV)
d.tileFills[7] = 'ttPV';                       // poi riempi lo slot con la tile PV
ok(trackPV(s, p) - before === 5, 'tile PV (prendi 5 punti) conta +5 in trackPV alla casella riempita');

// 3. partite intere con scambia + PV + scelta → nessun crash
let crash = null, games = 0;
try {
  for (let i = 0; i < 20; i++) {
    const g = runOneGame({ ...bl, players: Array.from({ length: 4 }, (_, k) => ({ name: 'A' + k, isAI: true })), aiRollout: null, seed: i + 100, trackTiles: [
      { id: 'ttSC', market: 1, name: 'Vendi', effect: { verbo: 'scambia', f1: { q: 1, tipo: 'risorsa', settore: 'carta' }, f2: { q: 3, tipo: 'moneta' } }, cost: 0, copies: 4 },
      { id: 'ttPV', market: 2, name: '5PV', effect: { verbo: 'prendi', f1: { q: 5, tipo: 'punti' } }, cost: 0, copies: 4 },
      { id: 'ttR', market: 3, name: 'R×carta', effect: { verbo: 'perOgni', f1: { q: 1, tipo: 'risorsa', settore: 'scelta' }, f2: { conta: 'icona', kind: 'sector', di: 'carta' } }, cost: 0, copies: 4 },
    ] });
    if (!g.failed) games++;
  }
} catch (err) { crash = err; }
ok(!crash && games === 20, `20 partite con tile scambia/PV/scelta: nessun crash (${games} ok)` + (crash ? ' — ' + crash.message : ''));

console.log('\n✓ tile-check: formula tile (migrazione, PV, scambia, scelta) ok');
