import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  LayoutDashboard, MessageSquareText, FlaskConical, GitCompareArrows,
  History, Settings, Plus, ArrowUpRight, Search, Globe2, ShieldCheck,
  Clock3, CheckCircle2, Circle, LoaderCircle, ExternalLink, Sparkles,
  Trash2, Send, ChevronRight, Database, KeyRound, FileText, Workflow,
  Mic, Volume2, VolumeX, BarChart3, Bot, Monitor, Moon, Sun, LogOut
} from 'lucide-react'
import { api } from './services/api'
import type { Result, Source, Task } from './types'

type Page = 'Dashboard' | 'AI Assistant' | 'Research' | 'Comparison' | 'Browser Companion' | 'Agent Monitor' | 'History' | 'Reports' | 'Templates' | 'Trust & Security' | 'Analytics' | 'Settings'

const navItems = [
  { name: 'Dashboard' as Page, icon: LayoutDashboard },
  { name: 'AI Assistant' as Page, icon: MessageSquareText },
  { name: 'Research' as Page, icon: FlaskConical },
  { name: 'Comparison' as Page, icon: GitCompareArrows },
  { name: 'Browser Companion' as Page, icon: Monitor },
  { name: 'Agent Monitor' as Page, icon: Bot },
  { name: 'History' as Page, icon: History },
  { name: 'Reports' as Page, icon: FileText },
  { name: 'Templates' as Page, icon: Workflow },
  { name: 'Trust & Security' as Page, icon: ShieldCheck },
  { name: 'Analytics' as Page, icon: BarChart3 },
  { name: 'Settings' as Page, icon: Settings },
]

function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [user, setUser] = useState<{ id: string; email: string; display_name: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(() => api.hasSession())
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [instruction, setInstruction] = useState('')
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('webpilot-theme') as 'light' | 'dark') || 'light')
  const recognition = useRef<WebPilotSpeechRecognition | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('webpilot-theme', theme)
  }, [theme])

  useEffect(() => {
    let active = true
    if (!api.hasSession()) return
    api.currentUser()
      .then(profile => { if (active) setUser(profile) })
      .catch(() => api.clearSession())
      .finally(() => { if (active) setAuthLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const expireSession = () => {
      setUser(null)
      setTasks([])
      setSelected(null)
      setSources([])
      setResult(null)
    }
    window.addEventListener('webpilot-auth-expired', expireSession)
    return () => window.removeEventListener('webpilot-auth-expired', expireSession)
  }, [])

  useEffect(() => {
    if (!selected || (selected.status !== 'running' && selected.status !== 'pending')) return
    const timer = window.setInterval(async () => {
      try {
        const fresh = await api.getTask(selected.id)
        setSelected(fresh)
        setTasks(current => current.map(task => task.id === fresh.id ? fresh : task))
        if (fresh.status === 'completed' || fresh.status === 'failed' || fresh.status === 'cancelled') {
          await openTask(fresh)
          await refresh()
        }
      } catch {
        // Keep the last known task state; the next interval will retry.
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [selected?.id, selected?.status])

  useEffect(() => {
    if (!user) return
    let active = true
    api.listTasks()
      .then(data => { if (active) setTasks(data) })
      .catch(e => {
        if (active) setError(e instanceof Error ? e.message : 'Backend unavailable')
      })
    return () => { active = false }
  }, [user])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const title = params.get('browser_title')
    const url = params.get('browser_url')
    const content = params.get('browser_content')
    if (url && content) {
      setInstruction(`Research this page (${title || 'Webpage'}): ${url}\n\nPage excerpt: ${content}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const refresh = async () => {
    try { setTasks(await api.listTasks()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Backend unavailable') }
  }

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. You can still type your task.')
      return
    }
    const activeRecognition = new SpeechRecognition()
    recognition.current = activeRecognition
    activeRecognition.lang = 'en-US'
    activeRecognition.interimResults = false
    activeRecognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript
      if (transcript) setInstruction(transcript)
    }
    activeRecognition.onerror = () => setError('Voice input failed. Please type your task instead.')
    activeRecognition.start()
    setNotice('Listening… Review the transcribed task before running it.')
  }

  const stopVoice = () => {
    recognition.current?.stop()
    recognition.current = null
    window.speechSynthesis?.cancel()
  }

  const speakSummary = () => {
    if (!result?.summary || !window.speechSynthesis) {
      setError('Speech playback is unavailable in this browser.')
      return
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(result.summary))
  }

  const openTask = async (task: Task) => {
    setSelected(task)
    setPage('AI Assistant')
    setError('')
    try {
      const [sourceData, resultData] = await Promise.all([
        api.getSources(task.id).catch(() => []),
        api.getResults(task.id).catch(() => null),
      ])
      setSources(sourceData)
      setResult(resultData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load task')
    }
  }

  const runTask = async (text = instruction) => {
    if (!text.trim()) return
    setExecuting(true)
    setError('')
    setPage('AI Assistant')
    try {
      const created = await api.createTask(text.trim())
      setSelected(created)
      const completed = await api.executeTask(created.id)
      setSelected(completed)
      await openTask(completed)
      await refresh()
      setInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Task execution failed')
    } finally {
      setExecuting(false)
    }
  }

  const removeTask = async (id: string) => {
    if (!window.confirm('Delete this task and its research data?')) return
    await api.deleteTask(id)
    if (selected?.id === id) {
      setSelected(null)
      setSources([])
      setResult(null)
    }
    await refresh()
  }

  const clearHistory = async () => {
    if (!window.confirm('Clear all task history and related research data?')) return
    await api.clearTasks()
    setSelected(null)
    setSources([])
    setResult(null)
    await refresh()
  }

  const signOut = async () => {
    try { await api.logout() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out from Supabase') }
    setUser(null)
    setTasks([])
    setSelected(null)
    setSources([])
    setResult(null)
  }

  const completed = tasks.filter(t => t.status === 'completed').length
  const active = tasks.filter(t => t.status === 'running').length
  const appMode = selected?.mode ?? tasks[0]?.mode ?? 'demo'

  if (authLoading) return <AuthScreen loading />
  if (!user) return <AuthScreen onAuthenticated={setUser} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={19} /></div>
          <div className="brand-copy"><strong>WebPilot</strong><span>AI</span></div>
        </div>
        <nav>
          {navItems.map(item => (
            <button key={item.name} className={page === item.name ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.name)}>
              <item.icon size={18} /><span>{item.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="status-dot" />
          <div><small>System status</small><strong>All systems operational</strong></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            <span className="demo-badge"><span /> {appMode === 'demo' ? 'Demo mode' : 'Live mode'}</span>
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="icon-button" onClick={() => setPage('Settings')} aria-label="Settings"><Settings size={18} /></button>
            <button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button>
            <div className="avatar" title={user.email}>
              {(user.display_name || user.email).slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}

        {page === 'Dashboard' && (
          <Dashboard tasks={tasks} completed={completed} active={active}
            instruction={instruction} setInstruction={setInstruction} runTask={runTask}
            openTask={openTask} executing={executing} startVoice={startVoice} />
        )}
        {page === 'AI Assistant' && (
          <Assistant selected={selected} result={result} sources={sources} executing={executing}
            instruction={instruction} setInstruction={setInstruction} runTask={runTask}
            startVoice={startVoice} speakSummary={speakSummary} stopVoice={stopVoice}
            onCancel={async () => {
              if (!selected) return
              try {
                await api.cancelTask(selected.id)
                setNotice('Stop requested. The workflow will stop at its next safe checkpoint.')
                await refresh()
              } catch (e) { setError(e instanceof Error ? e.message : 'Could not stop workflow') }
            }}
            onVerify={async () => {
              if (!selected) return
              try {
                const verification = await api.verifyTask(selected.id)
                setNotice(`${verification.findings.length} findings checked. Demo evidence is always marked demo, not verified.`)
                await openTask(selected)
              } catch (e) { setError(e instanceof Error ? e.message : 'Verification failed') }
            }}
            onReport={async () => {
              if (!selected) return
              try {
                await api.createReport(selected.id, 'research_summary')
                setNotice('Research report saved.')
                setPage('Reports')
              } catch (e) { setError(e instanceof Error ? e.message : 'Report generation failed') }
            }} />
        )}
        {page === 'Research' && <Research sources={sources} selected={selected} />}
        {page === 'Comparison' && <Comparison result={result} selected={selected} />}
        {page === 'Browser Companion' && <BrowserPage />}
        {page === 'Agent Monitor' && <AgentMonitor />}
        {page === 'History' && <HistoryPage tasks={tasks} openTask={openTask} removeTask={removeTask} clearHistory={clearHistory} />}
        {page === 'Reports' && <ReportsPage tasks={tasks} />}
        {page === 'Templates' && <TemplatesPage onUse={text => { setInstruction(text); setPage('Dashboard') }} />}
        {page === 'Trust & Security' && <TrustPage notice={notice} setNotice={setNotice} />}
        {page === 'Analytics' && <AnalyticsPage />}
        {page === 'Settings' && <SettingsPage clearHistory={clearHistory} />}
        {notice && <div className="notice-banner">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      </main>
    </div>
  )
}

function AuthScreen({ loading, onAuthenticated }: {
  loading?: boolean
  onAuthenticated?: (user: { id: string; email: string; display_name: string }) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = mode === 'register'
        ? await api.register(email, password, displayName)
        : await api.login(email, password)
      if (response.session) {
        onAuthenticated?.(response.user)
      } else {
        setMessage(response.message || 'Check your email to confirm your account, then sign in.')
        setMode('login')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="auth-page"><div className="auth-card">Checking your Supabase session…</div></div>
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><span className="brand-mark"><Sparkles size={19} /></span><strong>WebPilot AI</strong></div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>Sign in securely with your Supabase account.</p>
        {mode === 'register' && (
          <label>Display name
            <input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} />
          </label>
        )}
        <label>Email
          <input type="email" autoComplete="email" required value={email}
            onChange={event => setEmail(event.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 10 : 1} required value={password}
            onChange={event => setPassword(event.target.value)} />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status">{message}</div>}
        <button className="primary-button auth-submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button className="auth-switch" type="button" onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError('')
          setMessage('')
        }}>
          {mode === 'login' ? 'New to WebPilot? Create an account' : 'Already registered? Sign in'}
        </button>
      </form>
    </div>
  )
}

function Dashboard({ tasks, completed, active, instruction, setInstruction, runTask, openTask, executing, startVoice }: {
  tasks: Task[]; completed: number; active: number; instruction: string;
  setInstruction: (v: string) => void; runTask: (v?: string) => void;
  openTask: (t: Task) => void; executing: boolean; startVoice: () => void
}) {
  const examples = [
    { icon: Search, title: 'Find opportunities', text: 'Find five machine learning internships for engineering students', color: 'blue' },
    { icon: GitCompareArrows, title: 'Compare options', text: 'Compare the best AI tools for university students', color: 'violet' },
    { icon: Globe2, title: 'Summarize research', text: 'Summarize recent trends in renewable energy', color: 'cyan' },
  ]
  return (
    <div className="content">
      <section className="welcome">
        <div className="welcome-copy">
          <span className="welcome-icon"><Sparkles size={18} /></span>
          <div><h2>Good evening, explorer</h2><p>What would you like to research today?</p></div>
        </div>
        <button className="primary-button" onClick={() => document.querySelector<HTMLTextAreaElement>('.task-input')?.focus()}>
          <Plus size={17} /> New task
        </button>
      </section>

      <section className="task-composer">
        <div className="composer-heading"><MessageSquareText size={17} /><span>Describe your research task</span><button className="voice-button" onClick={startVoice}><Mic size={14} /> Voice input</button></div>
        <textarea className="task-input" value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder="Ask WebPilot to search, compare, summarize, or research anything..."
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask() } }} />
        <div className="composer-footer">
          <span><ShieldCheck size={15} /> Safe browsing enabled</span>
          <button className="send-button" disabled={executing || !instruction.trim()} onClick={() => runTask()}>
            {executing ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Run task
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Total tasks" value={tasks.length} change="All time" icon={Clock3} color="blue" />
        <StatCard label="Completed" value={completed} change="All time" icon={CheckCircle2} color="green" />
        <StatCard label="Active" value={active} change="Now" icon={LoaderCircle} color="violet" />
      </section>

      <section>
        <div className="section-heading"><div><h3>Quick actions</h3><p>Start with a common research workflow</p></div></div>
        <div className="quick-grid">
          {examples.map(item => (
            <button className="quick-card" key={item.title} onClick={() => setInstruction(item.text)}>
              <div className={`quick-icon ${item.color}`}><item.icon size={20} /></div>
              <div><h4>{item.title}</h4><p>{item.text}</p></div>
              <ArrowUpRight size={17} className="quick-arrow" />
            </button>
          ))}
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading"><div><h3>Recent tasks</h3><p>Your latest research activity</p></div></div>
        <div className="recent-list">
          {tasks.length === 0 ? (
            <div className="empty-state"><Search size={22} /><p>No tasks yet. Start your first research task above.</p></div>
          ) : tasks.slice(0, 5).map(task => (
            <button className="recent-row" key={task.id} onClick={() => openTask(task)}>
              <div className={`task-status ${task.status}`}><TaskStatusIcon status={task.status} /></div>
              <div className="recent-text"><strong>{task.instruction}</strong><span>{new Date(task.created_at).toLocaleString()}</span></div>
              <span className={`status-pill ${task.status}`}>{task.status}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, change, icon: Icon, color }: {
  label: string; value: number; change: string; icon: typeof Clock3; color: string
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}><Icon size={19} /></div>
      <div><span>{label}</span><strong>{value}</strong></div>
      <small>{change}</small>
    </div>
  )
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 size={17} />
  if (status === 'running') return <LoaderCircle className="spin" size={17} />
  if (status === 'failed') return <Circle size={17} />
  return <Clock3 size={17} />
}

function Assistant({ selected, result, sources, executing, instruction, setInstruction, runTask,
  startVoice, speakSummary, stopVoice, onVerify, onReport, onCancel }: {
  selected: Task | null; result: Result | null; sources: Source[]; executing: boolean;
  instruction: string; setInstruction: (v: string) => void; runTask: (v?: string) => void
  startVoice: () => void; speakSummary: () => void; stopVoice: () => void
  onVerify: () => void; onReport: () => void; onCancel: () => void
}) {
  const plan = result?.plan || selected?.plan || []
  return (
    <div className="assistant-layout">
      <div className="chat-column">
        <div className="chat-history">
          {!selected ? (
            <div className="assistant-empty">
              <div className="ai-orb"><Sparkles size={28} /></div>
              <h2>How can I help you explore?</h2>
              <p>Give me a research goal and I’ll build a plan, inspect sources, and compare findings.</p>
            </div>
          ) : (
            <>
              <div className="user-message"><div className="avatar small">SK</div><p>{selected.instruction}</p></div>
              <div className="ai-message">
                <div className="ai-mini"><Sparkles size={16} /></div>
                <div>
                  <span className="message-name">WebPilot AI</span>
                  {executing ? (
                    <div className="thinking"><LoaderCircle className="spin" size={16} /> Researching sources…</div>
                  ) : result ? (
                    <>
                      {result.mode === 'demo' && <div className="demo-note">Demo analysis — sample sources, not live verified facts</div>}
                      <p>{result.summary}</p>
                      {result.recommendations.length > 0 && (
                        <div className="recommendations">
                          <strong>Recommendations</strong>
                          {result.recommendations.map((item, i) => <span key={i}><CheckCircle2 size={14} /> {item}</span>)}
                        </div>
                      )}
                      <div className="assistant-actions">
                        <button onClick={onVerify}><ShieldCheck size={14} /> Verify sources</button>
                        <button onClick={onReport}><FileText size={14} /> Generate report</button>
                        <button onClick={speakSummary}><Volume2 size={14} /> Read summary</button>
                        <button onClick={stopVoice}><VolumeX size={14} /> Stop audio</button>
                      </div>
                    </>
                  ) : selected.status === 'cancelled' ? <p>This workflow was cancelled at a safe checkpoint.</p>
                    : <p>The task is preparing. Execution will begin when you submit it.</p>}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="chat-composer">
          <textarea value={instruction} onChange={e => setInstruction(e.target.value)}
            placeholder="Ask for a comparison, summary, or research task..."
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask() } }} />
          <button disabled={executing || !instruction.trim()} onClick={() => runTask()}><Send size={17} /></button>
          <button onClick={startVoice} aria-label="Voice input"><Mic size={17} /></button>
        </div>
      </div>

      <aside className="execution-panel">
        <div className="panel-heading"><div><h3>Execution plan</h3><p>{selected ? selected.status : 'Waiting for task'}</p></div>
          {selected && <span className={`status-pill ${selected.status}`}>{selected.status}</span>}
        </div>
        {selected?.status === 'running' && <button className="danger-button cancel-workflow" onClick={onCancel}>Stop workflow</button>}
        <div className="plan-list">
          {plan.length ? plan.map((step, i) => (
            <div className={`plan-step ${step.status}`} key={step.title}>
              <div className="step-index">{step.status === 'completed' ? <CheckCircle2 size={15} /> :
                step.status === 'running' ? <LoaderCircle className="spin" size={15} /> : i + 1}</div>
              <div><strong>{step.title}</strong><span>{step.status}</span></div>
            </div>
          )) : (
            ['Analyze intent', 'Generate search queries', 'Inspect sources', 'Compare evidence', 'Create findings']
              .map((step, i) => <div className="plan-step pending" key={step}><div className="step-index">{i + 1}</div><div><strong>{step}</strong><span>pending</span></div></div>)
          )}
        </div>
        {sources.length > 0 && <div className="source-count"><Globe2 size={16} /><span>{sources.length} sources discovered</span></div>}
      </aside>
    </div>
  )
}

function Research({ sources, selected }: { sources: Source[]; selected: Task | null }) {
  return (
    <div className="content">
      <div className="workspace-heading">
        <div><h2>Research workspace</h2><p>{selected ? 'Evidence collected for this task' : 'Select or run a task to inspect discovered sources'}</p></div>
        {selected && <span className={`status-pill ${selected.status}`}>{selected.status}</span>}
      </div>
      {sources.length === 0 ? <div className="large-empty"><FlaskConical size={28} /><h3>No research sources yet</h3><p>Run a task from the assistant to discover and extract web sources.</p></div> :
        <div className="source-grid">
          {sources.map(source => (
            <article className="source-card" key={source.id}>
              <div className="source-top"><div className="source-icon"><Globe2 size={18} /></div><a href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a></div>
              <h3>{source.title}</h3>
              <a className="source-url" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
              <p>{source.extracted_content}</p>
              <div className="source-footer"><ShieldCheck size={14} /> Evidence excerpt</div>
            </article>
          ))}
        </div>}
    </div>
  )
}

function Comparison({ result, selected }: { result: Result | null; selected: Task | null }) {
  const rows = result?.comparison_data || []
  return (
    <div className="content">
      <div className="workspace-heading"><div><h2>Smart comparison</h2><p>{selected ? selected.instruction : 'Structured findings from your research'}</p></div>
        {result?.mode === 'demo' && <span className="demo-badge"><span /> Demo data</span>}
      </div>
      {rows.length === 0 ? <div className="large-empty"><GitCompareArrows size={28} /><h3>No comparison available</h3><p>Run a comparison task to populate this workspace.</p></div> :
        <div className="comparison-table">
          <div className="comparison-header"><span>Option</span><span>Summary</span><span>Requirements</span><span>Details</span><span>Source</span></div>
          {rows.map((row, i) => (
            <div className="comparison-row" key={i}>
              <strong>{row.name || `Option ${i + 1}`}</strong>
              <span>{row.summary || 'Not specified'}</span>
              <span>{row.requirements || 'Not specified'}</span>
              <span>{row.details || 'Not specified'}</span>
              <a href={row.source} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
            </div>
          ))}
        </div>}
    </div>
  )
}

function BrowserPage() {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setTitle(params.get('browser_title') || '')
    setUrl(params.get('browser_url') || '')
    setText(params.get('browser_content') || '')
  }, [])

  const analyze = async () => {
    if (!url || !text) {
      setNotice('No active-page content is available. Open a webpage with the Chrome extension and choose “Send to workspace”.')
      return
    }
    setLoading(true)
    setAnswer('')
    try {
      const result = await api.analyzeBrowserPage(title, url, text, question)
      setAnswer(`${result.answer}\n\n${result.notice}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not analyze the webpage')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="content">
      <div className="workspace-heading">
        <div><h2>Browser companion</h2><p>Analyze a page explicitly shared from the Chrome extension.</p></div>
        <span className={`status-pill ${url ? 'completed' : 'pending'}`}>{url ? 'Page received' : 'Disconnected'}</span>
      </div>
      {notice && <p className="inline-error">{notice}</p>}
      {!url ? (
        <div className="large-empty"><Monitor size={28} /><h3>Extension page not connected</h3>
          <p>Install and enable the WebPilot extension, then use “Send to workspace” on an active webpage.</p>
        </div>
      ) : (
        <div className="browser-grid">
          <section className="settings-card">
            <div className="settings-card-heading"><div className="settings-icon cyan"><Globe2 size={18} /></div>
              <div><h3>{title || 'Current webpage'}</h3><p>{new URL(url).hostname}</p></div></div>
            <a className="source-url" href={url} target="_blank" rel="noreferrer">{url}</a>
            <h4 className="subsection-title">Shared excerpt</h4>
            <p className="browser-excerpt">{text}</p>
          </section>
          <section className="settings-card">
            <div className="settings-card-heading"><div className="settings-icon"><Sparkles size={18} /></div>
              <div><h3>Ask this page</h3><p>Leave blank to summarize extracted text</p></div></div>
            <textarea className="preferences-input" value={question} onChange={event => setQuestion(event.target.value)}
              placeholder="What are the main eligibility requirements?" />
            <button className="send-button" disabled={loading} onClick={analyze}>
              {loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Analyze page
            </button>
            {answer && <pre className="browser-answer">{answer}</pre>}
          </section>
        </div>
      )}
    </div>
  )
}

function AgentMonitor() {
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof api.agents>>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = () => {
      api.agents().then(data => { if (active) setAgents(data) })
        .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load agent activity') })
        .finally(() => { if (active) setLoading(false) })
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  return (
    <div className="content">
      <div className="workspace-heading"><div><h2>Agent monitor</h2><p>Execution records from the backend workflow service</p></div></div>
      {loading && <div className="large-empty"><LoaderCircle className="spin" size={28} /><h3>Loading agent activity</h3></div>}
      {error && <p className="inline-error">{error}</p>}
      {!loading && agents.length === 0 && <div className="large-empty"><Bot size={28} /><h3>No agent executions yet</h3><p>Run a task to create backend agent records.</p></div>}
      <div className="agent-grid">
        {agents.map(agent => (
          <article className="settings-card agent-card" key={agent.id}>
            <div className="settings-card-heading"><div className="settings-icon violet"><Bot size={18} /></div>
              <div><h3>{agent.agent} agent</h3><p>{agent.step.replaceAll('_', ' ')}</p></div>
              <span className={`status-pill ${agent.status === 'completed' ? 'completed' : agent.status === 'failed' ? 'failed' : 'pending'}`}>{agent.status}</span>
            </div>
            <div className="agent-meta"><span>Attempts: {agent.attempts}</span><span>Updated: {new Date(agent.updated_at).toLocaleString()}</span></div>
            {agent.error && <p className="agent-error">{agent.error}</p>}
            {Object.keys(agent.output).length > 0 && <pre className="agent-output">{JSON.stringify(agent.output, null, 2)}</pre>}
          </article>
        ))}
      </div>
    </div>
  )
}

function HistoryPage({ tasks, openTask, removeTask, clearHistory }: {
  tasks: Task[]; openTask: (task: Task) => void;
  removeTask: (id: string) => void; clearHistory: () => void
}) {
  return (
    <div className="content">
      <div className="workspace-heading">
        <div><h2>Task history</h2><p>Review and reopen previous research tasks</p></div>
        {tasks.length > 0 && <button className="danger-button" onClick={clearHistory}><Trash2 size={15} /> Clear history</button>}
      </div>
      {tasks.length === 0 ? (
        <div className="large-empty"><History size={28} /><h3>No task history</h3><p>Completed and pending tasks will appear here.</p></div>
      ) : (
        <div className="history-list">
          {tasks.map(task => (
            <article className="history-row" key={task.id}>
              <button className="history-main" onClick={() => openTask(task)}>
                <div className={`task-status ${task.status}`}><TaskStatusIcon status={task.status} /></div>
                <div><strong>{task.instruction}</strong><span>{new Date(task.created_at).toLocaleString()} · {task.mode} mode</span></div>
                <span className={`status-pill ${task.status}`}>{task.status}</span>
                <ChevronRight size={16} />
              </button>
              <button className="delete-button" onClick={() => removeTask(task.id)} aria-label="Delete task"><Trash2 size={15} /></button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsPage({ clearHistory }: { clearHistory: () => void }) {
  const [preferences, setPreferences] = useState('')
  const [saved, setSaved] = useState(false)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)

  useEffect(() => {
    let active = true
    api.preferences().then(value => {
      if (active) setPreferences(value.research_interests || '')
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    api.health().then(value => { if (active) setHealth(value) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  return (
    <div className="content settings-content">
      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon"><KeyRound size={18} /></div><div><h3>AI provider</h3><p>Configure credentials in the backend environment</p></div></div>
          <div className="setting-row"><div><strong>Provider</strong><span>{health?.providers.llm.provider || 'Checking backend…'}</span></div>
            <span className="status-pill pending">{health?.providers.llm.provider === 'demo' ? 'Demo' : health?.providers.llm.configured ? 'Configured' : 'Missing key'}</span></div>
          <div className="setting-row"><div><strong>Model</strong><span>Selected in backend .env</span></div></div>
          <code className="env-hint">OPENAI_API_KEY=your-key<br />LLM_PROVIDER=openai</code>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon cyan"><Search size={18} /></div><div><h3>Web search</h3><p>Set a configurable search provider</p></div></div>
          <div className="setting-row"><div><strong>Provider</strong><span>{health?.providers.search.provider || 'Checking backend…'}</span></div>
            <span className="status-pill pending">{health?.providers.search.provider === 'demo' ? 'Demo' : health?.providers.search.configured ? 'Configured' : 'Missing key'}</span></div>
          <code className="env-hint">SEARCH_PROVIDER=tavily<br />TAVILY_API_KEY=your-key</code>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon green"><Database size={18} /></div><div><h3>Research data</h3><p>Task history is scoped to your account</p></div></div>
          <div className="setting-row"><div><strong>Database</strong><span>{health?.providers.database || 'Checking backend…'}</span></div>
            <span className="status-pill pending">{health?.providers.database === 'postgresql' ? 'PostgreSQL' : 'Local SQLite'}</span></div>
          <div className="setting-row"><div><strong>Authentication</strong><span>Supabase Auth</span></div>
            <span className="status-pill pending">{health?.providers.auth.configured ? 'Configured' : 'Missing config'}</span></div>
          <button className="danger-button full" onClick={clearHistory}><Trash2 size={15} /> Clear all task history</button>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon violet"><ShieldCheck size={18} /></div><div><h3>Privacy & safety</h3><p>Research data and browser controls</p></div></div>
          <div className="privacy-list">
            <span><CheckCircle2 size={15} /> API keys remain on the backend</span>
            <span><CheckCircle2 size={15} /> No automated purchases or form submissions</span>
            <span><CheckCircle2 size={15} /> Extracted content is saved to your account</span>
            <span><CheckCircle2 size={15} /> Source restrictions and timeouts are respected</span>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon"><Sparkles size={18} /></div><div><h3>Research preferences</h3><p>Only save preferences you explicitly choose</p></div></div>
          <label className="preference-label" htmlFor="research-preferences">Research interests</label>
          <textarea id="research-preferences" className="preferences-input" value={preferences}
            maxLength={1000} placeholder="For example: prefer official sources; focus on student opportunities"
            onChange={event => { setPreferences(event.target.value); setSaved(false) }} />
          <button className="send-button" onClick={async () => {
            try {
              await api.savePreferences({ research_interests: preferences })
              setSaved(true)
            } catch { setSaved(false) }
          }}>Save preferences</button>
          {saved && <span className="saved-label">Preferences saved to your account.</span>}
        </section>
      </div>
    </div>
  )
}

function ReportsPage({ tasks }: { tasks: Task[] }) {
  const [reports, setReports] = useState<{ id: string; task_id: string; title: string; report_type: string }[]>([])
  const [error, setError] = useState('')
  const load = () => api.reports().then(setReports).catch(e => setError(e instanceof Error ? e.message : 'Could not load reports'))
  useEffect(() => { load() }, [])
  const create = async (task: Task) => {
    try { await api.createReport(task.id, 'research_summary'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create report') }
  }
  const download = async (id: string, format: 'csv' | 'pdf') => {
    try {
      const blob = await api.exportReport(id, format)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `webpilot-report.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed') }
  }
  return (
    <div className="content">
      <div className="workspace-heading"><div><h2>Research reports</h2><p>Generate reports from completed tasks and export findings.</p></div></div>
      {error && <p className="inline-error">{error}</p>}
      <div className="report-create-list">
        {tasks.filter(task => task.status === 'completed').map(task => (
          <div className="report-task" key={task.id}>
            <span>{task.instruction}</span>
            <button className="secondary-button" onClick={() => create(task)}><Plus size={14} /> Generate report</button>
          </div>
        ))}
        {!tasks.some(task => task.status === 'completed') && <div className="large-empty"><FileText size={28} /><h3>No completed tasks</h3><p>Finish a research task to generate a report.</p></div>}
      </div>
      <h3 className="subsection-title">Saved reports</h3>
      <div className="recent-list">
        {reports.map(report => (
          <div className="report-task" key={report.id}><div><strong>{report.title}</strong><small>{report.report_type.replaceAll('_', ' ')}</small></div>
            <div className="report-actions"><button className="secondary-button" onClick={() => download(report.id, 'csv')}>Export CSV</button><button className="secondary-button" onClick={() => download(report.id, 'pdf')}>Export PDF</button>
              <button className="danger-button" onClick={async () => {
                if (!window.confirm('Delete this report?')) return
                await api.deleteReport(report.id)
                await load()
              }}>Delete</button></div>
          </div>
        ))}
        {reports.length === 0 && <div className="empty-state"><p>No saved reports yet.</p></div>}
      </div>
    </div>
  )
}

function TemplatesPage({ onUse }: { onUse: (instruction: string) => void }) {
  const [templates, setTemplates] = useState<{ id: string; name: string; instruction: string }[]>([])
  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')
  const load = () => api.templates().then(setTemplates).catch(e => setError(e instanceof Error ? e.message : 'Could not load templates'))
  useEffect(() => { load() }, [])
  return (
    <div className="content">
      <div className="workspace-heading"><div><h2>Workflow templates</h2><p>Save reusable research prompts for later.</p></div></div>
      <section className="settings-card template-form">
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Template name" />
        <textarea value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={4000} placeholder="Describe the research workflow..." />
        <button className="primary-button" disabled={!name.trim() || instruction.trim().length < 3} onClick={async () => {
          try { await api.createTemplate(name.trim(), instruction.trim()); setName(''); setInstruction(''); await load() }
          catch (e) { setError(e instanceof Error ? e.message : 'Could not save template') }
        }}>Save template</button>
      </section>
      {error && <p className="inline-error">{error}</p>}
      <div className="template-list">
        {templates.map(template => (
          <article className="settings-card template-card" key={template.id}>
            <h3>{template.name}</h3><p>{template.instruction}</p>
            <div className="report-actions"><button className="secondary-button" onClick={() => onUse(template.instruction)}>Use template</button>
              <button className="danger-button" onClick={async () => { await api.deleteTemplate(template.id); await load() }}>Delete</button></div>
          </article>
        ))}
        {templates.length === 0 && <div className="large-empty"><Workflow size={28} /><h3>No saved workflows</h3><p>Create a template to reuse a research configuration.</p></div>}
      </div>
    </div>
  )
}

function TrustPage({ notice, setNotice }: { notice: string; setNotice: (value: string) => void }) {
  const [audit, setAudit] = useState<{ id: number; event_type: string; details: Record<string, unknown>; created_at: string }[]>([])
  const [approvals, setApprovals] = useState<{ id: string; action: string; status: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const [auditData, approvalData] = await Promise.all([api.audit(), api.approvals()])
      setAudit(auditData); setApprovals(approvalData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load security activity') }
  }
  useEffect(() => { load() }, [])
  return (
    <div className="content">
      <div className="workspace-heading"><div><h2>Trust &amp; security</h2><p>Your activity log and explicit approval records. Approvals do not execute external actions.</p></div></div>
      {error && <p className="inline-error">{error}</p>}
      <section className="settings-card approval-section">
        <div className="section-heading"><div><h3>Approval centre</h3><p>Approve/reject requests are recorded only; no action is triggered.</p></div>
          <button className="secondary-button" onClick={async () => { try { await api.requestApproval('Example user-controlled action'); setNotice('Approval request added. No external action will be performed.'); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not request approval') } }}>Create sample request</button>
        </div>
        {approvals.map(item => <div className="audit-row" key={item.id}><span>{item.action}</span><span className={`status-pill ${item.status === 'approved' ? 'completed' : item.status === 'pending' ? 'pending' : 'failed'}`}>{item.status}</span>
          {item.status === 'pending' && <div className="report-actions">
            <button className="secondary-button" onClick={async () => { await api.decideApproval(item.id, 'approved'); await load() }}>Approve</button>
            <button className="danger-button" onClick={async () => { await api.decideApproval(item.id, 'rejected'); await load() }}>Reject</button>
          </div>}
        </div>)}
        {approvals.length === 0 && <div className="empty-state"><p>No approvals pending.</p></div>}
      </section>
      <h3 className="subsection-title">Browser and workflow activity</h3>
      <div className="recent-list">
        {audit.map(item => <div className="audit-row" key={item.id}><div><strong>{item.event_type.replaceAll('_', ' ')}</strong><small>{JSON.stringify(item.details)}</small></div><time>{new Date(item.created_at).toLocaleString()}</time></div>)}
        {audit.length === 0 && <div className="empty-state"><p>No activity recorded yet.</p></div>}
      </div>
      {notice && <span className="saved-label">{notice}</span>}
    </div>
  )
}

function AnalyticsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics>> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.analytics().then(value => { if (active) setData(value) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load analytics') })
    return () => { active = false }
  }, [])
  if (error) return <div className="content"><p className="inline-error">{error}</p></div>
  if (!data) return <div className="content"><div className="large-empty"><LoaderCircle className="spin" size={28} /><h3>Loading analytics</h3></div></div>
  const stats = [
    ['Total workflows', data.total_workflows], ['Completed workflows', data.completed_workflows],
    ['Failed workflows', data.failed_workflows], ['Sources collected', data.sources_collected],
    ['Verified findings', data.verified_findings], ['Agent executions', data.agent_executions],
  ] as const
  return <div className="content"><div className="workspace-heading"><div><h2>Workflow analytics</h2><p>Metrics from your persisted account records</p></div></div>
    <div className="analytics-grid">{stats.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong></div></div>)}
      <div className="stat-card"><div><span>Average execution time</span><strong>{data.average_execution_seconds === null ? '—' : `${data.average_execution_seconds}s`}</strong></div></div></div>
    <p className="metrics-note">{data.calculation_notes}</p>
  </div>
}

export default App
