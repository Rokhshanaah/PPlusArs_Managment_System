import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const TARGETS = [
  '.panel',
  '.page-header',
  '.page-heading',
  '.balance-cards > article',
  '.balance-card',
  '.calculation-card',
  '.mode-switch',
  '.report-card',
  '.stat-card',
  '.dashboard-card',
  '.dashboard-hero',
  '.dashboard-stat-card',
  '.dashboard-stats > *',
  '.stats-grid > *',
  '.content-grid > *',
  '.cashbox-card',
  '.cashbox-cards > *',
  '.settings-category',
  '.settings-tabs',
  '.settings-danger-zone',
  '.settings-save-bar',
  '.accounts-totals',
  '.tabs',
  '.table-wrap',
  '.card-reader-form',
  '.card-reader-photo-panel',
  '.fp-identity-card',
  '.fp-identity-popup',
  '.reports-stats > *',
  '.report-filters',
  '.login-card',
  '.login-panel',
  '.login-form-box',
  '.customer-portal-card',
  '.modal .panel',
];

/** Soft page enter + scroll reveal (works with window or .main-area scroll). */
export default function PageMotion({ children }) {
  const location = useLocation();
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    root.classList.remove('is-ready');
    const readyTimer = requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.add('is-ready'));
    });

    const scrollRoot = document.querySelector('.main-area');
    const observed = new WeakSet();

    const reveal = (el, index = 0) => {
      if (el.classList.contains('is-visible')) return;
      el.style.setProperty('--reveal-delay', `${Math.min(index * 55, 330)}ms`);
      el.classList.add('is-visible');
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const nodes = [...root.querySelectorAll('.zh-animate:not(.is-visible)')];
          const idx = Math.max(0, nodes.indexOf(entry.target));
          reveal(entry.target, idx);
          io.unobserve(entry.target);
        });
      },
      {
        root: null,
        rootMargin: '0px 0px -36px 0px',
        threshold: 0.06,
      },
    );

    const tagAndObserve = () => {
      const list = [...root.querySelectorAll(TARGETS.join(','))];
      list.forEach((el, index) => {
        if (!el.classList.contains('zh-animate')) el.classList.add('zh-animate');
        if (el.classList.contains('is-visible')) return;
        if (observed.has(el)) return;
        observed.add(el);
        io.observe(el);

        const rect = el.getBoundingClientRect();
        const viewH = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < viewH * 0.94 && rect.bottom > 32) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              reveal(el, index);
              io.unobserve(el);
            });
          });
        }
      });
    };

    const t0 = setTimeout(tagAndObserve, 30);
    const t1 = setTimeout(tagAndObserve, 180);
    const t2 = setTimeout(tagAndObserve, 480);
    const t3 = setTimeout(tagAndObserve, 900);

    const mo = new MutationObserver(() => tagAndObserve());
    mo.observe(root, { childList: true, subtree: true });

    const onScroll = () => tagAndObserve();
    window.addEventListener('scroll', onScroll, { passive: true });
    scrollRoot?.addEventListener('scroll', onScroll, { passive: true });

    const safety = setTimeout(() => {
      root.classList.add('is-ready');
      root.querySelectorAll('.zh-animate:not(.is-visible)').forEach((el, i) => reveal(el, i));
    }, 1400);

    return () => {
      cancelAnimationFrame(readyTimer);
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(safety);
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll);
      scrollRoot?.removeEventListener('scroll', onScroll);
    };
  }, [location.pathname]);

  return (
    <div key={location.pathname} ref={rootRef} className="page-motion">
      {children}
    </div>
  );
}
