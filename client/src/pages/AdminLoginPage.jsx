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

  if (user?.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      setLoading(true);
      const data = await api.login(username, password);
      // Reconnect the socket so the server re-authenticates it as an admin
      // (rooms and presence handlers are assigned at connect time).
      resetSocket();
      onLogin(data.user);
      navigate('/admin');
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <Card
        title="Admin Sign In"
        subtitle="Access is restricted to authorized administrators."
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
