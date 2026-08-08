// Self-check di "scioperi risolti dal Sindacato" (08/08/2026). Uso: node scripts/strike-resolve-check.js
// Verifica: ogni evento in strikeLog con una carta bloccabile finisce con cardId valorizzato; resolved passa
// a true solo quando quella carta esce da dept.blocked via unblockSciopero; il report combacia col conteggio grezzo.
import assert from 'node:assert';
import fs from 'node:fs';
import { runOneGame, formatReport } from '../src/game/batchsim.js';

const ok = (c, m) => { assert.ok(c, m); console.log('✓ ' + m); };
const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const cfg = { ...bl, players: [{ name: 'P0', isAI: true }, { name: 'P1', isAI: true }, { name: 'P2', isAI: true }, { name: 'P3', isAI: true }], nPlayers: 4 };

const games = [];
for (let i = 0; i < 20; i++) games.push(runOneGame({ ...cfg, seed: 3000 + i }));
const good = games.filter(g => !g.failed);
ok(good.length === games.length, `tutte le ${games.length} partite completate senza failed:true`);

const allStrikes = good.flatMap(g => g.strikes || []);
ok(allStrikes.length > 0, `almeno uno sciopero osservato nel batch (N ${allStrikes.length})`);
ok(allStrikes.every(x => x.cardId != null), 'ogni evento strikeLog ha una cardId valorizzata (nessun buco "nessuna carta bloccabile" nel log)');
ok(allStrikes.every(x => typeof x.resolved === 'boolean'), 'ogni evento ha resolved booleano');

const resolved = allStrikes.filter(x => x.resolved).length;
console.log(`✓ ${resolved}/${allStrikes.length} scioperi risolti dal Sindacato nel batch (${(100 * resolved / allStrikes.length).toFixed(1)}%)`);

const report = formatReport(games, cfg);
const line = report.split('\n').find(l => l.includes('risolti dal Sindacato'));
ok(!!line, 'la riga "risolti dal Sindacato" compare nel report');
ok(line.includes(`${resolved}/${allStrikes.length}`), 'il conteggio nel report combacia col conteggio grezzo di tel.strikes');
ok(!line.includes('NaN'), 'nessun NaN nella riga');

console.log('\n✓ strike-resolve-check: tracciamento risoluzione scioperi ok');
