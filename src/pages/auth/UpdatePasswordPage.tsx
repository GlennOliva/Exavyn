import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { Alert, Button, Card, Field, TextInput } from '../../components/ui';
import { AuthLayout } from '../../components/AuthLayout';

export function UpdatePasswordPage() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(password);
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
        <h1>Set a new password</h1>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={onSubmit}>
          <Field label="New password" htmlFor="newPassword">
            <TextInput
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword">
            <TextInput
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
