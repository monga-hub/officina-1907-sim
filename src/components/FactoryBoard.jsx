import React, { useState } from 'react';
import { RESOURCE_OF, SECTOR_COLORS, NATION_FLAGS, ROLE_SLOTS_SOPRA, trackGridPos, TENSION_LIMIT } from '../game/data.js';
import { WORKER_BY_ID, describeCond } from '../game/engine.js';

const ROLE_LABEL = { terziario: 'Terziario', secondario: 'Secondario', primario: 'Primario' };
const RES_ICON = { Tessuti: '🧵', Acciaio: '⚒', Coloranti: '⚗' };

function WorkerChip({ id, blocked }) {
  const w = WORKER_BY_ID[id];
  return (
    <div className={`chip ${blocked ? 'blocked' : ''}`} style={{ borderColor: SECTOR_COLORS[w.sector] }} title={w.effectText}>
      {NATION_FLAGS[w.nation]} V{w.v} {blocked && '🔒'}
    </div>
  );
}

function cellLabel(cell, sector) {
  if (!cell) return '·';
  if (cell.coins) return `${cell.coins}ⓜ`;
  if (cell.res) return RES_ICON[RESOURCE_OF[sector]];
  if (cell.coinsPerIcon) return 'ⓜ×🂠';
  if (cell.coinsPerTension) return 'ⓜ×✊';
  if (cell.resPerIcon) return `${RES_ICON[RESOURCE_OF[sector]]}×🂠`;
  if (cell.resPerTension) return `${RES_ICON[RESOURCE_OF[sector]]}×✊`;
  if (cell.coinsPerFactory) return 'ⓜ×🏭';
  if (cell.resPerFactory) return `${RES_ICON[RESOURCE_OF[sector]]}×🏭`;
  if (cell.pv) return `${cell.pv}PV`;
  if (cell.pvPerIcon) return 'PV×🂠';
  if (cell.pvPerTension) return 'PV×✊';
  if (cell.pvPerFactory) return 'PV×🏭';
  if (cell.milestone) return '🏛';
  if (cell.tileSlot) return '□';
  return '·';
}

// Griglia 4x4 come sulla plancia fisica (righe A in alto → D in basso, serpentina da D1)
function Track({ dept, track, trackTileById }) {
  const grid = [[], [], [], []]; // righe A..D
  const max = track.length - 1;
  for (let pos = 1; pos <= max; pos++) {
    const [row, col] = trackGridPos(pos, max);
    grid[row][col] = pos;
  }
  return (
    <div className="track-grid">
      {grid.map((rowPos, r) => (
        <div key={r} className="track-row">
          {rowPos.map((pos, c) => {
            const filledId = dept.tileFills?.[pos];
            const filledTile = filledId ? trackTileById[filledId] : null;
            const cell = filledTile ? { [filledTile.cellType]: filledTile.amount } : track[pos];
            const title = filledTile
              ? `Posizione ${pos} — tile "${filledTile.name}"`
              : `Posizione ${pos}${cell?.milestone ? ' — Milestone' : cell?.pv ? ` — soglia ${cell.pv} PV a fine partita` : cell?.tileSlot ? ' — slot tile vuoto (compra al nodo Servizi)' : ''}`;
            return (
              <span key={c}
                className={`cell ${dept.prod === pos ? 'here' : ''} ${dept.prod >= pos ? 'passed' : ''}`}
                title={title}>
                {cellLabel(cell, dept.sector)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function FactoryBoard({ state, player, isCurrent }) {
  const [showTile, setShowTile] = useState(false);
  const roles = ['terziario', 'secondario', 'primario'];
  return (
    <div className={`factory ${isCurrent ? 'current' : ''}`} style={{ borderColor: player.color }}>
      <div className="factory-head">
        <b style={{ color: player.color }}>{player.name}</b>
        <span className="board-name">{player.boardName}{player.isAI ? ' · AI' : ''}</span>
        <span className="wealth">
          ⓜ {player.coins} &nbsp;
          {Object.entries(player.resources).map(([r, n]) => <span key={r}>{RES_ICON[r]} {n} </span>)}
        </span>
        <span className="pos">📍 {player.node}</span>
        <button className="tile-btn" onClick={() => setShowTile(!showTile)}>
          Piano Industriale {player.achieved.filter(Boolean).length}/3 {showTile ? '▾' : '▸'}
        </button>
      </div>
      {showTile && (
        <ul className="tile">
          {player.tile.objectives.map((o, i) => (
            <li key={i} className={player.achieved[i] ? 'done' : ''}>
              {player.achieved[i] ? '✔' : '○'} {describeCond(o.cond)} — <b>{o.pv} PV</b>
            </li>
          ))}
        </ul>
      )}
      <div className="depts">
        {roles.map(role => {
          const d = player.depts[role];
          return (
            <div key={role} className="dept" style={{ background: SECTOR_COLORS[d.sector] + '22', borderColor: SECTOR_COLORS[d.sector] }}>
              <div className="dept-head">
                <b style={{ color: SECTOR_COLORS[d.sector] }}>{d.sector}</b>
                <small> {ROLE_LABEL[role]}</small>
                <span className={`tension t${d.tension}`} title="Tensione">✊ {d.tension}/{TENSION_LIMIT}</span>
              </div>
              <Track dept={d} track={state.tracks[role]} trackTileById={state.trackTileById} />
              <div className="slots">
                <div className="slot-row">
                  <small>Sopra {d.sopra.length}/{ROLE_SLOTS_SOPRA[role]}</small>
                  {d.sopra.map(id => <WorkerChip key={id} id={id} blocked={d.blocked.includes(id)} />)}
                </div>
                <div className="slot-row">
                  <small>Sotto {d.sotto.length}/2</small>
                  {d.sotto.map(id => <WorkerChip key={id} id={id} blocked={d.blocked.includes(id)} />)}
                </div>
              </div>
            </div>
          );
        })}
        <div className="dept direzione">
          <div className="dept-head"><b>Direzione</b></div>
          <div className="slots">
            <div className="slot-row">
              <small>{state.servicesMode === 'struttura' ? 'Struttura Sopra' : 'Impiegati'} {player.direzione.sopra.length}/{state.slots.direzione.sopra}</small>
              {player.direzione.sopra.map((it, i) => {
                if (it && it.struttura) return (
                  <div key={i} className="chip welfare" title={`Potenza T${state.strutturaCards[it.idx]?.power.Tessile || 0}/M${state.strutturaCards[it.idx]?.power.Metallurgica || 0}/C${state.strutturaCards[it.idx]?.power.Chimica || 0}`}>
                    🏗 Struttura #{it.idx + 1}
                  </div>
                );
                const imp = WORKER_BY_ID[it];
                if (imp?.power) return (
                  <div key={i} className="chip welfare" title={`Avanza ${Object.entries(imp.power).map(([s, n]) => `${s} +${n}`).join(', ')}`}>
                    👔 {imp.nation}
                  </div>
                );
                return (
                  <div key={i} className="chip welfare" title={`Avanza ${state.welfareById[it].s1} +${state.welfareById[it].t1}, ${state.welfareById[it].s2} +${state.welfareById[it].t2}`}>
                    🛡 {state.welfareById[it].name}
                  </div>
                );
              })}
            </div>
            {(state.servicesMode === 'struttura' || state.welfareEnabled) && <div className="slot-row">
              <small>{state.servicesMode === 'struttura' ? 'Struttura Sotto' : 'Macchinari'} {player.direzione.sotto.length}/{state.slots.direzione.sotto}</small>
              {player.direzione.sotto.map((m, i) => m && m.struttura ? (
                <div key={i} className="chip welfare" title={m.effect}>
                  🏗 Struttura #{m.idx + 1}
                </div>
              ) : (
                <div key={i} className="chip welfare" title="Produce a inizio turno">
                  ⚙ {state.welfareById[m.id].name} ({m.usesLeft})
                </div>
              ))}
            </div>}
          </div>
          <div className="won">
            {player.contractsWon.map((c, i) => (
              <span key={i} className="pv-chip" title={`Commessa ${c.size}`}>{c.pv} PV</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
