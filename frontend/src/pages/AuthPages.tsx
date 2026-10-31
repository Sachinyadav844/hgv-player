import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { loginSchema, registerSchema } from '@hgv/shared';
import { Header } from '../components/AppShell';
import { Button, Field, Notice } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../services/api';
import { safeNext } from '../utils/nav';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header showNav={false} />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-12">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 mb-8 text-muted">{subtitle}</p>
        {children}
        <p className="mt-6 text-sm text-muted">{footer}</p>
      </main>
    </div>
  );
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="rounded-full p-2 text-muted hover:text-ink"
    >
      {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </button>
  );
}

type Errors = Record<string, string>;

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }): Errors {
  const out: Errors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(parsed.data);
      toast.success('Welcome back');
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(Object.keys(err.fieldErrors).length ? null : err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Log in to HGV Player"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link className="font-semibold text-ink underline" to={`/register${next !== '/rooms' ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          error={errors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={form.password}
          error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse({ name: form.name, email: form.email, password: form.password });
    const found: Errors = parsed.success ? {} : fieldErrorsFromZod(parsed.error);
    if (form.password !== form.confirm) found.confirm = 'Passwords do not match';
    if (Object.keys(found).length > 0 || !parsed.success) {
      setErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await register(parsed.data);
      toast.success('Account created. Welcome to HGV Player.');
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors;
        if (err.code === 'EMAIL_TAKEN') fields.email = err.message;
        setErrors(fields);
        setFormError(Object.keys(fields).length ? null : err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your HGV Player account"
      subtitle="It takes a minute. No email verification is needed."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-semibold text-ink underline" to={`/login${next !== '/rooms' ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field label="Name" autoComplete="name" value={form.name} error={errors.name} hint="Shown to others in the room." onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={form.password}
          error={errors.password}
          hint="At least 8 characters with a letter and a number."
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
        />
        <Field
          label="Confirm password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={form.confirm}
          error={errors.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
