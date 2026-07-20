// Profilo di build per tessera: quale strategia induce una tessera Piano Industriale, non solo il suo win%.
// Forza la tessera su un posto rotante (stesso trucco di recalcTile) e confronta quel posto contro il resto
// del tavolo nella STESSA partita: sector focus (attivazioni/produzione), assunzioni per nazionalità e turno,
// sviluppo Direzione, timing 1° Macchinario. Tutto già in tel (batchsim.js) — qui solo aggregazione + confronto.
// Uso: node scripts/tileprofile.js pf18,pf22,pf11 [--games 200] [--depth 6] [--rollouts 1] [--seed 5000]
import { readFileSync } from 'fs';
import { runOneGame } from '../src/game/batchsim.js';
import { SECTORS } from '../src/game/data.js';

function argVal(flag, def) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; }
const tileArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'pf18,pf22,pf11';
const nGames = parseInt(argVal('--games', '200'), 10);
const depth = parseInt(argVal('--depth', '6'), 10);
const rollouts = parseInt(argVal('--rollouts', '1'), 10);
const seedBase = parseInt(argVal('--seed', '5000'), 10);
const csvMode = process.argv.includes('--csv');

const baseCfg = JSON.parse(readFileSync(new URL('./live-config.json', import.meta.url)));
const tileIds = tileArg === 'all' ? baseCfg.tiles.map(t => t.id) : tileArg.split(',');
const P = 4;
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = x => (100 * x).toFixed(0) + '%';

for (const tileId of tileIds) {
  const tile = baseCfg.tiles.find(t => t.id === tileId);
  if (!tile) { console.error(`Tessera ${tileId} non trovata in live-config.json`); continue; }
  const nationCond = tile.objectives.find(o => o.cond.type === 'workers_nation')?.cond;
  const sectorCond = tile.objectives.find(o => o.cond.type === 'sector_leader')?.cond;

  const focus = [], field = []; // stats per game: {seat stats}
  let winsFocus = 0, gamesOk = 0;
  for (let g = 0; g < nGames; g++) {
    const tel = runOneGame({
      ...baseCfg, headless: true, seed: seedBase + g,
      players: Array.from({ length: P }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
      aiRollout: { depth, rollouts },
      forcedTile: tile, forcedSeat: g % P,
    });
    if (tel.failed) continue;
    gamesOk++;
    const seat = g % P;
    if (seat === tel.winner) winsFocus++;
    for (let s = 0; s < P; s++) {
      const nationHires = tel.hires.filter(h => h.seat === s && h.nation === nationCond?.nation);
      const fourthNationTurn = nationHires.length >= 4 ? nationHires.map(h => h.turn).sort((a, b) => a - b)[3] : null;
      const r = tel.results.find(x => x.playerId === s);
      const row = {
        activ: sectorCond ? (tel.activationsBySector[s][sectorCond.sector] || 0) : null,
        resGen: sectorCond ? Object.values(tel.resGen[s]).reduce((a, b) => a + b, 0) : null,
        resGenSector: sectorCond ? (tel.resGen[s][sectorCond.sector] || 0) : null,
        nationHires: nationHires.length,
        fourthNationTurn,
        dirSopra: tel.cards[s].dirSopra, dirSotto: tel.cards[s].dirSotto,
        firstMachine: tel.firstMachineTurn[s],
        firstContract: tel.contracts[s][0]?.turn ?? null,
        lastHire: tel.build[s].lastHire || null,
        nContracts: tel.contracts[s].length,
        pvContracts: r?.pvContracts ?? null, pvObjectives: r?.pvObjectives ?? null, pvTrack: r?.pvTrack ?? null,
        objDone: (tel.tileObjectives[s] || []).filter(o => o.done).length,
        win: s === tel.winner ? 1 : 0,
      };
      (s === seat ? focus : field).push(row);
    }
  }

  const num = k => avg(focus.map(r => r[k]).filter(v => v != null));
  const numF = k => avg(field.map(r => r[k]).filter(v => v != null));

  if (csvMode) {
    // scomposizione per-tessera, seat forzato/ruotato: win% in fondo, non in testa (vedi discussione — è la conseguenza, non la causa)
    const cols = [
      tileId, tile.name, nationCond?.nation ?? '—', sectorCond?.sector ?? '—', gamesOk,
      num('objDone').toFixed(2), num('firstMachine').toFixed(1), num('lastHire').toFixed(1),
      num('activ').toFixed(1), num('nContracts').toFixed(2),
      num('pvContracts').toFixed(1), num('pvObjectives').toFixed(1), num('pvTrack').toFixed(1),
      pct(winsFocus / (gamesOk || 1)),
    ];
    console.log(cols.join('|'));
    continue;
  }

  console.log(`\n=== ${tileId} ${tile.name} — nazione ${nationCond?.nation ?? '—'} · settore ${sectorCond?.sector ?? '—'} (${gamesOk} partite forzate, seed ${seedBase}) ===`);
  console.log(`win% forzata: ${pct(winsFocus / (gamesOk || 1))} (sanity check vs report grande)`);
  console.log(`attivazioni settore-obiettivo: forzata ${num('activ').toFixed(1)} vs campo ${numF('activ').toFixed(1)}`);
  console.log(`risorse prodotte settore-obiettivo: forzata ${num('resGenSector').toFixed(1)} vs campo ${numF('resGenSector').toFixed(1)} (tot. tutti settori: forzata ${num('resGen').toFixed(1)} vs campo ${numF('resGen').toFixed(1)})`);
  console.log(`lavoratori nazione-obiettivo assunti: forzata ${num('nationHires').toFixed(2)} vs campo ${numF('nationHires').toFixed(2)}`);
  const focus4 = focus.map(r => r.fourthNationTurn).filter(v => v != null);
  const field4 = field.map(r => r.fourthNationTurn).filter(v => v != null);
  console.log(`turno 4° lavoratore nazione (chi ce la fa): forzata ${avg(focus4).toFixed(1)} (n=${focus4.length}/${focus.length}) vs campo ${avg(field4).toFixed(1)} (n=${field4.length}/${field.length})`);
  console.log(`Direzione: Sopra forzata ${num('dirSopra').toFixed(2)} vs campo ${numF('dirSopra').toFixed(2)} · Sotto forzata ${num('dirSotto').toFixed(2)} vs campo ${numF('dirSotto').toFixed(2)}`);
  console.log(`1° Macchinario: forzata turno ${num('firstMachine').toFixed(1)} vs campo ${numF('firstMachine').toFixed(1)}`);
  console.log(`ultima assunzione: forzata turno ${num('lastHire').toFixed(1)} vs campo ${numF('lastHire').toFixed(1)}`);
  console.log(`1ª commessa: forzata turno ${num('firstContract').toFixed(1)} vs campo ${numF('firstContract').toFixed(1)}`);
  console.log(`commesse/partita: forzata ${num('nContracts').toFixed(2)} vs campo ${numF('nContracts').toFixed(2)}`);
  console.log(`PV commesse/obiettivi/tracciati: forzata ${num('pvContracts').toFixed(1)}/${num('pvObjectives').toFixed(1)}/${num('pvTrack').toFixed(1)} vs campo ${numF('pvContracts').toFixed(1)}/${numF('pvObjectives').toFixed(1)}/${numF('pvTrack').toFixed(1)}`);
  console.log(`obiettivi completati (su 2): forzata ${num('objDone').toFixed(2)} vs campo ${numF('objDone').toFixed(2)}`);
}
