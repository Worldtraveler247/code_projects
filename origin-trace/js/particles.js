/**
 * particles.js — Shared particle background for all Origin Trace pages.
 *
 * Call initParticles() after the DOM is ready and a <canvas id="bg-canvas">
 * exists on the page. The canvas is expected to be fixed/full-screen via CSS.
 *
 * Config constants are intentionally tuned for the dark theme — 70 particles,
 * slow drift speed, low opacity — do NOT adjust without testing on all pages.
 */
function initParticles() {
  const bg = document.getElementById('bg-canvas');
  if (!bg) return;
  const bx = bg.getContext('2d');
  let W, H, pts;

  function init() {
    W = bg.width  = window.innerWidth;
    H = bg.height = window.innerHeight;
    pts = Array.from({length: 70}, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.2 + 0.2,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      a:  Math.random() * 0.5 + 0.1
    }));
  }

  function draw() {
    bx.clearRect(0, 0, W, H);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      bx.beginPath();
      bx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      bx.fillStyle = 'rgba(74,247,255,' + (p.a * 0.4) + ')';
      bx.fill();
    });
    requestAnimationFrame(draw);
  }

  init(); draw();
  window.addEventListener('resize', init);
}
