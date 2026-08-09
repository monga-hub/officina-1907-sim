// Self-check: toggle Piano Industriale (default OFF) + obiettivi di gara RACE (podio 7/5/3 in Città).
// Uso: node scripts/race-check.js
import assert from 'node:assert';
import fs from 'node:fs';
import { initGame, legalCommands, applyCommand, scorePlayer, WORKER_BY_ID } from '../src/game/engine.js';

const ok = (c, m) => { assert.ok(c, m); console.log('✓ ' + m); };
const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
bl.newWorkers = bl.workers;
const players = [{ name: 'P0', isAI: true }, { name: 'P1', isAI: true }];

// ---- Task 1: Piano Industriale spento di default ----
{
  const s = initGame({ ...bl, players });
  ok(s.pianoEnabled === false, 'pianoEnabled default = false');
  ok(s.players.every(p => p.tile.objectives.length === 0), 'Piano OFF: nessun obiettivo privato sulle tessere');
  ok(s.players.every(p => p.achieved.length === 0), 'Piano OFF: achieved vuoto (coerente con objectives)');
  ok(s.players.every(p => scorePlayer(s, p).pvObjectives === 0), 'Piano OFF: pvObjectives = 0');
}
{
  const s = initGame({ ...bl, pianoEnabled: true, players });
  ok(s.players.every(p => p.tile.objectives.length > 0), 'Piano ON: le tessere hanno obiettivi');
  ok(s.players.every(p => p.achieved.length === p.tile.objectives.length), 'Piano ON: achieved allineato a objectives');
}

// ---- Task 2: obiettivi di gara RACE ----
// 3 id di lavoratori della STESSA nazionalità (dopo initGame WORKER_BY_ID è popolato dal mazzo in config).
function threeSameNation() {
  const byNat = {};
  for (const w of Object.values(WORKER_BY_ID)) (byNat[w.nation] ??= []).push(w.id);
  const nat = Object.keys(byNat).find(k => byNat[k].length >= 3);
  return byNat[nat].slice(0, 3);
}

const raceCfg = {
  ...bl, players,
  raceObjectives: { enabled: true, podium: [7, 5, 3], list: [{ id: 'race_same', type: 'sopra_same_nation', n: 3, enabled: true }] },
  borsaExit: { enabled: true, coins: 2 },
};

const s0 = initGame(raceCfg);
const ids = threeSameNation();
ok(ids.length === 3, 'trovati 3 lavoratori della stessa nazionalità per il test');

// mette P0 in Città con 3 Sopra stessa nazionalità → qualificato per race_same
s0.current = 0;
s0.phase = 'borsa';
s0.players[0].node = 'Borsa';
s0.players[0].depts.terziario.sopra = [...ids];

const cmds0 = legalCommands(s0);
ok(cmds0.some(c => c.type === 'completeRace' && c.raceId === 'race_same'), 'P0 qualificato: completeRace offerto in Città');
ok(cmds0.some(c => c.type === 'borsaExit'), 'prima di rivendicare: la via "esci con bonus" è ancora aperta');

const s1 = applyCommand(s0, { type: 'completeRace', raceId: 'race_same' });
ok(s1.raceObjectives.list[0].claims[0] === 0, 'P0 primo sul podio (claims[0]=P0)');
ok(scorePlayer(s1, s1.players[0]).pvRace === 7, 'P0 1° arrivato → 7 PV di gara');

// dopo aver rivendicato, la via "esci con bonus" si chiude nella stessa visita
const cmds0b = legalCommands(s1);
ok(!cmds0b.some(c => c.type === 'borsaExit'), 'dopo la gara: "esci con bonus" non più disponibile (esclusività)');
ok(!cmds0b.some(c => c.type === 'completeRace'), 'P0 non può rivendicare due volte lo stesso obiettivo');

// P1 arriva secondo sullo stesso obiettivo → 5 PV
s1.current = 1;
s1.phase = 'borsa';
s1.players[1].node = 'Borsa';
s1.players[1].depts.terziario.sopra = [...ids];
const cmds1 = legalCommands(s1);
ok(cmds1.some(c => c.type === 'completeRace' && c.raceId === 'race_same'), 'P1 qualificato: posto sul podio ancora libero');
const s2 = applyCommand(s1, { type: 'completeRace', raceId: 'race_same' });
ok(s2.raceObjectives.list[0].claims.join(',') === '0,1', 'ordine di arrivo registrato: [P0, P1]');
ok(scorePlayer(s2, s2.players[1]).pvRace === 5, 'P1 2° arrivato → 5 PV di gara');
ok(scorePlayer(s2, s2.players[0]).pvRace === 7, 'P0 mantiene i 7 PV del 1° posto');

// "Impiegati compresi": 2 Lavoratori Sopra + 1 Impiegato della stessa nazione in Direzione → qualifica same_nation n=3
{
  const s = initGame(raceCfg);
  // trova un Impiegato (ha .power) e 2 Lavoratori (no .power) della sua stessa nazione
  const all = Object.values(WORKER_BY_ID);
  const imp = all.find(w => w.power && all.filter(x => !x.power && x.nation === w.nation).length >= 2);
  ok(!!imp, 'trovato un Impiegato con ≥2 Lavoratori della stessa nazione');
  const wIds = all.filter(x => !x.power && x.nation === imp.nation).slice(0, 2).map(x => x.id);
  s.current = 0; s.phase = 'borsa'; s.players[0].node = 'Borsa';
  s.players[0].depts.terziario.sopra = [...wIds];       // 2 Lavoratori stessa nazione
  ok(!legalCommands(s).some(c => c.type === 'completeRace'), 'con soli 2 Sopra non è ancora qualificato');
  s.players[0].direzione.sopra = [imp.id];               // +1 Impiegato stessa nazione (Sopra in Direzione)
  ok(legalCommands(s).some(c => c.type === 'completeRace' && c.raceId === 'race_same'),
    'Impiegati compresi: 2 Lavoratori + 1 Impiegato stessa nazione qualifica «3 stessa nazionalità»');
}

// meccanica spenta → nessun PV di gara anche se ci sarebbero claims
const sOff = initGame({ ...bl, players, raceObjectives: { enabled: false } });
ok(scorePlayer(sOff, sOff.players[0]).pvRace === 0, 'race spento: pvRace = 0');

console.log('\n✓ race-check: toggle Piano + obiettivi di gara ok');
