import React from 'react';
import { FACTORY_MAP, SECTOR_COLORS, RESOURCE_OF } from '../game/data.js';
// mappa dallo stato (editabile via config); fallback alla costante di default

// Mappa esagonale della Borsa a fabbriche. Risorse colorate per settore, fabbriche col colore del proprietario,
// spot fondabili evidenziati e cliccabili (per il giocatore umano). Pointy-top odd-r, come l'editor.
const S = 24, SQ3 = Math.sqrt(3);
function center(c, r) { return [30 + SQ3 * S * (c + 0.5 * (r & 1)), 28 + 1.5 * S * r]; }
function pts(cx, cy) { let a = []; for (let i = 0; i < 6; i++) { const g = Math.PI / 180 * (60 * i - 30); a.push((cx + S * Math.cos(g)).toFixed(1) + ',' + (cy + S * Math.sin(g)).toFixed(1)); } return a.join(' '); }

export default function FactoryMap({ state, legal, dispatch }) {
  const active = new Set(state.factoryHexes || []);
  const hexes = (state.factoryMap || FACTORY_MAP).hexes.filter(h => active.has(h.id));
  if (!hexes.length) return null;
  const buildable = legal.filter(c => c.type === 'buildFactory');
  const spotCmds = {}; // hexId → [cmd,...]
  for (const c of buildable) (spotCmds[c.hex] = spotCmds[c.hex] || []).push(c);
  const maxX = Math.max(...hexes.map(h => center(h.col, h.row)[0])) + S + 6;
  const maxY = Math.max(...hexes.map(h => center(h.col, h.row)[1])) + S + 6;
  const colorOf = pid => state.players[pid]?.color || '#888';

  return (
    <div>
      <svg viewBox={`0 0 ${maxX} ${maxY}`} style={{ width: '100%', maxWidth: maxX, display: 'block' }}>
        {hexes.map(h => {
          const [cx, cy] = center(h.col, h.row);
          const fact = state.hexFactory[h.id];
          const resSector = state.hexResource[h.id];
          const spot = spotCmds[h.id];
          let fill = 'rgba(255,255,255,0.04)', stroke = 'rgba(200,180,150,0.25)', sw = 1.5;
          if (h.type === 'risorsa') { fill = SECTOR_COLORS[resSector] || '#4a3a22'; stroke = '#e8c98a'; sw = 2; }
          else if (fact) { fill = colorOf(fact.playerId); stroke = SECTOR_COLORS[fact.sector] || '#fff'; sw = 3; }
          else if (spot) { fill = 'rgba(120,200,120,0.18)'; stroke = '#6fd66f'; sw = 2.5; }
          return (
            <g key={h.id}>
              <polygon points={pts(cx, cy)} fill={fill} stroke={stroke} strokeWidth={sw}
                style={{ cursor: spot ? 'pointer' : 'default' }}
                onClick={() => spot && dispatch(spot[0])}>
                <title>{h.type === 'risorsa' ? `Risorsa ${resSector ? RESOURCE_OF[resSector] : '?'}` : fact ? `Fabbrica ${fact.sector}` : spot ? `Fonda: ${spot.map(c => c.sector).join('/')}` : h.id}</title>
              </polygon>
              {h.type === 'risorsa' && <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a130c" style={{ pointerEvents: 'none' }}>R</text>}
              {fact && <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" style={{ pointerEvents: 'none' }}>🏭</text>}
              {spot && <text x={cx} y={cy + 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="#6fd66f" style={{ pointerEvents: 'none' }}>+</text>}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 12, color: '#c9b89a', marginTop: 4 }}>
        Risorse: {Object.entries(SECTOR_COLORS).map(([s, c]) => <span key={s} style={{ marginRight: 10 }}><span style={{ display: 'inline-block', width: 11, height: 11, background: c, verticalAlign: 'middle' }} /> {s}</span>)}
        {buildable.length > 0 && <span style={{ color: '#6fd66f' }}>· <b>+</b> = fonda qui</span>}
      </div>
    </div>
  );
}
