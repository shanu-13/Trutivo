"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { loginUser } from '@/lib/api/auth.api';
import Link from 'next/link';
import { errorMessage } from '@/lib/format';
import AuthLayout, { authButton, authInput, authLabel } from '@/components/AuthLayout';
import { afterLoginPath } from '@/lib/safeRedirect';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login, isAuthenticated, loading: checking } = useAuth();
  const params = useSearchParams();
  const registered = params.get('registered') === '1';
  const destination = afterLoginPath(params.get('next'));

  // Already signed in: go straight to the application.
  useEffect(() => {
    if (!checking && isAuthenticated) router.replace(destination);
  }, [checking, isAuthenticated, destination, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await loginUser({ email, password });
      if (data.success) {
        login(data.data.user);
        router.replace(destination);
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (err: unknown) {
      setError(errorMessage(err, 'An error occurred. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Log in to Trutivo"
      subtitle="Continue with your resumes, applications and interview practice."
      footer={
        <>
          New to Trutivo?{' '}
          <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-700">
            Create an account
          </Link>
        </>
      }
    >
      {registered && !error && (
        <p role="status" className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Your account was created. Log in to continue.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className={authLabel}>
            Email
          </label>
          <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} required />
        </div>
        <div>
          <label htmlFor="login-password" className={authLabel}>
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
            required
          />
        </div>
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
      </form>
    </AuthLayout>
  );
}

// useSearchParams (for the "account created" notice) must sit inside a Suspense boundary.
export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
