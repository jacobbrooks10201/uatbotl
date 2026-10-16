// Uatbotl web client (hotseat). Talks to the game only through a MatchClient.

import './style.css';
import {
  actionLabel,
  actionsOf,
  giftedTraits,
  budgetFor,
  buildablesFor,
  commandKey,
  computeBudget,
  DEFAULT_AGE,
  describePiece,
  effectivePassives,
  IllegalInput,
  legalOptions,
  formatNotation,
  notationRounds,
  parseNotation,
  resourceInstances,
  RESOURCES,
  resultText,
  scopeAllows,
  rulesFor,
  unitDef,
  type ActionSpec,
  type Buildable,
  type Command,
  type GameOptions,
  type GameState,
  type Input,
  type PassiveSpec,
  type Piece,
  type PlayerId,
  type Resource,
  type Sq,
  type TileDef,
  type TraitSpec,
  type UnitDef,
} from '../engine';
import { LocalMatch, type MatchClient } from '../net/match';
import { stoneSprite, unitSprite } from './pixels';

// Rules depend on the board size, so they follow the current match (see syncRules).
let R = rulesFor(DEFAULT_AGE);
let G = R.geo;
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
  rosterTab: Resource | 'royal';
  newGame: boolean;
  settings: boolean;
  paste: boolean;
  /** Visual settings (persisted). pixel: the original 32×32 sprite style. names: unit names on the board. */
  pixel: boolean;
  names: boolean;
  /** Resource whose template instances are drawn on the board (hovered, or pinned by a click). */
  resHover: Resource | null;
  resPin: Resource | null;
  /** Replay: number of inputs applied in the position being viewed, or null for the live game. */
  view: number | null;
  playing: boolean;
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
  rosterTab: 'royal',
  newGame: false,
  settings: false,
  paste: false,
  pixel: false,
  names: false,
  resHover: null,
  resPin: null,
  view: null,
  playing: false,
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
  ui.pixel = !!prefs.pixel;
  ui.names = !!prefs.names;
  if (prefs.rosterTab) ui.rosterTab = prefs.rosterTab;
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
  stopPlaying();
  ui.view = null;
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
  if (viewing()) return [];
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
  return d ? (actionsOf(R, s, p)[ui.a] ?? null) : null;
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
  if (viewing() || s.result || !s.pending) return;
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

// ---------------------------------------------------------------------------
// Replay: step through any position of the game. The live game is untouched
// until "Play from here" is chosen.
// ---------------------------------------------------------------------------

let viewCache: { n: number; inputs: number; state: GameState } | null = null;

function viewing(): boolean {
  return ui.view !== null && ui.view < match.inputs.length;
}

/** The position on screen: the live game, or a replayed earlier one. */
function shownState(): GameState {
  if (!viewing()) return match.state;
  const n = ui.view!;
  if (!viewCache || viewCache.n !== n || viewCache.inputs !== match.inputs.length)
    viewCache = { n, inputs: match.inputs.length, state: match.stateAt(n) };
  return viewCache.state;
}

function setView(n: number | null): void {
  const len = match.inputs.length;
  ui.view = n === null || n >= len ? null : Math.max(0, n);
  if (ui.view === null) stopPlaying();
  ui.unit = null;
  ui.a = null;
  ui.picks = [];
  if (ui.view === null) resetSelection();
  render();
}

let playTimer: ReturnType<typeof setInterval> | null = null;

function stopPlaying(): void {
  ui.playing = false;
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
}

function togglePlay(): void {
  if (ui.playing) {
    stopPlaying();
    render();
    return;
  }
  if (!viewing()) ui.view = 0; // at the live end: play from the start
  ui.playing = true;
  playTimer = setInterval(() => setView((ui.view ?? match.inputs.length) + 1), 700);
  render();
}

function renderReplay(s: GameState): string {
  const len = match.inputs.length;
  if (len === 0) return '';
  const n = ui.view ?? len;
  const btn = (act: string, label: string, title: string, off = false) =>
    `<button data-act="${act}" title="${title}" ${off ? 'disabled' : ''}>${label}</button>`;
  return `<div class="box replay${viewing() ? ' on' : ''}">
    <div class="controls">
      ${btn('view-first', '|&lt;', 'Start (Home)', n === 0)}${btn('view-prev', '&lt;', 'Back one input (Left)', n === 0)}
      ${btn('view-play', ui.playing ? 'Pause' : 'Play', 'Autoplay')}
      ${btn('view-next', '&gt;', 'Forward one input (Right)', n === len)}${btn('view-last', '&gt;|', 'Live position (End)', n === len)}
      <span class="side-n">input ${n} / ${len} · turn ${s.turn}</span>
    </div>
    <input type="range" class="scrub" min="0" max="${len}" value="${n}" data-act="view-scrub">
    ${viewing() ? `<div class="sub">Viewing an earlier position. <button data-act="view-branch">Play from here</button> discards the inputs after it.</div>` : ''}
  </div>`;
}

function syncRules(): void {
  R = rulesFor(match.state);
  G = R.geo;
}

function render(): void {
  syncRules();
  const s = shownState();
  const html = `
    <div class="layout">
      <div class="board-wrap" style="--w:${G.width};--h:${G.height}">${renderBoard(s)}${renderIds(s)}</div>
      <div class="panel">
        <div class="box title"><h1>UATBOTL</h1><span class="age">${esc(R.age.name)} · ${G.width}×${G.height} · TURN ${s.turn}</span></div>
        ${renderReplay(s)}
        ${viewing() ? '' : renderPrompt(s)}
        ${renderBudget(s)}
        ${renderSelection(s)}
        <div id="hover">${renderHover(s)}</div>
        ${renderControls(s)}
        ${renderMoves(s)}
        ${renderCaptures(s)}
        ${renderLog(s)}
      </div>
    </div>
    ${ui.roster ? renderRoster() : ''}
    ${ui.newGame ? renderNewGame() : ''}
    ${ui.settings ? renderSettings() : ''}
    ${ui.paste ? renderPaste() : ''}
  `;
  // Keep scrolling panes pinned to the bottom when they were at the bottom.
  const panes = ['.log', '.moves'].map((sel) => {
    const el = app.querySelector(sel);
    return !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  });
  app.innerHTML = html;
  ['.log', '.moves'].forEach((sel, i) => {
    const el = app.querySelector(sel);
    if (el && panes[i]) el.scrollTop = el.scrollHeight;
  });
}

/**
 * Squares the other player's previous turn moved something to or created
 * something on (pieces, stones, tiles), where something still stands. The
 * turn player's own changes are not marked; once the game is over, the final
 * turn is.
 */
function arrivalSquares(s: GameState): Set<Sq> {
  return new Set((s.result ? s.arrivals : s.lastArrivals).filter((q) => s.board[q] !== null || s.tiles[q] !== null));
}

function renderBoard(s: GameState): string {
  const { squares } = nextPicks();
  const arrived = arrivalSquares(s);
  const f = forced(s);
  const W = G.width;
  const H = G.height;
  let h = `<div class="board${ui.pixel ? ' pixel' : ''}">`;
  for (let row = 0; row < H; row++) {
    const r = ui.flipped ? row : H - 1 - row;
    h += `<div class="coord">${r + 1}</div>`;
    for (let col = 0; col < W; col++) {
      const fl = ui.flipped ? W - 1 - col : col;
      const sq = G.sq(fl, r);
      const uid = s.board[sq];
      const piece = uid ? s.pieces[uid] : null;
      const tile = s.tiles[sq];
      const cls = ['cell'];
      if (squares.has(sq)) cls.push('cand');
      if (squares.has(sq) && piece) cls.push('occ');
      if (tile && piece) cls.push('on-tile');
      if (piece && piece.uid === ui.unit) cls.push(f ? 'forced' : 'sel');
      if (ui.picks.includes(sq)) cls.push('picked');
      if (arrived.has(sq)) cls.push('arrived');
      // Line between the two halves, drawn under the lower rank as displayed.
      const firstOf1 = Math.floor(H / 2);
      if ((!ui.flipped && r === firstOf1) || (ui.flipped && r === firstOf1 - 1)) cls.push('half-edge');
      h += `<div class="${cls.join(' ')}" data-sq="${sq}">`;
      if (tile) {
        const td = R.tile(tile.def);
        // Pixel style: tiles are a plain colour field. Classic: tinted square with its glyph.
        h += `<div class="tile${tile.spent ? ' spent' : ''}" style="--tc:${td.color}">${ui.pixel ? '' : esc(td.glyph)}</div>`;
        // A piece on a tile: the tile glyph stays visible above the piece.
        if (piece && !ui.pixel) h += `<div class="tile-badge" style="--tc:${td.color}">${esc(td.glyph)}</div>`;
      }
      if (piece) h += renderPiece(piece);
      if (piece && ui.names && piece.kind === 'unit') h += `<span class="uname">${esc(unitDef(R, piece)!.name)}</span>`;
      h += `</div>`;
    }
  }
  h += renderResOverlay(s);
  h += `<div class="coord"></div>`;
  for (let col = 0; col < W; col++) {
    const fl = ui.flipped ? W - 1 - col : col;
    h += `<div class="coord">${String.fromCharCode(97 + fl)}</div>`;
  }
  return h + `</div>`;
}

/** Lines between paired stones, dots on single ones, for the highlighted resource. */
function renderResOverlay(s: GameState): string {
  const res = ui.resHover ?? ui.resPin;
  if (!res) return '';
  const W = G.width;
  const H = G.height;
  const x = (q: Sq) => (ui.flipped ? W - 1 - G.file(q) : G.file(q)) + 0.5;
  const y = (q: Sq) => (ui.flipped ? G.rank(q) : H - 1 - G.rank(q)) + 0.5;
  const marks = resourceInstances(R, s, s.active)
    [res].map((inst) =>
      inst.length === 1
        ? `<circle cx="${x(inst[0])}" cy="${y(inst[0])}" r="0.17"/>`
        : `<line x1="${x(inst[0])}" y1="${y(inst[0])}" x2="${x(inst[1])}" y2="${y(inst[1])}"/>`,
    )
    .join('');
  return `<svg class="res-overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${marks}</svg>`;
}

function renderPiece(p: Piece): string {
  const owner = p.owner === 'n' ? 'n' : p.owner;
  if (ui.pixel) return renderPixelPiece(p, owner);
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

function renderPixelPiece(p: Piece, owner: PlayerId | 'n'): string {
  const hp = (p.kind === 'stone' ? p.hp < p.maxHp : p.maxHp > 1 || p.hp < p.maxHp) ? `<span class="hp">${p.hp}</span>` : '';
  if (p.kind === 'stone') {
    const label = ui.idsOpen && ui.idsStones ? `<span class="px-id">${p.id}</span>` : '';
    return `<div class="piece px stone p${owner}">${stoneSprite(!!p.reinforced)}${label}${hp}</div>`;
  }
  const d = unitDef(R, p)!;
  // Royals and gates get two lines of symmetry; everything else one.
  return `<div class="piece px p${owner}" title="${esc(describePiece(R, p))}">${unitSprite(d.id, !!d.role || !!d.gate)}${hp}</div>`;
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
    raypush: ['Choose a stone in line (the first piece along a ray).', 'Choose where it ends up.'],
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
      } else if (p.context === 'attack') {
        head = `${who}: ${p.by ? unitName(p.by) : 'General'} — may take one Attack with any unit that can attack`;
        buttons.push(`<button data-act="skip">Decline</button>`);
      } else {
        head = `${who}: Self-Execute — ${unitName(p.unit!)} may act`;
        buttons.push(`<button data-act="skip">Decline</button>`);
      }
      break;
    case 'effect':
      head = `${who}: ${esc(p.source === 'passive' ? 'Passive' : p.source)} — ${unitName(p.unit)} ${p.optional ? 'may perform' : 'performs'} ${esc(actionLabel(p.spec))}`;
      if (p.optional) buttons.push(`<button data-act="skip">Decline</button>`);
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

/**
 * A tiny picture of the stone shape that produces a resource (§10.2): one stone
 * (Extension), a horizontal pair (Prevenience), a vertical pair (Multiplicity),
 * a diagonal pair (Deduction), a stone with no own stone around it (Incursion).
 */
const RES_SHAPES: Record<Resource, Array<[number, number]>> = {
  E: [[1, 1]],
  P: [[0.5, 1], [1.5, 1]],
  M: [[1, 0.5], [1, 1.5]],
  D: [[0.5, 1.5], [1.5, 0.5]],
  I: [[1, 1]],
};
function resIcon(r: Resource): string {
  const cell = ([x, y]: [number, number], filled: boolean) =>
    `<rect x="${x + 0.08}" y="${y + 0.08}" width="0.84" height="0.84" rx="0.15" class="${filled ? 'on' : 'off'}"/>`;
  let body = RES_SHAPES[r].map((c) => cell(c, true)).join('');
  // Incursion: the eight neighbours must be free of own stones, drawn as empty outlines.
  if (r === 'I')
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) body += cell([x, y], false);
  return `<svg class="res-icon" viewBox="0 0 3 3" aria-hidden="true">${body}</svg>`;
}

function renderBudget(s: GameState): string {
  const b = s.result ? computeBudget(R, s, s.active) : budgetFor(s, s.active);
  const cells = RESOURCES.map(
    (r) =>
      `<div class="res${(ui.resHover ?? ui.resPin) === r ? ' on' : ''}${ui.resPin === r ? ' pinned' : ''}" data-res="${r}" title="Hover to show ${esc(R.age.resourceNames[r])} on the board; click to pin"><b>${b[r]}</b><span>${resIcon(r)}${esc(R.age.resourceNames[r])}</span></div>`,
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
    const acts = actionsOf(R, s, p);
    body = `<div class="actions">${acts
      .map((spec, a) => {
        const n = opts.filter((c) => c.a === a).length;
        return `<button data-action="${a}" class="${ui.a === a ? 'on' : ''}" ${n ? '' : 'disabled'}>${esc(actionLabel(spec))}<span class="n">${n}</span></button>`;
      })
      .join('')}</div>`;
    if (!d || !acts.length) body = `<div class="side-n">No actions.</div>`;
  } else if (pend.kind === 'effect') {
    body = `<div class="side-n">${esc(actionLabel(pend.spec))}</div>`;
  }
  const spec = currentSpec();
  if (spec && spec.kw === 'build' && ui.picks.length === 0 && p.owner !== 'n') {
    const { strings } = nextPicks();
    const budget = budgetFor(s, pend.player);
    const all = sortBuildables(buildablesFor(R, s, p.owner, spec.scope));
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
    case 'move':
      return `Move {${p.range}}${p.optional ? ' (optional)' : ''}`;
    case 'attack':
      return `Attack {${p.range}} {dmg=${p.dmg}}`;
    case 'throw':
      return `Stone throw {${p.range}}`;
    case 'bonusAttack':
      return `Bonus Attack {+${p.n}} (any unit that can Attack; optional)`;
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
    case 'fragile':
      return 'Fragile';
    case 'royalpath':
      return 'Royal Path';
    case 'queensgift':
    case 'kingsgift': {
      const label = t.kw === 'queensgift' ? 'Queensgift' : 'Kingsgift';
      const what = t.passive ? passiveText(t.passive) : t.action ? actionLabel(t.action) : t.trait ? traitText(t.trait) : '';
      return `${label}: ${t.text ?? what}`;
    }
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
      const acts = actionsOf(R, s, p);
      if (acts.length) h += `<dt>Actions</dt><dd>${acts.map((a) => esc(actionLabel(a))).join('<br>')}</dd>`;
      const passives = effectivePassives(R, s, p);
      if (passives.length) h += `<dt>Passives</dt><dd>${passives.map((x) => esc(passiveText(x))).join('<br>')}</dd>`;
      const traits = [...d.traits, ...giftedTraits(R, s, p)];
      if (traits.length) h += `<dt>Traits</dt><dd>${traits.map((t) => esc(traitText(t))).join('<br>')}</dd>`;
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
    <button data-act="settings">Settings</button>
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
      e.text.startsWith('-- Turn')
        ? `<div class="turn">${esc(e.text)}</div>`
        : `<div>${e.player === 'n' ? '' : `<span class="side-${e.player}">&gt;</span> `}${esc(e.text)}</div>`,
    )
    .join('');
  return `<div class="box"><h3>Log</h3><div class="log">${rows}</div></div>`;
}

/** Roster order: royals, then by resource type (E, A, D, M, I); gates first, then by code. */
function typeRank(u: UnitDef): number {
  return u.role ? -1 : u.cost ? RESOURCES.indexOf(u.cost.res) : RESOURCES.length;
}
function compareUnits(a: UnitDef, b: UnitDef): number {
  return (
    typeRank(a) - typeRank(b) ||
    Number(!a.gate) - Number(!b.gate) ||
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}
function sortBuildables(list: Buildable[]): Buildable[] {
  const rank = (b: Buildable) => (b.kind === 'unit' ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.kind === 'unit' && b.kind === 'unit'
        ? compareUnits(R.unit(a.id), R.unit(b.id))
        : RESOURCES.indexOf(a.cost.res) - RESOURCES.indexOf(b.cost.res) || a.cost.n - b.cost.n),
  );
}

/** Units with a Build action whose scope covers `u`, named for the roster. */
function unitBuilders(u: UnitDef): string[] {
  return R.age.units
    .filter((b) => b.actions.some((a) => a.kw === 'build' && scopeAllows(a.scope, u)))
    .map((b) => b.name);
}

/** Who makes a tile: gates that Build it, and units that Pave or Lay it. */
function tileMakers(t: TileDef): UnitDef[] {
  return R.age.units.filter((u) =>
    u.actions.some(
      (a) =>
        (a.kw === 'build' && 'gate' in a.scope && a.scope.gate === t.builtBy && !!t.cost) ||
        ((a.kw === 'pave' || a.kw === 'lay') && a.tile === t.id),
    ),
  );
}

function tileMakerText(t: TileDef): string {
  return tileMakers(t)
    .map((u) => {
      const a = u.actions.find((x) => (x.kw === 'pave' || x.kw === 'lay') && x.tile === t.id);
      return a ? `${u.name} (${a.kw === 'pave' ? 'Pave' : 'Lay'})` : `${u.name} (Build)`;
    })
    .join(', ');
}

/** A tile's resource: its cost, or else the resource of the first unit that makes it. */
function tileResource(t: TileDef): Resource | null {
  return t.cost?.res ?? tileMakers(t).find((u) => u.cost)?.cost?.res ?? null;
}

function renderRoster(): string {
  const cost = (c?: { res: string; n: number }) => (c ? `${c.n} ${c.res}` : '—');
  const tab = ui.rosterTab;
  const inTab = (u: UnitDef) => (tab === 'royal' ? !!u.role : u.cost?.res === tab);
  const tabs = (['royal', ...RESOURCES] as const)
    .map(
      (t) =>
        `<button data-act="roster-tab" data-tab="${t}" class="${t === tab ? 'on' : ''}">${t === 'royal' ? 'Royals' : `${resIcon(t)}${esc(R.age.resourceNames[t])}`}</button>`,
    )
    .join('');
  const units = [...R.age.units]
    .filter(inTab)
    .sort(compareUnits)
    .map(
      (u) => `<tr><td>${esc(u.code)}</td><td>${ui.pixel ? `<span class="roster-px p0">${unitSprite(u.id, !!u.role || !!u.gate)}</span>` : ''}${esc(u.name)}${u.gate ? ' <span class="side-n">(gate)</span>' : ''}</td><td>${cost(u.cost)}</td><td>${u.hp}</td>
      <td>${esc(u.cost ? unitBuilders(u).join(', ') || '—' : 'starts on the board')}</td>
      <td>${u.actions.map((a) => esc(actionLabel(a))).join('<br>')}</td>
      <td>${u.passives.map((p) => esc(passiveText(p))).join('<br>')}</td>
      <td>${u.traits.map((t) => esc(traitText(t))).join('<br>')}${u.note ? `<br><i class="side-n">${esc(u.note)}</i>` : ''}</td></tr>`,
    )
    .join('');
  const tiles = tab === 'royal' ? [] : R.age.tiles.filter((t) => tileResource(t) === tab);
  const tileRows = tiles
    .map(
      (t) => `<tr><td>${esc(t.code)}</td><td><span style="color:${t.color}">■</span> ${esc(t.name)} <span class="side-n">${esc(t.glyph)}</span></td><td>${cost(t.cost)}</td>
      <td>${esc(tileMakerText(t) || '—')}</td><td>${t.type}${t.unitary ? ', Unitary' : ''}</td><td>${esc(t.text)}</td></tr>`,
    )
    .join('');
  return `<div class="drawer"><button class="close" data-act="roster">Close</button>
    <h3>${esc(R.age.name)} roster</h3>
    <div class="tabs">${tabs}</div>
    <table><tr><th>Code</th><th>Unit</th><th>Cost</th><th>HP</th><th>Built by</th><th>Actions</th><th>Passives</th><th>Traits</th></tr>${units}</table>
    ${
      tiles.length
        ? `<h3 style="margin-top:16px">Tiles</h3>
    <table><tr><th>Code</th><th>Tile</th><th>Cost</th><th>Made by</th><th>Type</th><th>Effect</th></tr>${tileRows}</table>`
        : ''
    }</div>`;
}

function renderMoves(s: GameState): string {
  const rounds = notationRounds(s);
  const res = resultText(s);
  const rows = rounds.map((r) => `<div>${esc(r)}</div>`).join('') + (res ? `<div class="turn">${res}</div>` : '');
  return `<div class="box"><h3>Moves <span class="side-n">${G.width}x${G.height}</span>
    <span class="h-buttons"><button data-act="copy-moves" title="Copy the full notation">Copy</button><button data-act="paste-moves" title="Load a game from notation">Paste…</button></span></h3>
    <div class="moves">${rows || '<div class="side-n">—</div>'}</div></div>`;
}

function renderSettings(): string {
  const box = (key: 'pixel' | 'names', label: string, hint: string) =>
    `<label class="setting"><input type="checkbox" data-setting="${key}" ${ui[key] ? 'checked' : ''}> ${esc(label)}<div class="side-n">${esc(hint)}</div></label>`;
  return `<div class="drawer dialog"><button class="close" data-act="settings">Close</button>
    <h3>Settings</h3>
    ${box('pixel', 'Pixel style', 'The original style: 32×32 symmetric single-colour sprites; tiles as plain colour fields.')}
    ${box('names', 'Unit names', 'Show every unit’s full name in small text on the board.')}
  </div>`;
}

function renderPaste(): string {
  return `<div class="drawer dialog"><button class="close" data-act="paste-cancel">Close</button>
    <h3>Load from notation</h3>
    <form id="paste-form">
      <textarea name="notation" rows="8" placeholder="16x16 1. Qg4@k8 Kh15 ..."></textarea>
      ${ui.error && ui.paste ? `<div class="error">${esc(ui.error)}</div>` : ''}
      <div class="buttons"><button type="submit" name="mode" value="live">Load at the last position</button>
      <button type="submit" name="mode" value="replay">Load and replay from the start</button></div>
      <div class="side-n">Either way this abandons the current game.</div>
    </form></div>`;
}

/** Load a game from its notation text; `replay` opens it at the first position. */
function loadNotation(text: string, replay = false): void {
  const parsed = parseNotation(text, DEFAULT_AGE);
  ui.paste = false;
  replaceMatch(new LocalMatch(DEFAULT_AGE, parsed.inputs, parsed.options));
  if (replay) setView(0);
}

function renderNewGame(): string {
  const s = match.state;
  const current = R.age.boardSizes.includes(s.width) ? s.width : R.age.boardSize;
  const size = (n: number) =>
    `<label><input type="radio" name="size" value="${n}" ${n === current ? 'checked' : ''}> ${n}x${n}</label>`;
  return `<div class="drawer dialog"><button class="close" data-act="new-cancel">Close</button>
    <h3>New game</h3>
    <form id="new-game">
      <div class="fields">Board ${R.age.boardSizes.map(size).join('')}</div>
      <div class="side-n">The Kings and Queens keep their starting offsets: centred on the files, on each side's back rank. Costs can differ by board size (see the Roster).</div>
      ${ui.error && ui.newGame ? `<div class="error">${esc(ui.error)}</div>` : ''}
      <div class="buttons"><button type="submit">Start${s.result ? '' : ' (abandons this game)'}</button></div>
    </form></div>`;
}

function startNewGame(opts: GameOptions): void {
  try {
    const m = new LocalMatch(DEFAULT_AGE, [], opts);
    ui.newGame = false;
    replaceMatch(m);
  } catch (e) {
    ui.error = e instanceof Error ? e.message : String(e);
    render();
  }
}

// ---------------------------------------------------------------------------
// Drag to move: drag one of your units onto a square its Move action reaches.
// ---------------------------------------------------------------------------

interface Drag {
  uid: string;
  a: number;
  x: number;
  y: number;
  active: boolean;
  ghost: HTMLElement | null;
}
let drag: Drag | null = null;
let suppressClick = false;

/** The Move action slot a unit may be dragged with right now, or null. */
function dragMoveSlot(uid: string): number | null {
  const s = match.state;
  const pend = s.pending;
  if (viewing() || !pend || s.result || pend.kind !== 'action') return null;
  const f = forced(s);
  if (f && f.unit !== uid) return null;
  const p = s.pieces[uid];
  const d = p && unitDef(R, p);
  if (!d || p.owner !== pend.player) return null;
  const opts = options().filter((c) => c.unit === uid);
  const a = actionsOf(R, s, p).findIndex((spec, i) => spec.kw === 'move' && opts.some((c) => c.a === i));
  return a < 0 ? null : a;
}

function cellAt(x: number, y: number): Sq | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cell');
  return el ? Number(el.dataset.sq) : null;
}

app.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const cell = (ev.target as HTMLElement).closest<HTMLElement>('.cell');
  if (!cell) return;
  const uid = match.state.board[Number(cell.dataset.sq)];
  if (!uid) return;
  const a = dragMoveSlot(uid);
  if (a === null) return;
  drag = { uid, a, x: ev.clientX, y: ev.clientY, active: false, ghost: null };
});

window.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
    drag.active = true;
    // Show the Move action's destinations while dragging.
    ui.unit = drag.uid;
    ui.a = drag.a;
    ui.picks = [];
    ui.error = '';
    render();
    const src = app.querySelector<HTMLElement>(`.cell[data-sq="${match.state.pieces[drag.uid].sq}"] .piece`);
    if (src) {
      const r = src.getBoundingClientRect();
      const g = src.cloneNode(true) as HTMLElement;
      g.classList.add('drag-ghost');
      g.style.width = `${r.width}px`;
      g.style.height = `${r.height}px`;
      document.body.appendChild(g);
      drag.ghost = g;
      src.classList.add('drag-src');
    }
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${ev.clientX}px`;
    drag.ghost.style.top = `${ev.clientY}px`;
  }
});

window.addEventListener('pointerup', (ev) => {
  const d = drag;
  drag = null;
  if (!d || !d.active) return;
  d.ghost?.remove();
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  const to = cellAt(ev.clientX, ev.clientY);
  const cmd = options().find((c) => c.unit === d.uid && c.a === d.a && c.picks.length === 1 && c.picks[0] === to);
  if (cmd) submit({ type: 'choose', player: match.state.pending!.player, cmd });
  else render(); // dropped elsewhere: keep the unit selected with Move chosen
});

window.addEventListener('pointercancel', () => {
  drag?.ghost?.remove();
  drag = null;
  render();
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function savePrefs(): void {
  saveJson(PREFS_KEY, { flipped: ui.flipped, autoFlip: ui.autoFlip, pixel: ui.pixel, names: ui.names, rosterTab: ui.rosterTab });
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
  input.accept = 'application/json,.json,text/plain,.txt';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      // A JSON save file, or plain notation.
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (data) replaceMatch(LocalMatch.fromSave(data));
      else loadNotation(text);
    } catch (e) {
      ui.error = `Could not load: ${e instanceof Error ? e.message : e}`;
      render();
    }
  };
  input.click();
}

app.addEventListener('submit', (ev) => {
  const form = ev.target as HTMLFormElement;
  if (form.id === 'paste-form') {
    ev.preventDefault();
    try {
      const mode = ((ev as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
      loadNotation(String(new FormData(form).get('notation') ?? ''), mode === 'replay');
    } catch (e) {
      ui.error = e instanceof Error ? e.message : String(e);
      render();
    }
    return;
  }
  if (form.id !== 'new-game') return;
  ev.preventDefault();
  const data = new FormData(form);
  const n = Number(data.get('size'));
  startNewGame({ width: n, height: n });
});

app.addEventListener('click', (ev) => {
  if (suppressClick) return;
  const t = ev.target as HTMLElement;
  const s = match.state;
  const actor = (s.pending?.player ?? s.active) as PlayerId;

  const cell = t.closest<HTMLElement>('.cell');
  if (cell) return onCellClick(Number(cell.dataset.sq));

  const actionBtn = t.closest<HTMLElement>('[data-action]');
  if (actionBtn) return chooseAction(Number(actionBtn.dataset.action));

  const resEl = t.closest<HTMLElement>('[data-res]');
  if (resEl) {
    const r = resEl.dataset.res as Resource;
    ui.resPin = ui.resPin === r ? null : r;
    render();
    return;
  }

  const pickBtn = t.closest<HTMLElement>('[data-pick]');
  if (pickBtn) return pick(pickBtn.dataset.pick!);

  const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
  switch (act) {
    case 'undo':
      stopPlaying();
      ui.view = null;
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
    case 'view-first':
      stopPlaying();
      setView(0);
      break;
    case 'view-prev':
      stopPlaying();
      setView((ui.view ?? match.inputs.length) - 1);
      break;
    case 'view-next':
      stopPlaying();
      setView((ui.view ?? match.inputs.length) + 1);
      break;
    case 'view-last':
      setView(null);
      break;
    case 'view-play':
      togglePlay();
      break;
    case 'view-branch':
      if (ui.view !== null && confirm('Discard every input after this position and play on from here?')) {
        const n = ui.view;
        stopPlaying();
        ui.view = null;
        replaceMatch(new LocalMatch(match.age, match.inputs.slice(0, n), match.options));
      }
      break;
    case 'roster-tab':
      ui.rosterTab = t.closest<HTMLElement>('[data-tab]')!.dataset.tab as UiState['rosterTab'];
      savePrefs();
      render();
      break;
    case 'settings':
      ui.settings = !ui.settings;
      render();
      break;
    case 'copy-moves':
      void navigator.clipboard?.writeText(formatNotation(s)).catch(() => undefined);
      break;
    case 'paste-moves':
      ui.paste = true;
      ui.error = '';
      render();
      break;
    case 'paste-cancel':
      ui.paste = false;
      ui.error = '';
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
      ui.newGame = true;
      ui.error = '';
      render();
      break;
    case 'new-cancel':
      ui.newGame = false;
      ui.error = '';
      render();
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

app.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.act !== 'view-scrub') return;
  stopPlaying();
  setView(Number(el.value));
});

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  const key = el.dataset.setting as 'pixel' | 'names' | undefined;
  if (!key) return;
  ui[key] = el.checked;
  savePrefs();
  render();
});

app.addEventListener('mouseover', (ev) => {
  // Hovering a resource in the budget draws its instances on the board.
  const res = ((ev.target as HTMLElement).closest<HTMLElement>('[data-res]')?.dataset.res ?? null) as Resource | null;
  if (res !== ui.resHover) {
    ui.resHover = res;
    render();
  }
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
  } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key) && match.inputs.length && !(ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLInputElement)) {
    ev.preventDefault();
    stopPlaying();
    const n = ui.view ?? match.inputs.length;
    setView(ev.key === 'ArrowLeft' ? n - 1 : ev.key === 'ArrowRight' ? n + 1 : ev.key === 'Home' ? 0 : null);
    } else if (ev.key === 'Escape') {
    if (ui.newGame) ui.newGame = false;
    else if (ui.settings) ui.settings = false;
    else if (ui.paste) ui.paste = false;
    else if (ui.roster) ui.roster = false;
    else stepBack();
    render();
  }
});

syncRules();
resetSelection();
render();

// Handy for playtesting from the devtools console.
Object.assign(window as unknown as Record<string, unknown>, {
  uatbotl: { get match() { return match; }, commandKey, legalOptions },
});
