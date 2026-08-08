/* ============================================================
   Nexora Landing Page — interactions
   ============================================================ */
(() => {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- theme toggle ---------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const setThemeIcon = (theme) => {
    if (!themeToggle) return;
    const icon = themeToggle.querySelector('i');
    icon.className = theme === 'dark' ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
  };
  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('nx-theme', theme); } catch (e) { /* private mode */ }
    setThemeIcon(theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#090B12' : '#f4f5fb');
  };
  if (themeToggle) {
    setThemeIcon(root.getAttribute('data-theme') || 'light');
    themeToggle.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  /* ---------- navbar: floating pill + hide on scroll down, reveal on scroll up ---------- */
  const nav = document.getElementById('nxNav');
  const navMenu = document.getElementById('nxMenu');
  let lastScrollY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    const menuOpen = navMenu ? navMenu.classList.contains('show') : false;
    nav.classList.toggle('scrolled', y > 24);
    if (!menuOpen && y > lastScrollY && y > 140) {
      nav.classList.add('nav-hidden');
    } else {
      nav.classList.remove('nav-hidden');
    }
    lastScrollY = y;
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  // keep the bar visible whenever the mobile menu is open
  if (navMenu) {
    navMenu.addEventListener('shown.bs.collapse', () => nav.classList.remove('nav-hidden'));
  }

  /* ---------- scroll progress bar ---------- */
  const progressBar = document.getElementById('scrollProgress');
  if (progressBar && !prefersReduced) {
    const onProgress = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      progressBar.style.width = max > 0 ? ((h.scrollTop / max) * 100).toFixed(2) + '%' : '0%';
    };
    onProgress();
    window.addEventListener('scroll', onProgress, { passive: true });
    window.addEventListener('resize', onProgress, { passive: true });
  }

  /* ---------- back to top ---------- */
  const backTop = document.getElementById('backTop');
  if (backTop) {
    const onBackTop = () => backTop.classList.toggle('show', window.scrollY > 500);
    onBackTop();
    window.addEventListener('scroll', onBackTop, { passive: true });
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if (prefersReduced || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('visible'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- animated counters ---------- */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && !prefersReduced) {
    const animate = (el) => {
      const target = parseInt(el.dataset.count, 10);
      const dur = 1400;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = target + '+';
      };
      requestAnimationFrame(tick);
    };
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(entry.target);
            cio.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- lightbox ---------- */
  const lb = document.getElementById('lightbox');
  if (lb) {
    const lbImg = document.getElementById('lbImg');
    const lbCount = document.getElementById('lbCount');
    const lbClose = document.getElementById('lbClose');
    const lbPrev = document.getElementById('lbPrev');
    const lbNext = document.getElementById('lbNext');

    const items = Array.from(document.querySelectorAll('.gallery-item'));
    let current = 0;

    const show = (i) => {
      current = (i + items.length) % items.length;
      const item = items[current];
      const full = item.dataset.full || item.href;
      const caption = item.dataset.caption || 'Screenshot';
      lbImg.src = full;
      lbImg.alt = caption;
      lbCount.textContent = `${current + 1} / ${items.length} — ${caption}`;
    };

    const open = (i) => {
      show(i);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      lbImg.focus();
    };
    const close = () => {
      lb.classList.remove('open');
      document.body.style.overflow = '';
    };

    items.forEach((item, i) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        open(i);
      });
    });

    lbClose.addEventListener('click', close);
    lbPrev.addEventListener('click', () => show(current - 1));
    lbNext.addEventListener('click', () => show(current + 1));
    lb.addEventListener('click', (e) => {
      if (e.target === lb) close();
    });
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }

  /* ---------- copy to clipboard ---------- */
  const copyBtns = document.querySelectorAll('.copy-btn');
  const flashCopy = (btn) => {
    const icon = btn.querySelector('i');
    const old = icon.className;
    btn.classList.add('copied');
    icon.className = 'bi bi-check-lg';
    btn.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      btn.classList.remove('copied');
      icon.className = old;
      btn.setAttribute('aria-label', 'Copy');
    }, 1600);
  };
  const doCopy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopy(btn);
    } catch {
      // fallback for older browsers / non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flashCopy(btn); } catch { /* noop */ }
      ta.remove();
    }
  };
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', () => doCopy(btn.dataset.copy || '', btn));
  });

  /* ---------- docs TOC scroll spy ---------- */
  const tocLinks = Array.from(document.querySelectorAll('.docs-toc a[href^="#"]'));
  const docSections = tocLinks
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && docSections.length) {
    const setActive = (id) => {
      tocLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
      // mirror into the mobile select if present
      const sel = document.getElementById('mobileToc');
      if (sel) sel.value = id;
    };
    const dio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-30% 0px -62% 0px' }
    );
    docSections.forEach((s) => dio.observe(s));

    const sel = document.getElementById('mobileToc');
    if (sel) {
      sel.addEventListener('change', () => {
        const target = document.getElementById(sel.value);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }

  /* ---------- active nav link on scroll ---------- */
  const sections = document
    .querySelectorAll('section[id], header[id]');
  const navLinks = Array.from(document.querySelectorAll('.nx-navbar .nav-link'));
  if ('IntersectionObserver' in window && sections.length) {
    const nio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navLinks.forEach((l) => {
              l.classList.toggle(
                'active',
                l.getAttribute('href') === `#${entry.target.id}`
              );
            });
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((s) => nio.observe(s));
  }
})();
