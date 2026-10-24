import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../features/auth/AuthContext';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { ThemeToggle } from '../components/ThemeToggle';

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const [fullName, setFullName] = useState(user?.profile.full_name ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user?.id ?? '');
    if (updateError) {
      setError(errorMessage(updateError));
      return;
    }
    await refresh();
    setMessage('Profile updated.');
  };

  return (
    <div className="narrow stack">
      <h1>Profile</h1>
      <Card>
        <p className="muted small">
          Only your display name is editable. Your role is stored in trusted data and cannot be
          changed here.
        </p>
        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={save}>
          <Field label="Email" htmlFor="profileEmail">
            <TextInput id="profileEmail" value={user?.email ?? ''} disabled />
          </Field>
          <Field label="Full name" htmlFor="profileName">
            <TextInput
              id="profileName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="profileRole">
            <TextInput id="profileRole" value={user?.role ?? ''} disabled />
          </Field>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <h2>Settings</h2>
        <h3>Appearance</h3>
        <div className="row-between">
          <div>
            <p className="muted small">Theme preference</p>
          </div>
          <ThemeToggle />
        </div>
      </Card>
    </div>
  );
}
