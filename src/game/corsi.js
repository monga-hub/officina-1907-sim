// ===== Corsi di Formazione (28/07/2026) — sostituiscono gli Impiegati quando `enabled` =====
//
// Questo NON è una meccanica: è uno spazio di design. Ogni numero qui sotto è un knob dell'editor,
// nessun valore è cablato nel motore. L'obiettivo è provare decine di varianti cambiando solo dati.
//
// Il modulo tiene separati i DUE problemi che il brief dell'autore vuole indipendenti:
//
//   MODELLO — trimestri, posti, costi, disponibilità.  QUANDO e QUANTO puoi formarti: la scarsità.
//   EFFETTO — passi, settori, regola di scelta.        COSA ottieni quando ti formi: il payoff.
//
// Sono due sezioni distinte di CORSI_DEFAULT e due gruppi di funzioni distinti qui sotto. Cambiare
// la scarsità (più posti in T2) non deve costringere a toccare il payoff (+3/+1), e viceversa.
// Il motore vede solo l'API in fondo al file: `corsoCommands` (cosa è legale) e `chiudiTrimestri`
// (il clock che scorre). Nessuna regola dei Corsi vive dentro engine.js.
//
// Differenza strutturale rispetto agli Impiegati che sostituiscono: gli Impiegati erano una risorsa
// PRIVATA (un mazzo da cui peschi, uno slot sulla tua plancia). I posti dei corsi sono una risorsa
// PUBBLICA CONDIVISA: il posto che prendi tu non c'è più per gli altri, e a fine trimestre i posti
// avanzati sono persi per tutti. La competizione è il punto, ed è la variabile da tarare.

import { SECTORS } from './data.js';

// ⚠ MISTO: alcuni valori sono ancora SEED (ipotesi non tarate), altri sono CANDIDATI PLAYTEST supportati.
// Tarato — posti 2/2/2 + costo 5 (28/07/2026, sweep Posti×Costo 3×3 in aiRollout d6, 40 partite/config):
//   Lo sweep ha FALSIFICATO il criterio "~2,9 usi come gli Impiegati". Quel target apparteneva a una risorsa
//   PRIVATA (compri quando vuoi, vincolo = denaro); i Corsi sono risorsa PUBBLICA a capacità limitata, dove
//   il numero di acquisti EMERGE dalla contesa, non è una proprietà del bonus. Rendimento economico, ruolo
//   strategico ed effetto sui tracciati sono già risultati equivalenti a Impiegati → il vincolo 2,9 era l'unico
//   senza giustificazione autonoma, ed è stato abbandonato. La nuova domanda di design non è "quanti corsi",
//   ma "quanta pressione competitiva genera il nodo". 2/2/2+costo5 è il compromesso scelto: scarsità percepibile
//   (sat 79%), esclusione NON sistematica (2,3 giocatori esclusi/partita contro ~3,8 con 1/2/1), nodo ancora
//   desiderabile (3,54 corsi/gioc.). È il candidato ai PLAYTEST FISICI, non un balance finale: lo conferma o
//   lo falsifica l'osservazione umana ("opportunità da contendersi" vs "azione che fai se puoi"), non un altro sweep.
// SEED (non tarati, ipotesi del 28/07/2026): bounds 6/12/18, trimestri, trigger, effetto [3,1]/'ia', maxPerTrimestre.
//   Restano il primo valore plausibile scelto a intuito, non perché i dati lo indicassero. Quando uno verrà
//   tarato su un batch, va annotato QUI come sopra, con data e numero che lo giustifica.
export const CORSI_DEFAULT = {
  enabled: true,         // default ON (28/07/2026): i Corsi sostituiscono gli Impiegati nel baseline. Prima era OFF (no regressione) — ora è la meccanica canonica da portare ai playtest.
  nodo: 'Sindacato',     // dove ci si iscrive (gli Impiegati stavano qui: stesso nodo, per confronto pulito)

  // ---------- MODELLO: la scarsità ----------
  trimestri: 3,          // 1..4
  trigger: 'clock',      // 'clock' | 'turno' — cosa fa scorrere i trimestri (estendibile: vedi valoreTrigger)
  // Soglia che CHIUDE il trimestre i-esimo — stessa semantica di borsaIndici.quadBounds, di proposito:
  // il Clock è già scandito così per i quadrimestri della Borsa, due semantiche diverse sarebbero un bug in agguato.
  // [6,12,18] = T1 aperto finché il clock è < 6, T2 finché < 12, T3 finché < 18.
  // SEED: terzi esatti di un clock a 18. Sceglierle davvero richiede sapere a che TURNO arriva ogni valore
  // di clock — vedi la sezione «PASSO DEL CLOCK» del report, che è lì apposta per rispondere a questa domanda.
  bounds: [6, 12, 18],
  // Posti per reparto per trimestre. NON assumere che i reparti siano uguali: è esattamente una delle
  // asimmetrie da testare (un reparto più affollato vale come leva di bilanciamento).
  posti: {
    Tessile:      [2, 2, 2],
    Metallurgica: [2, 2, 2],
    Chimica:      [2, 2, 2],
  },
  // Costo. Accetta tre forme, risolte da costoCorso():
  //   4                              → fisso
  //   [3, 4, 5]                      → per trimestre
  //   { Tessile: 4, Chimica: 5, … }  → per reparto
  costo: 5,               // tarato: vedi banner in testa (sweep Posti×Costo 3×3, 28/07/2026)
  maxPerTrimestre: 0,    // quante formazioni può fare UN giocatore in uno stesso trimestre (0 = nessun limite)

  // ---------- EFFETTO: il payoff ----------
  effetto: {
    // Passi per reparto coinvolto, in ordine: passi[0] va SEMPRE al reparto in cui hai preso il posto,
    // passi[1..] ai reparti secondari scelti secondo `scelta`.
    // La LUNGHEZZA di questo array è il "numero di settori coinvolti" del brief — è un knob solo, non due:
    // tenere un `nSettori` separato dall'array è un invariante da mantenere a mano, cioè un bug che aspetta.
    //   [4]        → un solo reparto, +4
    //   [3, 1]     → gli Impiegati di oggi
    //   [2, 2]     → due reparti pari
    //   [2, 1, 1]  → tutti e tre
    passi: [3, 1],
    // Come si determinano i reparti SECONDARI (il primo è il reparto del posto):
    //   'ia'    → il motore genera un comando per ogni combinazione, l'IA sceglie (decisione vera)
    //   'max'   → i reparti col tracciato più AVANTI (deterministico, "massimo valore")
    //   'min'   → i reparti col tracciato più INDIETRO (deterministico, recupero)
    //   'fisso' → i successivi in ordine ciclico SECTORS (deterministico, nessuna scelta: come la carta Impiegato)
    scelta: 'ia',
  },
};

export function mergeCorsi(cfg) {
  const C = { ...CORSI_DEFAULT, ...(cfg || {}) };
  // Gli array vanno SOSTITUITI, non fusi: uno spread superficiale terrebbe la coda del default
  // (bounds [4] su un default [6,12,18] diventerebbe [4,12,18] — bug silenzioso). Stessa cura di mergeBorsaIndici.
  C.bounds = (cfg?.bounds || CORSI_DEFAULT.bounds).slice();
  C.posti = {};
  for (const s of SECTORS) C.posti[s] = (cfg?.posti?.[s] || CORSI_DEFAULT.posti[s] || []).slice();
  C.effetto = { ...CORSI_DEFAULT.effetto, ...(cfg?.effetto || {}) };
  C.effetto.passi = (cfg?.effetto?.passi || CORSI_DEFAULT.effetto.passi).slice();
  C.trimestri = Math.max(1, Math.min(4, C.trimestri | 0));
  // Un effetto non può toccare più reparti di quanti ne esistano: il resto sarebbe silenziosamente ignorato.
  C.effetto.passi = C.effetto.passi.slice(0, SECTORS.length);
  return C;
}

// ============================================================================
// MODELLO — trimestri, posti, costo. Nessuna nozione di "quanti passi dà un corso".
// ============================================================================

// Il valore che fa scorrere i trimestri. Aggiungere un trigger = aggiungere un case qui, nient'altro.
function valoreTrigger(state) {
  return state.corsi.trigger === 'turno' ? state.turn : state.clock;
}

// Trimestre corrente (0-based). Se == trimestri, sono tutti chiusi: nessuna formazione possibile.
export function trimestreCorrente(state) {
  return state.trimestre;
}
export function tuttiChiusi(state) {
  return state.trimestre >= state.corsi.trimestri;
}

// Chiude ogni trimestre la cui soglia è stata superata (un solo avanzamento può chiuderne più d'uno,
// come checkQuadClose). I posti rimasti NON si riportano avanti: sono persi, ed è il punto del design.
// Non serve memorizzare i persi — sono `posti[t] − occupati[t]` per ogni t già chiuso (vedi postiPersi).
export function chiudiTrimestri(state) {
  if (!state.corsi.enabled) return;
  const v = valoreTrigger(state);
  while (state.trimestre < state.corsi.trimestri && v >= (state.corsi.bounds[state.trimestre] ?? Infinity)) {
    state.trimestre += 1;
  }
}

export function postiTotali(C, sector, tri) {
  return C.posti[sector]?.[tri] ?? 0;
}
export function postiOccupati(state, sector, tri) {
  return state.corsiLog.filter(c => c.sector === sector && c.tri === tri).length;
}
export function postiLiberi(state, sector, tri = state.trimestre) {
  return Math.max(0, postiTotali(state.corsi, sector, tri) - postiOccupati(state, sector, tri));
}
// Posti mai occupati in un trimestre GIÀ CHIUSO: la metrica di sovradimensionamento.
export function postiPersi(state, sector, tri) {
  return tri < state.trimestre ? postiLiberi(state, sector, tri) : 0;
}

export function costoCorso(C, tri, sector) {
  const c = C.costo;
  if (Array.isArray(c)) return c[tri] ?? c[c.length - 1] ?? 0;
  if (c && typeof c === 'object') return c[sector] ?? 0;
  return c ?? 0;
}

export function formazioniDi(state, seat, tri = state.trimestre) {
  return state.corsiLog.filter(c => c.seat === seat && c.tri === tri).length;
}

// ============================================================================
// EFFETTO — quanti passi, su quali reparti. Nessuna nozione di posti o trimestri.
// ============================================================================

// Tutte le tuple ordinate di `k` settori presi da `pool` (k ≤ 2 in pratica: 6 tuple al massimo).
function tuple(pool, k) {
  if (k <= 0) return [[]];
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    for (const rest of tuple(pool.filter((_, j) => j !== i), k - 1)) out.push([pool[i], ...rest]);
  }
  return out;
}

// I reparti secondari possibili, dato il reparto del posto. Ritorna una LISTA di alternative:
// una sola voce per le modalità deterministiche, più voci per 'ia' (che le fa valutare tutte).
export function settoriSecondari(C, primario, player, posOf) {
  const k = C.effetto.passi.length - 1;
  const altri = SECTORS.filter(s => s !== primario);
  if (k <= 0) return [[]];
  switch (C.effetto.scelta) {
    case 'ia':
      return tuple(altri, Math.min(k, altri.length));
    case 'max':
      return [[...altri].sort((a, b) => posOf(player, b) - posOf(player, a)).slice(0, k)];
    case 'min':
      return [[...altri].sort((a, b) => posOf(player, a) - posOf(player, b)).slice(0, k)];
    default: { // 'fisso': i successivi in ordine ciclico — nessuna scelta, come la coppia stampata sulla carta Impiegato
      const i = SECTORS.indexOf(primario);
      return [Array.from({ length: k }, (_, n) => SECTORS[(i + 1 + n) % SECTORS.length])];
    }
  }
}

// La distribuzione dei passi di UNA formazione: [{ sector, passi }, …]. Puro: non tocca lo stato.
export function distribuzione(C, sectors) {
  return C.effetto.passi.map((passi, i) => ({ sector: sectors[i], passi })).filter(x => x.sector);
}

// ============================================================================
// API per il motore
// ============================================================================

// I comandi `corso` legali per il giocatore. `posOf(player, sector)` legge la posizione di un tracciato
// (la passa engine.js: qui non conosciamo la forma di player.depts, e non deve interessarci).
export function corsoCommands(state, player, posOf) {
  const C = state.corsi;
  if (!C.enabled || tuttiChiusi(state) || player.node !== C.nodo) return [];
  if (state.corsiSession) return [];                                       // una formazione per visita
  const tri = state.trimestre;
  if (C.maxPerTrimestre > 0 && formazioniDi(state, player.id, tri) >= C.maxPerTrimestre) return [];
  const cmds = [];
  for (const sector of SECTORS) {
    if (postiLiberi(state, sector, tri) <= 0) continue;
    if (player.coins < costoCorso(C, tri, sector)) continue;
    for (const sec of settoriSecondari(C, sector, player, posOf)) {
      cmds.push({ type: 'corso', sector, sectors: [sector, ...sec] });
    }
  }
  return cmds;
}

// Perché NON si può fare una formazione qui e ora. Serve alla telemetria "corso perso" (domanda
// bloccata dalla scarsità) — distinguere "trimestre chiuso" da "reparto saturo" da "non ha i marchi"
// è tutta la differenza tra "ho messo troppi pochi posti" e "il corso costa troppo".
export function bloccoCorso(state, player, posOf) {
  const C = state.corsi;
  if (!C.enabled || player.node !== C.nodo) return null;
  if (corsoCommands(state, player, posOf).length > 0) return null;
  if (tuttiChiusi(state)) return 'trimestri chiusi';
  if (state.corsiSession) return 'già formato in questa visita';
  const tri = state.trimestre;
  if (C.maxPerTrimestre > 0 && formazioniDi(state, player.id, tri) >= C.maxPerTrimestre) return 'limite personale del trimestre';
  const liberi = SECTORS.filter(s => postiLiberi(state, s, tri) > 0);
  if (liberi.length === 0) return 'tutti i reparti saturi';
  if (liberi.every(s => player.coins < costoCorso(C, tri, s))) return 'marchi insufficienti';
  return null;
}

// --- self-check del modulo (nessun motore, nessun framework): `node src/game/corsi.js` ---
// ponytail: gira solo se il file è eseguito direttamente, non all'import. Il guard su `process` non è
// zelo: questo modulo finisce nel bundle browser, dove `process` non esiste e il file esploderebbe all'import.
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('corsi.js')) {
  const assert = (c, m) => { if (!c) { console.error('✗ ' + m); process.exit(1); } console.log('✓ ' + m); };
  const posOf = (p, s) => p.track[s];
  const P = { id: 0, node: 'Sindacato', coins: 99, track: { Tessile: 1, Metallurgica: 9, Chimica: 5 } };
  const mk = over => ({ corsi: mergeCorsi({ enabled: true, ...over }), trimestre: 0, clock: 0, turn: 1, corsiLog: [], corsiSession: null });

  assert(mergeCorsi({ bounds: [4] }).bounds.length === 1, 'merge: bounds sostituito, non fuso col default');
  assert(mergeCorsi({ effetto: { passi: [4] } }).effetto.passi.length === 1, 'merge: passi sostituito, non fuso');
  assert(mergeCorsi({ effetto: { passi: [1, 1, 1, 1] } }).effetto.passi.length === SECTORS.length, 'merge: passi non può superare i reparti esistenti');

  assert(costoCorso(mergeCorsi({ costo: 4 }), 2, 'Chimica') === 4, 'costo fisso');
  assert(costoCorso(mergeCorsi({ costo: [3, 4, 5] }), 1, 'Chimica') === 4, 'costo per trimestre');
  assert(costoCorso(mergeCorsi({ costo: { Chimica: 7 } }), 0, 'Chimica') === 7, 'costo per reparto');

  const s1 = mk({ bounds: [6, 12, 18] });
  s1.clock = 13; chiudiTrimestri(s1);
  assert(s1.trimestre === 2, 'un solo avanzamento di clock può chiudere più trimestri');
  s1.clock = 99; chiudiTrimestri(s1);
  assert(tuttiChiusi(s1), 'oltre l\'ultima soglia sono tutti chiusi');
  const s1t = mk({ trigger: 'turno', bounds: [3, 6, 9] });
  s1t.clock = 99; chiudiTrimestri(s1t);
  assert(s1t.trimestre === 0, 'trigger turno: il clock non muove i trimestri');
  s1t.turn = 7; chiudiTrimestri(s1t);
  assert(s1t.trimestre === 2, 'trigger turno: avanza sul turno');

  const s2 = mk({ posti: { Tessile: [2, 0, 0], Metallurgica: [0, 0, 0], Chimica: [0, 0, 0] } });
  assert(corsoCommands(s2, P, posOf).every(c => c.sector === 'Tessile'), 'niente posti = niente comandi in quel reparto');
  s2.corsiLog.push({ seat: 1, tri: 0, sector: 'Tessile' }, { seat: 2, tri: 0, sector: 'Tessile' });
  assert(corsoCommands(s2, P, posOf).length === 0, 'posti esauriti da ALTRI giocatori: risorsa condivisa');
  assert(bloccoCorso(s2, P, posOf) === 'tutti i reparti saturi', 'blocco: saturazione riconosciuta');
  s2.trimestre = 1;
  assert(postiPersi(s2, 'Tessile', 0) === 0, 'T1 pieno: nessun posto perso');
  const s2b = mk({ posti: { Tessile: [3, 0, 0], Metallurgica: [0, 0, 0], Chimica: [0, 0, 0] } });
  s2b.corsiLog.push({ seat: 1, tri: 0, sector: 'Tessile' }); s2b.trimestre = 1;
  assert(postiPersi(s2b, 'Tessile', 0) === 2, 'trimestre chiuso con 1 posto su 3: 2 persi');
  assert(postiPersi(s2b, 'Tessile', 1) === 0, 'il trimestre corrente non ha ancora perso nulla');

  const povero = { ...P, coins: 1 };
  assert(bloccoCorso(mk({ costo: 5 }), povero, posOf) === 'marchi insufficienti', 'blocco: costo distinto dalla saturazione');
  const s3 = mk({ maxPerTrimestre: 1 });
  s3.corsiLog.push({ seat: 0, tri: 0, sector: 'Chimica' });
  assert(bloccoCorso(s3, P, posOf) === 'limite personale del trimestre', 'blocco: cap personale');
  assert(corsoCommands(s3, { ...P, id: 1 }, posOf).length > 0, 'il cap personale non blocca gli altri giocatori');

  const Cmax = mergeCorsi({ effetto: { passi: [3, 1], scelta: 'max' } });
  assert(settoriSecondari(Cmax, 'Tessile', P, posOf)[0][0] === 'Metallurgica', "scelta 'max': il tracciato più avanti");
  const Cmin = mergeCorsi({ effetto: { passi: [3, 1], scelta: 'min' } });
  assert(settoriSecondari(Cmin, 'Metallurgica', P, posOf)[0][0] === 'Tessile', "scelta 'min': il tracciato più indietro");
  const Cfix = mergeCorsi({ effetto: { passi: [3, 1], scelta: 'fisso' } });
  assert(settoriSecondari(Cfix, 'Tessile', P, posOf).length === 1, "scelta 'fisso': una sola alternativa");
  const Cia = mergeCorsi({ effetto: { passi: [3, 1], scelta: 'ia' } });
  assert(settoriSecondari(Cia, 'Tessile', P, posOf).length === 2, "scelta 'ia': tutte le alternative valutabili");
  const Cia3 = mergeCorsi({ effetto: { passi: [2, 1, 1], scelta: 'ia' } });
  assert(settoriSecondari(Cia3, 'Tessile', P, posOf).length === 2, "scelta 'ia' su 3 reparti: le 2 permutazioni ordinate");
  const Cuno = mergeCorsi({ effetto: { passi: [4], scelta: 'ia' } });
  assert(settoriSecondari(Cuno, 'Tessile', P, posOf).length === 1 && distribuzione(Cuno, ['Tessile']).length === 1, 'un solo reparto: nessun secondario');
  assert(distribuzione(Cia, ['Tessile', 'Chimica']).reduce((a, x) => a + x.passi, 0) === 4, 'distribuzione: i passi tornano');

  console.log('\n✓ corsi.js: modello e effetto ok');
}
