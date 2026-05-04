/**
 * tooltip.js
 * Singleton tooltip: desktop hover + mobile tap.
 * Called by tree.js and atlas.js with plain data objects.
 *
 * Usage:
 *   Tooltip.show(anchorEl, { title, body, url, urlLabel, warn })
 *   Tooltip.hide()
 */

const Tooltip = (() => {
  const el = document.getElementById('tooltip');
  let hideTimer = null;

  function clear(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }

  function show(anchor, data) {
    if (!el) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    clear(el);

    if (data.title) {
      const strong = document.createElement('strong');
      strong.textContent = data.title;
      el.appendChild(strong);
    }

    if (data.body) {
      const p = document.createElement('p');
      p.textContent = data.body;
      el.appendChild(p);
    }

    if (data.warn) {
      const w = document.createElement('p');
      w.style.color = '#ffc800';
      w.style.fontSize = '0.72rem';
      w.style.marginTop = '6px';
      w.textContent = 'Needs verification before publish.';
      el.appendChild(w);
    }

    if (data.url && data.urlLabel) {
      const a = document.createElement('a');
      a.href = data.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = data.urlLabel;
      a.style.display = 'block';
      a.style.marginTop = '6px';
      el.appendChild(a);
    }

    // Position near anchor
    position(anchor);
    el.classList.add('visible');
  }

  function hide() {
    // Small delay so moving between adjacent icons doesn't flicker
    hideTimer = setTimeout(() => {
      if (el) el.classList.remove('visible');
    }, 120);
  }

  function position(anchor) {
    const rect = anchor.getBoundingClientRect();
    const tipW = 280;
    const gap  = 10;

    let left = rect.right + gap;
    let top  = rect.top;

    // Flip left if overflowing viewport right
    if (left + tipW > window.innerWidth - 16) {
      left = rect.left - tipW - gap;
    }
    // Clamp top
    if (top + 160 > window.innerHeight - 16) {
      top = window.innerHeight - 176;
    }
    if (top < 8) top = 8;

    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  // Keep tooltip open when cursor is over it
  if (el) {
    el.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    el.addEventListener('mouseleave', hide);
  }

  // Close on outside tap (mobile)
  document.addEventListener('click', (e) => {
    if (el && !el.contains(e.target) && !e.target.closest('[data-cite]')) {
      hide();
    }
  });

  return { show, hide };
})();
