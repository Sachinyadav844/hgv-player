import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { changePasswordSchema, nameSchema } from '@hgv/shared';
import { AppShell, PageHeading } from '../components/AppShell';
import { Button, Field, Notice } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../services/api';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwFormError, setPwFormError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setNameError(null);
    setSavingName(true);
    try {
      const { user: updated } = await api.updateName(parsed.data);
      setUser(updated);
      toast.success('Name updated. Rooms show the new name the next time you join.');
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwFormError(null);
    const parsed = changePasswordSchema.safeParse({ currentPassword: pw.current, newPassword: pw.next });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message;
      setPwErrors(found);
      return;
    }
    setPwErrors({});
    setSavingPw(true);
    try {
      await api.changePassword(parsed.data);
      setPw({ current: '', next: '' });
      toast.success('Password changed');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') setPwErrors({ currentPassword: err.message });
      else setPwFormError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setSavingPw(false);
    }
  };

  const onLogout = async () => {
    try {
      await logout();
      toast.success('Logged out');
    } catch {
      toast.info('Logged out on this device.');
    }
    navigate('/');
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-xl px-4 py-10">
        <PageHeading title="Settings">Manage your account.</PageHeading>

        <section aria-labelledby="profile-title" className="rounded-panel border border-line p-5">
          <h2 id="profile-title" className="text-lg font-bold">
            Profile
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">Signed in as {user?.email}.</p>
          <form onSubmit={saveName} noValidate className="space-y-3">
            <Field label="Display name" value={name} error={nameError} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={savingName} disabled={name.trim() === user?.name}>
              Save name
            </Button>
          </form>
        </section>

        <section aria-labelledby="password-title" className="mt-6 rounded-panel border border-line p-5">
          <h2 id="password-title" className="text-lg font-bold">
            Change password
          </h2>
          <form onSubmit={savePassword} noValidate className="mt-4 space-y-3">
            {pwFormError && <Notice tone="error">{pwFormError}</Notice>}
            <Field label="Current password" type="password" autoComplete="current-password" value={pw.current} error={pwErrors.currentPassword} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <Field label="New password" type="password" autoComplete="new-password" value={pw.next} error={pwErrors.newPassword} hint="At least 8 characters with a letter and a number." onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <Button type="submit" loading={savingPw}>
              Change password
            </Button>
          </form>
        </section>

        <section aria-labelledby="session-title" className="mt-6 rounded-panel border border-line p-5">
          <h2 id="session-title" className="text-lg font-bold">
            Session
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">Log out on this device. Any room you are watching disconnects.</p>
          <Button variant="secondary" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden /> Log out
          </Button>
        </section>
      </div>
    </AppShell>
  );
}
