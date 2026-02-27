'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/app/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // If already signed in, skip login page
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        router.replace('/')
        router.refresh()
      }
    })()
  }, [router, supabase])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    setError(null)
    setBusy(true)

    const cleanEmail = email.trim().toLowerCase()
    const cleanPassword = password

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        })

        if (error) {
          setError(error.message)
          return
        }

        router.replace('/')
        router.refresh()
        return
      }

      // signup
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
      })

      if (error) {
        setError(error.message)
        return
      }

      // If email confirmation is disabled, session should exist immediately.
      // If it's still enabled in Supabase, session may be null.
      if (!data.session) {
        setError(
          'Signup succeeded, but your project is requiring email confirmation. Turn off "Confirm email" in Supabase Auth settings, or confirm your email and then sign in.'
        )
        return
      }

      router.replace('/')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </h1>

      <p style={{ marginTop: 0, color: '#666' }}>
        {mode === 'signin'
          ? 'Sign in to access the BDA Tracker.'
          : 'Create an account to access the BDA Tracker.'}
      </p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            spellCheck={false}
            inputMode="email"
            style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        {error ? <p style={{ color: 'crimson', margin: 0 }}>{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: 10,
            borderRadius: 6,
            border: '1px solid #ccc',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null)
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          }}
          style={{
            padding: 10,
            borderRadius: 6,
            border: '1px solid #ccc',
            background: 'transparent',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          Switch to {mode === 'signin' ? 'Sign up' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}