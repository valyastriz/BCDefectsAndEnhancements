import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/bite-size/Layout';
import { api } from './lib/api';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { PublicUpdatesPage } from './pages/PublicUpdatesPage';
import { RepSubmitPage } from './pages/RepSubmitPage';

function RequireAdmin({ user, children }) {
  if (!user || user.role !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

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
      </Routes>
    </AppShell>
  );
}

export default App;
