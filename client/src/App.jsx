import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/bite-size/Layout';
import { api } from './lib/api';
import { useViewer } from './hooks/useViewer';
import { AdminAccessPage } from './pages/AdminAccessPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminMetadataPage } from './pages/AdminMetadataPage';
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

  if (!checkedAuth) {
    return <div className="app-loading">Loading...</div>;
  }

  return (
    <AppShell>
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
        <Route
          path="/admin/metadata"
          element={
            <RequireAdmin user={user}>
              <AdminMetadataPage user={user} />
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
