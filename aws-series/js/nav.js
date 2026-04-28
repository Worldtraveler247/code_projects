// AWS in Practice — shared client-side helpers
// Loaded by the hub and every service page. Keeps interactivity
// minimal: nav highlight, code-block copy buttons, scroll reveal.

(function () {
  'use strict';

  // ---- Highlight current service in the top nav -------------------
  // The nav links use data-svc="ec2" etc. The page sets
  // <body data-svc="ec2"> and we match.
  const currentSvc = document.body.dataset.svc;
  if (currentSvc) {
    document.querySelectorAll('.aws-nav-link').forEach((link) => {
      if (link.dataset.svc === currentSvc) link.classList.add('active');
    });
  }

  // ---- Copy-to-clipboard for every <pre> in a .code-block ---------
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
        // Clipboard API can fail on insecure contexts (http://) or
        // when the page is loaded via file:// without permissions.
        // Fallback: select the text so the user can copy manually.
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

  // ---- Reveal-on-scroll using IntersectionObserver ----------------
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
