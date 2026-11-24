import type { Result, Source, Task } from '../types'

type DemoReport = {
  id: string
  task_id: string
  title: string
  report_type: string
  content: Record<string, unknown>
}

type DemoTemplate = { id: string; name: string; instruction: string }
type DemoApproval = {
  id: string
  action: string
  details: Record<string, unknown>
  status: string
  created_at: string
}
type DemoAuditEvent = {
  id: number
  task_id: string | null
  event_type: string
  details: Record<string, unknown>
  created_at: string
}

type DemoStore = {
  tasks: Task[]
  results: Record<string, Result>
  sources: Record<string, Source[]>
  reports: DemoReport[]
  templates: DemoTemplate[]
  preferences: Record<string, string>
  approvals: DemoApproval[]
  audit: DemoAuditEvent[]
}

const STORAGE_KEY = 'webpilot-demo-data'
const planTitles = ['Analyze intent', 'Generate search queries', 'Inspect sources', 'Compare evidence', 'Create findings']

function makePlan(): Task['plan'] {
  return planTitles.map(title => ({ title, status: 'completed' }))
}

function sampleResult(instruction: string, id: string): { result: Result; sources: Source[] } {
  const topic = instruction.replace(/[.!?]+$/, '').trim()
  const options = [
    { name: 'Research Option A', summary: 'A sample option for exploring the topic.', requirements: 'Review the official information before deciding.', details: 'Demo comparison point; no live data was retrieved.', source: `https://source-a.example/${id}` },
    { name: 'Research Option B', summary: 'An alternative sample for side-by-side comparison.', requirements: 'Check current eligibility and availability.', details: 'Demo comparison point; no live data was retrieved.', source: `https://source-b.example/${id}` },
    { name: 'Research Option C', summary: 'A third sample to help illustrate the comparison view.', requirements: 'Confirm details with a primary source.', details: 'Demo comparison point; no live data was retrieved.', source: `https://source-c.example/${id}` },
  ]
  const sources: Source[] = options.map((option, index) => ({
    id: index + 1,
    title: option.name,
    url: option.source,
    extracted_content: `Sample evidence for “${topic}”. This fictional demo excerpt demonstrates how WebPilot presents source material. It is not a real webpage or verified information.`,
  }))

  return {
    result: {
      summary: `Demo analysis for “${topic}”. This sample shows how WebPilot can organize a research request into comparable options. No live search or AI service was used, and these examples are not verified facts.`,
      comparison_data: options,
      recommendations: [
        'Use the comparison as a starting point, then verify details with official sources.',
        'Check current requirements and dates before making a decision.',
        'Connect live search and AI providers when you are ready to move beyond the demo.',
      ],
      plan: makePlan(),
      mode: 'demo',
    },
    sources,
  }
}

function makeSeedTask(id: string, instruction: string, hoursAgo: number): Task {
  const now = Date.now() - hoursAgo * 60 * 60 * 1000
  return {
    id,
    instruction,
    status: 'completed',
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    plan: makePlan(),
    mode: 'demo',
  }
}

function initialStore(): DemoStore {
  const tasks = [
    makeSeedTask('demo-task-1', 'Compare AI note-taking tools for university students', 3),
    makeSeedTask('demo-task-2', 'Explore beginner-friendly machine learning courses', 22),
  ]
  const results: DemoStore['results'] = {}
  const sources: DemoStore['sources'] = {}
  tasks.forEach(task => {
    const sample = sampleResult(task.instruction, task.id)
    results[task.id] = sample.result
    sources[task.id] = sample.sources
  })

  return {
    tasks,
    results,
    sources,
    reports: [],
    templates: [
      { id: 'template-compare', name: 'Compare options', instruction: 'Compare the leading options for [topic]. Summarize pros, considerations, and what to verify.' },
      { id: 'template-research', name: 'Explore a topic', instruction: 'Give me a beginner-friendly overview of [topic], with key themes and questions for further research.' },
      { id: 'template-opportunities', name: 'Find opportunities', instruction: 'Find and compare opportunities for [audience] interested in [field]. Include requirements to verify.' },
    ],
    preferences: {},
    approvals: [],
    audit: [],
  }
}

function readStore(): DemoStore {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return initialStore()
  try {
    return JSON.parse(saved) as DemoStore
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return initialStore()
  }
}

function writeStore(store: DemoStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseBody(options?: RequestInit): Record<string, unknown> {
  if (typeof options?.body !== 'string') return {}
  try {
    return JSON.parse(options.body) as Record<string, unknown>
  } catch {
    return {}
  }
}

function addAudit(store: DemoStore, event: string, taskId: string | null, details: Record<string, unknown> = {}): void {
  store.audit.unshift({
    id: Date.now(),
    task_id: taskId,
    event_type: event,
    details,
    created_at: new Date().toISOString(),
  })
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function makePdf(text: string): string {
  const lines = text.split(/\r?\n/).flatMap(line => {
    let remaining = line.replace(/[^\x20-\x7e]/g, '?')
    const wrapped: string[] = []
    while (remaining.length > 92) {
      const splitAt = remaining.lastIndexOf(' ', 92)
      const length = splitAt > 0 ? splitAt : 92
      wrapped.push(remaining.slice(0, length))
      remaining = remaining.slice(length).trimStart()
    }
    wrapped.push(remaining)
    return wrapped
  }).slice(0, 38)
  const commands = lines.map((line, index) => {
    const escaped = line.replace(/[\\()]/g, '\\$&')
    return `${index ? '0 -18 Td\n' : ''}(${escaped}) Tj`
  }).join('\n')
  const stream = `BT\n/F1 11 Tf\n50 780 Td\n${commands}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(document.length)
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = document.length
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => {
    document += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return document
}

export async function handleDemoRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = new URL(path, 'http://webpilot.local')
  const pathname = url.pathname
  const method = options?.method?.toUpperCase() ?? 'GET'
  const body = parseBody(options)
  const store = readStore()
  const taskRoute = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/)
  const reportRoute = pathname.match(/^\/api\/reports\/([^/]+)(?:\/([^/]+))?$/)
  const templateRoute = pathname.match(/^\/api\/templates\/([^/]+)$/)
  const approvalDecisionRoute = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/)

  if (pathname === '/api/auth/me' && method === 'GET') {
    return jsonResponse({ id: 'demo-user', email: 'demo@webpilot.example', display_name: 'Demo Explorer' })
  }
  if (['/api/auth/login', '/api/auth/register'].includes(pathname) && method === 'POST') {
    const email = typeof body.email === 'string' ? body.email : 'demo@webpilot.example'
    const displayName = typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name
      : 'Demo Explorer'
    return jsonResponse({
      user: { id: 'demo-user', email, display_name: displayName },
      session: { access_token: 'demo-token', refresh_token: 'demo-refresh', token_type: 'bearer' },
      message: null,
    })
  }
  if (pathname === '/api/auth/logout' && method === 'POST') return jsonResponse({ success: true })
  if (pathname === '/api/health' && method === 'GET') {
    return jsonResponse({
      status: 'ok',
      providers: {
        llm: { provider: 'demo', configured: true },
        search: { provider: 'demo', configured: true },
        auth: { provider: 'demo', configured: true },
        database: 'local demo storage',
      },
    })
  }

  if (pathname === '/api/tasks' && method === 'GET') return jsonResponse(store.tasks)
  if (pathname === '/api/tasks' && method === 'POST') {
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (instruction.length < 3) return jsonResponse({ detail: 'Enter a research task with at least 3 characters.' }, 422)
    const id = `demo-${Date.now()}`
    const now = new Date().toISOString()
    const task: Task = {
      id,
      instruction,
      status: 'pending',
      created_at: now,
      updated_at: now,
      plan: planTitles.map(title => ({ title, status: 'pending' })),
      mode: 'demo',
    }
    store.tasks.unshift(task)
    addAudit(store, 'demo_task_created', id, { instruction })
    writeStore(store)
    return jsonResponse(task)
  }
  if (pathname === '/api/tasks' && method === 'DELETE') {
    store.tasks = []
    store.results = {}
    store.sources = {}
    store.reports = []
    writeStore(store)
    return jsonResponse({ deleted: true })
  }

  if (taskRoute) {
    const [, id, action] = taskRoute
    const taskIndex = store.tasks.findIndex(task => task.id === id)
    if (taskIndex < 0) return jsonResponse({ detail: 'Demo task not found.' }, 404)
    const task = store.tasks[taskIndex]

    if (!action && method === 'GET') return jsonResponse(task)
    if (!action && method === 'DELETE') {
      store.tasks.splice(taskIndex, 1)
      delete store.results[id]
      delete store.sources[id]
      store.reports = store.reports.filter(report => report.task_id !== id)
      writeStore(store)
      return jsonResponse({ deleted: true })
    }
    if (action === 'execute' && method === 'POST') {
      await new Promise(resolve => window.setTimeout(resolve, 700))
      const sample = sampleResult(task.instruction, task.id)
      const completed: Task = { ...task, status: 'completed', updated_at: new Date().toISOString(), plan: makePlan() }
      store.tasks[taskIndex] = completed
      store.results[id] = sample.result
      store.sources[id] = sample.sources
      addAudit(store, 'demo_task_completed', id)
      writeStore(store)
      return jsonResponse(completed)
    }
    if (action === 'cancel' && method === 'POST') {
      const cancelled: Task = { ...task, status: 'cancelled', updated_at: new Date().toISOString() }
      store.tasks[taskIndex] = cancelled
      writeStore(store)
      return jsonResponse({ id, status: 'cancelled' })
    }
    if (action === 'results' && method === 'GET') {
      return store.results[id] ? jsonResponse(store.results[id]) : jsonResponse({ detail: 'Demo results are not ready.' }, 404)
    }
    if (action === 'sources' && method === 'GET') return jsonResponse(store.sources[id] ?? [])
    if (action === 'verify' && method === 'POST') {
      const result = store.results[id]
      return jsonResponse({
        findings: (result?.recommendations ?? []).map(claim => ({
          claim,
          confidence: 0,
          verification_status: 'demo',
          source_url: null,
        })),
      })
    }
    if (action === 'reports' && method === 'POST') {
      const report: DemoReport = {
        id: `report-${Date.now()}`,
        task_id: id,
        title: `Demo report: ${task.instruction.slice(0, 60)}`,
        report_type: url.searchParams.get('report_type') || 'research_summary',
        content: { summary: store.results[id]?.summary ?? 'No demo results available.' },
      }
      store.reports.unshift(report)
      writeStore(store)
      return jsonResponse(report)
    }
  }

  if (pathname === '/api/analytics' && method === 'GET') {
    return jsonResponse({
      total_workflows: store.tasks.length,
      completed_workflows: store.tasks.filter(task => task.status === 'completed').length,
      failed_workflows: 0,
      average_execution_seconds: 0.7,
      sources_collected: Object.values(store.sources).reduce((total, sources) => total + sources.length, 0),
      verified_findings: 0,
      agent_executions: store.tasks.filter(task => task.status === 'completed').length * 5,
      calculation_notes: 'Local demo metrics; sample research is not live or verified.',
    })
  }
  if (pathname === '/api/agents' && method === 'GET') {
    return jsonResponse(store.tasks.filter(task => task.status === 'completed').flatMap((task, taskIndex) =>
      planTitles.map((step, index) => ({
        id: taskIndex * planTitles.length + index + 1,
        task_id: task.id,
        agent: ['Planner', 'Search', 'Research', 'Analysis', 'Writer'][index],
        step: step.toLowerCase().replaceAll(' ', '_'),
        status: 'completed',
        attempts: 1,
        error: '',
        output: { demo: true, note: 'Sample activity only; no live agent executed.' },
        created_at: task.created_at,
        updated_at: task.updated_at,
      })),
    ))
  }
  if (pathname === '/api/browser/analyze' && method === 'POST') {
    const title = typeof body.title === 'string' ? body.title : 'Shared webpage'
    const question = typeof body.question === 'string' && body.question.trim()
      ? `For “${body.question.trim()}”, `
      : ''
    return jsonResponse({
      title,
      url: typeof body.url === 'string' ? body.url : '',
      answer: `${question}this local demo can display a sample response based on the shared page. Connect the backend and AI provider for real page analysis.`,
      mode: 'demo',
      notice: 'Demo response only — no live AI analysis was performed.',
    })
  }

  if (pathname === '/api/reports' && method === 'GET') return jsonResponse(store.reports)
  if (reportRoute) {
    const [, id, action] = reportRoute
    const report = store.reports.find(item => item.id === id)
    if (!report) return jsonResponse({ detail: 'Demo report not found.' }, 404)
    if (action === 'export' && method === 'GET') {
      const format = url.searchParams.get('format')
      const content = format === 'csv'
        ? `Title,Type,Task ID,Summary\r\n${[report.title, report.report_type, report.task_id, report.content.summary].map(csvCell).join(',')}\r\n`
        : `WebPilot AI demo report\n\n${report.title}\n\n${String(report.content.summary ?? '')}\n\nDemo content only; not verified research.`
      return new Response(format === 'csv' ? content : makePdf(content), {
        headers: { 'Content-Type': format === 'csv' ? 'text/csv' : 'application/pdf' },
      })
    }
    if (!action && method === 'DELETE') {
      store.reports = store.reports.filter(item => item.id !== id)
      writeStore(store)
      return jsonResponse({ deleted: true })
    }
  }

  if (pathname === '/api/templates' && method === 'GET') return jsonResponse(store.templates)
  if (pathname === '/api/templates' && method === 'POST') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!name || instruction.length < 3) return jsonResponse({ detail: 'Enter a name and a research prompt.' }, 422)
    const template = { id: `template-${Date.now()}`, name, instruction }
    store.templates.unshift(template)
    writeStore(store)
    return jsonResponse(template)
  }
  if (templateRoute && method === 'DELETE') {
    store.templates = store.templates.filter(template => template.id !== templateRoute[1])
    writeStore(store)
    return jsonResponse({ deleted: true })
  }

  if (pathname === '/api/preferences' && method === 'GET') return jsonResponse(store.preferences)
  if (pathname === '/api/preferences' && method === 'PUT') {
    const preferences = typeof body.preferences === 'object' && body.preferences !== null
      ? body.preferences as Record<string, string>
      : {}
    store.preferences = preferences
    writeStore(store)
    return jsonResponse(store.preferences)
  }
  if (pathname === '/api/security/audit' && method === 'GET') return jsonResponse(store.audit)
  if (pathname === '/api/approvals' && method === 'GET') return jsonResponse(store.approvals)
  if (pathname === '/api/approvals' && method === 'POST') {
    const approval: DemoApproval = {
      id: `approval-${Date.now()}`,
      action: typeof body.action === 'string' ? body.action : 'Demo approval request',
      details: typeof body.details === 'object' && body.details !== null ? body.details as Record<string, unknown> : {},
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    store.approvals.unshift(approval)
    addAudit(store, 'demo_approval_requested', null, { action: approval.action })
    writeStore(store)
    return jsonResponse(approval)
  }
  if (approvalDecisionRoute && method === 'POST') {
    const approval = store.approvals.find(item => item.id === approvalDecisionRoute[1])
    if (!approval) return jsonResponse({ detail: 'Demo approval request not found.' }, 404)
    approval.status = body.decision === 'approved' ? 'approved' : 'rejected'
    writeStore(store)
    return jsonResponse({ id: approval.id, status: approval.status, note: 'Recorded in the demo only; no external action was performed.' })
  }

  return jsonResponse({ detail: 'This feature is not available in the local demo.' }, 404)
}

