// Self-check della telemetria "STRATEGIA SOTTO vs SOPRA" (08/08/2026). Uso: node scripts/sotto-strategy-check.js
// Verifica: runOneGame produce tel.sottoStrategy con tutti i campi attesi, formatReport stampa la sezione
// senza crash/NaN, e i totali Sopra/Sotto per giocatore combaciano col conteggio grezzo di tel.hires.
import assert from 'node:assert';
import fs from 'node:fs';
import { runOneGame, formatReport } from '../src/game/batchsim.js';

const ok = (c, m) => { assert.ok(c, m); console.log('✓ ' + m); };
const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const cfg = { ...bl, players: [{ name: 'P0', isAI: true }, { name: 'P1', isAI: true }, { name: 'P2', isAI: true }, { name: 'P3', isAI: true }], nPlayers: 4 };

const games = [];
for (let i = 0; i < 8; i++) games.push(runOneGame({ ...cfg, seed: 1000 + i }));
const good = games.filter(g => !g.failed);
ok(good.length === games.length, `tutte le ${games.length} partite completate senza failed:true`);

for (const g of good) {
  ok(Array.isArray(g.sottoStrategy) && g.sottoStrategy.length === 4, 'tel.sottoStrategy ha una riga per giocatore');
  for (const x of g.sottoStrategy) {
    const rawSopra = g.hires.filter(h => h.seat === x.seat && h.side === 'sopra').length;
    const rawSotto = g.hires.filter(h => h.seat === x.seat && h.side === 'sotto').length;
    assert.strictEqual(x.sopraCount, rawSopra, 'sopraCount combacia col conteggio grezzo di tel.hires');
    assert.strictEqual(x.sottoCount, rawSotto, 'sottoCount combacia col conteggio grezzo di tel.hires');
    assert.ok(['0-1', '2', '3', '4+'].includes(x.profile), 'profile è uno dei 4 bucket attesi');
    assert.ok(Number.isFinite(x.pv) && Number.isFinite(x.rank), 'pv/rank finali sono numeri');
  }
}
console.log('✓ sopraCount/sottoCount per ogni giocatore-partita combaciano col log grezzo hires');
console.log('✓ profile/pv/rank ok su tutte le righe');

const report = formatReport(games, cfg);
const lines = report.split('\n');
ok(report.includes('STRATEGIA SOTTO vs SOPRA'), 'la sezione compare nel report');
ok(!lines.find(l => l.includes('attivazioni reparto/giocatore'))?.includes('NaN'), 'fix: "attivazioni reparto/giocatore" non è più NaN');
ok(!lines.find(l => l.startsWith('SCIOPERI:'))?.includes('NaN'), 'la riga SCIOPERI non contiene NaN');
// "Produzioni/commessa: media NaN..." è un bug preesistente SCOLLEGATO (altra sezione, altra causa) — segnalato a parte, non verificato qui.

console.log('\n✓ sotto-strategy-check: telemetria e report ok');
