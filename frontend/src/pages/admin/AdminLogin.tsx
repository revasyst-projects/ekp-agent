import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { adminLogin, isAdminAuthed } from '../../api/client'
import { Card, Spinner } from '../../components/ui'
import { Logo } from '../../components/ui'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (isAdminAuthed()) return <Navigate to="/admin/links" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await adminLogin(username, password)
      navigate('/admin/links')
    } catch {
      setError('Invalid credentials.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm p-7">
        <div className="flex items-center gap-3">
          <Logo className="size-8" />
          <div>
            <h1 className="font-semibold text-slate-900">Admin portal</h1>
            <p className="text-xs text-slate-500">Enterprise Knowledge Platform</p>
          </div>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          {/* credentials come from ADMIN_USERNAME / ADMIN_PASSWORD env vars */}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy && <Spinner className="size-4 text-white" />}
            Sign in
          </button>
        </form>
      </Card>
    </div>
  )
}
