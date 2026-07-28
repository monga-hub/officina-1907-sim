// Self-check dei Corsi di Formazione SUL MOTORE. Uso: node scripts/corsi-check.js
// corsi.js ha già il suo self-check (`node src/game/corsi.js`) ma è puro: verifica il modello, non
// l'integrazione. Qui si verifica quello che solo il motore può rompere — che il posto sia davvero
// una risorsa CONDIVISA tra giocatori, che i trimestri chiudano col clock, che i Corsi spengano
// gli Impiegati, e che nessun batch con i Corsi accesi diverga dagli invarianti della telemetria.
import assert from 'node:assert/strict';
import { initGame, applyCommand, legalCommands } from '../src/game/engine.js';
import { NEW_WORKERS_MERGED, NEW_NODE_BANKS, NATIONS_NUOVO, IMPIEGATI_BANK, SECTORS } from '../src/game/data.js';
import { runOneGame } from '../src/game/batchsim.js';
import fs from 'node:fs';

const mk = corsi => initGame({
  seed: 1,
  players: Array.from({ length: 4 }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
  workers: NEW_WORKERS_MERGED, nations: NATIONS_NUOVO, nodeBanks: NEW_NODE_BANKS, welfareEnabled: false,
  corsi,
});
// porta il giocatore corrente al nodo dei Corsi senza passare dal movimento (qui interessa il nodo)
const alNodo = (s, coins = 99) => {
  const p = s.players[s.current];
  p.node = s.corsi.nodo; p.coins = coins; s.phase = 'action';
  s.sindacatoSession = { hireLavoratore: false, hireImpiegato: false, trattativa: false, unblock: false };
  return p;
};

// 1. default OFF: nessun comando 'corso' e nessuna regressione sul resto
{
  const s = mk(undefined);
  assert.equal(s.corsi.enabled, false, 'i Corsi sono OFF di default');
  alNodo(s);
  assert.equal(legalCommands(s).filter(c => c.type === 'corso').length, 0, 'OFF: nessun comando corso');
  assert.ok(s.nodeBanks.Sindacato.includes(IMPIEGATI_BANK), 'OFF: il banco Impiegati resta al Sindacato');
  assert.ok(legalCommands(s).some(c => c.type === 'hire' && c.bank === IMPIEGATI_BANK), 'OFF: si assumono ancora Impiegati');
  console.log('✓ default OFF: comportamento invariato');
}

// 2. ON: i Corsi SOSTITUISCONO gli Impiegati (non si sommano)
{
  const s = mk({ enabled: true });
  alNodo(s);
  const cmds = legalCommands(s);
  assert.ok(cmds.some(c => c.type === 'corso'), 'ON: i corsi sono disponibili');
  assert.equal(cmds.filter(c => c.type === 'hire' && c.bank === IMPIEGATI_BANK).length, 0, 'ON: nessun Impiegato assumibile');
  assert.ok(cmds.some(c => c.type === 'hire' && c.bank !== IMPIEGATI_BANK), 'ON: i lavoratori normali restano');
  console.log('✓ i Corsi sostituiscono gli Impiegati, non si sommano');
}

// 3. IL POSTO È CONDIVISO — è la differenza strutturale con gli Impiegati, l'invariante da non perdere
{
  const s = mk({ enabled: true, posti: { Tessile: [1, 0, 0], Metallurgica: [0, 0, 0], Chimica: [0, 0, 0] } });
  const p = alNodo(s);
  const cmd = legalCommands(s).find(c => c.type === 'corso');
  assert.ok(cmd && cmd.sector === 'Tessile', 'unico posto disponibile: Tessile');
  const s2 = applyCommand(s, cmd);
  assert.equal(s2.corsiLog.length, 1, 'il corso è registrato');
  // ora un ALTRO giocatore al nodo: il posto non c'è più per lui
  const s3 = { ...s2, current: (p.id + 1) % 4, phase: 'action', corsiSession: false };
  s3.players = s2.players.map(q => ({ ...q }));
  alNodo(s3);
  assert.equal(legalCommands(s3).filter(c => c.type === 'corso').length, 0, 'il posto preso da uno non è più disponibile per gli altri');
  console.log('✓ i posti sono una risorsa pubblica condivisa');
}

// 4. i trimestri chiudono col clock e i posti rimasti sono persi
{
  const s = mk({ enabled: true, bounds: [4, 8, 12], posti: { Tessile: [9, 9, 9], Metallurgica: [0, 0, 0], Chimica: [0, 0, 0] } });
  assert.equal(s.trimestre, 0, 'si parte da T1');
  s.clock = 9;
  const p = alNodo(s);
  // il clock viene letto alla chiusura: forziamo un avanzamento passando dal motore
  const s2 = applyCommand(s, legalCommands(s).find(c => c.type === 'corso'));
  assert.ok(s2.corsiLog[0].tri >= 0, 'il corso registra il trimestre in cui è stato preso');
  // chiusura diretta via clock: initGame + clock oltre l'ultima soglia
  const s3 = mk({ enabled: true, bounds: [4, 8, 12] });
  s3.clock = 99;
  const { chiudiTrimestri, tuttiChiusi } = await import('../src/game/corsi.js');
  chiudiTrimestri(s3);
  assert.ok(tuttiChiusi(s3), 'oltre l\'ultima soglia i trimestri sono tutti chiusi');
  alNodo(s3);
  assert.equal(legalCommands(s3).filter(c => c.type === 'corso').length, 0, 'trimestri chiusi: nessuna formazione possibile');
  console.log('✓ i trimestri chiudono col clock, i posti rimasti sono persi');
}

// 5. l'effetto è quello configurato — e NON tocca gli slot in Direzione (la scarsità è il posto)
{
  const s = mk({ enabled: true, effetto: { passi: [2, 2], scelta: 'fisso' }, costo: 6 });
  const p = alNodo(s, 10);
  const cmd = legalCommands(s).find(c => c.type === 'corso');
  assert.equal(cmd.sectors.length, 2, 'passi [2,2] → due reparti coinvolti');
  const pre = Object.fromEntries(['terziario', 'secondario', 'primario'].map(r => [s.players[p.id].depts[r].sector, s.players[p.id].depts[r].prod]));
  const dirPre = s.players[p.id].direzione.sopra.length;
  const s2 = applyCommand(s, cmd);
  const q = s2.players[p.id];
  const post = Object.fromEntries(['terziario', 'secondario', 'primario'].map(r => [q.depts[r].sector, q.depts[r].prod]));
  for (const sec of cmd.sectors) assert.equal(post[sec] - pre[sec], 2, `${sec} avanza dei 2 passi configurati`);
  assert.equal(q.coins, 10 - 6, 'il costo configurato è stato pagato');
  assert.equal(q.direzione.sopra.length, dirPre, 'il corso NON occupa uno slot in Direzione');
  console.log('✓ effetto, costo e slot: come da configurazione');
}

// 6. una sola formazione per visita, ma il resto del Sindacato resta combinabile
{
  const s = mk({ enabled: true });
  alNodo(s);
  const s2 = applyCommand(s, legalCommands(s).find(c => c.type === 'corso'));
  assert.equal(s2.corsiSession, true, 'la sessione segna la formazione fatta');
  assert.equal(legalCommands(s2).filter(c => c.type === 'corso').length, 0, 'niente seconda formazione nella stessa visita');
  assert.ok(legalCommands(s2).some(c => c.type === 'hire'), 'il Sindacato resta combinabile: si può ancora assumere');
  console.log('✓ una formazione per visita, sotto-azioni del Sindacato ancora combinabili');
}

// 7. batch con i Corsi accesi: invarianti della telemetria (gli stessi del check Impiegati)
{
  const bl = JSON.parse(fs.readFileSync(new URL('../src/game/baseline-config.json', import.meta.url)));
  bl.newWorkers = bl.workers;
  const games = [];
  for (let seed = 0; seed < 8; seed++) {
    games.push(runOneGame({
      ...bl, players: Array.from({ length: 4 }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
      aiRollout: null, seed: seed + 7000, corsi: { enabled: true },
    }));
  }
  const ok = games.filter(g => !g.failed);
  assert.equal(ok.length, games.length, 'nessuna partita fallita coi Corsi accesi');
  let n = 0;
  for (const g of ok) {
    const C = g.corsi.cfg;
    for (const b of g.corsiBuys) {
      n++;
      assert.equal(b.steps.length, C.effetto.passi.length, 'un passo per ogni reparto configurato');
      assert.equal(b.sectors[0], b.sector, "il primo reparto è quello d'iscrizione");
      assert.equal(new Set(b.sectors).size, b.sectors.length, 'nessun reparto ripetuto nella stessa formazione');
      for (const st of b.steps) {
        assert.equal(st.gained, st.to - st.from, 'gained = to − from');
        assert.ok(st.gained <= st.nominal, 'i passi reali non superano i nominali');
        assert.ok(st.to <= g.trackMax, 'il tracciato non supera il massimo');
        for (const m of st.ms) {
          const pos = g.msPos[st.role][m];
          assert.ok(pos > st.from && pos <= st.to, 'la milestone è stata davvero attraversata in questa salita');
        }
      }
    }
    // i posti occupati non superano mai quelli disponibili — l'invariante della risorsa condivisa
    for (const p2 of g.corsi.posti) {
      assert.ok(p2.occupati <= p2.tot, `${p2.sector} T${p2.tri + 1}: occupati ≤ disponibili`);
      const reali = g.corsiBuys.filter(b => b.sector === p2.sector && b.tri === p2.tri).length;
      assert.equal(p2.occupati, reali, 'la saturazione combacia con le formazioni registrate');
    }
    // il contributo per-reparto non può eccedere il tracciato finale
    for (const seatArr of g.corsi.perSeat) for (const d of seatArr) {
      assert.ok(d.corso <= d.prod, 'i passi da Corso non superano il tracciato finale');
    }
    assert.ok(g.corsiBlocked.every(b => b.reason), 'ogni blocco ha un motivo');
  }
  assert.ok(n > 0, 'il batch ha prodotto formazioni da verificare');
  console.log(`✓ telemetria Corsi: ${n} formazioni su ${ok.length} partite, invarianti ok`);
}

console.log('\n✓ corsi-check: motore e telemetria ok');
