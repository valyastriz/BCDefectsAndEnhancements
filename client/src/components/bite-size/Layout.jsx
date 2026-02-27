import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9Z" />
    </svg>
  );
}

export function AppShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [useHamburger, setUseHamburger] = useState(false);
  const location = useLocation();
  const headerTopRef = useRef(null);
  const brandRef = useRef(null);
  const desktopNavRef = useRef(null);
  // Natural (unstretched) widths captured once at mount
  const navNaturalWidth = useRef(0);
  const brandNaturalWidth = useRef(0);

  const navItems = [
    { to: '/', label: 'Submit a Request' },
    { to: '/public', label: 'Status Board' },
    { to: '/admin', label: 'Admin' },
  ];

  // Capture natural widths once before any flex-stretching or state changes occur
  useLayoutEffect(() => {
    const brand = brandRef.current;
    const nav = desktopNavRef.current;
    if (!brand || !nav) return;
    // Temporarily zero flex-grow so brand reports its content width, not stretched width
    const was = brand.style.flexGrow;
    brand.style.flexGrow = '0';
    brandNaturalWidth.current = brand.scrollWidth;
    navNaturalWidth.current = nav.scrollWidth;
    brand.style.flexGrow = was;
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const measure = () => {
      const headerTop = headerTopRef.current;
      if (!headerTop) return;

      const style = window.getComputedStyle(headerTop);
      const pl = parseFloat(style.paddingLeft) || 0;
      const pr = parseFloat(style.paddingRight) || 0;
      const gap = parseFloat(style.columnGap || style.gap) || 16;

      const brandW = brandNaturalWidth.current;
      const navW = navNaturalWidth.current;
      const needed = pl + brandW + gap + navW + pr;

      const next = needed > headerTop.clientWidth + 1;
      setUseHamburger((prev) => (prev === next ? prev : next));
    };

    const schedule = () => requestAnimationFrame(measure);
    const ro = new ResizeObserver(schedule);
    if (headerTopRef.current) ro.observe(headerTopRef.current);

    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  useEffect(() => {
    if (!useHamburger) setMenuOpen(false);
  }, [useHamburger]);

  return (
    <div className="app-shell">
      <header className={`app-header${menuOpen ? ' menu-open' : ''}${useHamburger ? ' use-hamburger' : ''}`}>
        <div className="app-header-top" ref={headerTopRef}>
          <Link className="brand" to="/" ref={brandRef}>
            <span className="brand-icon">
              <TicketIcon />
            </span>
            <span className="brand-text">
              <strong>Billing Center Defect and Enhancement Submission Portal</strong>
              <span>Defects &amp; Enhancements</span>
            </span>
          </Link>

          <nav className="app-nav-links app-nav-desktop" ref={desktopNavRef}>
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
            ))}
          </nav>

          <button
            type="button"
            className="hamburger-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span>{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>

        <nav className="app-nav-links app-nav-mobile">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
