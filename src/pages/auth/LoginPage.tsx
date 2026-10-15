import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { isSupabaseConfigured } from '../../lib/config';
import { Alert, Button, Card, Field, PageSpinner, TextInput } from '../../components/ui';
import { AuthLayout } from '../../components/AuthLayout';

export function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <PageSpinner />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1>Sign in</h1>
        <p className="muted small">Access your Exavyn account.</p>
        {!isSupabaseConfigured ? (
          <Alert tone="warning" role="alert">
            Supabase is not configured. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
          </Alert>
        ) : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={onSubmit} className="mt-2">
          <Field label="Email" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div className="row-between mt-2">
          <Link to="/register" className="small">
            Create a student account
          </Link>
          <Link to="/forgot-password" className="small">
            Forgot password?
          </Link>
        </div>
      </Card>
    </AuthLayout>
  );
}
