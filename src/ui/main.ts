// Uatbotl web client (hotseat). Talks to the game only through a MatchClient.

import './style.css';
import {
  actionLabel,
  budgetFor,
  buildablesFor,
  commandKey,
  computeBudget,
  DEFAULT_AGE,
  describePiece,
  effectivePassives,
  IllegalInput,
  legalOptions,
  RESOURCES,
  rulesFor,
  unitDef,
  type ActionSpec,
  type Command,
  type GameState,
  type Input,
  type PassiveSpec,
  type Piece,
  type PlayerId,
  type Sq,
  type TraitSpec,
} from '../engine';
import { LocalMatch, type MatchClient } from '../net/match';

const R = rulesFor(DEFAULT_AGE);
const G = R.geo;
const N = G.size;
const AUTOSAVE_KEY = 'uatbotl.autosave.v1';
const PREFS_KEY = 'uatbotl.prefs.v1';

type Pick = Sq | string;

interface UiState {
  unit: string | null;
  a: number | null;
  picks: Pick[];
  hover: Sq | null;
  flipped: boolean;
  autoFlip: boolean;
  idsOpen: boolean;
  idsStones: boolean;
  idsSide: PlayerId;
  roster: boolean;
  error: string;
}

const ui: UiState = {
  unit: null,
  a: null,
  picks: [],
  hover: null,
  flipped: false,
  autoFlip: false,
  idsOpen: false,
  idsStones: false,
  idsSide: 0,
  roster: false,
  error: '',
};

// ---------------------------------------------------------------------------
// Persistence (wrapped: storage can be unavailable)
// ---------------------------------------------------------------------------

function loadJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

const prefs = loadJson(PREFS_KEY) as Partial<UiState> | null;
if (prefs) {
  ui.flipped = !!prefs.flipped;
  ui.autoFlip = !!prefs.autoFlip;
}

function initialMatch(): LocalMatch {
  const saved = loadJson(AUTOSAVE_KEY);
  if (saved) {
    try {
      return LocalMatch.fromSave(saved);
    } catch {
      /* corrupt or outdated autosave: start fresh */
    }
  }
  return new LocalMatch(DEFAULT_AGE);
}

let match: LocalMatch = initialMatch();
let unsubscribe = attach(match);

function attach(m: LocalMatch): () => void {
  return m.subscribe(() => {
    saveJson(AUTOSAVE_KEY, m.toSave());
    resetSelection();
    render();
  });
}

function replaceMatch(m: LocalMatch): void {
  unsubscribe();
  match = m;
  unsubscribe = attach(m);
  saveJson(AUTOSAVE_KEY, m.toSave());
  resetSelection();
  render();
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

let optCache: { state: GameState | null; opts: Command[] } = { state: null, opts: [] };
function options(): Command[] {
  const s = match.state;
  if (optCache.state !== s) optCache = { state: s, opts: legalOptions(s) };
  return optCache.opts;
}


function sideName(p: PlayerId | 'n'): string {
  return p === 'n' ? 'Neutral' : p === 0 ? 'Red' : 'Blue';
}
function sideSpan(p: PlayerId | 'n', text = sideName(p)): string {
  return `<span class="side-${p}">${esc(text)}</span>`;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The unit (and action slot) a pending decision forces, if any. */
function forced(s: GameState): { unit: string; a: number | null } | null {
  const p = s.pending;
  if (!p) return null;
  if (p.kind === 'effect') return { unit: p.unit, a: -1 };
  if (p.kind === 'displace') return { unit: p.piece, a: -2 };
  if (p.kind === 'action' && p.unit) return { unit: p.unit, a: null };
  return null;
}

function resetSelection(): void {
  ui.unit = null;
  ui.a = null;
  ui.picks = [];
  ui.error = '';
  const f = forced(match.state);
  if (f) {
    ui.unit = f.unit;
    ui.a = f.a;
    if (ui.a === null) autoPickAction();
  }
  if (ui.autoFlip && match.state.pending) ui.flipped = match.state.pending.player === 1;
}

function candidates(): Command[] {
  return options().filter(
    (c) =>
      (ui.unit === null || c.unit === ui.unit) &&
      (ui.a === null || c.a === ui.a) &&
      ui.picks.every((p, i) => c.picks[i] === p),
  );
}

function nextPicks(): { squares: Set<Sq>; strings: Set<string> } {
  const squares = new Set<Sq>();
  const strings = new Set<string>();
  if (ui.unit === null || ui.a === null) return { squares, strings };
  for (const c of candidates()) {
    const p = c.picks[ui.picks.length];
    if (p === undefined) continue;
    if (typeof p === 'number') squares.add(p);
    else strings.add(p);
  }
  return { squares, strings };
}

function currentSpec(): ActionSpec | null {
  const s = match.state;
  if (ui.unit === null || ui.a === null) return null;
  if (ui.a === -1) return s.pending?.kind === 'effect' ? s.pending.spec : null;
  if (ui.a < 0) return null;
  const p = s.pieces[ui.unit];
  const d = p && unitDef(R, p);
  return d?.actions[ui.a] ?? null;
}

function autoPickAction(): void {
  if (ui.unit === null) return;
  const opts = options().filter((c) => c.unit === ui.unit);
  const first = opts.length ? Math.min(...opts.map((c) => c.a)) : null;
  ui.a = first;
  ui.picks = [];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function submit(input: Input): void {
  try {
    (match as MatchClient).submit(input);
  } catch (e) {
    ui.error = e instanceof IllegalInput ? e.message : String(e);
    render();
  }
}

function tryComplete(): void {
  const c = candidates();
  if (c.length && c.every((x) => x.picks.length === ui.picks.length)) {
    submit({ type: 'choose', player: match.state.pending!.player, cmd: c[0] });
  } else {
    render();
  }
}

function pick(p: Pick): void {
  ui.picks.push(p);
  ui.error = '';
  tryComplete();
}

function chooseAction(a: number): void {
  ui.a = a;
  ui.picks = [];
  ui.error = '';
  // Actions with no picks (Shelter, Shield) resolve immediately.
  const c = candidates();
  if (c.length === 1 && c[0].picks.length === 0) {
    submit({ type: 'choose', player: match.state.pending!.player, cmd: c[0] });
    return;
  }
  render();
}

function onCellClick(sq: Sq): void {
  const s = match.state;
  if (s.result || !s.pending) return;
  const { squares } = nextPicks();
  if (squares.has(sq)) {
    pick(sq);
    return;
  }
  const f = forced(s);
  const uid = s.board[sq];
  const piece = uid ? s.pieces[uid] : null;
  if (!f && piece && piece.kind === 'unit' && piece.owner === s.pending.player) {
    if (ui.unit === piece.uid && ui.picks.length === 0) {
      ui.unit = null;
      ui.a = null;
    } else {
      ui.unit = piece.uid;
      autoPickAction();
    }
    ui.picks = [];
    render();
    return;
  }
  // Clicking elsewhere steps back.
  if (ui.picks.length) ui.picks.pop();
  else if (!f) {
    ui.unit = null;
    ui.a = null;
  }
  render();
}

function stepBack(): void {
  if (ui.picks.length) ui.picks.pop();
  else if (!forced(match.state)) {
    ui.unit = null;
    ui.a = null;
  }
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;

function render(): void {
  const s = match.state;
  const html = `
    <div class="layout">
      <div class="board-wrap">${renderBoard(s)}${renderIds(s)}</div>
      <div class="panel">
        <div class="box title"><h1>UATBOTL</h1><span class="age">${esc(R.age.name)} · TURN ${s.turn}</span></div>
        ${renderPrompt(s)}
        ${renderBudget(s)}
        ${renderSelection(s)}
        <div id="hover">${renderHover(s)}</div>
        ${renderControls(s)}
        ${renderCaptures(s)}
        ${renderLog(s)}
      </div>
    </div>
    ${ui.roster ? renderRoster() : ''}
  `;
  const logEl = app.querySelector('.log');
  const atBottom = !logEl || logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  app.innerHTML = html;
  const newLog = app.querySelector('.log');
  if (newLog && atBottom) newLog.scrollTop = newLog.scrollHeight;
}

function lastSquares(): Set<Sq> {
  const out = new Set<Sq>();
  const inputs = match.inputs;
  for (let i = inputs.length - 1; i >= 0; i--) {
    const inp = inputs[i];
    if (inp.type !== 'choose') continue;
    for (const p of inp.cmd.picks) if (typeof p === 'number') out.add(p);
    break;
  }
  return out;
}

function renderBoard(s: GameState): string {
  const { squares } = nextPicks();
  const last = lastSquares();
  const f = forced(s);
  let h = `<div class="board" style="--n:${N}">`;
  for (let row = 0; row < N; row++) {
    const r = ui.flipped ? row : N - 1 - row;
    h += `<div class="coord">${r + 1}</div>`;
    for (let col = 0; col < N; col++) {
      const fl = ui.flipped ? N - 1 - col : col;
      const sq = G.sq(fl, r);
      const uid = s.board[sq];
      const piece = uid ? s.pieces[uid] : null;
      const tile = s.tiles[sq];
      const cls = ['cell'];
      if (squares.has(sq)) cls.push('cand');
      if (squares.has(sq) && piece) cls.push('occ');
      if (piece && piece.uid === ui.unit) cls.push(f ? 'forced' : 'sel');
      if (ui.picks.includes(sq)) cls.push('picked');
      else if (last.has(sq)) cls.push('last');
      if ((!ui.flipped && r === N / 2) || (ui.flipped && r === N / 2 - 1)) cls.push('half-edge');
      h += `<div class="${cls.join(' ')}" data-sq="${sq}">`;
      if (tile) {
        const td = R.tile(tile.def);
        h += `<div class="tile${tile.spent ? ' spent' : ''}" style="--tc:${td.color}">${esc(td.glyph)}</div>`;
      }
      if (piece) h += renderPiece(piece);
      h += `</div>`;
    }
  }
  h += `<div class="coord"></div>`;
  for (let col = 0; col < N; col++) {
    const fl = ui.flipped ? N - 1 - col : col;
    h += `<div class="coord">${String.fromCharCode(97 + fl)}</div>`;
  }
  return h + `</div>`;
}

function renderPiece(p: Piece): string {
  const owner = p.owner === 'n' ? 'n' : p.owner;
  if (p.kind === 'stone') {
    const label = ui.idsOpen && ui.idsStones ? String(p.id) : '';
    const hp = p.hp < p.maxHp ? `<span class="hp">${p.hp}</span>` : '';
    return `<div class="piece stone p${owner}${p.reinforced ? ' reinforced' : ''}">${label}${hp}</div>`;
  }
  const d = unitDef(R, p)!;
  const royal = d.role ? ' royal' : '';
  const hp = p.maxHp > 1 || p.hp < p.maxHp ? `<span class="hp">${p.hp}</span>` : '';
  return `<div class="piece unit p${owner}${royal}" title="${esc(describePiece(R, p))}">${esc(d.glyph)}${hp}</div>`;
}

function renderIds(s: GameState): string {
  const btn = `<button class="ids-toggle" data-act="ids">${ui.idsOpen ? '▾' : '◂'}</button>`;
  if (!ui.idsOpen) return btn;
  const list = Object.values(s.pieces)
    .filter((p) => p.owner === ui.idsSide && (ui.idsStones || p.kind === 'unit'))
    .sort((a, b) => a.id - b.id);
  const rows = list
    .map(
      (p) =>
        `<div class="row" data-hover="${p.sq}"><span class="side-${p.owner}">#${p.id}</span> ${esc(p.kind === 'stone' ? 'stone' : unitDef(R, p)!.name)} <span class="side-n">${G.name(p.sq)}</span></div>`,
    )
    .join('');
  return `${btn}<div class="ids-menu">
    <div class="controls" style="margin-bottom:6px">
      <button data-act="ids-side" class="${ui.idsSide === 0 ? 'on' : ''}" data-side="0">Red</button>
      <button data-act="ids-side" class="${ui.idsSide === 1 ? 'on' : ''}" data-side="1">Blue</button>
      <button data-act="ids-stones" class="${ui.idsStones ? 'on' : ''}">stones</button>
    </div>
    ${rows || '<div class="side-n">—</div>'}
  </div>`;
}

function stepHint(spec: ActionSpec | null, i: number): string {
  if (!spec) return 'Choose a square.';
  const steps: Record<string, string[]> = {
    move: ['Choose a destination.'],
    pave: ['Choose a destination (a tile is left behind).'],
    attack: ['Choose a target.'],
    shoot: ['Choose a target (first piece along a direction).'],
    build: ['Choose what to build.', 'Choose where to build it.'],
    push: ['Choose an adjacent piece.', 'Choose the direction (the square it moves toward).'],
    stonepush: ['Choose an adjacent stone.', 'Choose the direction (the square it moves toward).'],
    undertaking: ['Choose where to move.', 'Choose where to place the stone.'],
    castle: ['Click the King to castle with.'],
    relocate: ['Choose a unit to relocate.', 'Choose where it goes.'],
    reallocate: ['Choose a stone to reallocate.', 'Choose where it goes.'],
    lay: ['Choose where to lay the tile.'],
    moveattack: ['Choose a tile to move onto.', 'Choose a target from there.'],
    reinforce: ['Choose a stone to reinforce.'],
  };
  return steps[spec.kw]?.[i] ?? 'Confirm.';
}

function renderPrompt(s: GameState): string {
  if (s.result) {
    const r = s.result;
    const why = {
      ipseity: 'Ipseity — the King has fallen',
      resignation: 'by resignation',
      stalemate: 'by stalemate — no legal action',
      agreement: 'Draw by agreement',
      repetition: 'Draw by threefold repetition',
    }[r.reason];
    const head = r.winner === null ? 'Draw' : `${sideSpan(r.winner)} wins`;
    return `<div class="box prompt"><div class="result">${head}</div><div class="sub">${esc(why)}</div>
      <div class="buttons"><button data-act="new">New game</button><button data-act="undo">Undo last input</button></div></div>`;
  }
  const p = s.pending!;
  const who = sideSpan(p.player);
  let head = '';
  let sub = '';
  const buttons: string[] = [];
  const unitName = (uid: string) => (s.pieces[uid] ? esc(describePiece(R, s.pieces[uid])) : '?');
  switch (p.kind) {
    case 'action':
      if (p.context === 'main') {
        head = `${who} to act <span class="side-n">(${s.actionsLeft} action${s.actionsLeft === 1 ? '' : 's'} left)</span>`;
      } else if (p.context === 'build') {
        head = `${who}: Build Action — take a Build`;
      } else {
        head = `${who}: Self-Execute — ${unitName(p.unit!)} may act`;
        buttons.push(`<button data-act="skip">Decline</button>`);
      }
      break;
    case 'effect':
      head = `${who}: ${esc(p.source === 'passive' ? 'Passive' : p.source)} — ${unitName(p.unit)} performs ${esc(actionLabel(p.spec))}`;
      break;
    case 'displace':
      head = `${who} chooses where ${unitName(p.piece)} is displaced`;
      break;
  }
  if (ui.unit === null) sub = p.kind === 'action' && p.context === 'build' ? 'Select a builder.' : 'Select one of your units.';
  else if (ui.a === null) sub = 'Choose an action.';
  else sub = p.kind === 'displace' ? 'Choose an adjacent empty square.' : stepHint(currentSpec(), ui.picks.length);
  const { strings } = nextPicks();
  if (strings.has('none')) buttons.push(`<button data-pick="none">Place no stone</button>`);
  if (ui.picks.length) buttons.push(`<button data-act="back">Back</button>`);
  if (s.drawOffer !== null && s.drawOffer !== p.player) {
    buttons.push(`<button data-act="accept-draw">Accept draw (${sideName(p.player)})</button>`);
    buttons.push(`<button data-act="decline-draw">Decline draw</button>`);
  }
  return `<div class="box prompt">${head}<div class="sub">${esc(sub)}</div>
    ${ui.error ? `<div class="error">${esc(ui.error)}</div>` : ''}
    ${buttons.length ? `<div class="buttons">${buttons.join('')}</div>` : ''}</div>`;
}

function renderBudget(s: GameState): string {
  const b = s.result ? computeBudget(R, s, s.active) : budgetFor(s, s.active);
  const cells = RESOURCES.map(
    (r) => `<div class="res" title="${esc(R.age.resourceNames[r])}"><b>${b[r]}</b><span>${esc(R.age.resourceNames[r])}</span></div>`,
  ).join('');
  const proj = ([0, 1] as PlayerId[])
    .map((pl) => {
      const nb = computeBudget(R, s, pl);
      return `${sideSpan(pl)} ${RESOURCES.map((r) => `${r}${nb[r]}`).join(' ')}`;
    })
    .join(' &nbsp;·&nbsp; ');
  return `<div class="box"><h3>Budget — ${sideSpan(s.active)} (remaining this turn)</h3><div class="budget">${cells}</div>
    <div class="proj">From current stones: ${proj}</div></div>`;
}

function renderSelection(s: GameState): string {
  if (!s.pending || ui.unit === null) return '';
  const p = s.pieces[ui.unit];
  if (!p) return '';
  const pend = s.pending;
  let body = '';
  if (pend.kind === 'action') {
    const d = unitDef(R, p);
    const opts = options().filter((c) => c.unit === p.uid);
    body = `<div class="actions">${(d?.actions ?? [])
      .map((spec, a) => {
        const n = opts.filter((c) => c.a === a).length;
        return `<button data-action="${a}" class="${ui.a === a ? 'on' : ''}" ${n ? '' : 'disabled'}>${esc(actionLabel(spec))}<span class="n">${n}</span></button>`;
      })
      .join('')}</div>`;
    if (!d?.actions.length) body = `<div class="side-n">No actions.</div>`;
  } else if (pend.kind === 'effect') {
    body = `<div class="side-n">${esc(actionLabel(pend.spec))}</div>`;
  }
  const spec = currentSpec();
  if (spec && spec.kw === 'build' && ui.picks.length === 0 && p.owner !== 'n') {
    const { strings } = nextPicks();
    const budget = budgetFor(s, pend.player);
    const all = buildablesFor(R, s, p.owner, spec.scope);
    body += `<div class="builds">${all
      .map((b) => {
        const name = b.kind === 'unit' ? R.unit(b.id).name : `${R.tile(b.id).name} (tile)`;
        const ok = strings.has(b.id);
        const short = budget[b.cost.res] < b.cost.n;
        return `<button data-pick="${b.id}" ${ok ? '' : 'disabled'} title="${short ? 'Not enough budget' : ok ? '' : 'No legal square'}">${esc(name)}<span class="cost">${b.cost.n}${b.cost.res}</span></button>`;
      })
      .join('')}</div>`;
  }
  return `<div class="box"><h3>Selected — ${esc(describePiece(R, p))} @ ${G.name(p.sq)}</h3>${body}</div>`;
}

function passiveText(p: PassiveSpec): string {
  switch (p.kw) {
    case 'extraAction':
      return `+${p.n} Action`;
    case 'buildAction':
      return `Build Action {+${p.n}}`;
    case 'shoot':
      return `Shoot {${p.dirs}} {dmg=${p.dmg}}`;
    case 'undertaking':
      return `Undertaking {${p.range}}`;
  }
}

function traitText(t: TraitSpec): string {
  switch (t.kw) {
    case 'memory':
      return 'Memory';
    case 'ipseity':
      return 'Ipseity';
    case 'unitary':
      return 'Unitary';
    case 'queensgift':
    case 'kingsgift':
      return `${t.kw === 'queensgift' ? 'Queensgift' : 'Kingsgift'}: ${t.text ?? passiveText(t.passive)}`;
  }
}

function renderHover(s: GameState): string {
  const sq = ui.hover;
  if (sq === null) return '';
  const uid = s.board[sq];
  const p = uid ? s.pieces[uid] : null;
  const tile = s.tiles[sq];
  if (!p && !tile) return '';
  let h = `<div class="box info"><h3>${G.name(sq)}</h3>`;
  if (p) {
    const d = unitDef(R, p);
    h += `<dl><dt>Piece</dt><dd>${sideSpan(p.owner, describePiece(R, p))}${d ? ` <span class="side-n">${esc(d.code)}</span>` : ''}</dd>`;
    h += `<dt>HP</dt><dd>${p.hp}/${p.maxHp}${d?.traits.some((t) => t.kw === 'memory') ? ' (Memory)' : ''}</dd>`;
    if (d) {
      if (d.requires) h += `<dt>Requires</dt><dd>${esc(d.requires)} gate</dd>`;
      if (d.actions.length) h += `<dt>Actions</dt><dd>${d.actions.map((a) => esc(actionLabel(a))).join('<br>')}</dd>`;
      const passives = effectivePassives(R, s, p);
      if (passives.length) h += `<dt>Passives</dt><dd>${passives.map((x) => esc(passiveText(x))).join('<br>')}</dd>`;
      if (d.traits.length) h += `<dt>Traits</dt><dd>${d.traits.map((t) => esc(traitText(t))).join('<br>')}</dd>`;
    }
    h += `</dl>`;
    if (d?.note) h += `<div class="note">${esc(d.note)}</div>`;
  }
  if (tile) {
    const t = R.tile(tile.def);
    h += `<dl style="margin-top:6px"><dt>Tile</dt><dd>${esc(t.name)} <span class="side-n">${esc(t.code)} · ${t.type}${tile.spent ? ' · spent' : ''}</span></dd></dl>`;
    h += `<div class="note">${esc(t.text)}</div>`;
  }
  return h + `</div>`;
}

function renderControls(s: GameState): string {
  const actor = s.pending?.player ?? s.active;
  const live = !s.result;
  return `<div class="box"><div class="controls">
    <button data-act="undo" ${match.canUndo() ? '' : 'disabled'} title="Ctrl+Z">Undo</button>
    <button data-act="flip">Flip board</button>
    <button data-act="autoflip" class="${ui.autoFlip ? 'on' : ''}">Auto-flip</button>
    <button data-act="roster">Roster</button>
    <button data-act="save">Save</button>
    <button data-act="load">Load</button>
    <button data-act="new">New game</button>
    <button data-act="offer-draw" ${live && s.drawOffer === null ? '' : 'disabled'}>Offer draw (${sideName(actor)})</button>
    <button data-act="resign" ${live ? '' : 'disabled'}>Resign (${sideName(actor)})</button>
  </div></div>`;
}

function renderCaptures(s: GameState): string {
  const col = (pl: PlayerId) => {
    const list = s.captures[pl].map((uid) => s.dead[uid]);
    const names = list.map((p) => sideSpan(p.owner, p.kind === 'stone' ? 'stone' : unitDef(R, p)!.name)).join(', ');
    return `<div><div>${sideSpan(pl)} Captures · ${list.length}</div><div class="list">${names || '—'}</div></div>`;
  };
  return `<div class="box"><h3>Captures</h3><div class="captures">${col(0)}${col(1)}</div></div>`;
}

function renderLog(s: GameState): string {
  const rows = s.log
    .slice(-300)
    .map((e) =>
      e.text.startsWith('—')
        ? `<div class="turn">${esc(e.text)}</div>`
        : `<div>${e.player === 'n' ? '' : `<span class="side-${e.player}">▸</span> `}${esc(e.text)}</div>`,
    )
    .join('');
  return `<div class="box"><h3>Log</h3><div class="log">${rows}</div></div>`;
}

function renderRoster(): string {
  const cost = (c?: { res: string; n: number }) => (c ? `${c.n} ${c.res}` : '—');
  const units = R.age.units
    .map(
      (u) => `<tr><td>${esc(u.code)}</td><td>${esc(u.name)}</td><td>${cost(u.cost)}</td><td>${u.hp}</td>
      <td>${esc(u.requires ?? (u.gate ? `(${u.gate} gate)` : ''))}</td>
      <td>${u.actions.map((a) => esc(actionLabel(a))).join('<br>')}</td>
      <td>${u.passives.map((p) => esc(passiveText(p))).join('<br>')}</td>
      <td>${u.traits.map((t) => esc(traitText(t))).join('<br>')}${u.note ? `<br><i class="side-n">${esc(u.note)}</i>` : ''}</td></tr>`,
    )
    .join('');
  const tiles = R.age.tiles
    .map(
      (t) => `<tr><td>${esc(t.code)}</td><td><span style="color:${t.color}">■</span> ${esc(t.name)}</td><td>${cost(t.cost)}</td>
      <td>${esc(t.builtBy ? `${t.builtBy} gate` : 'placed by units')}</td><td>${t.type}${t.unitary ? ', Unitary' : ''}</td><td>${esc(t.text)}</td></tr>`,
    )
    .join('');
  return `<div class="drawer"><button class="close" data-act="roster">Close</button>
    <h3>${esc(R.age.name)} roster</h3>
    <table><tr><th>Code</th><th>Unit</th><th>Cost</th><th>HP</th><th>Requires</th><th>Actions</th><th>Passives</th><th>Traits</th></tr>${units}</table>
    <h3 style="margin-top:16px">Tiles</h3>
    <table><tr><th>Code</th><th>Tile</th><th>Cost</th><th>Built by</th><th>Type</th><th>Effect</th></tr>${tiles}</table></div>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function savePrefs(): void {
  saveJson(PREFS_KEY, { flipped: ui.flipped, autoFlip: ui.autoFlip });
}

function download(): void {
  const blob = new Blob([JSON.stringify(match.toSave(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `uatbotl-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function upload(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      replaceMatch(LocalMatch.fromSave(JSON.parse(await f.text())));
    } catch (e) {
      ui.error = `Could not load: ${e instanceof Error ? e.message : e}`;
      render();
    }
  };
  input.click();
}

app.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const s = match.state;
  const actor = (s.pending?.player ?? s.active) as PlayerId;

  const cell = t.closest<HTMLElement>('.cell');
  if (cell) return onCellClick(Number(cell.dataset.sq));

  const actionBtn = t.closest<HTMLElement>('[data-action]');
  if (actionBtn) return chooseAction(Number(actionBtn.dataset.action));

  const pickBtn = t.closest<HTMLElement>('[data-pick]');
  if (pickBtn) return pick(pickBtn.dataset.pick!);

  const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
  switch (act) {
    case 'undo':
      if (match.canUndo()) match.undo();
      break;
    case 'back':
      stepBack();
      break;
    case 'skip':
      submit({ type: 'skip', player: actor });
      break;
    case 'flip':
      ui.flipped = !ui.flipped;
      savePrefs();
      render();
      break;
    case 'autoflip':
      ui.autoFlip = !ui.autoFlip;
      if (ui.autoFlip && s.pending) ui.flipped = s.pending.player === 1;
      savePrefs();
      render();
      break;
    case 'roster':
      ui.roster = !ui.roster;
      render();
      break;
    case 'ids':
      ui.idsOpen = !ui.idsOpen;
      render();
      break;
    case 'ids-side':
      ui.idsSide = Number(t.closest<HTMLElement>('[data-side]')!.dataset.side) as PlayerId;
      render();
      break;
    case 'ids-stones':
      ui.idsStones = !ui.idsStones;
      render();
      break;
    case 'save':
      download();
      break;
    case 'load':
      upload();
      break;
    case 'new':
      if (s.result || confirm('Abandon this game and start a new one?')) replaceMatch(new LocalMatch(DEFAULT_AGE));
      break;
    case 'resign':
      if (confirm(`${sideName(actor)} resigns?`)) submit({ type: 'resign', player: actor });
      break;
    case 'offer-draw':
      submit({ type: 'offerDraw', player: actor });
      break;
    case 'accept-draw':
      submit({ type: 'acceptDraw', player: actor });
      break;
    case 'decline-draw':
      submit({ type: 'declineDraw', player: actor });
      break;
  }
});

app.addEventListener('mouseover', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-sq],[data-hover]');
  if (!el) return;
  const sq = Number(el.dataset.sq ?? el.dataset.hover);
  if (sq === ui.hover) return;
  ui.hover = sq;
  // Only the hover card changes, so hovering never rebuilds the board under the cursor.
  const slot = document.getElementById('hover');
  if (slot) slot.innerHTML = renderHover(match.state);
});

document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (match.canUndo()) match.undo();
  } else if (ev.key === 'Escape') {
    if (ui.roster) ui.roster = false;
    else stepBack();
    render();
  }
});

resetSelection();
render();

// Handy for playtesting from the devtools console.
Object.assign(window as unknown as Record<string, unknown>, {
  uatbotl: { get match() { return match; }, commandKey, legalOptions },
});
