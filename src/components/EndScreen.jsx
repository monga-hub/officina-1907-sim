import React, { useState } from 'react';
import FactoryBoard from './FactoryBoard.jsx';
import { totalResources, describeCond } from '../game/engine.js';
import { CONTRACTS, SECTOR_COLORS, NODES, SECTORS } from '../game/data.js';

const SIZE_LABEL = { small: 'Piccola', medium: 'Media', large: 'Grande' };
const RES_DOT = { Tessile: '🧵', Metallurgica: '⚒', Chimica: '⚗' };
const NODE_LABEL = { Tessile: '⚙ Tessile', Metallurgica: '⚙ Metallurgica', Chimica: '⚙ Chimica', Servizi: '🏛 Servizi', Sindacato: '✊ Sindacato', Borsa: '⚖ Borsa' };

// Resoconto testuale copiabile della partita (da incollare in chat).
function buildReport(state) {
  const r = state.results, players = state.players;
  const L = [];
  L.push(`OFFICINA 1907 — Fine partita (${new Date().toLocaleString('it-IT')})`);
  const opt = [
    `seed ${state.seed}`,
    `${state.nPlayers} giocatori`,
    `${state.turn} round`,
    state.singlePlace ? 'commesse posto unico (2 carte/taglia)' : 'commesse 1°+2° posto',
    state.endOnTrigger ? 'fine immediata al trigger' : 'si completa il giro',
    state.rotateStart ? 'primo giocatore rotante' : 'primo giocatore fisso',
    state.rules.coinsRepeat ? 'marchi riproducono' : 'marchi solo attraversamento',
    `conversioni ${state.rules.coinsPerPV}ⓜ=1PV, ${state.rules.resPerPV}R=1PV`,
  ];
  L.push('Impostazioni: ' + opt.join(' · '));
  L.push(`Vince ${r[0].name} con ${r[0].total} PV.`);
  L.push('');
  L.push('Classifica (PV: Commesse / Piano Ind. / Tracciati / Marchi / Risorse / Scioperi = Totale):');
  r.forEach((x, i) => {
    const p = players[x.playerId];
    L.push(`${i + 1}° ${x.name} [${p.boardName}] — ${x.pvContracts}/${x.pvObjectives}/${x.pvTrack}/${x.pvCoins}/${x.pvResources}/${x.pvStrikes || 0} = ${x.total} PV · ${p.coins}ⓜ, ${totalResources(p)} risorse, ${p.activations} attivazioni rimasti`);
  });
  L.push('');
  players.forEach(p => {
    L.push(`— ${p.name} (${p.boardName}):`);
    p.tile.objectives.forEach((o, i) => L.push(`   ${p.achieved[i] ? '✔' : '✗'} ${describeCond(o.cond)} (${o.pv} PV)`));
    const wc = p.contractsWon;
    L.push(`   Commesse completate (${wc.length}): ` + (wc.length ? wc.map(c => `${SIZE_LABEL[c.size]} ${state.singlePlace ? '' : (c.place + 1) + '° '}${c.pv}PV${c.turn ? ' (t' + c.turn + ')' : ''}`).join(', ') : 'nessuna'));
    L.push('   Nodi visitati: ' + NODES.map(nd => `${NODE_LABEL[nd]} ${p.nodeVisits?.[nd] ?? 0}`).join(' · '));
    L.push('   Attivazioni per reparto: ' + SECTORS.map(s => `${s} ${p.activationsBySector?.[s] ?? 0}`).join(' · '));
    L.push('   Carte installate (↑Sopra/↓Sotto): ' + ['terziario', 'secondario', 'primario'].map(ro => `${p.depts[ro].sector} ${p.depts[ro].sopra.length}↑/${p.depts[ro].sotto.length}↓`).join(' · ') + ` · Direzione ${p.direzione.sopra.length}↑/${p.direzione.sotto.length}↓`);
    const sn = p.sindacato || {};
    L.push(`   Sindacato: ${sn.trattative ?? 0} trattative · sblocca carta ${sn.unblock ?? 0} · scioperi subiti da avversari ${p.strikesByOpponent ?? 0}`);
  });
  L.push('');
  L.push('Efficienza economica (perché ha vinto) — Marchi guad/spesi/finali · Risorse prod/spese/eff% (eff% può superare 100: include risorse iniziali/da effetti) · Produzioni · Commesse · Prod/comm · Risorse/comm (più basso = più efficiente) · turni commesse (gap):');
  r.forEach((x, i) => {
    const p = players[x.playerId], e = economy(p);
    const idx = e.prod > 0 ? (x.pvContracts / e.prod).toFixed(2) : '—';
    const idxTot = e.prod > 0 ? (x.total / e.prod).toFixed(2) : '—';
    L.push(`${i + 1}° ${x.name}: ⓜ ${e.gained}/${e.spent}/${e.final} · R ${e.resProd}/${e.resSpent}/${e.effRes}% · ${e.prod} prod · ${e.nc} comm · ${e.prodPerC} prod/c · ${e.resPerC} R/c · ${idx} PVcomm/prod · ${idxTot} PVtot/prod · ${e.seqStr}${e.gapStr !== '—' ? ` (gap ${e.gapStr})` : ''}`);
  });
  L.push('');
  L.push('Marchi — dove sono finiti (iniziali+guadagnati → lavoratori/direzione/sindacato/borsa/movimento → rimasti):');
  r.forEach((x, i) => {
    const p = players[x.playerId], e = economy(p);
    L.push(`${i + 1}° ${x.name}: ${e.start}+${e.gained} → L${e.by.lavoratori}/D${e.by.direzione}/S${e.by.sindacato}/B${e.by.borsa}/M${e.by.movimento} → ${e.final} rimasti`);
  });
  L.push('');
  L.push('Visite ai nodi (totale tavolo): ' + NODES.map(nd => `${NODE_LABEL[nd]} ${players.reduce((a, p) => a + (p.nodeVisits?.[nd] ?? 0), 0)}`).join(' · '));
  L.push('');
  L.push('— ANALISI DEI RISULTATI —');
  buildAnalysis(state).forEach(line => L.push('• ' + line));
  return L.join('\n');
}

// Efficienza economica: quanto un giocatore ha CONVERTITO produzione in punti (non solo accumulato).
function economy(p) {
  const resProd = SECTORS.reduce((a, s) => a + (p.resGen?.[s] || 0), 0);
  const resSpent = SECTORS.reduce((a, s) => a + (p.resSpent?.[s] || 0), 0);
  const gained = p.coinsGained || 0;
  const spent = (p.coinsStart || 0) + gained - p.coins; // marchi spesi = iniziali + guadagnati − finali
  const nc = p.contractsWon.length;
  const per = x => (nc > 0 ? (x / nc).toFixed(1) : '—');
  // cadenza commesse: sequenza dei turni + gap (la media sola inganna con 2-3 commesse)
  const turns = p.contractsWon.map(c => c.turn).filter(Boolean).sort((a, b) => a - b);
  const gaps = turns.slice(1).map((t, i) => t - turns[i]);
  const span = turns.length ? `t${turns[0]}${turns.length > 1 ? `→t${turns[turns.length - 1]}` : ''}` : '—';
  const seqStr = turns.length ? turns.map(t => 't' + t).join('→') : '—';
  const gapStr = gaps.length ? gaps.join('/') : '—';
  return {
    resProd, resSpent, effRes: resProd > 0 ? Math.round((100 * resSpent) / resProd) : 0,
    gained, spent, final: p.coins, prod: p.activations, nc,
    prodPerC: per(p.activations), resPerC: per(resProd), span, seqStr, gapStr,
    start: p.coinsStart || 0,
    by: p.coinsSpentBy || { lavoratori: 0, direzione: 0, sindacato: 0, borsa: 0, movimento: 0 },
  };
}

// Osservazioni auto-generate dalla singola partita.
function buildAnalysis(state) {
  const r = state.results, players = state.players, A = [];
  const win = r[0], second = r[1];
  A.push(`Vince ${win.name} con ${win.total} PV${second ? `, +${win.total - second.total} sul 2°` : ''}.`);
  // Profilo del vincitore: sui canali-fine (Commesse/Piano/Tracciati; marchi e risorse sono MEZZI, non causa).
  // Non "vinta grazie alla componente X vs media" (fuorviante): guarda dove è primo in assoluto e dove è ultimo.
  const chan = [['pvContracts', 'Commesse'], ['pvObjectives', 'Piano Industriale'], ['pvTrack', 'Tracciati']];
  const others = r.slice(1);
  const isTop = k => others.length > 0 && others.every(x => win[k] > x[k]);      // in testa da solo
  const isBottom = k => others.length > 0 && others.every(x => win[k] < x[k]);   // ultimo del tavolo
  const firsts = chan.filter(([k]) => isTop(k));
  const weak = chan.filter(([k]) => isBottom(k));
  let prof;
  if (firsts.length >= 2) prof = `domina su più fronti (${firsts.map(c => c[1]).join(', ')})`;
  else if (firsts.length === 1) prof = `specialista dei ${firsts[0][1]}`;
  else prof = 'equilibrato — nessun canale in testa ma nessun punto debole (secondo su più fronti)';
  A.push(`Profilo del vincitore: ${prof}.`);
  if (firsts.length && weak.length) A.push(`Ha compensato la debolezza sui ${weak.map(c => c[1]).join(', ')} con ${firsts.map(c => c[1]).join('/')}.`);
  // margine stretto o largo
  if (second) {
    const marg = win.total - second.total;
    if (marg <= 3) A.push(`Partita tirata: solo ${marg} PV tra 1° e 2°.`);
    else if (marg >= 20) A.push(`Vittoria netta: ${marg} PV di margine sul 2°.`);
  }
  // più bersagliato
  const atk = players.map(p => p.strikesByOpponent ?? 0);
  const mx = Math.max(...atk);
  if (mx > 0) A.push(`Più bersagliato dagli scioperi: ${players[atk.indexOf(mx)].name} (${mx} subiti da avversari).`);
  // obiettivi: quanti completati sul tavolo
  const objDone = players.reduce((a, p) => a + p.achieved.filter(Boolean).length, 0);
  const objTot = players.reduce((a, p) => a + p.achieved.length, 0);
  A.push(`Obiettivi Piano Industriale completati: ${objDone}/${objTot} sul tavolo.`);
  // azioni Sindacato non usate
  const sum = k => players.reduce((a, p) => a + (p.sindacato?.[k] || 0), 0);
  const dead = [];
  if (sum('unblock') === 0) dead.push('sblocca-carta');
  if (dead.length) A.push(`Azioni al Sindacato non usate: ${dead.join(', ')}.`);
  // tracciato più mollato
  const roleLabel = { terziario: 'Terziario', secondario: 'Secondario', primario: 'Primario' };
  const roleProd = { terziario: 0, secondario: 0, primario: 0 };
  for (const p of players) for (const role of Object.keys(roleProd)) roleProd[role] += p.depts[role].prod;
  const laggard = Object.keys(roleProd).reduce((a, b) => (roleProd[a] <= roleProd[b] ? a : b));
  A.push(`Tracciato meno sviluppato dal tavolo: ${roleLabel[laggard]}.`);
  return A;
}

function wonContractReq(c) {
  if (c.req) return c.req;
  if (c.reqIndex === undefined) return null;
  const card = CONTRACTS[c.size].find(k => k.id === c.cardId);
  return card ? card.reqs[c.reqIndex] : null;
}

function ContractsWonList({ player }) {
  if (player.contractsWon.length === 0) return <p className="hint">Nessuna commessa completata.</p>;
  return (
    <ul className="won-list">
      {player.contractsWon.map((c, i) => {
        const req = wonContractReq(c);
        return (
          <li key={i}>
            {SIZE_LABEL[c.size]} · {c.place + 1}° posto · <b>{c.pv} PV</b>
            {c.turn ? <span className="hint"> (turno {c.turn})</span> : null}
            {req && <span className="won-req"> — {req.map((s, j) => <span key={j} title={s} style={{ color: SECTOR_COLORS[s] }}>{RES_DOT[s]}</span>)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Grafico a linee SVG minimale: una serie per giocatore, colori dei giocatori
function LineChart({ title, players, series, yLabel }) {
  const W = 560, H = 200, PAD = 34;
  const maxLen = Math.max(...series.map(s => s.length), 2);
  const maxVal = Math.max(...series.flat(), 1);
  const x = i => PAD + (i / (maxLen - 1)) * (W - PAD - 10);
  const y = v => H - PAD + 10 - (v / maxVal) * (H - PAD - 20);
  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const xStep = Math.max(1, Math.ceil(maxLen / 8));
  return (
    <div className="chart-box">
      <h4>{title}</h4>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#4c4337" strokeWidth="0.5" />
            <text x={PAD - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#b3a893">{t}</text>
          </g>
        ))}
        {Array.from({ length: maxLen }).map((_, i) => (i % xStep === 0 || i === maxLen - 1) && (
          <text key={i} x={x(i)} y={H - PAD + 22} textAnchor="middle" fontSize="9" fill="#b3a893">{i + 1}</text>
        ))}
        <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="#b3a893">turno</text>
        {series.map((s, pi) => s.length > 0 && (
          <polyline key={pi} fill="none" stroke={players[pi].color} strokeWidth="2"
            points={s.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <div className="chart-legend">
        {players.map(p => <span key={p.id}><span className="dot" style={{ background: p.color }} /> {p.name}</span>)}
      </div>
    </div>
  );
}

export default function EndScreen({ state, onRestart }) {
  const r = state.results;
  const players = state.players;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = buildReport(state);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no-op */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="setup wide">
      <h1>Fine partita</h1>
      <p className="tagline">Vince <b>{r[0].name}</b> con {r[0].total} Punti Vittoria!</p>
      <button className="primary" onClick={copy}>{copied ? '✓ Copiato!' : '📋 Copia risultati (per la chat)'}</button>

      <div className="track-editor" style={{ textAlign: 'left', marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Analisi dei risultati</h3>
        <ul>{buildAnalysis(state).map((line, i) => <li key={i}>{line}</li>)}</ul>
      </div>
      <table className="results">
        <thead>
          <tr><th></th><th>Giocatore</th><th>Commesse</th><th>Piano Ind.</th><th>Tracciati</th><th>Marchi</th><th>Risorse</th><th>Scioperi</th><th>Totale PV</th>
            <th className="sep">ⓜ rimasti</th><th>Risorse rimaste</th><th>Attivazioni reparto</th></tr>
        </thead>
        <tbody>
          {r.map((x, i) => {
            const p = players[x.playerId];
            return (
              <tr key={x.playerId} className={i === 0 ? 'winner' : ''}>
                <td>{i + 1}°</td><td style={{ color: p.color }}>{x.name}</td>
                <td>{x.pvContracts}</td><td>{x.pvObjectives}</td><td>{x.pvTrack}</td><td>{x.pvCoins}</td><td>{x.pvResources}</td>
                <td>{x.pvStrikes || 0}</td>
                <td><b>{x.total}</b></td>
                <td className="sep">{p.coins}</td><td>{totalResources(p)}</td><td>{p.activations}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 style={{ textAlign: 'left' }}>Efficienza economica — perché ha vinto</h3>
      <p className="hint" style={{ textAlign: 'left' }}>Chi ha <b>convertito</b> la produzione in punti, non chi ha solo accumulato. «Eff. risorse» = risorse spese / prodotte (può superare il 100%: si consumano anche risorse iniziali e ottenute da effetti/Borsa). «Risorse/comm.» = risorse prodotte per commessa completata: <b>più basso = motore più efficiente</b>. «PV comm./prod.» = PV da commesse ÷ produzioni: quanto le produzioni diventano punteggio-commesse. «PV tot./prod.» = PV totali ÷ produzioni: valore complessivo estratto da ogni attivazione (chi produce poco ma "pesante" vs chi disperde). Utili per confrontare varianti di regolamento. «Commesse (turni)» = quando sono state completate (passa il mouse per i gap).</p>
      <div style={{ overflowX: 'auto' }}>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th><th>Marchi guad.</th><th>Marchi spesi</th><th>Marchi finali</th><th className="sep">Risorse prod.</th><th>Risorse spese</th><th>Eff. risorse</th><th className="sep">Produzioni</th><th>Commesse</th><th className="sep">Prod/comm.</th><th>Risorse/comm.</th><th>PV comm./prod.</th><th>PV tot./prod.</th><th>Commesse (turni)</th></tr>
        </thead>
        <tbody>
          {r.map((x, i) => {
            const p = players[x.playerId];
            const e = economy(p);
            return (
              <tr key={x.playerId} className={i === 0 ? 'winner' : ''}>
                <td style={{ color: p.color }}>{x.name}</td>
                <td>{e.gained}</td><td>{e.spent}</td><td>{e.final}</td>
                <td className="sep">{e.resProd}</td><td>{e.resSpent}</td><td>{e.effRes}%</td>
                <td className="sep">{e.prod}</td><td>{e.nc}</td>
                <td className="sep">{e.prodPerC}</td><td>{e.resPerC}</td><td><b>{e.prod > 0 ? (x.pvContracts / e.prod).toFixed(2) : '—'}</b></td><td><b>{e.prod > 0 ? (x.total / e.prod).toFixed(2) : '—'}</b></td><td title={e.gapStr !== '—' ? `gap ${e.gapStr}` : ''}>{e.seqStr}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <h3 style={{ textAlign: 'left' }}>Marchi — dove sono finiti</h3>
      <p className="hint" style={{ textAlign: 'left' }}>Come ha investito i marchi (non «per commessa», che mescola spese non correlate). Molti marchi «finali» = potenziale non convertito.</p>
      <div style={{ overflowX: 'auto' }}>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th><th>Iniziali</th><th>Guadagnati</th><th className="sep">Lavoratori</th><th>Direzione</th><th>Sindacato</th><th>Borsa</th><th>Movimento</th><th className="sep">Rimasti</th></tr>
        </thead>
        <tbody>
          {r.map((x, i) => {
            const p = players[x.playerId];
            const e = economy(p);
            return (
              <tr key={x.playerId} className={i === 0 ? 'winner' : ''}>
                <td style={{ color: p.color }}>{x.name}</td>
                <td>{e.start}</td><td>{e.gained}</td>
                <td className="sep">{e.by.lavoratori}</td><td>{e.by.direzione}</td><td>{e.by.sindacato}</td><td>{e.by.borsa}</td><td>{e.by.movimento}</td>
                <td className="sep">{e.final}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <h3 style={{ textAlign: 'left' }}>Visite ai nodi della mappa</h3>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th>{NODES.map(nd => <th key={nd}>{NODE_LABEL[nd]}</th>)}<th className="sep">Totale</th></tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id}>
              <td style={{ color: p.color }}>{p.name}</td>
              {NODES.map(nd => <td key={nd}>{p.nodeVisits?.[nd] ?? 0}</td>)}
              <td className="sep">{NODES.reduce((a, nd) => a + (p.nodeVisits?.[nd] ?? 0), 0)}</td>
            </tr>
          ))}
          <tr className="winner">
            <td><b>Tavolo</b></td>
            {NODES.map(nd => <td key={nd}><b>{players.reduce((a, p) => a + (p.nodeVisits?.[nd] ?? 0), 0)}</b></td>)}
            <td className="sep"><b>{players.reduce((a, p) => a + NODES.reduce((b, nd) => b + (p.nodeVisits?.[nd] ?? 0), 0), 0)}</b></td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ textAlign: 'left' }}>Attivazioni reparto</h3>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th>{SECTORS.map(s => <th key={s}>Attiva {s}</th>)}<th className="sep">Tot attivazioni</th></tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id}>
              <td style={{ color: p.color }}>{p.name}</td>
              {SECTORS.map(s => <td key={s}>{p.activationsBySector?.[s] ?? 0}</td>)}
              <td className="sep">{p.activations}</td>
            </tr>
          ))}
          <tr className="winner">
            <td><b>Tavolo</b></td>
            {SECTORS.map(s => <td key={s}><b>{players.reduce((a, p) => a + (p.activationsBySector?.[s] ?? 0), 0)}</b></td>)}
            <td className="sep"><b>{players.reduce((a, p) => a + p.activations, 0)}</b></td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ textAlign: 'left' }}>Sviluppo plance — carte installate (↑ Sopra / ↓ Sotto)</h3>
      <p className="hint" style={{ textAlign: 'left' }}>Quanto è sviluppata realmente la fabbrica: carte per reparto (col settore di quel giocatore) + Direzione. Molte attivazioni ma poche carte = tableau piccolo sfruttato bene; molte carte = motore grande.</p>
      <div style={{ overflowX: 'auto' }}>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th><th>Terziario</th><th>Secondario</th><th>Primario</th><th>Direzione</th><th className="sep">Tot. carte</th></tr>
        </thead>
        <tbody>
          {players.map(p => {
            const cell = d => `${d.sector} ${d.sopra.length}↑/${d.sotto.length}↓`;
            const dir = p.direzione;
            const tot = ['terziario', 'secondario', 'primario'].reduce((a, ro) => a + p.depts[ro].sopra.length + p.depts[ro].sotto.length, 0) + dir.sopra.length + dir.sotto.length;
            return (
              <tr key={p.id}>
                <td style={{ color: p.color }}>{p.name}</td>
                <td>{cell(p.depts.terziario)}</td><td>{cell(p.depts.secondario)}</td><td>{cell(p.depts.primario)}</td>
                <td>{dir.sopra.length}↑/{dir.sotto.length}↓</td>
                <td className="sep"><b>{tot}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <h3 style={{ textAlign: 'left' }}>Azioni al Sindacato (Trattativa)</h3>
      <table className="results">
        <thead>
          <tr><th>Giocatore</th><th>Trattative</th><th>Sblocca carta</th><th className="sep">Scioperi subiti (avversari)</th></tr>
        </thead>
        <tbody>
          {players.map(p => {
            const s = p.sindacato || {};
            return (
              <tr key={p.id}>
                <td style={{ color: p.color }}>{p.name}</td>
                <td>{s.trattative ?? 0}</td><td>{s.unblock ?? 0}</td>
                <td className="sep">{p.strikesByOpponent ?? 0}</td>
              </tr>
            );
          })}
          <tr className="winner">
            <td><b>Tavolo</b></td>
            {['trattative', 'unblock'].map(k => (
              <td key={k}><b>{players.reduce((a, p) => a + (p.sindacato?.[k] ?? 0), 0)}</b></td>
            ))}
            <td className="sep"><b>{players.reduce((a, p) => a + (p.strikesByOpponent ?? 0), 0)}</b></td>
          </tr>
        </tbody>
      </table>

      <div className="charts-row">
        <LineChart title="Marchi a fine turno" players={players} series={players.map(p => p.coinsHistory)} />
        <LineChart title="Risorse totali a fine turno" players={players} series={players.map(p => p.resHistory)} />
      </div>

      <div className="end-detail">
        {players.map(p => (
          <div key={p.id} className="end-tile">
            <b style={{ color: p.color }}>{p.name}</b> — {p.boardName} · {p.activations} attivazioni
            <ul>
              {p.tile.objectives.map((o, i) => (
                <li key={i} className={p.achieved[i] ? 'done' : ''}>{p.achieved[i] ? '✔' : '✗'} {describeCond(o.cond)} ({o.pv} PV)</li>
              ))}
            </ul>
            <div className="won-title">Commesse completate ({p.contractsWon.length}):</div>
            <ContractsWonList player={p} />
          </div>
        ))}
      </div>

      <h3 style={{ textAlign: 'left' }}>Situazione finale delle plance</h3>
      <div className="final-boards">
        {players.map(p => <FactoryBoard key={p.id} state={state} player={p} isCurrent={false} />)}
      </div>

      <button className="primary" onClick={onRestart}>Nuova partita</button>
    </div>
  );
}
