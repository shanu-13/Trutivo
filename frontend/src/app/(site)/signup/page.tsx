"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginUser, registerUser } from '@/lib/api/auth.api';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { errorMessage } from '@/lib/format';
import AuthLayout, { authButton, authInput, authLabel } from '@/components/AuthLayout';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const router = useRouter();
  const { login, isAuthenticated, loading: checking } = useAuth();

  // Already signed in: go straight to the dashboard.
  useEffect(() => {
    if (!checking && isAuthenticated) router.replace('/dashboard');
  }, [checking, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }
    if (password.length < 6) {
      return setError('Password must be at least 6 characters');
    }

    setLoading(true);

    try {
      const data = await registerUser({ name, email, password });
      if (data.success) {
        // Sign the new account in with the existing login endpoint, then open the dashboard.
        try {
          const session = await loginUser({ email, password });
          if (session.success) {
            login(session.data.user);
            router.replace('/dashboard');
            return;
          }
        } catch {
          // Fall through: the account exists, so the user can log in by hand.
        }
        router.push('/login?registered=1');
      } else {
        setError(data.message || 'Registration failed');
      }
    } catch (err: unknown) {
      setError(errorMessage(err, 'An error occurred. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your Trutivo account"
      subtitle="Analyse resumes, match them to jobs and prepare for interviews."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
            Log in
          </Link>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="register-name" className={authLabel}>
            Full name
          </label>
          <input id="register-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={authInput} required />
        </div>
        <div>
          <label htmlFor="register-email" className={authLabel}>
            Email
          </label>
          <input id="register-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} required />
        </div>
        <div>
          <label htmlFor="register-password" className={authLabel}>
            Password
          </label>
          <input id="register-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} aria-describedby="register-password-hint" required />
          <p id="register-password-hint" className="mt-1 text-xs text-slate-500">
            At least 6 characters.
          </p>
        </div>
        <div>
          <label htmlFor="register-confirm" className={authLabel}>
            Confirm password
          </label>
          <input id="register-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={authInput} required />
        </div>
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? 'Creating Account...' : 'Sign Up'}
        </button>
      </form>
    </AuthLayout>
  );
}
