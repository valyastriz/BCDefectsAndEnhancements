import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';
import { Button, Card, Input, Notice } from '../components/bite-size/BitsizeUI';

export function AdminLoginPage({ user, onLogin }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Where signing in takes you, and where an already-signed-in visitor to this
  // page is sent. A rep has no admin side — sending them to /admin would bounce
  // off RequireAdmin and land them back here, being asked to sign in as the
  // account they are already signed in as.
  const landingFor = (account) => (account?.role === 'admin' ? '/admin' : '/');

  if (user) {
    return <Navigate to={landingFor(user)} replace />;
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      setLoading(true);
      const data = await api.login(username, password);
      // Reconnect the socket so the server re-authenticates it (rooms and
      // presence handlers are assigned at connect time, and a rep joins neither).
      resetSocket();
      onLogin(data.user);
      navigate(landingFor(data.user));
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <Card
        title="Sign In"
        subtitle="Sign in to file a request and to follow the ones you filed. The triage team signs in here too."
      >
        <form className="bs-form" onSubmit={submit}>
          <Input
            label="Username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Notice text={error} />
          <Button type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
