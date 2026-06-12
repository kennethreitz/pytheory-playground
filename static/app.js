/* PyTheory Playground frontend — all theory math happens server-side. */

const $ = (id) => document.getElementById(id);
const api = (path) => fetch(path).then(async (r) => {
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
});

let META = null;
let audioEl = null;

// Global playback sound (pytheory synth preset); "" = pure sine.
const soundQ = () => ($("sound").value ? `&sound=${$("sound").value}` : "");

// Play audio through a button that toggles into a stop button while playing.
// Starting any sound stops whatever else was playing (and resets its button).
function playUrl(url, button) {
  if (audioEl && !audioEl.paused && audioEl._button === button) {
    audioEl.pause(); // second click = stop; the pause listener resets the label
    return;
  }
  if (audioEl) audioEl.pause();
  if (button._origHTML === undefined) button._origHTML = button.innerHTML;
  button.disabled = true;
  audioEl = new Audio(url);
  audioEl._button = button;
  const reset = () => {
    button.disabled = false;
    button.innerHTML = button._origHTML;
  };
  audioEl.addEventListener("playing", () => {
    button.disabled = false;
    button.innerHTML = button.classList.contains("mini-play") ? "&#9632;" : "&#9632; Stop";
  }, { once: true });
  audioEl.addEventListener("pause", reset, { once: true });
  audioEl.addEventListener("ended", reset, { once: true });
  audioEl.addEventListener("error", reset, { once: true });
  audioEl.play().catch(reset);
}

function fill(select, options, selected) {
  select.innerHTML = "";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt === "" ? "major (triad)" : opt;
    if (opt === selected) o.selected = true;
    select.appendChild(o);
  }
}

/* ---------- chord diagram (SVG) ---------- */

function autoBase(positions, nFrets = 5) {
  const fretted = positions.filter((p) => p !== null && p > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 1;
  return maxFret <= nFrets ? 1 : minFret;
}

function chordDiagram(svg, positions, strings, opts = {}) {
  const W = opts.width || 220, H = opts.height || 260;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const n = positions.length;
  const left = 35, right = W - 25, top = 56, bottom = H - 20;
  const sx = (i) => left + (i * (right - left)) / (n - 1);
  const nFrets = 5;
  const fy = (f) => top + (f * (bottom - top)) / nFrets;

  const base = opts.base || autoBase(positions, nFrets);

  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
    return e;
  };

  // nut or base-fret marker
  if (base === 1) {
    el("rect", { x: left - 1, y: top - 5, width: right - left + 2, height: 5, class: "diag-nut" });
  } else {
    const t = el("text", { x: left - 28, y: fy(0) + 16, "font-size": 13, class: "diag-label" });
    t.textContent = `${base}fr`;
  }
  // frets and strings
  for (let f = 0; f <= nFrets; f++)
    el("line", { x1: left, y1: fy(f), x2: right, y2: fy(f), "stroke-width": 1, class: "diag-fret" });
  for (let i = 0; i < n; i++)
    el("line", { x1: sx(i), y1: top, x2: sx(i), y2: bottom, "stroke-width": 1, class: "diag-string" });

  positions.forEach((p, i) => {
    const x = sx(i);
    if (p === null) {
      const t = el("text", { x, y: top - 12, "text-anchor": "middle", "font-size": 14, class: "diag-mute" });
      t.textContent = "✕";
    } else if (p === 0) {
      el("circle", { cx: x, cy: top - 17, r: 6, fill: "none", "stroke-width": 2, class: "diag-open" });
    } else {
      const fretPos = p - base + 1;
      if (fretPos >= 1 && fretPos <= nFrets) {
        el("circle", { cx: x, cy: fy(fretPos) - (fy(1) - fy(0)) / 2, r: 9, class: "diag-dot" });
      } else {
        // fretted outside the visible window — show an arrow hint
        const t = el("text", { x, y: fretPos < 1 ? top - 12 : bottom - 4, "text-anchor": "middle", "font-size": 13, class: "diag-out" });
        t.textContent = fretPos < 1 ? "↑" : "↓";
      }
    }
    // string label
    const lbl = el("text", { x, y: bottom + 16, "text-anchor": "middle", "font-size": 12, class: "diag-label" });
    lbl.textContent = strings ? strings[i] : "";
  });

  // invisible click targets for editing
  if (opts.onEdit) {
    const colW = (right - left) / (n - 1);
    for (let i = 0; i < n; i++) {
      const header = el("rect", {
        x: sx(i) - colW / 2, y: 0, width: colW, height: top - 4,
        fill: "transparent", cursor: "pointer",
      });
      header.addEventListener("click", () => opts.onEdit(i, "header"));
      for (let f = 1; f <= nFrets; f++) {
        const cell = el("rect", {
          x: sx(i) - colW / 2, y: fy(f - 1), width: colW, height: fy(1) - fy(0),
          fill: "transparent", cursor: "pointer",
        });
        cell.addEventListener("click", () => opts.onEdit(i, "fret", base + f - 1));
      }
    }
  }
}

/* ---------- chords panel ---------- */

function renderFormula(formula) {
  $("chord-formula").innerHTML = formula.length
    ? formula.map((f) => `<tr><td>${f.note}</td><td>${f.interval}</td></tr>`).join("")
    : "<tr><td>—</td><td>no sounding notes</td></tr>";
}

// Current tuning + capo as a query-string fragment ("" when standard, no capo).
function chordTuning() {
  const sel = $("chord-tuning").value;
  let q = "";
  if (sel === "custom…") {
    const t = $("chord-tuning-custom").value.trim();
    if (t) q = `&tuning=${encodeURIComponent(t)}`;
  } else if (sel !== "standard") {
    q = `&tuning=${encodeURIComponent(sel)}`;
  }
  const capo = parseInt($("chord-capo").value, 10) || 0;
  if (capo > 0) q += `&capo=${capo}`;
  return q;
}

function syncTuningControls() {
  const isGuitar = $("chord-instrument").value === "guitar";
  // Named tunings are guitar-only; other instruments get standard/custom.
  const options = isGuitar ? [...META.tunings, "custom…"] : ["standard", "custom…"];
  const current = $("chord-tuning").value;
  fill($("chord-tuning"), options, options.includes(current) ? current : "standard");
  $("chord-tuning-custom-wrap").classList.toggle("hidden", $("chord-tuning").value !== "custom…");
}

const chordState = {
  positions: [],
  strings: [],
  viewBase: 1,
  custom: false,       // true once the user has clicked the diagram
  voicingTones: [],    // exact pitches of a custom voicing, for playback
};

function renderChordDiagram() {
  $("fret-label").textContent = `${chordState.viewBase}fr`;
  chordDiagram($("chord-diagram"), chordState.positions, chordState.strings, {
    base: chordState.viewBase,
    onEdit: editChordPosition,
  });
}

function editChordPosition(string, action, fret) {
  const p = chordState.positions;
  if (action === "header") {
    p[string] = p[string] === 0 ? null : 0;   // toggle open ↔ muted
  } else {
    p[string] = p[string] === fret ? 0 : fret; // click a dot again to clear
  }
  chordState.custom = true;
  renderChordDiagram();
  scheduleIdentify();
}

let identifyTimer = null;
function scheduleIdentify() {
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(identifyCurrentVoicing, 200);
}

// Map a chord symbol like "Am7" back onto the Root/Quality dropdowns.
function selectChordFromSymbol(symbol) {
  if (!symbol || !META) return false;
  const roots = [...META.roots].sort((a, b) => b.length - a.length);
  for (const root of roots) {
    if (symbol.startsWith(root) && META.qualities.includes(symbol.slice(root.length))) {
      $("chord-root").value = root;
      $("chord-quality").value = symbol.slice(root.length);
      return true;
    }
  }
  return false;
}

async function identifyCurrentVoicing() {
  const frets = chordState.positions.map((p) => (p === null ? "x" : p)).join(",");
  const instrument = $("chord-instrument").value;
  $("chord-error").textContent = "";
  try {
    const d = await api(`/api/tools/identify?frets=${encodeURIComponent(frets)}&instrument=${instrument}${chordTuning()}`);
    const label = d.symbol || d.name;
    $("chord-title").innerHTML = label
      ? `${label} <small class="custom-note">your voicing</small>`
      : `? <small class="custom-note">unrecognized voicing</small>`;
    $("chord-tab").textContent = d.tab;
    $("chord-tones").textContent = d.tones.length ? `tones: ${d.tones.join(" · ")}` : "";
    renderFormula(d.formula || []);
    chordState.voicingTones = d.tones;
    if (selectChordFromSymbol(d.symbol)) {
      // keep the voicing alternatives and chord-tone map in sync with
      // whatever chord the edited shape turned into
      refreshAlternatives(d.symbol);
      if ($("gscale-mode").value === "chord") refreshGuitarScale();
    }
  } catch (e) {
    $("chord-error").textContent = e.message;
  }
}

async function refreshAlternatives(symbol) {
  if (!symbol || !META.chords.includes(symbol)) return;
  try {
    const c = await api(`/api/chord?name=${encodeURIComponent(symbol)}&instrument=${$("chord-instrument").value}${chordTuning()}`);
    renderAlternatives(c.alternatives || []);
    updateShareUrl();
  } catch { /* keep the previous row */ }
}

async function refreshChord() {
  const name = $("chord-root").value + $("chord-quality").value;
  const instrument = $("chord-instrument").value;
  $("chord-error").textContent = "";
  try {
    const c = await api(`/api/chord?name=${encodeURIComponent(name)}&instrument=${instrument}${chordTuning()}`);
    $("chord-title").textContent = c.name;
    $("chord-tab").textContent = c.tab;
    $("chord-tones").textContent = `tones: ${c.tones.join(" · ")}`;
    renderFormula(c.formula);
    chordState.positions = [...c.positions];
    chordState.strings = c.strings;
    chordState.viewBase = autoBase(c.positions);
    chordState.custom = false;
    chordState.voicingTones = [];
    renderChordDiagram();
    renderAlternatives(c.alternatives || []);
    updateShareUrl();
    if ($("gscale-mode").value === "chord") refreshGuitarScale();
  } catch (e) {
    $("chord-error").textContent = e.message;
  }
}

/* ---------- guitar-tab scale fingering (horizontal fretboard SVG) ---------- */

function renderScaleBoard(svg, data) {
  const n = data.strings.length;
  const frets = data.frets;
  const left = 56, right = 16, top = 26, rowH = 27;
  const W = 920, H = top + n * rowH + 26;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
    return e;
  };
  const fw = (W - left - right) / frets;
  const fx = (f) => left + f * fw;                                  // fret-line x
  const dx = (f) => (f === 0 ? left - 16 : left + (f - 0.5) * fw);  // dot x
  const sy = (i) => top + (n - 1 - i) * rowH + rowH / 2;            // low string at bottom

  // fret lines + numbers (nut is heavier)
  for (let f = 0; f <= frets; f++) {
    el("line", { x1: fx(f), y1: top, x2: fx(f), y2: top + n * rowH,
                 class: f === 0 ? "diag-nut-line" : "diag-fret", "stroke-width": f === 0 ? 4 : 1 });
    if (f > 0) {
      const t = el("text", { x: fx(f) - fw / 2, y: top - 8, "text-anchor": "middle",
                             "font-size": 11, class: "diag-label" });
      t.textContent = f;
    }
  }
  // inlay markers
  for (const f of [3, 5, 7, 9, 12, 15]) {
    if (f > frets) break;
    const y = top + (n * rowH) / 2;
    el("circle", { cx: fx(f) - fw / 2, cy: y, r: 4, class: "diag-inlay" });
    if (f === 12) el("circle", { cx: fx(f) - fw / 2, cy: y - rowH, r: 4, class: "diag-inlay" });
  }
  // strings + open labels
  data.strings.forEach((s, i) => {
    const y = sy(i);
    el("line", { x1: left, y1: y, x2: W - right, y2: y, class: "diag-string", "stroke-width": 1 });
    const lbl = el("text", { x: 8, y: y + 4, "font-size": 11, class: "diag-label" });
    lbl.textContent = s.open;
  });
  // scale dots (click to hear)
  data.strings.forEach((s, i) => {
    const y = sy(i);
    for (const pos of s.frets) {
      const g = document.createElementNS(ns, "g");
      g.style.cursor = "pointer";
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", dx(pos.fret)); c.setAttribute("cy", y); c.setAttribute("r", 10);
      c.setAttribute("class", pos.root ? "board-dot root" : "board-dot");
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", dx(pos.fret)); t.setAttribute("y", y + 3.5);
      t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", 9);
      t.setAttribute("class", "board-note");
      t.textContent = pos.note;
      g.append(c, t);
      if (pos.pitch) g.addEventListener("click", () => playPitch(pos.pitch));
      svg.appendChild(g);
    }
  });
}

// quick one-shot note playback (no toggle button involved)
function playPitch(pitch) {
  if (audioEl) audioEl.pause();
  audioEl = new Audio(`/api/voicing/audio?tones=${encodeURIComponent(pitch)}${soundQ()}`);
  audioEl.play().catch(() => {});
}

async function refreshGuitarScale() {
  const mode = $("gscale-mode").value;
  $("gscale-pickers").classList.toggle("hidden", mode === "chord");
  const base = `instrument=${$("chord-instrument").value}${chordTuning()}`;
  const url = mode === "chord"
    ? `/api/chord/positions?name=${encodeURIComponent($("chord-root").value + $("chord-quality").value)}&${base}`
    : `/api/scale/positions?tonic=${encodeURIComponent($("gscale-tonic").value)}&name=${encodeURIComponent($("gscale-name").value)}&${base}`;
  try {
    renderScaleBoard($("gscale-board"), await api(url));
  } catch (e) {
    $("chord-error").textContent = e.message;
  }
}

// alternative voicings as clickable mini diagrams
function renderAlternatives(alts) {
  const row = $("chord-alts");
  row.innerHTML = "";
  for (const positions of alts) {
    const div = document.createElement("div");
    div.className = "prog-chord alt-voicing";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", 110);
    svg.setAttribute("height", 135);
    chordDiagram(svg, positions, chordState.strings, { width: 110, height: 135 });
    div.appendChild(svg);
    div.title = "Load this voicing into the editor";
    div.addEventListener("click", () => {
      chordState.positions = [...positions];
      chordState.viewBase = autoBase(positions);
      chordState.custom = true;
      renderChordDiagram();
      identifyCurrentVoicing();
    });
    row.appendChild(div);
  }
}

/* ---------- scales panel ---------- */

const SHARP_OF = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
const PC = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };

function pitchClass(name) {
  const n = name.replace(/[0-9-]/g, "");
  return PC[SHARP_OF[n] ?? n];
}

function renderPiano(container, noteNames) {
  container.innerHTML = "";
  const lit = new Set(noteNames.map(pitchClass));
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 }; // white index -> black pc
  let x = 0;
  for (let oct = 0; oct < 2; oct++) {
    whites.forEach((pc, wi) => {
      const k = document.createElement("div");
      k.className = "white-key" + (lit.has(pc) ? " lit" : "");
      k.style.left = `${x}px`;
      container.appendChild(k);
      if (wi in blacks) {
        const b = document.createElement("div");
        b.className = "black-key" + (lit.has(blacks[wi]) ? " lit" : "");
        b.style.left = `${x + 25}px`;
        container.appendChild(b);
      }
      x += 37;
    });
  }
}

let lastHarmonized = [];

// Repopulate tonic + scale selects for the chosen tonal system,
// keeping the current choice when it exists there. Defaults to B minor.
function syncSystemControls() {
  const sys = META.systems[$("scale-system").value];
  const curTonic = $("scale-tonic").value;
  const tonicDefault = sys.tonics.includes(curTonic) ? curTonic
    : sys.tonics.includes("B") ? "B" : sys.tonics[0];
  fill($("scale-tonic"), sys.tonics, tonicDefault);
  const curScale = $("scale-name").value;
  const scaleDefault = sys.scales.includes(curScale) ? curScale
    : sys.scales.includes("minor") ? "minor" : (sys.scales[1] || sys.scales[0]);
  fill($("scale-name"), sys.scales, scaleDefault);
}

async function refreshScale() {
  const system = $("scale-system").value;
  const tonic = $("scale-tonic").value, octave = $("scale-octave").value, name = $("scale-name").value;
  const q = `system=${encodeURIComponent(system)}&tonic=${encodeURIComponent(tonic)}&octave=${octave}&name=${encodeURIComponent(name)}`;
  $("scale-error").textContent = "";
  try {
    const s = await api(`/api/scale?${q}`);
    $("scale-title").textContent = `${tonic} ${s.name}` + (system !== "western" ? ` (${system})` : "");
    const row = $("scale-notes");
    row.innerHTML = "";
    s.tones.forEach((t, i) => {
      const pill = document.createElement("span");
      pill.className = "note-pill" + (i === 0 ? " tonic" : "");
      pill.textContent = t;
      row.appendChild(pill);
    });
    // Piano + fretboard views only make sense for 12-TET western note names.
    const westernNotes = META.systems[system].western_notes;
    $("scale-piano").classList.toggle("hidden", !westernNotes);
    $("scale-fretboard-card").classList.toggle("hidden", !westernNotes);
    if (westernNotes) {
      renderPiano($("scale-piano"), s.note_names);
      const inst = $("scale-instrument").value || "guitar";
      api(`/api/scale/fretboard?${q}&instrument=${inst}`)
        .then((d) => ($("scale-fretboard").textContent = d.diagram))
        .catch((e) => ($("scale-fretboard").textContent = e.message));
    }
    updateShareUrl();
    $("scale-harmonized-card").classList.toggle("hidden", s.harmonized.length === 0);
    pillRow($("scale-harmonized"), s.harmonized, (pill, sym) => {
      pill.textContent = sym;
      pill.append(" ", playButton(`/api/symbols/audio?symbols=${encodeURIComponent(sym)}`));
    });
    lastHarmonized = s.harmonized;
  } catch (e) {
    $("scale-error").textContent = e.message;
  }
}

/* ---------- keys & progressions panel ---------- */

let randomSymbols = null; // when set, play/MIDI use the rolled progression

function renderProgressionRow(chords) {
  const row = $("prog-chords");
  row.innerHTML = "";
  for (const ch of chords) {
    const div = document.createElement("div");
    div.className = "prog-chord";
    div.innerHTML = `<div class="numeral ${numeralFunction(ch.numeral)}">${ch.numeral}</div><div class="sym">${ch.symbol}</div>`;
    if (ch.positions) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", 130);
      svg.setAttribute("height", 160);
      chordDiagram(svg, ch.positions, ch.strings, { width: 130, height: 160 });
      div.appendChild(svg);
    }
    row.appendChild(div);
  }
}

async function rollProgression() {
  const tonic = encodeURIComponent($("key-tonic").value);
  const mode = $("key-mode").value;
  try {
    let d = null;
    // re-roll dull results (all one chord, or same as what's showing)
    for (let tries = 0; tries < 4; tries++) {
      d = await api(`/api/progression/random?tonic=${tonic}&mode=${mode}`);
      const distinct = new Set(d.symbols).size;
      if (distinct >= 3 && d.symbols.join() !== (randomSymbols || []).join()) break;
    }
    renderProgressionRow(d.chords);
    randomSymbols = d.symbols;
    $("prog-rolled").textContent =
      `rolled: ${d.chords.map((c) => c.numeral).join("–")} (${d.symbols.join(" ")})`;
    const row = $("prog-chords");
    row.classList.remove("flash");
    void row.offsetWidth; // restart the animation
    row.classList.add("flash");
  } catch (e) {
    $("key-error").textContent = e.message;
  }
}

function progParams() {
  const tonic = encodeURIComponent($("key-tonic").value);
  const mode = $("key-mode").value;
  const numerals = encodeURIComponent($("key-progression").value);
  return `tonic=${tonic}&mode=${mode}&numerals=${numerals}`;
}

async function refreshKey() {
  $("key-error").textContent = "";
  try {
    const tonic = $("key-tonic").value, mode = $("key-mode").value;
    const k = await api(`/api/key?tonic=${encodeURIComponent(tonic)}&mode=${mode}`);
    $("key-title").textContent = `${k.tonic} ${k.mode}`;
    const numerals = mode === "major"
      ? ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
      : ["i", "ii°", "III", "iv", "v", "VI", "VII"];
    $("key-numerals").innerHTML = numerals.slice(0, k.chords.length)
      .map((n) => `<th class="${numeralFunction(n)}">${n}</th>`).join("");
    $("key-triads").innerHTML = k.chords.map((c) => `<td>${c}</td>`).join("");
    $("key-sevenths").innerHTML = k.seventh_chords.map((c) => `<td>${c}</td>`).join("");
    const sig = k.signature;
    const sigText = sig.accidentals.length
      ? `${sig.accidentals.join(" ")} (${sig.sharps || sig.flats} ${sig.sharps ? "sharps" : "flats"})`
      : "no accidentals";
    $("key-extra").textContent = `signature: ${sigText} · relative: ${k.relative}`;

    updateShareUrl();
    const p = await api(`/api/progression?${progParams()}`);
    renderProgressionRow(p.chords);
    randomSymbols = null;
    $("prog-rolled").textContent = "";

    // beyond the key: borrowed chords + secondary dominants + suggestions
    const symbolize = (s) => s.replace(" major", "").replace(" minor", "m")
      .replace(" diminished", "dim").replace(" half-diminished 7th", "m7b5")
      .replace(" dominant 7th", "7").replace(" 7th", "7");
    const ex = await api(`/api/key/explore?tonic=${encodeURIComponent(tonic)}&mode=${mode}`);
    pillRow($("key-borrowed"), ex.borrowed);
    pillRow($("key-secondary"), ex.secondary_dominants, (pill, sd) => {
      pill.innerHTML = `${sd.symbol} <small>V/${numerals[sd.degree - 1]}</small>`;
      pill.append(" ", playButton(`/api/symbols/audio?symbols=${encodeURIComponent(sd.symbol + "," + symbolize(k.chords[sd.degree - 1]))}`));
    });
    const afterChords = k.chords.map(symbolize);
    fill($("key-after"), afterChords, $("key-after").value || afterChords[3]);
    refreshSuggestions();
    refreshModulation();
    renderCircle();
  } catch (e) {
    $("key-error").textContent = e.message;
  }
}

async function refreshSuggestions() {
  const tonic = $("key-tonic").value, mode = $("key-mode").value;
  const after = $("key-after").value;
  if (!after) return;
  try {
    const d = await api(`/api/key/explore?tonic=${encodeURIComponent(tonic)}&mode=${mode}&after=${encodeURIComponent(after)}`);
    pillRow($("key-suggestions"), d.suggestions, (pill, sym) => {
      pill.textContent = sym;
      pill.append(" ", playButton(`/api/symbols/audio?symbols=${encodeURIComponent(after + "," + sym)}`));
    });
  } catch (e) {
    $("key-suggestions").textContent = e.message;
  }
}

let modPath = [];
async function refreshModulation() {
  const tonic = $("key-tonic").value, mode = $("key-mode").value;
  const to = $("mod-tonic").value, toMode = $("mod-mode").value;
  try {
    const d = await api(`/api/key/modulate?tonic=${encodeURIComponent(tonic)}&mode=${mode}&to_tonic=${encodeURIComponent(to)}&to_mode=${toMode}`);
    modPath = d.path;
    pillRow($("mod-path"), d.path.length ? d.path : ["—"]);
    $("mod-pivots").textContent = d.pivot_chords.length
      ? `pivot chords: ${d.pivot_chords.join(" · ")}`
      : "no shared diatonic chords — chromatic modulation";
  } catch (e) {
    $("key-error").textContent = e.message;
  }
}

// harmonic function of a Roman numeral: tonic / subdominant / dominant
function numeralFunction(numeral) {
  const base = numeral.replace(/[^ivIV]/g, "").toLowerCase();
  if (["i", "iii", "vi"].includes(base)) return "fn-tonic";
  if (["ii", "iv"].includes(base)) return "fn-subdominant";
  if (["v", "vii"].includes(base)) return "fn-dominant";
  return "";
}

/* ---------- circle of fifths ---------- */

let circleData = null;

async function renderCircle() {
  if (!circleData) circleData = (await api("/api/circle")).keys;
  const svg = $("circle-fifths");
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const cx = 180, cy = 180;
  const current = $("key-tonic").value;
  const mode = $("key-mode").value;
  circleData.forEach((k, i) => {
    const angle = (i * 30 - 90) * Math.PI / 180;
    const place = (r) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const rings = [
      { label: k.major, r: 142, size: 19, active: mode === "major" && k.major === current },
      { label: k.minor, r: 96, size: 14, active: mode === "minor" && k.minor === current + "m" },
    ];
    for (const ring of rings) {
      const [x, y] = place(ring.r);
      const g = document.createElementNS(ns, "g");
      g.style.cursor = "pointer";
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", ring.size + 5);
      c.setAttribute("class", "circle-node" + (ring.active ? " active" : ""));
      if (!ring.active) {
        c.style.fill = `hsl(${i * 30}, 35%, 16%)`;
        c.style.stroke = `hsl(${i * 30}, 45%, 42%)`;
      }
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x); t.setAttribute("y", y + 4.5);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", ring.size === 19 ? 15 : 12);
      t.setAttribute("class", "circle-label" + (ring.active ? " active" : ""));
      t.textContent = ring.label;
      g.append(c, t);
      g.addEventListener("click", () => {
        $("key-tonic").value = k.major;
        $("key-mode").value = ring.label.endsWith("m") && ring.r === 96 ? "minor" : "major";
        refreshKey();
      });
      svg.appendChild(g);
    }
    // signature label between the rings
    const sig = k.sharps ? `${k.sharps}♯` : k.flats ? `${k.flats}♭` : "";
    if (sig) {
      const [x, y] = place(120);
      const s = document.createElementNS(ns, "text");
      s.setAttribute("x", x); s.setAttribute("y", y + 3);
      s.setAttribute("text-anchor", "middle");
      s.setAttribute("font-size", 9);
      s.setAttribute("class", "circle-sig");
      s.textContent = sig;
      svg.appendChild(s);
    }
  });
}

/* ---------- tools panel ---------- */

const FMT_EXT = { lilypond: "ly", abc: "abc", musicxml: "musicxml", tab: "txt" };

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Shared converter UI (MIDI + audio cards): format subtabs, downloads, PDF engraving.
function setupConverter(prefix, buildRequest) {
  const state = { outputs: null, format: "lilypond" };

  const show = (fmt) => {
    state.format = fmt;
    document.querySelectorAll(`#${prefix}-format-tabs button`).forEach((b) =>
      b.classList.toggle("active", b.dataset.fmt === fmt));
    $(`${prefix}-output`).textContent = state.outputs ? state.outputs[fmt] : "";
    $(`${prefix}-pdf`).classList.toggle("hidden", fmt !== "lilypond");
  };

  $(`${prefix}-convert`).addEventListener("click", async () => {
    const btn = $(`${prefix}-convert`);
    $(`${prefix}-error`).textContent = "";
    let reqSpec;
    try {
      reqSpec = await buildRequest();
    } catch (e) {
      $(`${prefix}-error`).textContent = e.message;
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch(reqSpec.url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: reqSpec.body,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      state.outputs = data;
      $(`${prefix}-outputs`).classList.remove("hidden");
      $(`${prefix}-detected`).textContent =
        (data.detected_key ? `Detected key: ${data.detected_key}` : `Key: ${data.key}`) +
        (data.bpm ? ` · ${Math.round(data.bpm)} bpm` : "");
      const midiBtn = $(`${prefix}-midi-dl`);
      if (midiBtn) midiBtn.classList.toggle("hidden", !data.midi_b64);
      show(state.format);
    } catch (e) {
      $(`${prefix}-error`).textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelectorAll(`#${prefix}-format-tabs button`).forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.fmt)));

  $(`${prefix}-download`).addEventListener("click", () => {
    if (!state.outputs) return;
    downloadBlob(new Blob([state.outputs[state.format]], { type: "text/plain" }),
                 `score.${FMT_EXT[state.format]}`);
  });

  $(`${prefix}-pdf`).addEventListener("click", async () => {
    if (!state.outputs) return;
    const btn = $(`${prefix}-pdf`);
    btn.disabled = true;
    $(`${prefix}-error`).textContent = "";
    try {
      const r = await fetch(`/api/tools/lilypond-pdf?sig=${state.outputs.lilypond_sig || ""}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: state.outputs.lilypond,
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || r.statusText);
      }
      window.open(URL.createObjectURL(await r.blob()), "_blank");
    } catch (e) {
      $(`${prefix}-error`).textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  const midiBtn = $(`${prefix}-midi-dl`);
  if (midiBtn) midiBtn.addEventListener("click", () => {
    if (!state.outputs?.midi_b64) return;
    const bytes = Uint8Array.from(atob(state.outputs.midi_b64), (c) => c.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: "audio/midi" }), "transcription.mid");
  });
}

async function fileBody(inputId, errorMessage) {
  const file = $(inputId).files[0];
  if (!file) throw new Error(errorMessage);
  return { file, body: await file.arrayBuffer() };
}

/* ---------- in-browser recording (raw PCM → WAV, no codecs needed) ---------- */

const REC_MAX_SECONDS = 30;
let audioRecording = null; // most recent recording for the audio converter

function encodeWav(chunks, rate) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const tag = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, len * 2, true);
  const pcm = new Int16Array(buf, 44);
  let o = 0;
  for (const c of chunks)
    for (let i = 0; i < c.length; i++) pcm[o++] = Math.max(-1, Math.min(1, c[i])) * 0x7fff;
  return new Blob([buf], { type: "audio/wav" });
}

// Independent mic recorder bound to a button + status line; onBlob gets a WAV.
function setupRecorder(buttonId, statusId, onBlob) {
  const r = { active: false, ctx: null, stream: null, node: null, chunks: [], timer: null };
  const btn = $(buttonId), status = $(statusId);

  async function start() {
    try {
      // recordings survive noisy rooms much better with the browser's
      // noise suppression and auto-gain in front of them
      r.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      status.textContent = `microphone access denied: ${e.message}`;
      return;
    }
    r.ctx = new AudioContext();
    const source = r.ctx.createMediaStreamSource(r.stream);
    r.node = r.ctx.createScriptProcessor(4096, 1, 1);
    r.chunks = [];
    r.node.onaudioprocess = (e) => {
      if (r.active) r.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(r.node);
    r.node.connect(r.ctx.destination);
    r.active = true;
    btn.innerHTML = "&#9632; Stop recording";
    const started = performance.now();
    r.timer = setInterval(() => {
      const s = (performance.now() - started) / 1000;
      status.textContent = `recording… ${s.toFixed(0)}s`;
      if (s >= REC_MAX_SECONDS) stop();
    }, 250);
  }

  function stop() {
    r.active = false;
    clearInterval(r.timer);
    const rate = r.ctx.sampleRate;
    r.node?.disconnect();
    r.ctx?.close();
    r.stream?.getTracks().forEach((t) => t.stop());
    btn.innerHTML = "&#9679; Record";
    const seconds = r.chunks.reduce((n, c) => n + c.length, 0) / rate;
    if (seconds < 0.5) {
      status.textContent = "too short — try again";
      return;
    }
    status.textContent = `recorded ${seconds.toFixed(1)}s…`;
    onBlob(encodeWav(r.chunks, rate), seconds);
    r.chunks = [];
  }

  btn.addEventListener("click", () => (r.active ? stop() : start()));
}

/* ---------- hum it → harmonize it ---------- */

let harmData = null;

async function harmonizeBody(body, filename) {
  $("harm-error").textContent = "";
  $("harm-go").disabled = true;
  try {
    const r = await fetch(`/api/tools/harmonize?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    harmData = d;
    $("harm-result").classList.remove("hidden");
    $("harm-summary").textContent =
      `${d.key} · ${Math.round(d.bpm)} bpm · ${d.bars} bar${d.bars === 1 ? "" : "s"} · ${d.melody_notes} notes heard`;
    pillRow($("harm-chords"), d.chords.map((sym, i) => ({ sym, i })), (pill, c) => {
      pill.innerHTML = `<small>bar ${c.i + 1}</small> ${c.sym}`;
    });
    $("harm-audio").src = `data:${d.audio_mime || "audio/wav"};base64,${d.audio_b64}`;
  } catch (e) {
    $("harm-error").textContent = e.message;
  } finally {
    $("harm-go").disabled = false;
    $("harm-rec-status").textContent = "or choose a file:";
  }
}

async function engraveSource(source, sig, btn, errId) {
  btn.disabled = true;
  $(errId).textContent = "";
  try {
    const r = await fetch(`/api/tools/lilypond-pdf?sig=${sig || ""}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: source,
    });
    if (!r.ok) {
      const data = await r.json();
      throw new Error(data.error || r.statusText);
    }
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  } catch (e) {
    $(errId).textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- tuner ---------- */

const tuner = {
  running: false,
  mode: "sse",     // "sse" = pytheory's native tuner; "mic" = browser-mic fallback
  es: null,
  ctx: null,
  stream: null,
  node: null,
  buffer: [],
  timer: null,
  strings: [],
  busy: false,
  lastChord: null,
};

const tunerChordMode = () => $("tuner-listen").value === "chord";

function tunerQuery() {
  const t = $("tuner-tuning").value;
  const tq = t && t !== "standard" ? `&tuning=${encodeURIComponent(t)}` : "";
  return `instrument=${$("tuner-instrument").value}${tq}`;
}

async function refreshTunerStrings() {
  const chromatic = $("tuner-instrument").value === "chromatic";
  $("tuner-tuning-wrap").classList.toggle("hidden", chromatic);
  $("tuner-strings").parentElement.querySelector("h4").classList.toggle("hidden", chromatic);
  if (chromatic) {
    tuner.strings = [];
    $("tuner-strings").innerHTML = "";
    return;
  }
  try {
    const d = await api(`/api/tuner/strings?${tunerQuery()}`);
    tuner.strings = d.strings;
    pillRow($("tuner-strings"), d.strings, (pill, s) => {
      pill.textContent = s.label;
      pill.title = `${s.frequency} Hz — click for reference tone`;
      pill.style.cursor = "pointer";
      pill.dataset.label = s.label;
      pill.addEventListener("click", (e) =>
        playUrl(`/api/voicing/audio?tones=${encodeURIComponent(s.label)}${soundQ()}`, e.target));
    });
  } catch (e) {
    $("tuner-error").textContent = e.message;
  }
}

// Strobe disc (the heart of pytheory's upcoming native strobe tuner):
// rotation speed is proportional to cents — sharp drifts clockwise, flat
// counter-clockwise, in tune freezes. Inner rings move slower = fine reading.
const STROBE_RINGS = [
  { n: 24, r0: 118, r1: 162, mult: 1.0 },
  { n: 12, r0: 68, r1: 112, mult: 0.5 },
  { n: 6, r0: 22, r1: 62, mult: 0.25 },
];
let strobeAngle = 0;
let strobeRaf = null;
let strobeLast = 0;

function strobeFrame(now) {
  if (!tuner.running || tunerChordMode() || $("tuner-display-mode").value !== "strobe") {
    strobeRaf = null;
    return;
  }
  const ctx = $("strobe-disc").getContext("2d");
  const dt = strobeLast ? Math.min((now - strobeLast) / 1000, 0.1) : 0;
  strobeLast = now;
  const cents = tuner.lastCents;
  if (cents !== null) strobeAngle += cents * dt * 0.06 * 2 * Math.PI;

  ctx.clearRect(0, 0, 340, 340);
  const styles = getComputedStyle(document.documentElement);
  ctx.fillStyle = cents === null ? styles.getPropertyValue("--line").trim()
    : Math.abs(cents) < 5 ? "#3fb950"
    : styles.getPropertyValue("--accent").trim();
  for (const ring of STROBE_RINGS) {
    const seg = (2 * Math.PI) / ring.n;
    for (let i = 0; i < ring.n; i++) {
      const a = strobeAngle * ring.mult + i * seg;
      ctx.beginPath();
      ctx.arc(170, 170, ring.r1, a, a + seg / 2);       // outer edge
      ctx.arc(170, 170, ring.r0, a + seg / 2, a, true); // back along inner
      ctx.fill();
    }
  }
  strobeRaf = requestAnimationFrame(strobeFrame);
}

function syncTunerDisplay() {
  const chord = tunerChordMode();
  const strobe = !chord && $("tuner-display-mode").value === "strobe";
  $("tuner-display-wrap").classList.toggle("hidden", chord);
  $("tuner-scale").classList.toggle("hidden", chord);
  $("tuner-track-needle").classList.toggle("hidden", strobe || chord);
  $("tuner-strobe").classList.toggle("hidden", !strobe);
  $("tuner-chord-notes").classList.toggle("hidden", !chord);
  $("tuner-hint-note").classList.toggle("hidden", chord);
  $("tuner-hint-chord").classList.toggle("hidden", !chord);
  $("tuner-api-hint").textContent = chord
    ? "pytheory.audio.identify_chord(samples, rate)"
    : "pytheory.tuner.Tuner · analyze_frame(…)";
  if (!tuner.running)
    $("tuner-toggle").textContent = chord ? "🎤 Identify chords" : "🎤 Start tuner";
  if (strobe && tuner.running && !strobeRaf) {
    strobeLast = 0;
    strobeRaf = requestAnimationFrame(strobeFrame);
  }
}

function chordUpdate(d) {
  const c = d.chord;
  tuner.lastCents = null;
  if (!c) {
    $("tuner-note").textContent = "—";
    $("tuner-freq").textContent = "strum a chord…";
    $("tuner-verdict").textContent = "";
    $("tuner-chord-notes").innerHTML = "";
    tuner.lastChord = null;
    return;
  }
  $("tuner-note").textContent = c.symbol;
  $("tuner-freq").textContent = c.notes.join(" · ");
  $("tuner-verdict").textContent = `${Math.round(c.confidence * 100)}% match`;
  if (c.symbol !== tuner.lastChord) {
    tuner.lastChord = c.symbol;
    pillRow($("tuner-chord-notes"), c.notes);
    $("tuner-chord-notes").appendChild(
      playButton(`/api/chord/audio?name=${encodeURIComponent(c.symbol)}`));
  }
}

function tunerUpdate(d) {
  const needle = $("tuner-needle");
  tuner.lastCents = d.voiced ? d.cents : null;
  if (!d.voiced) {
    $("tuner-note").textContent = "—";
    $("tuner-freq").textContent = "listening for a note…";
    $("tuner-verdict").textContent = "";
    needle.style.left = "50%";
    needle.classList.remove("in-tune");
    document.querySelectorAll("#tuner-strings .note-pill").forEach((p) =>
      p.classList.remove("tonic"));
    return;
  }
  $("tuner-note").textContent = `${d.note}${d.octave ?? ""}`;
  $("tuner-freq").textContent = `${d.frequency} Hz · target ${d.target} Hz`;
  const clamped = Math.max(-50, Math.min(50, d.cents));
  needle.style.left = `${50 + clamped}%`;
  const inTune = Math.abs(d.cents) < 5;
  needle.classList.toggle("in-tune", inTune);
  $("tuner-verdict").textContent = inTune ? "in tune"
    : d.cents > 0 ? `${d.cents}¢ sharp — tune down` : `${Math.abs(d.cents)}¢ flat — tune up`;
  // highlight the nearest open string
  document.querySelectorAll("#tuner-strings .note-pill").forEach((p) => {
    const s = tuner.strings.find((x) => x.label === p.dataset.label);
    p.classList.toggle("tonic",
      !!s && Math.abs(1200 * Math.log2(d.frequency / s.frequency)) < 60);
  });
}

async function tunerTick() {
  if (!tuner.running || tuner.busy) return;
  // Rolling window: analyze the most recent slice without draining the
  // buffer, so updates land every tick instead of waiting for a fresh
  // accumulation each time. Pitch tracking reads ~0.35s; chord ID folds
  // ~1s into a chromagram (identify_chord's sweet spot).
  const chord = tunerChordMode();
  const windowSec = chord ? 1.0 : 0.35;
  const need = Math.floor(tuner.ctx.sampleRate * windowSec);
  let total = 0;
  for (const chunk of tuner.buffer) total += chunk.length;
  if (total < need) return;
  const all = new Float32Array(total);
  let off = 0;
  for (const chunk of tuner.buffer) { all.set(chunk, off); off += chunk.length; }
  // trim the rolling buffer to just past the analysis window
  const keep = Math.floor(tuner.ctx.sampleRate * (windowSec + 0.15));
  if (total > keep) tuner.buffer = [all.subarray(total - keep)];
  const slice = all.subarray(all.length - need);
  tuner.busy = true;
  try {
    const url = chord
      ? `/api/tools/identify-chord?rate=${tuner.ctx.sampleRate}`
      : `/api/tools/tune?rate=${tuner.ctx.sampleRate}&system=${encodeURIComponent($("tuner-system").value)}&reference=${$("tuner-reference").value}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
    });
    if (r.ok) (chord ? chordUpdate : tunerUpdate)(await r.json());
  } catch { /* transient — keep listening */ } finally {
    tuner.busy = false;
  }
}

// Preferred path: pytheory's own Tuner + SSE stream (mic opens on the server,
// readings arrive 20/sec). Western-only — analyze_frame thinks in MIDI.
async function tryNativeTuner() {
  try {
    const r = await fetch(`/api/tuner/start?reference=${$("tuner-reference").value}`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) {
      tuner.nativeFailure = data.error || r.statusText;
      return false;
    }
    const adopt = (conn, kind) => {
      tuner.es = conn;
      tuner.running = true;
      tuner.mode = "sse";
      $("tuner-toggle").textContent = "■ Stop tuner";
      $("tuner-mode").textContent = `native tuner — server mic, 20 readings/sec (${kind})`;
      syncTunerDisplay();
    };
    const onReading = (raw) => {
      const d = JSON.parse(raw);
      if (!d || !d.note) return tunerUpdate({ voiced: false });
      tunerUpdate({
        voiced: true,
        frequency: d.freq,
        note: d.note,
        octave: d.octave,
        cents: d.cents,
        target: Math.round(d.freq / Math.pow(2, d.cents / 1200) * 100) / 100,
      });
    };
    // pytheory's next release streams over WebSocket; today's serves SSE.
    const base = new URL(data.stream);
    const tryWs = () => new Promise((resolve) => {
      let adopted = false;
      const ws = new WebSocket(`ws://${base.host}/ws`);
      const giveUp = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 1500);
      ws.onerror = () => { clearTimeout(giveUp); resolve(false); };
      ws.onmessage = (e) => {
        clearTimeout(giveUp);
        if (!adopted) { adopted = true; adopt(ws, "websocket"); resolve(true); }
        onReading(e.data);
      };
    });
    const trySse = () => new Promise((resolve) => {
      let adopted = false;
      const es = new EventSource(data.stream);
      const giveUp = setTimeout(() => { es.close(); resolve(false); }, 4000);
      es.onerror = () => { clearTimeout(giveUp); es.close(); resolve(false); };
      es.onmessage = (e) => {
        clearTimeout(giveUp);
        if (!adopted) { adopted = true; adopt(es, "sse"); resolve(true); }
        onReading(e.data);
      };
    });
    // serve() binds :8123 on a thread — give it a beat and retry once
    if (await tryWs()) return true;
    await new Promise((r) => setTimeout(r, 700));
    return (await tryWs()) || (await trySse());
  } catch {
    return false;
  }
}

async function tunerStart() {
  $("tuner-error").textContent = "";
  // The native tuner streams pitch readings only — chord ID needs the raw
  // audio, so it always rides the browser-mic pipeline.
  if (!tunerChordMode() && $("tuner-system").value === "western" && await tryNativeTuner()) return;
  tuner.mode = "mic";
  try {
    // Note mode: noise suppression keeps room hum out of the pitch tracker;
    // echo cancellation stops reference tones from feeding back into it.
    // Chord mode wants the raw mic — that speech DSP ducks a sustained
    // ringing chord like stationary noise and starves the chromagram.
    const dsp = !tunerChordMode();
    tuner.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: dsp, noiseSuppression: dsp, autoGainControl: dsp },
    });
  } catch (e) {
    $("tuner-error").textContent = `Microphone access denied: ${e.message}`;
    return;
  }
  tuner.ctx = new AudioContext();
  const source = tuner.ctx.createMediaStreamSource(tuner.stream);
  tuner.node = tuner.ctx.createScriptProcessor(4096, 1, 1);
  tuner.node.onaudioprocess = (e) => {
    if (tuner.running) tuner.buffer.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(tuner.node);
  tuner.node.connect(tuner.ctx.destination);
  tuner.running = true;
  tuner.timer = setInterval(tunerTick, 200);
  $("tuner-toggle").textContent = tunerChordMode() ? "■ Stop listening" : "■ Stop tuner";
  syncTunerDisplay();
  $("tuner-mode").textContent = tunerChordMode()
    ? "browser mic → pytheory.audio.identify_chord, ~1s window"
    : "browser mic"
      + (tuner.nativeFailure ? ` (native tuner unavailable: ${tuner.nativeFailure})` : "");
}

function tunerStop() {
  tuner.running = false;
  if (tuner.mode === "sse") {
    tuner.es?.close();
    tuner.es = null;
    fetch("/api/tuner/stop", { method: "POST" }).catch(() => {});
  } else {
    clearInterval(tuner.timer);
    tuner.node?.disconnect();
    tuner.ctx?.close();
    tuner.stream?.getTracks().forEach((t) => t.stop());
    tuner.buffer = [];
  }
  $("tuner-toggle").textContent = tunerChordMode() ? "🎤 Identify chords" : "🎤 Start tuner";
  $("tuner-mode").textContent = "";
  if (tunerChordMode()) chordUpdate({ chord: null });
  else tunerUpdate({ voiced: false });
}

/* ---------- chord lab ---------- */

function pillRow(container, items, formatter) {
  container.innerHTML = "";
  for (const item of items) {
    const pill = document.createElement("span");
    pill.className = "note-pill";
    if (formatter) formatter(pill, item); else pill.textContent = item;
    container.appendChild(pill);
  }
}

function playButton(url) {
  const b = document.createElement("button");
  b.className = "mini-play";
  b.textContent = "▶";
  b.addEventListener("click", (e) => playUrl(url + soundQ(), e.target));
  return b;
}

async function refreshLab() {
  $("lab-error").textContent = "";
  try {
    const d = await api(`/api/chord/lab?name=${encodeURIComponent($("lab-symbol").value.trim())}`);
    $("lab-title").textContent = d.symbol;
    updateShareUrl();
    $("lab-tones").textContent = `tones: ${d.tones.join(" · ")}`;
    $("lab-intervals").textContent = d.intervals.join(" – ") + " semitones";
    $("lab-pcs").textContent = `{${d.pitch_classes.join(", ")}}`;
    $("lab-forte").textContent = d.forte_number;
    $("lab-figured").textContent = d.figured_bass ?? "—";
    const t = d.tension;
    $("lab-tension").textContent =
      `${t.score} (${t.tritones} tritone${t.tritones === 1 ? "" : "s"}, ${t.minor_seconds} minor 2nd${t.minor_seconds === 1 ? "" : "s"}${t.has_dominant_function ? ", dominant function" : ""})`;
    $("lab-dissonance").textContent = d.dissonance;

    const v = $("lab-voicings");
    v.innerHTML = "";
    for (const voicing of d.voicings) {
      const row = document.createElement("div");
      row.className = "voicing-row";
      const label = document.createElement("span");
      label.className = "voicing-label";
      label.textContent = voicing.label;
      const tones = document.createElement("span");
      tones.className = "tones";
      tones.textContent = voicing.tones.join(" ");
      row.append(playButton(`/api/voicing/audio?tones=${encodeURIComponent(voicing.tones.join(","))}`), label, tones);
      v.appendChild(row);
    }

    const sub = $("lab-sub");
    sub.innerHTML = "";
    if (d.tritone_sub) {
      sub.append("Tritone substitution: ");
      const pill = document.createElement("span");
      pill.className = "note-pill";
      pill.textContent = d.tritone_sub;
      sub.append(pill, " ", playButton(`/api/symbols/audio?symbols=${encodeURIComponent(d.symbol + "," + d.tritone_sub)}`));
    } else {
      sub.textContent = "No tritone substitution (works on dominant chords).";
    }
    $("lab-ext").textContent = d.extensions.length
      ? `available extensions: ${d.extensions.join(" · ")}` : "";

    pillRow($("lab-temperaments"), META.temperaments, (pill, t) => {
      pill.textContent = t;
      pill.append(" ", playButton(`/api/chord/audio?name=${encodeURIComponent(d.symbol)}&temperament=${t}`));
    });
    $("lab-beats").innerHTML = d.beat_frequencies.length
      ? d.beat_frequencies.map((b) => `<tr><td>${b.pair}</td><td>${b.hz} Hz</td></tr>`).join("")
      : "<tr><td>—</td></tr>";
    pillRow($("lab-solo"), d.solo_scales, (pill, s) => {
      pill.innerHTML = `${s.tonic} ${s.scale} <small>${Math.round(s.fit * 100)}%</small>`;
      pill.append(" ", playButton(`/api/scale/audio?tonic=${encodeURIComponent(s.tonic)}&octave=4&name=${encodeURIComponent(s.scale)}`));
    });
    refreshVoiceLeading();
  } catch (e) {
    $("lab-error").textContent = e.message;
  }
}

async function refreshVoiceLeading() {
  const from = $("lab-symbol").value.trim();
  const to = $("vl-to").value.trim();
  if (!from || !to) return;
  try {
    const d = await api(`/api/chord/voice-leading?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const arrow = (n) => (n === 0 ? "→ stays" : n > 0 ? `↑ +${n}` : `↓ ${n}`);
    $("vl-moves").innerHTML = d.moves.map((m) =>
      `<tr><td>${m.from} → ${m.to}</td><td>${arrow(m.semitones)}</td></tr>`).join("");
    $("vl-total").textContent = `${d.from} → ${d.to} · total motion: ${d.total_motion} semitones`;
  } catch (e) {
    $("vl-moves").innerHTML = "";
    $("vl-total").textContent = e.message;
  }
}

/* ---------- note inspector ---------- */

async function inspectNote() {
  $("note-error").textContent = "";
  try {
    const q = `name=${encodeURIComponent($("note-name").value)}&octave=${$("note-octave").value}&reference=${$("note-reference").value}`;
    const d = await api(`/api/tools/note?${q}`);
    $("note-result").classList.remove("hidden");
    $("note-facts").innerHTML = [
      ["note", d.note], ["frequency", `${d.frequency} Hz`], ["MIDI", d.midi],
      ["solfège", d.solfege], ["Helmholtz", d.helmholtz],
      ["interval from A4", d.interval_from_a4],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
    $("note-overtones").innerHTML = d.overtones.map((o) =>
      `<tr><td>${o.n}×</td><td>${o.hz} Hz</td><td>≈ ${o.nearest}${o.cents ? ` (${o.cents > 0 ? "+" : ""}${o.cents}¢)` : ""}</td></tr>`).join("");
  } catch (e) {
    $("note-result").classList.add("hidden");
    $("note-error").textContent = e.message;
  }
}

/* ---------- toolbox: identify / analyze / detect ---------- */

async function identifyChord() {
  $("ident-error").textContent = "";
  try {
    const frets = encodeURIComponent($("ident-frets").value);
    const inst = $("ident-instrument").value;
    const tuning = $("ident-tuning").value.trim();
    const tq = tuning && tuning !== "standard" ? `&tuning=${encodeURIComponent(tuning)}` : "";
    const d = await api(`/api/tools/identify?frets=${frets}&instrument=${inst}${tq}`);
    $("ident-result").classList.remove("hidden");
    $("ident-name").textContent = d.name || d.symbol || "Unknown chord";
    $("ident-tones").textContent = d.tones.length ? `· ${d.tones.join(" ")}` : "";
    $("ident-tab").textContent = d.tab || "";
  } catch (e) {
    $("ident-result").classList.add("hidden");
    $("ident-error").textContent = e.message;
  }
}

async function analyzeProgression() {
  $("analyze-error").textContent = "";
  const out = $("analyze-result");
  out.innerHTML = "";
  try {
    const chords = encodeURIComponent($("analyze-chords").value);
    const key = encodeURIComponent($("analyze-key").value);
    const mode = $("analyze-mode").value;
    const d = await api(`/api/tools/analyze?chords=${chords}&key=${key}&mode=${mode}`);
    for (const item of d.analysis) {
      const pill = document.createElement("span");
      pill.className = "note-pill";
      pill.innerHTML = `${item.symbol} <strong style="color:var(--accent2)">${item.numeral ?? "?"}</strong>`;
      out.appendChild(pill);
    }
  } catch (e) {
    $("analyze-error").textContent = e.message;
  }
}

async function detectKey() {
  $("detect-error").textContent = "";
  $("detect-result").textContent = "";
  try {
    const notes = encodeURIComponent($("detect-notes").value);
    const d = await api(`/api/tools/detect-key?notes=${notes}`);
    let html = d.key
      ? `<strong>${d.key}</strong> — chords: ${d.chords.join(", ")} · relative: ${d.relative}`
      : d.message;
    if (d.scale_match) {
      html += `<br><span class="hint">best scale fit: ${d.scale_match.tonic} ${d.scale_match.scale} (${d.scale_match.matched} notes matched)</span>`;
    }
    $("detect-result").innerHTML = html;
  } catch (e) {
    $("detect-error").textContent = e.message;
  }
}

/* ---------- songwriter ---------- */

let songSections = [];
let songSel = -1;

const SECTION_HUES = ["#2f6f6a", "#6a4a7a", "#7a5a2f", "#3d6a8a", "#7a3d4d", "#4a7a3d", "#5a5a7a"];

function sectionBars(sec) {
  const named = META.progressions[sec.numerals];
  return named ? named.length : Math.max(1, sec.numerals.split("-").filter(Boolean).length);
}

function sectionColor(name) {
  const base = name.replace(/\s*\d+$/, "").trim().toLowerCase();
  if (!sectionColor._map) sectionColor._map = new Map();
  if (!sectionColor._map.has(base)) {
    sectionColor._map.set(base, SECTION_HUES[sectionColor._map.size % SECTION_HUES.length]);
  }
  return sectionColor._map.get(base);
}

function songSummary() {
  const bars = songSections.reduce((n, s) => n + sectionBars(s), 0);
  const bpm = parseInt($("song-bpm").value, 10) || 110;
  const secs = Math.round((bars * 4 * 60) / bpm);
  $("song-summary").textContent = songSections.length
    ? `${songSections.length} section${songSections.length === 1 ? "" : "s"} · ${bars} bars · ~${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} at ${bpm} bpm`
    : "";
}

function renderTimeline() {
  if (activePanel() === "song") updateShareUrl();
  const tl = $("song-timeline");
  tl.innerHTML = "";
  sectionColor._map = new Map(); // stable colors per render, by first appearance
  songSections.forEach((sec, i) => {
    const block = document.createElement("div");
    block.className = "song-block" + (i === songSel ? " selected" : "");
    block.style.flexGrow = sectionBars(sec);
    block.style.borderColor = sectionColor(sec.name);
    block.style.background = sectionColor(sec.name) + "33";
    block.innerHTML = `<div class="sb-name">${sec.name}</div>
      <div class="sb-meta">${sec.numerals}</div>
      <div class="sb-meta">${sec.style === "drums" ? "&#129345; drums" : sec.style}${sec.groove !== "none" ? " · " + sec.groove : ""}</div>
      <div class="sb-bars">${sectionBars(sec)} bars</div>`;
    block.addEventListener("click", () => selectSection(i));
    tl.appendChild(block);
  });
  songSummary();
}

function selectSection(i) {
  songSel = i;
  const sec = songSections[i];
  $("song-editor").classList.toggle("hidden", !sec);
  if (!sec) return renderTimeline();
  $("se-name").value = sec.name;
  $("se-prog").value = sec.numerals;
  $("se-groove").value = sec.groove;
  $("se-style").value = sec.style;
  renderTimeline();
}

function updateSelectedSection() {
  if (songSel < 0 || !songSections[songSel]) return;
  Object.assign(songSections[songSel], {
    name: $("se-name").value || "section",
    numerals: $("se-prog").value || "I-IV-V-I",
    groove: $("se-groove").value,
    style: $("se-style").value,
  });
  renderTimeline();
}

function songSpec(onlySelected = false) {
  const sections = onlySelected && songSections[songSel]
    ? [songSections[songSel]] : songSections;
  return {
    tonic: $("song-tonic").value,
    mode: $("song-mode").value,
    bpm: parseInt($("song-bpm").value, 10) || 110,
    swing: parseFloat($("song-swing").value) || 0,
    sound: $("song-sound").value,
    fade_out: onlySelected ? false : $("song-fade").checked,
    fill: $("song-fill").value === "none" ? null : $("song-fill").value,
    fill_every: $("song-fill-every").value || null,
    mix: {
      chords: parseFloat($("mix-chords").value),
      bass: parseFloat($("mix-bass").value),
      drums: parseFloat($("mix-drums").value),
      reverb: parseFloat($("mix-reverb").value),
      humanize: parseFloat($("mix-humanize").value),
    },
    sections,
  };
}

function loadSongSpec(spec) {
  $("song-bpm").value = spec.bpm;
  $("song-swing").value = spec.swing;
  $("song-swing-label").textContent = spec.swing;
  $("song-sound").value = spec.sound;
  $("song-fade").checked = spec.fade_out !== false;
  if (spec.mode) $("song-mode").value = spec.mode;
  const mix = spec.mix || {};
  $("mix-chords").value = mix.chords ?? 0.42;
  $("mix-bass").value = mix.bass ?? 0.5;
  $("mix-drums").value = mix.drums ?? 0.5;
  $("mix-reverb").value = mix.reverb ?? 0.2;
  $("mix-humanize").value = mix.humanize ?? 0.15;
  songSections = spec.sections.map((s) => ({ ...s }));
  selectSection(songSections.length ? 0 : -1);
}

async function sketchSong() {
  $("song-error").textContent = "";
  try {
    const q = `vibe=${$("song-vibe").value}&tonic=${encodeURIComponent($("song-tonic").value)}&mode=${$("song-mode").value}`;
    loadSongSpec(await api(`/api/song/sketch?${q}`));
  } catch (e) {
    $("song-error").textContent = e.message;
  }
}

async function songPost(path, onlySelected = false) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(songSpec(onlySelected)),
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.error || r.statusText);
  }
  return r;
}

/* ---------- shareable URLs ----------
Each panel serializes its state into the hash (e.g. #chords?root=C&capo=2)
as you work; opening such a link restores it. */

const SHARE = {
  chords: {
    collect() {
      const p = { root: $("chord-root").value, quality: $("chord-quality").value,
                  instrument: $("chord-instrument").value };
      const t = $("chord-tuning").value;
      if (t === "custom…" && $("chord-tuning-custom").value.trim()) p.tuning = $("chord-tuning-custom").value.trim();
      else if (t !== "standard") p.tuning = t;
      const capo = parseInt($("chord-capo").value, 10) || 0;
      if (capo) p.capo = capo;
      if (chordState.custom) p.frets = chordState.positions.map((x) => (x === null ? "x" : x)).join(",");
      return p;
    },
    apply(p) {
      if (p.get("root")) $("chord-root").value = p.get("root");
      if (p.get("quality") !== null) $("chord-quality").value = p.get("quality");
      if (p.get("instrument")) $("chord-instrument").value = p.get("instrument");
      syncTuningControls();
      const t = p.get("tuning");
      if (t) {
        if (META.tunings.includes(t)) $("chord-tuning").value = t;
        else {
          $("chord-tuning").value = "custom…";
          $("chord-tuning-custom").value = t;
          $("chord-tuning-custom-wrap").classList.remove("hidden");
        }
      }
      if (p.get("capo")) $("chord-capo").value = p.get("capo");
      if (p.get("frets")) {
        // restore a custom voicing after the chart loads
        setTimeout(() => {
          chordState.positions = p.get("frets").split(",").map((x) => (x === "x" ? null : parseInt(x, 10)));
          chordState.custom = true;
          chordState.viewBase = autoBase(chordState.positions);
          renderChordDiagram();
          identifyCurrentVoicing();
        }, 600);
      }
    },
  },
  scales: {
    collect() {
      return { system: $("scale-system").value, tonic: $("scale-tonic").value,
               octave: $("scale-octave").value, name: $("scale-name").value };
    },
    apply(p) {
      if (p.get("system")) $("scale-system").value = p.get("system");
      syncSystemControls();
      if (p.get("tonic")) $("scale-tonic").value = p.get("tonic");
      if (p.get("octave")) $("scale-octave").value = p.get("octave");
      if (p.get("name")) $("scale-name").value = p.get("name");
    },
  },
  keys: {
    collect() {
      return { tonic: $("key-tonic").value, mode: $("key-mode").value,
               progression: $("key-progression").value };
    },
    apply(p) {
      if (p.get("tonic")) $("key-tonic").value = p.get("tonic");
      if (p.get("mode")) $("key-mode").value = p.get("mode");
      if (p.get("progression")) $("key-progression").value = p.get("progression");
    },
  },
  lab: {
    collect() { return { chord: $("lab-symbol").value, to: $("vl-to").value }; },
    apply(p) {
      if (p.get("chord")) $("lab-symbol").value = p.get("chord");
      if (p.get("to")) $("vl-to").value = p.get("to");
    },
  },
  tuner: {
    collect() {
      return { instrument: $("tuner-instrument").value, tuning: $("tuner-tuning").value,
               system: $("tuner-system").value, reference: $("tuner-reference").value,
               display: $("tuner-display-mode").value, listen: $("tuner-listen").value };
    },
    apply(p) {
      if (p.get("instrument")) $("tuner-instrument").value = p.get("instrument");
      if (p.get("tuning")) $("tuner-tuning").value = p.get("tuning");
      if (p.get("system")) $("tuner-system").value = p.get("system");
      if (p.get("reference")) $("tuner-reference").value = p.get("reference");
      if (p.get("display")) { $("tuner-display-mode").value = p.get("display"); syncTunerDisplay(); }
      if (p.get("listen")) { $("tuner-listen").value = p.get("listen"); syncTunerDisplay(); }
      refreshTunerStrings();
    },
  },
  song: {
    collect() {
      // whole arrangement in one base64url param
      const b64 = btoa(JSON.stringify(songSpec()))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      return { s: b64, vibe: $("song-vibe").value };
    },
    apply(p) {
      if (p.get("vibe")) $("song-vibe").value = p.get("vibe");
      if (!p.get("s")) return;
      try {
        const json = atob(p.get("s").replaceAll("-", "+").replaceAll("_", "/"));
        const spec = JSON.parse(json);
        if (spec.tonic) $("song-tonic").value = spec.tonic;
        loadSongSpec(spec);
        SHARE._songRestored = true;
      } catch { /* malformed link — fall through to a fresh sketch */ }
    },
  },
};

function activePanel() {
  return document.querySelector(".panel.active")?.id.replace("panel-", "") || "about";
}

function updateShareUrl() {
  const panel = activePanel();
  const collect = SHARE[panel]?.collect;
  let hash = `#${panel}`;
  if (collect) {
    const qs = new URLSearchParams(collect()).toString();
    if (qs) hash += `?${qs}`;
  }
  history.replaceState(null, "", hash);
}

/* ---------- boot ---------- */

async function boot() {
  META = await api("/api/meta");
  $("version").textContent = `v${META.version}`;

  fill($("chord-root"), META.roots, "C");
  fill($("chord-quality"), META.qualities, "");
  fill($("chord-instrument"), META.instruments, "guitar");
  syncTuningControls();
  fill($("scale-system"), Object.keys(META.systems), "western");
  syncSystemControls();
  fill($("scale-instrument"), META.instruments, "guitar");
  fill($("key-tonic"), META.roots, "C");
  fill($("key-progression"), Object.keys(META.progressions), "I-V-vi-IV");
  fill($("mod-tonic"), META.roots, "G");
  fill($("midi-key"), ["auto", ...META.roots], "auto");
  for (const sym of META.chords) {
    const o = document.createElement("option");
    o.value = sym;
    $("chord-symbols").appendChild(o);
  }
  $("lab-symbol").addEventListener("input", () => {
    if (META.chords.includes($("lab-symbol").value)) refreshLab();
  });
  fill($("ident-instrument"), META.instruments, "guitar");
  fill($("analyze-key"), META.roots, "C");
  for (const s of ["", ...META.sounds]) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s === "" ? "sine (pure)" : s.replaceAll("_", " ");
    $("sound").appendChild(o);
  }
  if (META.sounds.includes("electric_piano")) $("sound").value = "electric_piano";

  // tab switching (with #hash deep links + shareable state params)
  const showPanel = (name) => {
    if (name === "groove") name = "song"; // Groove Lab merged into Songwriter
    if (!$(`panel-${name}`)) return;
    document.querySelectorAll("#tabs button").forEach((x) =>
      x.classList.toggle("active", x.dataset.panel === name));
    document.querySelectorAll(".panel").forEach((x) =>
      x.classList.toggle("active", x.id === `panel-${name}`));
  };
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      showPanel(b.dataset.panel);
      updateShareUrl();
    }));
  const PANEL_REFRESH = {
    chords: () => { refreshChord(); refreshGuitarScale(); },
    scales: refreshScale,
    keys: refreshKey,
    lab: refreshLab,
  };
  const applyHashState = (refresh) => {
    let [panel, query] = location.hash.slice(1).split("?");
    if (panel === "groove") panel = "song";
    if (panel) showPanel(panel);
    if (query && SHARE[panel]) {
      SHARE[panel].apply(new URLSearchParams(query));
      if (refresh) PANEL_REFRESH[panel]?.();
    }
  };
  applyHashState(false); // initial refreshes below pick the state up
  window.addEventListener("hashchange", () => applyHashState(true));
  document.querySelectorAll("a.goto").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", `#${a.dataset.panel}`);
      showPanel(a.dataset.panel);
    }));

  ["chord-root", "chord-quality"].forEach((id) =>
    $(id).addEventListener("change", refreshChord));
  $("chord-instrument").addEventListener("change", () => {
    syncTuningControls();
    refreshChord();
    refreshGuitarScale();
  });
  $("chord-tuning").addEventListener("change", () => {
    $("chord-tuning-custom-wrap").classList.toggle("hidden", $("chord-tuning").value !== "custom…");
    if ($("chord-tuning").value !== "custom…" || $("chord-tuning-custom").value.trim()) {
      refreshChord();
      refreshGuitarScale();
    }
  });
  $("chord-tuning-custom").addEventListener("change", () => { refreshChord(); refreshGuitarScale(); });
  $("chord-capo").addEventListener("change", () => { refreshChord(); refreshGuitarScale(); });
  fill($("gscale-tonic"), META.roots, "A");
  fill($("gscale-name"), META.systems.western.scales.filter((s) => s !== "chromatic"), "minor");
  ["gscale-tonic", "gscale-name", "gscale-mode"].forEach((id) =>
    $(id).addEventListener("change", refreshGuitarScale));
  $("gscale-play").addEventListener("click", (e) => {
    if ($("gscale-mode").value === "chord") {
      const name = $("chord-root").value + $("chord-quality").value;
      playUrl(`/api/chord/audio?name=${encodeURIComponent(name)}${soundQ()}`, e.target);
      return;
    }
    const q = `tonic=${encodeURIComponent($("gscale-tonic").value)}&octave=3&name=${encodeURIComponent($("gscale-name").value)}`;
    playUrl(`/api/scale/audio?${q}${soundQ()}`, e.target);
  });
  ["scale-tonic", "scale-octave", "scale-name", "scale-instrument"].forEach((id) =>
    $(id).addEventListener("change", refreshScale));
  $("scale-system").addEventListener("change", () => {
    syncSystemControls();
    refreshScale();
  });
  $("scale-harmonized-all").addEventListener("click", (e) => {
    if (lastHarmonized.length)
      playUrl(`/api/symbols/audio?symbols=${encodeURIComponent(lastHarmonized.join(","))}${soundQ()}`, e.target);
  });
  ["key-tonic", "key-mode", "key-progression"].forEach((id) =>
    $(id).addEventListener("change", () => { randomSymbols = null; refreshKey(); }));
  $("key-after").addEventListener("change", refreshSuggestions);
  $("vl-go").addEventListener("click", refreshVoiceLeading);
  $("vl-to").addEventListener("keydown", (e) => { if (e.key === "Enter") refreshVoiceLeading(); });
  fill($("note-name"), META.roots, "A");
  $("note-go").addEventListener("click", inspectNote);
  ["note-name", "note-octave", "note-reference"].forEach((id) =>
    $(id).addEventListener("change", inspectNote));
  inspectNote();
  ["mod-tonic", "mod-mode"].forEach((id) =>
    $(id).addEventListener("change", refreshModulation));
  $("mod-play").addEventListener("click", (e) => {
    if (modPath.length) playUrl(`/api/symbols/audio?symbols=${encodeURIComponent(modPath.join(","))}${soundQ()}`, e.target);
  });
  $("lab-go").addEventListener("click", refreshLab);
  $("lab-symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") refreshLab(); });
  fill($("tuner-instrument"), ["chromatic", ...META.instruments], "guitar");
  fill($("tuner-tuning"), META.tunings, "standard");
  fill($("tuner-system"), Object.keys(META.systems), "western");
  ["tuner-instrument", "tuner-tuning"].forEach((id) =>
    $(id).addEventListener("change", refreshTunerStrings));
  $("tuner-toggle").addEventListener("click", () =>
    tuner.running ? tunerStop() : tunerStart());
  $("tuner-display-mode").addEventListener("change", syncTunerDisplay);
  $("tuner-listen").addEventListener("change", () => {
    const wasRunning = tuner.running;
    if (wasRunning) tunerStop();  // the two modes ride different pipelines
    if (tunerChordMode()) chordUpdate({ chord: null });
    else tunerUpdate({ voiced: false });
    syncTunerDisplay();
    if (wasRunning) tunerStart();
  });
  refreshTunerStrings();

  $("chord-play").addEventListener("click", (e) => {
    if (chordState.custom && chordState.voicingTones.length) {
      playUrl(`/api/voicing/audio?tones=${encodeURIComponent(chordState.voicingTones.join(","))}${soundQ()}`, e.target);
      return;
    }
    const name = $("chord-root").value + $("chord-quality").value;
    playUrl(`/api/chord/audio?name=${encodeURIComponent(name)}${soundQ()}`, e.target);
  });
  $("fret-down").addEventListener("click", () => {
    chordState.viewBase = Math.max(1, chordState.viewBase - 1);
    renderChordDiagram();
  });
  $("fret-up").addEventListener("click", () => {
    chordState.viewBase = Math.min(15, chordState.viewBase + 1);
    renderChordDiagram();
  });
  $("scale-play").addEventListener("click", (e) => {
    const q = `system=${encodeURIComponent($("scale-system").value)}&tonic=${encodeURIComponent($("scale-tonic").value)}&octave=${$("scale-octave").value}&name=${encodeURIComponent($("scale-name").value)}`;
    playUrl(`/api/scale/audio?${q}${soundQ()}`, e.target);
  });
  $("prog-play").addEventListener("click", (e) => {
    if (randomSymbols) {
      playUrl(`/api/symbols/audio?symbols=${encodeURIComponent(randomSymbols.join(","))}${soundQ()}`, e.target);
      return;
    }
    playUrl(`/api/progression/audio?${progParams()}${soundQ()}`, e.target);
  });
  $("prog-random").addEventListener("click", rollProgression);
  $("prog-midi").addEventListener("click", () =>
    window.location.assign(`/api/progression/midi?${progParams()}`));

  $("ident-go").addEventListener("click", identifyChord);
  $("analyze-go").addEventListener("click", analyzeProgression);
  $("detect-go").addEventListener("click", detectKey);

  setupConverter("midi", async () => {
    const { body } = await fileBody("midi-file", "Choose a MIDI file first.");
    const title = encodeURIComponent($("midi-title").value || "Imported from MIDI");
    const key = encodeURIComponent($("midi-key").value);
    return { url: `/api/tools/midi-convert?title=${title}&key=${key}`, body };
  });
  setupConverter("audio", async () => {
    let body, filename;
    if (audioRecording) {
      body = await audioRecording.arrayBuffer();
      filename = "recording.wav";
    } else {
      const f = await fileBody("audio-file", "Record something or choose an audio file first.");
      body = f.body;
      filename = f.file.name;
    }
    const title = encodeURIComponent($("audio-title").value || "Transcribed audio");
    const q = $("audio-quantize").value ? `&quantize=${$("audio-quantize").value}` : "";
    const split = $("audio-split").checked ? "&split=1" : "";
    return {
      url: `/api/tools/audio-convert?title=${title}&filename=${encodeURIComponent(filename)}${q}${split}`,
      body,
    };
  });
  setupRecorder("audio-record", "audio-rec-status", (blob) => {
    audioRecording = blob;
    $("audio-rec-status").textContent += " transcribing…";
    $("audio-convert").click();
  });
  $("audio-file").addEventListener("change", () => {
    audioRecording = null; // a chosen file takes over from any recording
    $("audio-rec-status").textContent = "or choose a file:";
  });
  setupRecorder("harm-record", "harm-rec-status", (blob) =>
    blob.arrayBuffer().then((b) => harmonizeBody(b, "recording.wav")));
  $("harm-go").addEventListener("click", async () => {
    try {
      const { file, body } = await fileBody("harm-file", "Record something or choose an audio file first.");
      harmonizeBody(body, file.name);
    } catch (e) {
      $("harm-error").textContent = e.message;
    }
  });
  $("harm-midi").addEventListener("click", () => {
    if (!harmData?.midi_b64) return;
    const bytes = Uint8Array.from(atob(harmData.midi_b64), (c) => c.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: "audio/midi" }), "harmonized.mid");
  });
  $("harm-pdf").addEventListener("click", (e) => {
    if (harmData?.lilypond) engraveSource(harmData.lilypond, harmData.lilypond_sig, e.target, "harm-error");
  });

  // songwriter
  fill($("song-tonic"), META.roots, "C");
  fill($("song-sound"), META.sounds, "electric_piano");
  [...$("song-sound").options].forEach((o) => (o.textContent = o.textContent.replaceAll("_", " ")));
  fill($("song-fill"), ["none", ...META.drum_fills], "none");
  fill($("se-groove"), ["none", ...META.drum_presets], "none");
  for (const name of Object.keys(META.progressions)) {
    const o = document.createElement("option");
    o.value = name;
    $("progression-names").appendChild(o);
  }
  $("song-swing").addEventListener("input", () =>
    ($("song-swing-label").textContent = $("song-swing").value));
  $("song-bpm").addEventListener("change", songSummary);
  $("song-sketch").addEventListener("click", sketchSong);
  ["se-name", "se-prog"].forEach((id) => $(id).addEventListener("input", updateSelectedSection));
  ["se-groove", "se-style"].forEach((id) => $(id).addEventListener("change", updateSelectedSection));
  $("song-add").addEventListener("click", () => {
    songSections.push({ name: "section", numerals: "I-IV-V-I", groove: "none", style: "block" });
    selectSection(songSections.length - 1);
  });
  $("se-del").addEventListener("click", () => {
    songSections.splice(songSel, 1);
    selectSection(Math.min(songSel, songSections.length - 1));
  });
  $("se-dup").addEventListener("click", () => {
    const copy = { ...songSections[songSel] };
    if (!/\d+$/.test(copy.name)) copy.name += " 2";
    songSections.splice(songSel + 1, 0, copy);
    selectSection(songSel + 1);
  });
  $("se-left").addEventListener("click", () => {
    if (songSel <= 0) return;
    [songSections[songSel - 1], songSections[songSel]] = [songSections[songSel], songSections[songSel - 1]];
    selectSection(songSel - 1);
  });
  $("se-right").addEventListener("click", () => {
    if (songSel >= songSections.length - 1) return;
    [songSections[songSel + 1], songSections[songSel]] = [songSections[songSel], songSections[songSel + 1]];
    selectSection(songSel + 1);
  });
  $("se-preview").addEventListener("click", async (e) => {
    if (audioEl && !audioEl.paused && audioEl._button === e.target) {
      audioEl.pause();
      return;
    }
    try {
      const blob = await (await songPost("/api/song/audio", true)).blob();
      playUrl(URL.createObjectURL(blob), e.target);
    } catch (err) {
      $("song-error").textContent = err.message;
    }
  });
  $("song-play").addEventListener("click", async (e) => {
    if (audioEl && !audioEl.paused && audioEl._button === e.target) {
      audioEl.pause();
      return;
    }
    $("song-error").textContent = "";
    $("song-status").textContent = "rendering the band…";
    try {
      const blob = await (await songPost("/api/song/audio")).blob();
      playUrl(URL.createObjectURL(blob), e.target);
    } catch (err) {
      $("song-error").textContent = err.message;
    } finally {
      $("song-status").textContent = "";
    }
  });
  $("song-midi").addEventListener("click", async () => {
    try {
      downloadBlob(await (await songPost("/api/song/midi")).blob(), "song.mid");
    } catch (err) {
      $("song-error").textContent = err.message;
    }
  });
  $("song-pdf").addEventListener("click", async (e) => {
    try {
      $("song-status").textContent = "engraving…";
      const d = await (await songPost("/api/song/notation")).json();
      await engraveSource(d.lilypond, d.lilypond_sig, e.target, "song-error");
    } catch (err) {
      $("song-error").textContent = err.message;
    } finally {
      $("song-status").textContent = "";
    }
  });
  if (!SHARE._songRestored) sketchSong();

  refreshChord();
  refreshGuitarScale();
  refreshLab();
  refreshScale();
  refreshKey();
}

boot().catch((e) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="error" style="padding:2rem">Failed to load: ${e.message}</p>`);
});
