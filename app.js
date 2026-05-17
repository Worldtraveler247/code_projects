'use strict';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Particle canvas ──────────────────────────────────────────────────────────
(function () {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas || reducedMotion) return;

    const ctx = canvas.getContext('2d');
    let W, H, pts, rafId;

    function resize() {
        W = canvas.width  = innerWidth;
        H = canvas.height = innerHeight;
        pts = Array.from({length: 90}, () => ({
            x: Math.random() * W, y: Math.random() * H,
            r: Math.random() * 1.3 + 0.2,
            vx: (Math.random() - 0.5) * 0.22,
            vy: (Math.random() - 0.5) * 0.22,
            a: Math.random() * 0.7 + 0.1,
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        for (const p of pts) {
            p.x = (p.x + p.vx + W) % W;
            p.y = (p.y + p.vy + H) % H;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(74,247,255,${p.a * 0.5})`;
            ctx.fill();
        }
        rafId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
        document.hidden ? cancelAnimationFrame(rafId) : draw();
    });
})();

// ── Scroll-reveal ────────────────────────────────────────────────────────────
(function () {
    const targets = document.querySelectorAll('.card, .reveal');
    if (reducedMotion) {
        targets.forEach(el => el.classList.add('visible'));
        return;
    }
    const observer = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            setTimeout(() => e.target.classList.add('visible'), +(e.target.dataset.delay) || 0);
            observer.unobserve(e.target);
        }
    }, {threshold: 0.12});
    targets.forEach((el, i) => { el.dataset.delay = i * 80; observer.observe(el); });
})();

// ── Tag filter + search ──────────────────────────────────────────────────────
(function () {
    const filterBtns  = document.querySelectorAll('[data-filter]');
    const searchInput = document.getElementById('card-search');
    const cards       = document.querySelectorAll('.card');
    const noResults   = document.getElementById('no-results');
    const liveRegion  = document.getElementById('filter-live');

    if (!filterBtns.length && !searchInput) return;

    let activeTag   = 'all';
    let searchQuery = '';

    function run() {
        let count = 0;
        for (const card of cards) {
            const tagMatch    = activeTag === 'all' || card.dataset.tag === activeTag;
            const searchMatch = !searchQuery || card.textContent.toLowerCase().includes(searchQuery);
            const show        = tagMatch && searchMatch;
            card.hidden = !show;
            if (show) count++;
        }
        if (noResults)  noResults.hidden  = count > 0;
        if (liveRegion) liveRegion.textContent = `${count} project${count !== 1 ? 's' : ''} shown.`;
    }

    function go(fn) {
        document.startViewTransition ? document.startViewTransition(fn) : fn();
    }

    for (const btn of filterBtns) {
        btn.addEventListener('click', () => {
            for (const b of filterBtns) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            activeTag = btn.dataset.filter;
            go(run);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            go(run);
        });
    }
})();
