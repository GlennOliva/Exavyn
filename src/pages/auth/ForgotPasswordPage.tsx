import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { Alert, Button, Card, Field, TextInput } from '../../components/ui';
import { AuthLayout } from '../../components/AuthLayout';

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await requestPasswordReset(email);
      setMessage('If that email is registered, reset instructions will be sent shortly.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1>Account recovery</h1>
        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={onSubmit}>
          <Field label="Email" htmlFor="forgotEmail">
            <TextInput
              id="forgotEmail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
        <p className="mt-2 small">
          <Link to="/login">Back to sign in</Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
