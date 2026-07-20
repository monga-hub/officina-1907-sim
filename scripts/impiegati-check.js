// Self-check del mercato Impiegati (mazzo nuovo). Uso: node scripts/impiegati-check.js
// simulate.js gira sul mazzo CLASSICO (nessun config.workers) e non tocca mai gli Impiegati: senza
// questo script il mercato dedicato a Servizi non ha nessuna copertura headless.
import assert from 'node:assert/strict';
import { initGame, applyCommand, legalCommands, bankMarket } from '../src/game/engine.js';
import { chooseCommand } from '../src/game/ai.js';
import { NEW_WORKERS_MERGED, NEW_NODE_BANKS, NATIONS_NUOVO, IMPIEGATI_BANK, IMPIEGATI_MARKET } from '../src/game/data.js';

// stessa config del mazzo nuovo che passa SetupScreen.cfg()
const newDeck = extra => initGame({
  seed: 1,
  players: Array.from({ length: 4 }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
  workers: NEW_WORKERS_MERGED, nations: NATIONS_NUOVO, nodeBanks: NEW_NODE_BANKS, welfareEnabled: false,
  ...extra,
});

// 1. il mazzo Impiegati è a parte: 12 carte, tutte con `power`, nessuna nei mazzetti A-E
const s = newDeck();
assert.equal(s.banks[IMPIEGATI_BANK].length, 12, '12 Impiegati nel mazzo dedicato');
assert.ok(s.banks[IMPIEGATI_BANK].every(id => NEW_WORKERS_MERGED.find(c => c.id === id).power), 'solo Impiegati nel mazzo');
for (const b of ['A', 'B', 'C', 'D', 'E']) {
  assert.ok(s.banks[b].every(id => !NEW_WORKERS_MERGED.find(c => c.id === id).power), `nessun Impiegato nel mazzetto ${b}`);
}
assert.deepEqual(s.nodeBanks.Servizi, ['D', IMPIEGATI_BANK], 'il mercato Impiegati sta al nodo Servizi');

// 2. a Servizi sono scoperte 3 carte Impiegato, tutte piazzabili solo in Direzione Sopra
const p = s.players[s.current];
p.node = 'Servizi';
p.coins = 99;
s.phase = 'action'; // il turno parte da 'move': saltiamo lo spostamento, qui interessa il nodo
const impCmds = legalCommands(s).filter(c => c.type === 'hire' && c.bank === IMPIEGATI_BANK);
const offered = [...new Set(impCmds.map(c => c.cardId))];
assert.equal(offered.length, IMPIEGATI_MARKET, `${IMPIEGATI_MARKET} Impiegati scoperti`);
assert.deepEqual(offered, s.banks[IMPIEGATI_BANK].slice(0, IMPIEGATI_MARKET), 'scoperte = prime 3 del mazzo');
assert.ok(impCmds.every(c => c.side === 'sopra' && c.role === 'direzione'), 'Impiegato solo in Direzione Sopra');
// il mazzetto D dello stesso nodo resta a profondità 1
const dCards = [...new Set(legalCommands(s).filter(c => c.type === 'hire' && c.bank === 'D').map(c => c.cardId))];
assert.equal(dCards.length, 1, 'banco lavoratori: solo la cima');

// 3. comprando un Impiegato il mercato si rifornisce dal mazzo (la 4ª carta diventa scoperta)
const fourth = s.banks[IMPIEGATI_BANK][IMPIEGATI_MARKET];
const bought = offered[1]; // non la cima: il mercato dev'essere comprabile in mezzo
const s2 = applyCommand(s, impCmds.find(c => c.cardId === bought));
assert.equal(s2.banks[IMPIEGATI_BANK].length, 11, 'la carta comprata esce dal mazzo');
assert.ok(!s2.banks[IMPIEGATI_BANK].includes(bought), 'la carta comprata non è più nel mazzo');
assert.equal(bankMarket(s2, IMPIEGATI_BANK).length, IMPIEGATI_MARKET, 'mercato di nuovo a 3');
assert.ok(bankMarket(s2, IMPIEGATI_BANK).includes(fourth), 'la 4ª carta è ora scoperta');
assert.ok(s2.players[p.id].direzione.sopra.includes(bought), 'Impiegato installato in Direzione Sopra');

// 4. Trattativa con "acquisto scontato" attivo: è l'UNICO ramo dell'IA che valuta una carta del banco con
// bestPlacement/hireValue invece di applicarla e basta. Di default è spento (TRATTATIVA_DEFAULT), quindi
// senza questo caso il check è cieco proprio dove un Impiegato (niente w.sector) fa esplodere quelle due.
// reqWelfare:2 = servono 2 carte in Direzione Sopra, cioè 2 Impiegati: il ramo si apre solo a metà partita.
for (let g = 0; g < 5; g++) {
  let st = newDeck({ seed: 3000 + g, headless: true, trattativa: { buyDiscount: { enabled: true, reqWelfare: 2, discount: 0 } } });
  let steps = 0;
  while (!st.gameOver && steps++ < 20000) st = applyCommand(st, chooseCommand(st));
  assert.ok(st.gameOver, `seed ${3000 + g}: partita con acquisto scontato terminata`);
}
console.log('✓ Trattativa con acquisto scontato: 5 partite, nessun crash su bestPlacement/hireValue');

// 5. partite intere sul mazzo nuovo: nessun crash, nessun mercato Impiegati rotto
for (let g = 0; g < 5; g++) {
  let st = newDeck({ seed: 2000 + g, headless: true });
  let steps = 0;
  while (!st.gameOver && steps++ < 20000) {
    st = applyCommand(st, chooseCommand(st));
    const mkt = bankMarket(st, IMPIEGATI_BANK);
    assert.equal(mkt.length, Math.min(IMPIEGATI_MARKET, st.banks[IMPIEGATI_BANK].length), 'mercato sempre a 3 finché il mazzo regge');
    assert.equal(new Set(mkt).size, mkt.length, 'nessun doppione tra le scoperte');
  }
  assert.ok(st.gameOver, `seed ${2000 + g}: partita terminata`);
  const hired = st.players.reduce((n, q) => n + q.direzione.sopra.length, 0);
  console.log(`✓ seed ${2000 + g}: ${st.turn} turni, Impiegati assunti ${hired}, rimasti nel mazzo ${st.banks[IMPIEGATI_BANK].length}`);
}

console.log('\n✓ mercato Impiegati ok');
