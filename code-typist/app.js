// Code Typist — typing tutor with on-screen keyboard + finger hint
// Pure vanilla JS, no framework. Loaded after snippets.js.

(() => {
  'use strict';

  // -----------------------------------------------------------
  // Keyboard layout: each row is an array of keys.
  // A key is { label, code, shifted?, finger?, width? }
  //   label   = visible character on the cap (lower)
  //   code    = JS event.code that this key listens for
  //   shifted = the character produced when shift is held
  //   finger  = which finger should press it ('lp' = left pinky, etc.)
  //   width   = optional CSS class for non-standard key widths
  // -----------------------------------------------------------
  const KEYBOARD = [
    [
      { label: '`', shifted: '~',  code: 'Backquote', finger: 'lp' },
      { label: '1', shifted: '!',  code: 'Digit1',    finger: 'lp' },
      { label: '2', shifted: '@',  code: 'Digit2',    finger: 'lr' },
      { label: '3', shifted: '#',  code: 'Digit3',    finger: 'lm' },
      { label: '4', shifted: '$',  code: 'Digit4',    finger: 'li' },
      { label: '5', shifted: '%',  code: 'Digit5',    finger: 'li' },
      { label: '6', shifted: '^',  code: 'Digit6',    finger: 'ri' },
      { label: '7', shifted: '&',  code: 'Digit7',    finger: 'ri' },
      { label: '8', shifted: '*',  code: 'Digit8',    finger: 'rm' },
      { label: '9', shifted: '(',  code: 'Digit9',    finger: 'rr' },
      { label: '0', shifted: ')',  code: 'Digit0',    finger: 'rp' },
      { label: '-', shifted: '_',  code: 'Minus',     finger: 'rp' },
      { label: '=', shifted: '+',  code: 'Equal',     finger: 'rp' },
      { label: '⌫', code: 'Backspace', finger: 'rp', width: 'wide-1-5' },
    ],
    [
      { label: 'Tab', code: 'Tab', finger: 'lp', width: 'wide-1-5' },
      { label: 'q', shifted: 'Q', code: 'KeyQ', finger: 'lp' },
      { label: 'w', shifted: 'W', code: 'KeyW', finger: 'lr' },
      { label: 'e', shifted: 'E', code: 'KeyE', finger: 'lm' },
      { label: 'r', shifted: 'R', code: 'KeyR', finger: 'li' },
      { label: 't', shifted: 'T', code: 'KeyT', finger: 'li' },
      { label: 'y', shifted: 'Y', code: 'KeyY', finger: 'ri' },
      { label: 'u', shifted: 'U', code: 'KeyU', finger: 'ri' },
      { label: 'i', shifted: 'I', code: 'KeyI', finger: 'rm' },
      { label: 'o', shifted: 'O', code: 'KeyO', finger: 'rr' },
      { label: 'p', shifted: 'P', code: 'KeyP', finger: 'rp' },
      { label: '[', shifted: '{', code: 'BracketLeft',  finger: 'rp' },
      { label: ']', shifted: '}', code: 'BracketRight', finger: 'rp' },
      { label: '\\', shifted: '|', code: 'Backslash', finger: 'rp', width: 'wide-1' },
    ],
    [
      { label: 'Caps', code: 'CapsLock', finger: 'lp', width: 'wide-1-5' },
      { label: 'a', shifted: 'A', code: 'KeyA', finger: 'lp' },
      { label: 's', shifted: 'S', code: 'KeyS', finger: 'lr' },
      { label: 'd', shifted: 'D', code: 'KeyD', finger: 'lm' },
      { label: 'f', shifted: 'F', code: 'KeyF', finger: 'li' },
      { label: 'g', shifted: 'G', code: 'KeyG', finger: 'li' },
      { label: 'h', shifted: 'H', code: 'KeyH', finger: 'ri' },
      { label: 'j', shifted: 'J', code: 'KeyJ', finger: 'ri' },
      { label: 'k', shifted: 'K', code: 'KeyK', finger: 'rm' },
      { label: 'l', shifted: 'L', code: 'KeyL', finger: 'rr' },
      { label: ';', shifted: ':', code: 'Semicolon', finger: 'rp' },
      { label: "'", shifted: '"', code: 'Quote',     finger: 'rp' },
      { label: '↵', code: 'Enter', finger: 'rp', width: 'wide-2' },
    ],
    [
      { label: '⇧', code: 'ShiftLeft', finger: 'lp', width: 'wide-2' },
      { label: 'z', shifted: 'Z', code: 'KeyZ', finger: 'lp' },
      { label: 'x', shifted: 'X', code: 'KeyX', finger: 'lr' },
      { label: 'c', shifted: 'C', code: 'KeyC', finger: 'lm' },
      { label: 'v', shifted: 'V', code: 'KeyV', finger: 'li' },
      { label: 'b', shifted: 'B', code: 'KeyB', finger: 'li' },
      { label: 'n', shifted: 'N', code: 'KeyN', finger: 'ri' },
      { label: 'm', shifted: 'M', code: 'KeyM', finger: 'ri' },
      { label: ',', shifted: '<', code: 'Comma',  finger: 'rm' },
      { label: '.', shifted: '>', code: 'Period', finger: 'rr' },
      { label: '/', shifted: '?', code: 'Slash',  finger: 'rp' },
      { label: '⇧', code: 'ShiftRight', finger: 'rp', width: 'wide-2' },
    ],
    [
      { label: '␣', code: 'Space', finger: 'thumb', width: 'space' },
    ],
  ];

  // Build a map: produced character → { code, finger, needsShift }
  // Used to figure out which key glows for a target character.
  const charToKey = {};
  for (const row of KEYBOARD) {
    for (const key of row) {
      if (key.label && key.label.length === 1) {
        charToKey[key.label] = { code: key.code, finger: key.finger, needsShift: false };
      }
      if (key.shifted) {
        charToKey[key.shifted] = { code: key.code, finger: key.finger, needsShift: true };
      }
    }
  }
  charToKey[' ']  = { code: 'Space', finger: 'thumb', needsShift: false };
  charToKey['\n'] = { code: 'Enter', finger: 'rp',    needsShift: false };

  // Pick the shift key for the OPPOSITE hand from the target finger.
  // Touch-typing rule: shift with the hand that's NOT pressing the letter.
  function shiftSideFor(finger) {
    if (!finger) return null;
    if (finger.startsWith('l')) return 'ShiftRight';
    if (finger.startsWith('r')) return 'ShiftLeft';
    return null; // thumb / unknown — either shift is fine
  }

  // -----------------------------------------------------------
  // DOM rendering
  // -----------------------------------------------------------

  const keyboardEl   = document.getElementById('keyboard');
  const snippetEl    = document.getElementById('snippet');
  const titleEl      = document.getElementById('snippet-title');
  const langLabelEl  = document.getElementById('snippet-lang');
  const wpmEl        = document.getElementById('stat-wpm');
  const accEl        = document.getElementById('stat-acc');
  const timeEl       = document.getElementById('stat-time');
  const errEl        = document.getElementById('stat-err');
  const newBtn       = document.getElementById('new-btn');
  const restartBtn   = document.getElementById('restart-btn');
  const langTabs     = document.querySelectorAll('.lang-tab');
  const leftHand     = document.getElementById('left-hand');
  const rightHand    = document.getElementById('right-hand');

  // Build the keyboard once.
  const keyEls = {};
  for (const row of KEYBOARD) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    for (const key of row) {
      const keyEl = document.createElement('div');
      keyEl.className = 'key' + (key.width ? ' ' + key.width : '');
      keyEl.textContent = key.label;
      keyEl.dataset.code = key.code;
      keyEl.dataset.finger = key.finger || '';
      rowEl.appendChild(keyEl);
      // Stash by code; for both shifts use suffix _L / _R so we can target each.
      if (!keyEls[key.code]) keyEls[key.code] = [];
      keyEls[key.code].push(keyEl);
    }
    keyboardEl.appendChild(rowEl);
  }

  // -----------------------------------------------------------
  // Trainer state
  // -----------------------------------------------------------

  const state = {
    lang: 'go',
    snippet: '',
    snippetTitle: '',
    pos: 0,
    errors: 0,
    startedAt: null,
    timerId: null,
    wrongChar: false,
  };

  function pickRandomSnippet(lang) {
    const list = SNIPPETS[lang];
    return list[Math.floor(Math.random() * list.length)];
  }

  function loadSnippet(lang) {
    state.lang = lang;
    const snip = pickRandomSnippet(lang);
    state.snippet = snip.code;
    state.snippetTitle = snip.title;
    state.pos = 0;
    state.errors = 0;
    state.startedAt = null;
    state.wrongChar = false;
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    titleEl.textContent = snip.title;
    langLabelEl.textContent = lang;
    renderSnippet();
    updateStats();
    snippetEl.classList.remove('complete');
    highlightTarget();
  }

  function renderSnippet() {
    snippetEl.innerHTML = '';
    for (let i = 0; i < state.snippet.length; i++) {
      const ch = state.snippet[i];
      const span = document.createElement('span');
      span.className = 'ch';
      if (ch === '\n') {
        span.classList.add('newline');
        span.textContent = '\n';
      } else {
        span.textContent = ch;
      }
      if (i < state.pos) span.classList.add('done');
      else if (i === state.pos) {
        span.classList.add('current');
        if (state.wrongChar) span.classList.add('wrong');
      }
      snippetEl.appendChild(span);
    }
  }

  function highlightTarget() {
    // Clear previous targets
    document.querySelectorAll('.key.target').forEach(k => k.classList.remove('target'));
    document.querySelectorAll('.hand .finger.active').forEach(f => f.classList.remove('active'));

    const ch = state.snippet[state.pos];
    if (ch === undefined) return;
    const mapping = charToKey[ch];
    if (!mapping) return;

    // Glow the target key (and shift if needed)
    (keyEls[mapping.code] || []).forEach(k => k.classList.add('target'));
    if (mapping.needsShift) {
      const shiftCode = shiftSideFor(mapping.finger);
      if (shiftCode) {
        (keyEls[shiftCode] || []).forEach(k => k.classList.add('target'));
      }
    }

    // Glow the corresponding finger on the hands
    if (mapping.finger) {
      const hand = mapping.finger.startsWith('l') || mapping.finger === 'thumb'
        ? leftHand
        : rightHand;
      const fingerEl = hand.querySelector(`[data-finger="${mapping.finger}"]`);
      if (fingerEl) fingerEl.classList.add('active');
      // Thumb is on both hands — activate both for space
      if (mapping.finger === 'thumb') {
        const rightThumb = rightHand.querySelector('[data-finger="thumb"]');
        if (rightThumb) rightThumb.classList.add('active');
      }
    }
  }

  function flashKey(code, good) {
    const els = keyEls[code];
    if (!els) return;
    const cls = good ? 'pressed-good' : 'pressed-bad';
    els.forEach(el => {
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 140);
    });
  }

  function startTimer() {
    if (state.startedAt) return;
    state.startedAt = Date.now();
    state.timerId = setInterval(updateStats, 200);
  }

  function updateStats() {
    const elapsed = state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0;
    const minutes = elapsed / 60;
    const correctChars = state.pos - state.errors > 0 ? state.pos - state.errors : 0;
    const wpm = minutes > 0 ? Math.round((correctChars / 5) / minutes) : 0;
    const totalKeystrokes = state.pos + state.errors;
    const acc = totalKeystrokes > 0
      ? Math.max(0, Math.round((state.pos / totalKeystrokes) * 100))
      : 100;

    wpmEl.textContent = wpm;
    accEl.textContent = acc + '%';
    timeEl.textContent = formatTime(elapsed);
    errEl.textContent = state.errors;

    accEl.className = 'stat-value' + (acc < 90 ? (acc < 75 ? ' bad' : ' warn') : '');
    errEl.className = 'stat-value' + (state.errors > 0 ? (state.errors > 5 ? ' bad' : ' warn') : '');
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function complete() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    snippetEl.classList.add('complete');
    document.querySelectorAll('.key.target').forEach(k => k.classList.remove('target'));
    document.querySelectorAll('.hand .finger.active').forEach(f => f.classList.remove('active'));
  }

  // -----------------------------------------------------------
  // Key handling
  // -----------------------------------------------------------

  function handleKey(e) {
    // Tab is captured to avoid focus moving to next element
    if (e.key === 'Tab') e.preventDefault();

    // Ignore pure modifier presses (shift down/up, etc.)
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

    if (state.pos >= state.snippet.length) return;
    startTimer();

    const expected = state.snippet[state.pos];
    let typed = e.key;

    // Normalize: Enter event.key === 'Enter'; we want '\n'.
    if (typed === 'Enter') typed = '\n';
    // Treat Tab key as 4 spaces — but only if expected starts a 4-space run.
    // Easier: snippets have no tabs, so this branch is unused. Bail out.
    if (typed === 'Tab') {
      flashKey('Tab', false);
      state.errors += 1;
      state.wrongChar = true;
      renderSnippet();
      updateStats();
      return;
    }

    // Backspace = correct previous wrong char (or step back)
    if (typed === 'Backspace') {
      if (state.wrongChar) {
        state.wrongChar = false;
        renderSnippet();
        flashKey('Backspace', true);
        return;
      }
      if (state.pos > 0) {
        state.pos -= 1;
        renderSnippet();
        highlightTarget();
        flashKey('Backspace', true);
      }
      return;
    }

    // Single-character produced keys
    if (typed.length === 1) {
      const code = e.code;
      if (typed === expected) {
        flashKey(code, true);
        state.pos += 1;
        state.wrongChar = false;
        if (state.pos >= state.snippet.length) {
          renderSnippet();
          updateStats();
          complete();
          return;
        }
        renderSnippet();
        highlightTarget();
        updateStats();
      } else {
        flashKey(code, false);
        state.errors += 1;
        state.wrongChar = true;
        renderSnippet();
        updateStats();
      }
      return;
    }

    // Newline (Enter) handled separately
    if (typed === '\n') {
      if (expected === '\n') {
        flashKey('Enter', true);
        state.pos += 1;
        state.wrongChar = false;
        // Skip leading whitespace on new line so user doesn't have to retype indent positions
        // (they still type the spaces, but indent feels natural)
        if (state.pos >= state.snippet.length) {
          renderSnippet();
          updateStats();
          complete();
          return;
        }
        renderSnippet();
        highlightTarget();
        updateStats();
      } else {
        flashKey('Enter', false);
        state.errors += 1;
        state.wrongChar = true;
        renderSnippet();
        updateStats();
      }
    }
  }

  // -----------------------------------------------------------
  // Wire up controls
  // -----------------------------------------------------------

  langTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      langTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadSnippet(tab.dataset.lang);
    });
  });

  newBtn.addEventListener('click', () => loadSnippet(state.lang));
  restartBtn.addEventListener('click', () => {
    state.pos = 0;
    state.errors = 0;
    state.wrongChar = false;
    state.startedAt = null;
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    snippetEl.classList.remove('complete');
    renderSnippet();
    updateStats();
    highlightTarget();
  });

  document.addEventListener('keydown', handleKey);

  // Initial load
  loadSnippet('go');
})();
