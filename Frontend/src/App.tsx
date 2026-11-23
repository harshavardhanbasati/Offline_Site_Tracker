import { createContext, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, BarChart3, ClipboardCheck, Download, LayoutDashboard, LogOut, MapPin, Menu, RefreshCw, Search, Settings, Wifi, WifiOff, X } from 'lucide-react'
import { api, clearSession, setSession } from './api'
import { db } from './db'
import { enqueueMutation, retryFailed, synchronize } from './sync'
import type { Inspection, Role, Site, User } from './types'

interface AuthValue {
  user: User | null
  login: (email: string, password: string) => Promise<void>
  register: (fullName: string, email: string, password: string, role: 'inspector' | 'employee') => Promise<void>
  logout: () => void
}
const AuthContext = createContext<AuthValue | null>(null)

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => {
    const restore = async () => {
      try {
        const tokens = await api.refresh()
        setSession(tokens)
        const profile = await api.me()
        await db.sync_metadata.put({ key: 'cached_user', value: JSON.stringify(profile), updatedAt: Date.now() })
        setUser(profile)
      } catch {
        const cached = await db.sync_metadata.get('cached_user')
        if (cached) {
          try { setUser(JSON.parse(cached.value) as User) } catch { clearSession() }
        } else {
          clearSession()
        }
      }
    }
    void restore()
  }, [])
  const login = async (email: string, password: string) => {
    const tokens = await api.login(email, password)
    setSession(tokens)
    const profile = await api.me()
    await db.sync_metadata.put({ key: 'cached_user', value: JSON.stringify(profile), updatedAt: Date.now() })
    setUser(profile)
  }
  const register = async (fullName: string, email: string, password: string, role: 'inspector' | 'employee') => {
    const tokens = await api.register(fullName, email, password, role)
    setSession(tokens)
    const profile = await api.me()
    await db.sync_metadata.put({ key: 'cached_user', value: JSON.stringify(profile), updatedAt: Date.now() })
    setUser(profile)
  }
  const logout = () => { clearSession(); setUser(null) }
  const value = useMemo(() => ({ user, login, register, logout }), [user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthContext unavailable')
  return value
}

function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' }) {
  const color = variant === 'primary' ? 'border-[#1676b8] bg-[#1676b8] text-white hover:bg-[#105f95]' : variant === 'danger' ? 'border-[#c83e4d] bg-[#c83e4d] text-white' : 'border-[#d7e0e7] bg-white text-[#344054] hover:bg-[#f8fafc]'
  return <button className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition disabled:opacity-50 ${color} ${className}`} {...props}>{children}</button>
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#dde5ec] bg-white ${className}`}>{children}</section>
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const tones = { neutral: 'bg-[#eef2f6] text-[#475467]', success: 'bg-[#eaf7ef] text-[#198754]', warning: 'bg-[#fff4de] text-[#9a6700]', danger: 'bg-[#fdecee] text-[#b42332]', info: 'bg-[#edf6fb] text-[#1676b8]' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

const loginSchema = z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(6, 'Password must be at least 6 characters') })
type LoginValues = z.infer<typeof loginSchema>

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const submit = async (values: LoginValues) => {
    setError('')
    try { await login(values.email, values.password); navigate('/') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to sign in') }
  }
  return (
    <div className="grid min-h-screen bg-[#f4f7fa] lg:grid-cols-[1fr_440px]">
      <aside className="hidden flex-col justify-between bg-[#17324d] p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 font-bold">FS</div><strong>FieldSync</strong></div>
        <div className="max-w-xl"><p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-[#9cc6e2]">Offline-ready operations</p><h1 className="text-4xl font-bold leading-tight">Keep every inspection moving, anywhere.</h1><p className="mt-5 max-w-lg text-base leading-7 text-[#cbd6e1]">Capture field work locally, reconcile safely, and keep inspectors and employees aligned when connectivity returns.</p></div>
        <p className="text-xs text-[#91a6bb]">FieldSync Enterprise Platform</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <h2 className="text-2xl font-bold">Welcome back</h2><p className="mt-2 text-sm text-[#667085]">Sign in to manage your inspections.</p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit(submit)}>
            <div><label className="mb-2 block text-sm font-semibold" htmlFor="email">Email address</label><input id="email" type="email" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="name@company.com" {...register('email')} />{errors.email && <p className="mt-1 text-xs text-[#c83e4d]">{errors.email.message}</p>}</div>
            <div><label className="mb-2 block text-sm font-semibold" htmlFor="password">Password</label><input id="password" type="password" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="Enter your password" {...register('password')} />{errors.password && <p className="mt-1 text-xs text-[#c83e4d]">{errors.password.message}</p>}</div>
            {error && <div role="alert" className="rounded-lg border border-[#f2c3c8] bg-[#fff4f4] px-3 py-2 text-sm text-[#b42332]">{error}</div>}
            <Button className="w-full" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</Button>
          </form>
          <p className="mt-5 text-center text-sm text-[#667085]">
            New to FieldSync? <Link className="font-semibold text-[#1676b8] hover:underline" to="/register">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  role: z.enum(['inspector', 'employee']),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type RegisterValues = z.infer<typeof registerSchema>

function RegisterPage() {
  const { register: registerAccount } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  })

  const submit = async (values: RegisterValues) => {
    setError('')
    try {
      await registerAccount(values.fullName, values.email, values.password, values.role)
      navigate('/')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create account')
    }
  }

  return (
    <div className="grid min-h-screen bg-[#f4f7fa] lg:grid-cols-[1fr_440px]">
      <aside className="hidden flex-col justify-between bg-[#17324d] p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 font-bold">FS</div><strong>FieldSync</strong></div>
        <div className="max-w-xl"><p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-[#9cc6e2]">Join field operations</p><h1 className="text-4xl font-bold leading-tight">Create your FieldSync account.</h1><p className="mt-5 max-w-lg text-base leading-7 text-[#cbd6e1]">Register as an inspector or employee, based on the responsibilities assigned to you.</p></div>
        <p className="text-xs text-[#91a6bb]">FieldSync Enterprise Platform</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <h2 className="text-2xl font-bold">Create your account</h2>
          <p className="mt-2 text-sm text-[#667085]">Choose the access level that matches your field role.</p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit(submit)}>
            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="fullName">Full name</label>
              <input id="fullName" autoComplete="name" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="Your full name" {...register('fullName')} />
              {errors.fullName && <p className="mt-1 text-xs text-[#c83e4d]">{errors.fullName.message}</p>}
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="registerEmail">Email address</label>
              <input id="registerEmail" type="email" autoComplete="email" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="name@company.com" {...register('email')} />
              {errors.email && <p className="mt-1 text-xs text-[#c83e4d]">{errors.email.message}</p>}
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="registerPassword">Password</label>
              <input id="registerPassword" type="password" autoComplete="new-password" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="At least 8 characters" {...register('password')} />
              {errors.password && <p className="mt-1 text-xs text-[#c83e4d]">{errors.password.message}</p>}
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="confirmPassword">Confirm password</label>
              <input id="confirmPassword" type="password" autoComplete="new-password" className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" placeholder="Repeat your password" {...register('confirmPassword')} />
              {errors.confirmPassword && <p className="mt-1 text-xs text-[#c83e4d]">{errors.confirmPassword.message}</p>}
            </div>
            <fieldset>
              <legend className="mb-2 block text-sm font-semibold">Role</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="relative cursor-pointer rounded-lg border border-[#d7e0e7] p-4 has-[:checked]:border-[#1676b8] has-[:checked]:bg-[#edf6fb]">
                  <input className="sr-only" type="radio" value="inspector" {...register('role')} />
                  <span className="block text-sm font-bold">Inspector</span>
                  <span className="mt-1 block text-xs leading-5 text-[#667085]">Manage sites and create, update, and submit inspections.</span>
                </label>
                <label className="relative cursor-pointer rounded-lg border border-[#d7e0e7] p-4 has-[:checked]:border-[#1676b8] has-[:checked]:bg-[#edf6fb]">
                  <input className="sr-only" type="radio" value="employee" {...register('role')} />
                  <span className="block text-sm font-bold">Employee</span>
                  <span className="mt-1 block text-xs leading-5 text-[#667085]">View assigned tasks and update their completion status.</span>
                </label>
              </div>
              {errors.role && <p className="mt-1 text-xs text-[#c83e4d]">{errors.role.message}</p>}
            </fieldset>
            {error && <div role="alert" className="rounded-lg border border-[#f2c3c8] bg-[#fff4f4] px-3 py-2 text-sm text-[#b42332]">{error}</div>}
            <Button className="w-full" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account...' : 'Create account'}</Button>
          </form>
          <p className="mt-5 text-center text-sm text-[#667085]">
            Already have an account? <Link className="font-semibold text-[#1676b8] hover:underline" to="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

const navigation = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'My Sites', to: '/sites', icon: MapPin },
  { label: 'Inspections', to: '/inspections', icon: ClipboardCheck },
  { label: 'Sync Center', to: '/sync', icon: RefreshCw },
  { label: 'Activity', to: '/activity', icon: Activity },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: Settings },
]

function useNetwork() {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine)
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    let active = true
    const probe = async () => {
      if (!navigator.onLine) { setBackendReachable(false); return }
      try { await api.health(); if (active) setBackendReachable(true) } catch { if (active) setBackendReachable(false) }
    }
    void probe()
    const timer = window.setInterval(probe, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [browserOnline])
  return { browserOnline, backendReachable }
}

function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { browserOnline, backendReachable } = useNetwork()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const brandName = localStorage.getItem('fieldsync.brand_name') ?? 'FieldSync'
  useEffect(() => {
    const savedColor = localStorage.getItem('fieldsync.brand_color')
    if (savedColor) document.documentElement.style.setProperty('--brand', savedColor)
  }, [])
  useEffect(() => { if (browserOnline && backendReachable) void synchronize() }, [browserOnline, backendReachable])
  const title = navigation.find((item) => item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to))?.label ?? 'FieldSync'
  const syncNow = async () => { setSyncing(true); await synchronize(); setSyncing(false) }
  return (
    <div className="min-h-screen bg-[#f4f7fa]">
      <aside className={`${menuOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-[#e1e8ee] bg-white transition-transform lg:translate-x-0`}>
        <div className="flex h-[72px] items-center border-b border-[#edf1f4] px-6"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1676b8] text-sm font-bold text-white">FS</div>        <div className="ml-3"><div className="text-[15px] font-bold">{brandName}</div><div className="text-xs text-[#667085]">Field operations</div></div><button aria-label="Close navigation" className="ml-auto lg:hidden" onClick={() => setMenuOpen(false)}><X size={18}/></button></div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          {navigation.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold ${isActive ? 'bg-[#edf6fb] text-[#1676b8]' : 'text-[#667085] hover:bg-[#f7f9fb]'}`}><item.icon size={18}/>{item.label}</NavLink>)}
        </nav>
        <div className="border-t border-[#edf1f4] p-3"><div className="flex items-center gap-3 rounded-lg px-3 py-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f1f7] font-bold text-[#1676b8]">{user?.full_name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{user?.full_name}</div><div className="text-xs capitalize text-[#667085]">{user?.role}</div></div><button aria-label="Log out" className="text-[#667085]" onClick={() => { logout(); navigate('/login') }}><LogOut size={17}/></button></div></div>
      </aside>
      {menuOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setMenuOpen(false)} />}
      <div className="lg:pl-[240px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center border-b border-[#e1e8ee] bg-white px-4 lg:px-8">
          <button aria-label="Open navigation" className="mr-3 lg:hidden" onClick={() => setMenuOpen(true)}><Menu size={20}/></button>
          <div><div className="text-xs text-[#98a2b3]">FieldSync / <span className="text-[#667085]">{title}</span></div><h1 className="text-lg font-bold">{title}</h1></div>
          <div className="ml-auto flex items-center gap-2"><div className="hidden h-10 w-[220px] items-center gap-2 rounded-lg border border-[#dfe6ec] px-3 md:flex"><Search size={16} className="text-[#98a2b3]"/><input className="w-full border-0 bg-transparent text-sm outline-none" placeholder="Search..." aria-label="Search"/></div><button aria-label="Synchronization status" onClick={syncNow} disabled={syncing} className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${!browserOnline ? 'border-[#f3d49b] bg-[#fff8ea] text-[#9a6700]' : backendReachable === false ? 'border-[#f2c3c8] bg-[#fff4f4] text-[#b42332]' : 'border-[#bfe0cb] bg-[#edf8f1] text-[#198754]'}`}>{browserOnline ? <Wifi size={16}/> : <WifiOff size={16}/>}<span className="hidden sm:inline">{syncing ? 'Syncing...' : !browserOnline ? 'Offline' : backendReachable === false ? 'Server unreachable' : 'Synced'}</span></button></div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}

function OverviewPage() {
  const navigate = useNavigate()
  const report = useQuery({ queryKey: ['report'], queryFn: api.report })
  const [localCounts, setLocalCounts] = useState({ sites: 0, inspections: 0, pending: 0, failed: 0 })
  useEffect(() => {
    const load = async () => setLocalCounts({
      sites: await db.cached_sites.count(),
      inspections: await db.local_inspections.count(),
      pending: await db.sync_outbox.where('status').anyOf(['pending', 'processing']).count(),
      failed: await db.sync_outbox.where('status').equals('failed').count(),
    })
    void load()
  }, [])
  const data = report.data ?? {}
  const stats = [
    ['Assigned sites', Number(data.total_sites ?? localCounts.sites)],
    ['Inspections', Number(data.total_inspections ?? localCounts.inspections)],
    ['Completed', Number(data.completed ?? 0)],
    ['Unsynchronized', localCounts.pending],
  ] as Array<[string, number]>
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Good morning</h2><p className="mt-1 text-sm text-[#667085]">Your field operation overview.</p></div><Button onClick={() => navigate('/inspections')}><ClipboardCheck size={16}/>Quick create</Button></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value]) => <Card key={label} className="p-5"><p className="text-sm font-medium text-[#667085]">{label}</p><p className="mt-4 text-3xl font-bold">{value}</p></Card>)}</div>
      {localCounts.failed > 0 && <div className="flex items-center gap-3 rounded-xl border border-[#f2c3c8] bg-[#fff7f7] px-4 py-3 text-sm text-[#a7353f]"><AlertTriangle size={18}/><strong>{localCounts.failed} failed sync operations</strong><button className="ml-auto underline" onClick={() => navigate('/sync')}>Open Sync Center</button></div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5"><h3 className="mb-5 font-bold">Inspection status</h3><div className="grid gap-3 sm:grid-cols-3">{[['Completed', Number(data.completed ?? 0), 'success'], ['In progress', Number((data.status_counts as Record<string, number> | undefined)?.in_progress ?? 0), 'info'], ['Draft', Number((data.status_counts as Record<string, number> | undefined)?.draft ?? 0), 'neutral']].map(([label, value, tone]) => <div key={String(label)} className="rounded-lg border border-[#edf1f4] p-4"><Badge tone={tone as 'success' | 'info' | 'neutral'}>{label}</Badge><p className="mt-3 text-2xl font-bold">{String(value)}</p></div>)}</div></Card>
        <Card className="p-5"><h3 className="mb-4 font-bold">Synchronization</h3><div className="space-y-3 text-sm"><div className="flex justify-between rounded-lg border border-[#edf1f4] p-3"><span>Pending operations</span><strong>{localCounts.pending}</strong></div><div className="flex justify-between rounded-lg border border-[#edf1f4] p-3"><span>Failed operations</span><strong>{localCounts.failed}</strong></div></div></Card>
      </div>
    </div>
  )
}

function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [search, setSearch] = useState('')
  useEffect(() => {
    const load = async () => {
      try { const result = await api.sites(search); await db.cached_sites.bulkPut(result); setSites(result) }
      catch { const local = await db.cached_sites.filter((site) => !search || `${site.name} ${site.code}`.toLowerCase().includes(search.toLowerCase())).toArray(); setSites(local) }
    }
    const timer = window.setTimeout(load, search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [search])
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-bold">My Sites</h2><p className="mt-1 text-sm text-[#667085]">Assigned locations and cached field information.</p></div><div className="relative w-full sm:w-[280px]"><Search className="absolute left-3 top-3 text-[#98a2b3]" size={17}/><input className="h-11 w-full rounded-lg border border-[#d7e0e7] pl-10 pr-3 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sites..." /></div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sites.map((site) => <Card key={site.id} className="p-5"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf6fb] text-[#1676b8]"><MapPin size={18}/></div><Badge tone={site.status === 'active' ? 'success' : 'neutral'}>{site.status}</Badge></div><h3 className="mt-4 font-bold">{site.name}</h3><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">{site.code}</p><p className="mt-3 text-sm leading-5 text-[#667085]">{site.address}</p><div className="mt-4 border-t border-[#edf1f4] pt-3 text-xs text-[#98a2b3]">Cached locally · Updated {new Date(site.updated_at).toLocaleDateString()}</div></Card>)}{sites.length === 0 && <Card className="col-span-full p-10 text-center text-sm text-[#667085]">No sites match this view.</Card>}</div>
    </div>
  )
}

function InspectionsPage() {
  const { user } = useAuth()
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [draft, setDraft] = useState<Inspection | null>(null)
  useEffect(() => {
    const load = async () => {
      try {
        const [serverInspections, serverSites] = await Promise.all([api.inspections(), api.sites()])
        await db.local_inspections.bulkPut(serverInspections.map((item) => ({ ...item, syncStatus: 'synchronized' })))
        await db.cached_sites.bulkPut(serverSites)
        setInspections(serverInspections); setSites(serverSites)
      } catch {
        setInspections(await db.local_inspections.toArray()); setSites(await db.cached_sites.toArray())
      }
    }
    void load()
  }, [])
  const openNew = () => setDraft({
    id: crypto.randomUUID(), site_id: '', inspector_id: '', title: '', status: 'draft', data: {}, version: 1,
    submitted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    checklist: [{ label: 'Site access verified', status: 'pending', sort_order: 0 }, { label: 'Safety controls inspected', status: 'pending', sort_order: 1 }, { label: 'Equipment condition recorded', status: 'pending', sort_order: 2 }],
    syncStatus: 'draft', serverVersion: 1,
  })
  const save = async () => {
    if (!draft || !draft.site_id || !draft.title.trim()) return
    const exists = await db.local_inspections.get(draft.id)
    const local = { ...draft, syncStatus: 'pending' as const, updated_at: new Date().toISOString() }
    await enqueueMutation(
      exists ? 'update_inspection' : 'create_inspection',
      { ...local, serverVersion: exists?.serverVersion ?? draft.version },
      user?.role ?? 'inspector',
    )
    setInspections((current) => current.some((item) => item.id === draft.id) ? current.map((item) => item.id === draft.id ? local : item) : [local, ...current])
    setDraft(null)
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">{user?.role === 'employee' ? 'My Tasks' : 'Inspections'}</h2><p className="mt-1 text-sm text-[#667085]">{user?.role === 'employee' ? 'View assigned tasks and update their completion status.' : 'Create drafts, complete checklists, and submit field work.'}</p></div>{user?.role !== 'employee' && <Button onClick={openNew}>Create inspection</Button>}</div>
      {draft && <Card className="p-5"><div className="flex items-center justify-between"><h3 className="font-bold">Inspection draft</h3><Badge tone="warning">Saved locally</Badge></div><div className="mt-5 grid gap-4 md:grid-cols-2"><div><label className="mb-2 block text-sm font-semibold">Site</label><select className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={draft.site_id} onChange={(event) => setDraft({ ...draft, site_id: event.target.value })}><option value="">Select a site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div><div><label className="mb-2 block text-sm font-semibold">Title</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div><div><label className="mb-2 block text-sm font-semibold">Status</label><select className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Inspection['status'] })}><option value="draft">Draft</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></div></div><div className="mt-5 space-y-2">{draft.checklist.map((item, index) => <div key={item.label} className="grid items-center gap-3 rounded-lg border border-[#edf1f4] p-3 sm:grid-cols-[1fr_180px]"><span className="text-sm font-medium">{item.label}</span><select className="h-9 rounded-lg border border-[#d7e0e7] px-2 text-sm" value={item.status} onChange={(event) => setDraft({ ...draft, checklist: draft.checklist.map((value, itemIndex) => itemIndex === index ? { ...value, status: event.target.value as typeof value.status } : value) })}><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="not_applicable">Not applicable</option></select></div>)}</div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={save} disabled={!draft.site_id || !draft.title.trim()}>Save locally</Button></div></Card>}
      <Card className="overflow-hidden"><div className="grid grid-cols-[1fr_140px_140px] border-b border-[#edf1f4] px-5 py-3 text-xs font-semibold uppercase text-[#98a2b3]"><span>Inspection</span><span>Status</span><span>Sync</span></div>{inspections.map((inspection) => <button key={inspection.id} onClick={() => setDraft({ ...inspection, checklist: [...inspection.checklist] })} className="grid w-full grid-cols-[1fr_140px_140px] items-center border-b border-[#edf1f4] px-5 py-4 text-left last:border-0"><div><p className="text-sm font-bold">{inspection.title}</p><p className="mt-1 text-xs text-[#98a2b3]">Version {inspection.version}</p></div><Badge tone={inspection.status === 'completed' ? 'success' : inspection.status === 'in_progress' ? 'info' : 'neutral'}>{inspection.status.replace('_', ' ')}</Badge><Badge tone={inspection.syncStatus === 'failed' || inspection.syncStatus === 'conflict' ? 'danger' : inspection.syncStatus === 'pending' ? 'warning' : 'success'}>{inspection.syncStatus ?? 'synchronized'}</Badge></button>) }{inspections.length === 0 && <div className="py-12 text-center text-sm text-[#667085]">No inspections available.</div>}</Card>
    </div>
  )
}

function SyncPage() {
  const [outbox, setOutbox] = useState<Array<{ id?: number; idempotencyKey: string; operation: string; status: string; retryCount: number }>>([])
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([])
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([])
  const [syncing, setSyncing] = useState(false)
  const load = async () => {
    setOutbox(await db.sync_outbox.toArray())
    try { setHistory(await api.syncHistory()); setConflicts(await api.conflicts()) } catch { /* local outbox remains authoritative */ }
  }
  useEffect(() => { void load() }, [])
  const syncNow = async () => { setSyncing(true); await synchronize(); await load(); setSyncing(false) }
  const retry = async () => { await retryFailed(); await syncNow() }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Sync Center</h2><p className="mt-1 text-sm text-[#667085]">Monitor pending work, failures, and conflicts.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={retry}>Retry failed</Button><Button onClick={syncNow} disabled={syncing}><RefreshCw size={16} className={syncing ? 'animate-spin' : ''}/>Sync now</Button></div></div>
      <div className="grid gap-4 md:grid-cols-3"><Card className="p-5"><p className="text-sm font-semibold">Outbox</p><p className="mt-3 text-lg font-bold">{outbox.length} operations</p></Card><Card className="p-5"><p className="text-sm font-semibold">Failures</p><p className="mt-3 text-lg font-bold">{outbox.filter((item) => item.status === 'failed').length}</p></Card><Card className="p-5"><p className="text-sm font-semibold">Conflicts</p><p className="mt-3 text-lg font-bold">{conflicts.filter((item) => item.status === 'open').length}</p></Card></div>
      {conflicts.filter((item) => item.status === 'open').length > 0 && <Card className="p-5"><h3 className="mb-4 font-bold">Conflicts requiring review</h3><div className="space-y-3">{conflicts.filter((item) => item.status === 'open').map((conflict) => <div key={String(conflict.id)} className="flex items-center gap-3 rounded-lg border border-[#f2c3c8] bg-[#fff7f7] p-3"><AlertTriangle size={18} className="text-[#c83e4d]"/><div className="flex-1"><p className="text-sm font-semibold">Inspection version conflict</p><p className="text-xs text-[#667085]">Local and server values differ</p></div><Button variant="secondary" onClick={async () => { await api.resolveConflict(String(conflict.id), 'accept_server'); await load() }}>Accept server</Button></div>)}</div></Card>}
      <div className="grid gap-5 xl:grid-cols-2"><Card className="p-5"><h3 className="mb-4 font-bold">Persistent outbox</h3><div className="space-y-2">{outbox.map((item) => <div key={item.idempotencyKey} className="flex items-center rounded-lg border border-[#edf1f4] p-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.operation.replace('_', ' ')}</p><p className="text-xs text-[#98a2b3]">Retry {item.retryCount}</p></div><Badge tone={item.status === 'failed' || item.status === 'conflict' ? 'danger' : item.status === 'pending' ? 'warning' : 'success'}>{item.status}</Badge></div>)}{outbox.length === 0 && <p className="py-8 text-center text-sm text-[#667085]">No pending operations.</p>}</div></Card><Card className="p-5"><h3 className="mb-4 font-bold">Synchronization history</h3><div className="space-y-2">{history.slice(0, 12).map((item) => <div key={String(item.id)} className="flex items-center border-b border-[#edf1f4] py-3"><div className="flex-1"><p className="text-sm font-semibold">{String(item.operation).replace('_', ' ')}</p><p className="text-xs text-[#98a2b3]">{new Date(String(item.created_at)).toLocaleString()}</p></div><Badge tone={item.status === 'synchronized' ? 'success' : item.status === 'failed' || item.status === 'conflict' ? 'danger' : 'warning'}>{String(item.status)}</Badge></div>)}{history.length === 0 && <p className="py-8 text-center text-sm text-[#667085]">No synchronization history.</p>}</div></Card></div>
    </div>
  )
}

function ActivityPage() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => { void api.activity().then(setItems).catch(() => setItems([])) }, [])
  return (
    <div className="space-y-5"><div><h2 className="text-xl font-bold">Activity</h2><p className="mt-1 text-sm text-[#667085]">Important system, inspection, and synchronization events.</p></div><Card className="p-5">{items.map((item) => <div key={String(item.id)} className="flex gap-3 border-b border-[#edf1f4] py-4 last:border-0"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf6fb] text-[#1676b8]"><Activity size={17}/></div><div><p className="text-sm font-bold capitalize">{String(item.action).replaceAll('.', ' ')}</p><p className="mt-1 text-xs text-[#667085]">{String(item.entity_type)} · {new Date(String(item.created_at)).toLocaleString()}</p></div></div>)}{items.length === 0 && <div className="py-12 text-center text-sm text-[#667085]">No activity has been recorded.</div>}</Card></div>
  )
}

function ReportsPage() {
  const report = useQuery({ queryKey: ['report'], queryFn: api.report })
  const data = report.data ?? {}
  const download = () => {
    const csv = `Metric,Value\nTotal sites,${Number(data.total_sites ?? 0)}\nTotal inspections,${Number(data.total_inspections ?? 0)}\nCompleted,${Number(data.completed ?? 0)}\nOpen conflicts,${Number(data.open_conflicts ?? 0)}`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = 'fieldsync-report.csv'; link.click(); URL.revokeObjectURL(link.href)
  }
  const values: Array<[string, number]> = [['Sites', Number(data.total_sites ?? 0)], ['Inspections', Number(data.total_inspections ?? 0)], ['Completed', Number(data.completed ?? 0)], ['Open conflicts', Number(data.open_conflicts ?? 0)]]
  return (
    <div className="space-y-5"><div className="flex items-end justify-between"><div><h2 className="text-xl font-bold">Reports</h2><p className="mt-1 text-sm text-[#667085]">Operational summaries from server-backed reporting data.</p></div><Button variant="secondary" onClick={download}><Download size={16}/>Export CSV</Button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{values.map(([label, value]) => <Card key={label} className="p-5"><p className="text-sm font-medium text-[#667085]">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></Card>)}</div><Card className="p-5"><h3 className="mb-4 font-bold">Status summary</h3><p className="rounded-lg border border-[#edf1f4] p-8 text-center text-sm text-[#667085]">Inspection records are summarized by the server reporting endpoint.</p></Card></div>
  )
}

function SettingsPage() {
  const { user } = useAuth()
  const [autoSync, setAutoSync] = useState(true)
  const [saved, setSaved] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [brandName, setBrandName] = useState(() => localStorage.getItem('fieldsync.brand_name') ?? 'FieldSync')
  const [brandColor, setBrandColor] = useState(() => localStorage.getItem('fieldsync.brand_color') ?? '#1676b8')
  useEffect(() => { if (user?.role === 'administrator') void api.users().then(setUsers).catch(() => setUsers([])) }, [user])
  const updateUser = async (id: string, changes: { role?: Role; is_active?: boolean }) => {
    await api.updateUser(id, changes)
    setUsers(await api.users())
  }
  const removeUser = async (id: string) => {
    await api.removeUser(id)
    setUsers(await api.users())
  }
  const save = () => {
    localStorage.setItem('fieldsync.preferences', JSON.stringify({ autoSync }))
    if (user?.role === 'administrator') {
      localStorage.setItem('fieldsync.brand_name', brandName)
      localStorage.setItem('fieldsync.brand_color', brandColor)
      document.documentElement.style.setProperty('--brand', brandColor)
    }
    setSaved(true)
  }
  return (
    <div className="space-y-5"><div><h2 className="text-xl font-bold">Settings</h2><p className="mt-1 text-sm text-[#667085]">Manage profile and synchronization preferences.</p></div><div className="grid gap-5 lg:grid-cols-2"><Card className="p-5"><h3 className="font-bold">Profile</h3><div className="mt-5 space-y-4"><div><label className="mb-2 block text-sm font-semibold">Full name</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={user?.full_name ?? ''} readOnly /></div><div><label className="mb-2 block text-sm font-semibold">Email</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={user?.email ?? ''} readOnly /></div><div><label className="mb-2 block text-sm font-semibold">Role</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={user?.role ?? ''} readOnly /></div></div></Card><Card className="p-5"><h3 className="font-bold">Synchronization</h3><label className="mt-5 flex items-center justify-between rounded-lg border border-[#edf1f4] p-4"><div><p className="text-sm font-semibold">Automatic synchronization</p><p className="mt-1 text-xs text-[#667085]">Sync when browser and backend connectivity return.</p></div><input type="checkbox" checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} /></label><Button className="mt-5" onClick={save}>{saved ? 'Preferences saved' : 'Save preferences'}</Button></Card></div>{user?.role === 'administrator' && <><Card className="p-5"><h3 className="font-bold">Organization</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><div><label className="mb-2 block text-sm font-semibold">Organization name</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 text-sm" value={brandName} onChange={(event) => setBrandName(event.target.value)} /></div><div><label className="mb-2 block text-sm font-semibold">Brand color</label><input className="h-11 w-full rounded-lg border border-[#d7e0e7] px-2" type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} /></div></div></Card><Card className="p-5"><h3 className="font-bold">Users</h3><div className="mt-4 divide-y divide-[#edf1f4]">{users.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><div className="flex-1"><p className="text-sm font-semibold">{item.full_name}</p><p className="text-xs text-[#667085]">{item.email}</p></div><select aria-label={`Role for ${item.full_name}`} className="h-9 rounded-lg border border-[#d7e0e7] px-2 text-xs" value={item.role} onChange={(event) => void updateUser(item.id, { role: event.target.value as Role })}><option value="administrator">Administrator</option><option value="inspector">Inspector</option><option value="employee">Employee</option></select><Button variant={item.is_active ? 'secondary' : 'primary'} onClick={() => void updateUser(item.id, { is_active: !item.is_active })}>{item.is_active ? 'Disable' : 'Enable'}</Button>{item.id !== user.id && <Button variant="danger" onClick={() => void removeUser(item.id)}>Remove</Button>}</div>)}</div></Card></>}</div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <AppLayout>{children}</AppLayout>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage/>}/>
          <Route path="/register" element={<RegisterPage/>}/>
          <Route path="/" element={<Protected><OverviewPage/></Protected>}/>
          <Route path="/sites" element={<Protected><SitesPage/></Protected>}/>
          <Route path="/inspections" element={<Protected><InspectionsPage/></Protected>}/>
          <Route path="/sync" element={<Protected><SyncPage/></Protected>}/>
          <Route path="/activity" element={<Protected><ActivityPage/></Protected>}/>
          <Route path="/reports" element={<Protected><ReportsPage/></Protected>}/>
          <Route path="/settings" element={<Protected><SettingsPage/></Protected>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
