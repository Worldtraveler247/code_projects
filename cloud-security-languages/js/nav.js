// Cloud Security Engineering Languages — shared client-side helpers
// Highlights current language in nav, adds copy buttons to code blocks,
// and reveals sections on scroll.

(function () {
  'use strict';

  // ---- Highlight current language in the top nav -------------------
  const currentLang = document.body.dataset.lang;
  if (currentLang) {
    document.querySelectorAll('.lang-nav-link').forEach((link) => {
      if (link.dataset.lang === currentLang) link.classList.add('active');
    });
  }

  // ---- Copy-to-clipboard for every <pre> in a .code-block ----------
  document.querySelectorAll('.code-block').forEach((block) => {
    const pre = block.querySelector('pre');
    if (!pre) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.innerText);
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1600);
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = 'Select all';
      }
    });
    block.appendChild(btn);
  });

  // ---- Reveal-on-scroll using IntersectionObserver -----------------
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();
