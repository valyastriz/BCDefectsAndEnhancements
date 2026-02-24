import { Link, NavLink } from 'react-router-dom';

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9Z" />
    </svg>
  );
}

export function AppShell({ children }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <TicketIcon />
          </span>
          <span className="brand-text">
            <strong>BC Helpdesk</strong>
            <span>Defects &amp; Enhancements</span>
          </span>
        </Link>

        <div className="header-right">
          <nav>
            <NavLink to="/">Submit a Request</NavLink>
            <NavLink to="/public">Status Board</NavLink>
            <NavLink to="/admin">Admin</NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
