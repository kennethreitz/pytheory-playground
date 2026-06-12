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
    chordState.voicingTones = d.tones;
    selectChordFromSymbol(d.symbol);
  } catch (e) {
    $("chord-error").textContent = e.message;
  }
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
    chordState.positions = [...c.positions];
    chordState.strings = c.strings;
    chordState.viewBase = autoBase(c.positions);
    chordState.custom = false;
    chordState.voicingTones = [];
    renderChordDiagram();
  } catch (e) {
    $("chord-error").textContent = e.message;
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

// Repopulate tonic + scale selects for the chosen tonal system.
function syncSystemControls() {
  const sys = META.systems[$("scale-system").value];
  const tonicDefault = sys.tonics.includes("C") ? "C" : sys.tonics[0];
  fill($("scale-tonic"), sys.tonics, tonicDefault);
  const scaleDefault = sys.scales.includes("major") ? "major"
    : (sys.scales[1] || sys.scales[0]);
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
    $("key-numerals").innerHTML = numerals.slice(0, k.chords.length).map((n) => `<th>${n}</th>`).join("");
    $("key-triads").innerHTML = k.chords.map((c) => `<td>${c}</td>`).join("");
    $("key-sevenths").innerHTML = k.seventh_chords.map((c) => `<td>${c}</td>`).join("");
    const sig = k.signature;
    const sigText = sig.accidentals.length
      ? `${sig.accidentals.join(" ")} (${sig.sharps || sig.flats} ${sig.sharps ? "sharps" : "flats"})`
      : "no accidentals";
    $("key-extra").textContent = `signature: ${sigText} · relative: ${k.relative}`;

    const p = await api(`/api/progression?${progParams()}`);
    const row = $("prog-chords");
    row.innerHTML = "";
    for (const ch of p.chords) {
      const div = document.createElement("div");
      div.className = "prog-chord";
      div.innerHTML = `<div class="numeral">${ch.numeral}</div><div class="sym">${ch.symbol}</div>`;
      if (ch.positions) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", 130);
        svg.setAttribute("height", 160);
        chordDiagram(svg, ch.positions, ch.strings, { width: 130, height: 160 });
        div.appendChild(svg);
      }
      row.appendChild(div);
    }

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

/* ---------- groove lab ---------- */

function grooveParams() {
  const q = new URLSearchParams({
    preset: $("groove-preset").value,
    bpm: $("groove-bpm").value,
    swing: $("groove-swing").value,
    repeats: $("groove-repeats").value,
  });
  if ($("groove-fill").value !== "none") {
    q.set("fill", $("groove-fill").value);
    if ($("groove-fill-every").value) q.set("fill_every", $("groove-fill-every").value);
  }
  if ($("groove-numerals").value !== "none") {
    q.set("numerals", $("groove-numerals").value);
    q.set("tonic", $("groove-tonic").value);
    q.set("mode", $("groove-mode").value);
    if ($("sound").value) q.set("sound", $("sound").value);
  }
  return q.toString();
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
      const r = await fetch("/api/tools/lilypond-pdf", {
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

const recorder = { active: false, ctx: null, stream: null, node: null, chunks: [], timer: null, blob: null };
const REC_MAX_SECONDS = 30;

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

async function recordStart() {
  $("audio-error").textContent = "";
  try {
    recorder.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    $("audio-error").textContent = `Microphone access denied: ${e.message}`;
    return;
  }
  recorder.ctx = new AudioContext();
  const source = recorder.ctx.createMediaStreamSource(recorder.stream);
  recorder.node = recorder.ctx.createScriptProcessor(4096, 1, 1);
  recorder.chunks = [];
  recorder.node.onaudioprocess = (e) => {
    if (recorder.active) recorder.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(recorder.node);
  recorder.node.connect(recorder.ctx.destination);
  recorder.active = true;
  $("audio-record").innerHTML = "&#9632; Stop recording";
  const started = performance.now();
  recorder.timer = setInterval(() => {
    const s = (performance.now() - started) / 1000;
    $("audio-rec-status").textContent = `recording… ${s.toFixed(0)}s`;
    if (s >= REC_MAX_SECONDS) recordStop();
  }, 250);
}

function recordStop() {
  recorder.active = false;
  clearInterval(recorder.timer);
  const rate = recorder.ctx.sampleRate;
  recorder.node?.disconnect();
  recorder.ctx?.close();
  recorder.stream?.getTracks().forEach((t) => t.stop());
  $("audio-record").innerHTML = "&#9679; Record";
  const seconds = recorder.chunks.reduce((n, c) => n + c.length, 0) / rate;
  if (seconds < 0.5) {
    $("audio-rec-status").textContent = "too short — try again";
    recorder.blob = null;
    return;
  }
  recorder.blob = encodeWav(recorder.chunks, rate);
  recorder.chunks = [];
  $("audio-rec-status").textContent = `recorded ${seconds.toFixed(1)}s — transcribing…`;
  $("audio-convert").click();
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
};

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

function tunerUpdate(d) {
  const needle = $("tuner-needle");
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
  // Rolling window: analyze the most recent ~0.35s without draining the
  // buffer, so updates land every tick (~4-5/sec) instead of waiting for
  // a fresh accumulation each time.
  const need = Math.floor(tuner.ctx.sampleRate * 0.35);
  let total = 0;
  for (const chunk of tuner.buffer) total += chunk.length;
  if (total < need) return;
  const all = new Float32Array(total);
  let off = 0;
  for (const chunk of tuner.buffer) { all.set(chunk, off); off += chunk.length; }
  // trim the rolling buffer to the last ~0.5s
  const keep = Math.floor(tuner.ctx.sampleRate * 0.5);
  if (total > keep) tuner.buffer = [all.subarray(total - keep)];
  const slice = all.subarray(all.length - need);
  tuner.busy = true;
  try {
    const r = await fetch(`/api/tools/tune?rate=${tuner.ctx.sampleRate}&system=${encodeURIComponent($("tuner-system").value)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
    });
    if (r.ok) tunerUpdate(await r.json());
  } catch { /* transient — keep listening */ } finally {
    tuner.busy = false;
  }
}

// Preferred path: pytheory's own Tuner + SSE stream (mic opens on the server,
// readings arrive 20/sec). Western-only — analyze_frame thinks in MIDI.
async function tryNativeTuner() {
  try {
    const r = await fetch("/api/tuner/start", { method: "POST" });
    const data = await r.json();
    if (!r.ok) {
      tuner.nativeFailure = data.error || r.statusText;
      return false;
    }
    return await new Promise((resolve) => {
      const es = new EventSource(data.stream);
      const giveUp = setTimeout(() => { es.close(); resolve(false); }, 4000);
      es.onerror = () => { clearTimeout(giveUp); es.close(); resolve(false); };
      es.onmessage = (e) => {
        clearTimeout(giveUp);
        if (tuner.es !== es) {  // first reading: adopt the stream
          tuner.es = es;
          tuner.running = true;
          tuner.mode = "sse";
          $("tuner-toggle").textContent = "■ Stop tuner";
          $("tuner-mode").textContent = "native tuner — server mic, 20 readings/sec";
          resolve(true);
        }
        const d = JSON.parse(e.data);
        if (!d) return tunerUpdate({ voiced: false });
        tunerUpdate({
          voiced: true,
          frequency: d.freq,
          note: d.note,
          octave: d.octave,
          cents: d.cents,
          target: Math.round(d.freq / Math.pow(2, d.cents / 1200) * 100) / 100,
        });
      };
    });
  } catch {
    return false;
  }
}

async function tunerStart() {
  $("tuner-error").textContent = "";
  if ($("tuner-system").value === "western" && await tryNativeTuner()) return;
  tuner.mode = "mic";
  try {
    tuner.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
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
  $("tuner-toggle").textContent = "■ Stop tuner";
  $("tuner-mode").textContent = "browser mic"
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
  $("tuner-toggle").textContent = "🎤 Start tuner";
  $("tuner-mode").textContent = "";
  tunerUpdate({ voiced: false });
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
  } catch (e) {
    $("lab-error").textContent = e.message;
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

  // tab switching (with #hash deep links)
  const showPanel = (name) => {
    if (!$(`panel-${name}`)) return;
    document.querySelectorAll("#tabs button").forEach((x) =>
      x.classList.toggle("active", x.dataset.panel === name));
    document.querySelectorAll(".panel").forEach((x) =>
      x.classList.toggle("active", x.id === `panel-${name}`));
  };
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", `#${b.dataset.panel}`);
      showPanel(b.dataset.panel);
    }));
  if (location.hash) showPanel(location.hash.slice(1));
  window.addEventListener("hashchange", () => showPanel(location.hash.slice(1)));
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
  });
  $("chord-tuning").addEventListener("change", () => {
    $("chord-tuning-custom-wrap").classList.toggle("hidden", $("chord-tuning").value !== "custom…");
    if ($("chord-tuning").value !== "custom…" || $("chord-tuning-custom").value.trim()) refreshChord();
  });
  $("chord-tuning-custom").addEventListener("change", refreshChord);
  $("chord-capo").addEventListener("change", refreshChord);
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
    $(id).addEventListener("change", refreshKey));
  $("key-after").addEventListener("change", refreshSuggestions);
  ["mod-tonic", "mod-mode"].forEach((id) =>
    $(id).addEventListener("change", refreshModulation));
  $("mod-play").addEventListener("click", (e) => {
    if (modPath.length) playUrl(`/api/symbols/audio?symbols=${encodeURIComponent(modPath.join(","))}${soundQ()}`, e.target);
  });
  $("lab-go").addEventListener("click", refreshLab);
  $("lab-symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") refreshLab(); });
  fill($("groove-preset"), META.drum_presets, "funk");
  fill($("groove-fill"), ["none", ...META.drum_fills], "none");
  fill($("groove-numerals"), ["none", ...Object.keys(META.progressions)], "none");
  fill($("groove-tonic"), META.roots, "C");
  $("groove-swing").addEventListener("input", () =>
    ($("groove-swing-label").textContent = $("groove-swing").value));
  $("groove-play").addEventListener("click", (e) => {
    const wasPlaying = audioEl && !audioEl.paused && audioEl._button === e.target;
    playUrl(`/api/groove/audio?${grooveParams()}`, e.target);
    if (wasPlaying) return; // playUrl just stopped it
    $("groove-status").textContent = "rendering…";
    audioEl.addEventListener("playing", () =>
      ($("groove-status").textContent = `${$("groove-preset").value} · ${$("groove-bpm").value} bpm`), { once: true });
    audioEl.addEventListener("pause", () => ($("groove-status").textContent = ""), { once: true });
  });
  $("groove-midi").addEventListener("click", () =>
    window.location.assign(`/api/groove/midi?${grooveParams()}`));
  fill($("tuner-instrument"), ["chromatic", ...META.instruments], "guitar");
  fill($("tuner-tuning"), META.tunings, "standard");
  fill($("tuner-system"), Object.keys(META.systems), "western");
  ["tuner-instrument", "tuner-tuning"].forEach((id) =>
    $(id).addEventListener("change", refreshTunerStrings));
  $("tuner-toggle").addEventListener("click", () =>
    tuner.running ? tunerStop() : tunerStart());
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
  $("prog-play").addEventListener("click", (e) =>
    playUrl(`/api/progression/audio?${progParams()}${soundQ()}`, e.target));
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
    if (recorder.blob) {
      body = await recorder.blob.arrayBuffer();
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
  $("audio-record").addEventListener("click", () =>
    recorder.active ? recordStop() : recordStart());
  $("audio-file").addEventListener("change", () => {
    recorder.blob = null; // a chosen file takes over from any recording
    $("audio-rec-status").textContent = "or choose a file:";
  });

  refreshChord();
  refreshLab();
  refreshScale();
  refreshKey();
}

boot().catch((e) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="error" style="padding:2rem">Failed to load: ${e.message}</p>`);
});
