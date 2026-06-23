/* ==========================================================================
 * Morsh Kora — Animations
 * Powered by GSAP 3 (GreenSock) + Canvas 2D
 * Features:
 *   1. Ball-shot animation — a soccer ball flies from the logo across screen
 *   2. World Cup 2026 banner entrance + continuous effects
 *   3. Canvas particle stars behind the WC banner
 * ========================================================================*/

(function () {
  'use strict';

  /* -----------------------------------------------------------------------
   * Wait for GSAP to load (it's loaded via CDN in <head>)
   * --------------------------------------------------------------------- */
  if (typeof gsap === 'undefined') {
    console.warn('Morsh Kora animations: GSAP not available.');
    return;
  }

  /* -----------------------------------------------------------------------
   * Utility: get element center relative to the viewport
   * --------------------------------------------------------------------- */
  function getCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ======================================================================
   * 1. BALL SHOT ANIMATION
   *    The ball sits as a fixed-position element (id="shotBall").
   *    GSAP positions it at the logo, then fires it across the screen
   *    with a parabolic arc and full-spin rotation — like a penalty kick.
   * ==================================================================== */
  function initBallShot() {
    const ball    = document.getElementById('shotBall');
    const logoIcon = document.getElementById('logoBallIcon');
    if (!ball || !logoIcon) return;

    let shotCount = 0;

    function shoot() {
      const origin = getCenter(logoIcon);

      // Determine arc direction — alternate sides each shot
      const goRight = (shotCount % 2 === 0);
      shotCount++;

      const targetX = goRight
        ? window.innerWidth  + 80
        : -80;
      const arcY    = origin.y - (80 + Math.random() * 60); // peak of arc
      const spinDir = goRight ? 1440 : -1440;               // 4 full rotations

      // Snap ball to logo starting position
      gsap.set(ball, {
        x: origin.x - 22,
        y: origin.y - 22,
        opacity: 1,
        rotation: 0,
        scale: 1,
      });

      /* Phase 1 — tiny recoil (the "wind-up") */
      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(ball, { opacity: 0 });
          // Schedule next shot with a randomised delay
          const nextDelay = 4 + Math.random() * 4;
          gsap.delayedCall(nextDelay, shoot);
        },
      });

      tl
        /* Wind-up: pull back slightly */
        .to(ball, {
          x: origin.x - 22 + (goRight ? -12 : 12),
          y: origin.y - 22 + 6,
          duration: 0.12,
          ease: 'power1.inOut',
        })
        /* Rise — ball launches upward toward the arc peak */
        .to(ball, {
          x: (origin.x + targetX) / 2,
          y: arcY,
          rotation: spinDir / 2,
          duration: 0.45,
          ease: 'power2.out',
        })
        /* Fall — ball drops and exits the screen */
        .to(ball, {
          x: targetX,
          y: origin.y + 40,
          rotation: spinDir,
          scale: 0.7,        // slight perspective shrink
          opacity: 0,
          duration: 0.55,
          ease: 'power2.in',
        });
    }

    /* First shot fires 2 seconds after page load */
    gsap.delayedCall(2, shoot);

    /* Give the logo ball icon a subtle premium idle motion. */
    gsap.to('#logoBallIcon', {
      y: -2,
      scale: 1.035,
      rotation: 2,
      duration: 2.4,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  }

  /* ======================================================================
   * 2. WORLD CUP 2026 BANNER — entrance animation
   *    Elements start invisible and animate in with stagger / spring easing.
   * ==================================================================== */
  function initWC2026() {
    const banner = document.getElementById('wc2026Banner');
    if (!banner) return;

    const trophy   = document.getElementById('wcTrophy');
    const words    = banner.querySelectorAll('.wc-word');
    const year     = banner.querySelector('.wc-year');
    const hosts    = banner.querySelector('.wc-hosts');
    const badge    = banner.querySelector('.wc-live-badge');
    const spinBall = document.getElementById('wcSpinBall');
    const eyebrow  = banner.querySelector('.wc-eyebrow');

    /* Set invisible initial states */
    gsap.set([trophy, eyebrow, words, year, hosts, badge, spinBall], {
      opacity: 0,
    });
    gsap.set(trophy,  { scale: 0, y: 20 });
    gsap.set(words,   { y: 40, skewX: 8 });
    gsap.set(year,    { scale: 0.4, y: 20 });
    gsap.set(spinBall, { scale: 0, rotation: -90 });
    gsap.set(hosts,   { y: 10 });
    gsap.set(badge,   { scale: 0 });

    /* Build entrance timeline */
    const tl = gsap.timeline({ delay: 0.5 });

    tl
      /* Eyebrow "FIFA™" fades in */
      .to(eyebrow, { opacity: 1, duration: 0.4, ease: 'power2.out' })

      /* Title words slam in with stagger */
      .to(words, {
        opacity: 1,
        y: 0,
        skewX: 0,
        stagger: 0.12,
        duration: 0.55,
        ease: 'back.out(1.5)',
      }, '-=0.1')

      /* Year bounces in */
      .to(year, {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1.2, 0.5)',
      }, '-=0.25')

      /* Trophy enters with a back-spin */
      .to(trophy, {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.7,
        ease: 'back.out(2)',
      }, '-=0.4')

      /* Spin-ball rolls in */
      .to(spinBall, {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.55,
        ease: 'back.out(1.8)',
      }, '-=0.5')

      /* Host flags */
      .to(hosts, {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: 'power2.out',
      }, '-=0.3')

      /* LIVE badge pops in last */
      .to(badge, {
        opacity: 1,
        scale: 1,
        duration: 0.4,
        ease: 'back.out(2)',
      }, '-=0.2');

    /* ── Continuous trophy bounce ── */
    gsap.to(trophy, {
      y: -12,
      duration: 0.9,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 1.8,
    });

    /* ── Trophy glow pulse ── */
    gsap.to(trophy, {
      filter: [
        'drop-shadow(0 0 20px rgba(201,162,84,0.9)) drop-shadow(0 0 40px rgba(201,162,84,0.45))',
        'drop-shadow(0 0 8px rgba(201,162,84,0.42))  drop-shadow(0 0 16px rgba(201,162,84,0.2))',
      ],
      duration: 1.4,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 1.8,
    });
  }

  /* ======================================================================
   * 3. CANVAS PARTICLE STARS — background of the WC banner
   *    Tiny glowing dots in the site's brand colours drift slowly,
   *    creating a starfield / bokeh atmosphere.
   * ==================================================================== */
  function initWCParticles() {
    const canvas = document.getElementById('wcParticles');
    const banner = document.getElementById('wc2026Banner');
    if (!canvas || !banner) return;

    const ctx = canvas.getContext('2d');

    /* Match canvas size to banner */
    function resize() {
      canvas.width  = banner.offsetWidth;
      canvas.height = banner.offsetHeight;
    }
    resize();
    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(banner);

    /* Premium 2026-inspired palette: ivory, black, metallic gold. */
    const COLORS = ['#f8f3ea', '#ffffff', '#c9a254', '#8b6b32', '#d7d0c2'];

    /* Build particle pool */
    const PARTICLE_COUNT = 70;
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x:     Math.random(),          // 0–1 relative to canvas width
      y:     Math.random(),          // 0–1 relative to canvas height
      r:     0.5 + Math.random() * 2,
      alpha: 0.1 + Math.random() * 0.75,
      vx:    (Math.random() - 0.5) * 0.00025,
      vy:    (Math.random() - 0.5) * 0.00025,
      da:    (Math.random() - 0.5) * 0.008,  // alpha drift speed
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    /* A few larger "shooting-star" streaks */
    const streaks = Array.from({ length: 4 }, () => ({
      x:     Math.random(),
      y:     Math.random() * 0.6,
      speed: 0.0008 + Math.random() * 0.0012,
      len:   0.06 + Math.random() * 0.08,
      alpha: 0,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 6,      // seconds before first activation
      timer: 0,
    }));

    let lastTime = 0;

    function draw(timestamp) {
      const dt = timestamp - lastTime;
      lastTime  = timestamp;

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      /* ── Draw regular particles ── */
      particles.forEach(p => {
        p.x     += p.vx;
        p.y     += p.vy;
        p.alpha += p.da;

        /* Wrap at edges */
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;
        if (p.y < 0) p.y = 1;
        if (p.y > 1) p.y = 0;

        /* Clamp and reverse alpha drift */
        if (p.alpha > 0.85) { p.alpha = 0.85; p.da = -Math.abs(p.da); }
        if (p.alpha < 0.05) { p.alpha = 0.05; p.da =  Math.abs(p.da); }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      /* ── Draw shooting-star streaks ── */
      const dtSec = dt / 1000 || 0.016;
      streaks.forEach(s => {
        s.delay -= dtSec;
        if (s.delay > 0) return;

        s.x     += s.speed;
        s.alpha  = Math.min(1, s.alpha + 0.05);

        /* Draw gradient streak */
        const x1 = s.x * w;
        const x0 = x1 - s.len * w;
        const y  = s.y * h;

        const grad = ctx.createLinearGradient(x0, y, x1, y);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, s.color);

        ctx.save();
        ctx.globalAlpha = s.alpha * 0.6;
        ctx.strokeStyle = grad;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.restore();

        /* Reset when it exits the right edge */
        if (s.x > 1 + s.len) {
          s.x     = -s.len;
          s.y     = Math.random() * 0.8;
          s.alpha = 0;
          s.delay = 3 + Math.random() * 5;
          s.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        }
      });

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  }

  /* ======================================================================
   * Bootstrap all animations after the DOM is ready
   * ==================================================================== */
  function boot() {
    initBallShot();
    initWC2026();
    initWCParticles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
