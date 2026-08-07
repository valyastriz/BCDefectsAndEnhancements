import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/bite-size/Layout';
import { api } from './lib/api';
import { useViewer } from './hooks/useViewer';
import { AdminAccessPage } from './pages/AdminAccessPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminMetadataPage } from './pages/AdminMetadataPage';
import { AdminThroughputPage } from './pages/AdminThroughputPage';
import { PublicUpdatesPage } from './pages/PublicUpdatesPage';
import { RepSubmitPage } from './pages/RepSubmitPage';

function RequireAdmin({ user, children }) {
  if (!user || user.role !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

/**
 * Super-user-only routes.
 *
 * The server is the authority — every /api/admin/access endpoint is behind
 * ensureSuperUser and 403s regardless of what the browser believes. This only
 * stops a non-super-user landing on a page that could show them nothing but
 * errors, so it waits for the real answer rather than guessing from the session.
 */
function RequireSuperUser({ children }) {
  const { loading, viewer } = useViewer();

  if (loading) return <div className="app-loading">Loading...</div>;
  if (!viewer.isSuperUser) return <Navigate to="/admin" replace />;

  return children;
}

function App() {
  const [user, setUser] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  useEffect(() => {
    let isMounted = true;
    api
      .me()
      .then((data) => {
        if (isMounted) {
          setUser(data.user || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUser(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setCheckedAuth(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // The header's sign-out, which is the only one a rep has: they never reach the
  // admin pages where the account menu lives. Clears the session locally even if
  // the request fails, so a failed logout cannot leave the UI claiming they are
  // still signed in.
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  if (!checkedAuth) {
    return <div className="app-loading">Loading...</div>;
  }

  return (
    <AppShell user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<RepSubmitPage />} />
        <Route path="/public" element={<PublicUpdatesPage />} />
        <Route path="/admin/login" element={<AdminLoginPage user={user} onLogin={setUser} />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin user={user}>
              <AdminDashboardPage user={user} onLogout={() => setUser(null)} />
            </RequireAdmin>
          }
        />
        {/* Super users only. Editing a lookup renames or withdraws a value on
            every ticket that holds it, across every application — it is not
            scoped by the per-application grants the rest of the admin side is,
            so an admin for one queue would be changing another's vocabulary.
            The server is the authority (metaRoutes puts ensureSuperUser on all
            three writes); this stops a non-super-user landing on a page whose
            every control 403s. */}
        <Route
          path="/admin/metadata"
          element={
            <RequireAdmin user={user}>
              <RequireSuperUser>
                <AdminMetadataPage user={user} />
              </RequireSuperUser>
            </RequireAdmin>
          }
        />
        {/* Open to any admin. Which of its two views they get is the server's
            decision, not this route's — a non-manager sees their own numbers. */}
        <Route
          path="/admin/throughput"
          element={
            <RequireAdmin user={user}>
              <AdminThroughputPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/access"
          element={
            <RequireAdmin user={user}>
              <RequireSuperUser>
                <AdminAccessPage user={user} />
              </RequireSuperUser>
            </RequireAdmin>
          }
        />
      </Routes>
    </AppShell>
  );
}

export default App;
