# WebPilot AI

WebPilot AI is a research assistant MVP that turns natural-language requests into a structured research plan, gathers web evidence, and presents source-linked findings in a responsive workspace.

## What it does

- Creates tasks from natural-language instructions and persists them in Supabase PostgreSQL (or local SQLite for development).
- Builds an explicit research plan with task progress.
- Uses configurable Tavily or Brave Search APIs, with clearly labeled sample data when search is not configured.
- Extracts readable page text with timeouts and source links.
- Summarizes evidence with an OpenAI API when configured; demo analysis never claims to be verified research.
- Displays source cards, comparison tables, recommendations, and task history.
- Includes safety notice and does not submit forms or make purchases.

## Stack and architecture

- **Frontend:** React, TypeScript, Vite, Lucide React, custom responsive CSS.
- **Backend:** FastAPI, Pydantic, SQLAlchemy, PostgreSQL/SQLite, HTTPX, BeautifulSoup.
- **Services:** `planner_service`, `search_service`, `extraction_service`, `analysis_service`, `task_service`, and `agent_service`.
- **API:** FastAPI docs at `/docs`.

Research providers start in demo mode. Demo results use reserved `.example` links and are clearly marked; demo mode does not imply a real search or AI response. Edit the Supabase placeholders in `.env` before starting the backend.

## Requirements

- Node.js 20.19+ or 22.12+
- Python 3.10+

## Run the frontend demo on Windows PowerShell

The frontend runs in local demo mode by default. It includes sample research, needs no backend, Supabase account, or API keys, and stores demo tasks in your browser. The sample sources and analysis are fictional and are not live or verified research.

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open the local URL printed by Vite (usually [http://localhost:5173](http://localhost:5173)). Use the sidebar to explore the dashboard, research results, comparisons, reports, templates, and settings. New tasks run against local sample data.

To clear demo tasks and return to the original sample dashboard, clear this site's local storage in your browser.

## Run with the backend

From the project root:

```powershell
Copy-Item .env.example .env
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

In the first PowerShell terminal:

```powershell
.\.venv\Scripts\Activate.ps1
Set-Location .\backend
python -m uvicorn app.main:app --reload
```

In a second terminal, start the frontend in live API mode:

```powershell
Set-Location .\frontend
npm install
$env:VITE_DEMO_MODE = "false"
npm run dev
```

Open the frontend at [http://localhost:5173](http://localhost:5173) and API docs at [http://localhost:8000/docs](http://localhost:8000/docs). The API health check is [http://localhost:8000/api/health](http://localhost:8000/api/health).

Before using Supabase, update the project-root `.env` with the Supabase URL, publishable key, JWKS URL, and PostgreSQL connection string. Configure OpenAI and Tavily there as well for live research. If Supabase email confirmation is enabled, confirm the registration email before signing in. The backend creates its application tables on startup and adds nullable owner columns to recognized existing tables; data in a previous local SQLite database is not copied to Supabase automatically.

## Tests

From the project root, after activating `.venv`:

```powershell
Set-Location .\backend
python -m unittest discover -s tests
```

## Provider and Supabase configuration

Copy `.env.example` to `.env` in the project root. For live AI and search, configure:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-rotated-openai-key
OPENAI_MODEL=gpt-4o-mini
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-rotated-tavily-key
```

For Supabase Auth, set the project URL and publishable key from the Supabase dashboard. The JWKS URL normally follows this form:

```dotenv
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_JWKS_URL=https://your-project-ref.supabase.co/auth/v1/.well-known/jwks.json
```

Set `DATABASE_URL` to a Supabase PostgreSQL connection string from **Project Settings → Database → Connection string**. With the psycopg driver, use a SQLAlchemy URL such as:

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:URL_ENCODED_DATABASE_PASSWORD@db.your-project-ref.supabase.co:5432/postgres?sslmode=require
```

Replace the example host and password with the exact values Supabase provides. If using the session pooler instead, use the username and host Supabase shows for that connection mode. URL-encode special characters in the database password. The checked-in `.env.example` is set up for Supabase; SQLite can be used instead with `DATABASE_URL=sqlite:///./webpilot.db`, while Supabase Auth remains required for authenticated API use.

The browser sends only the Supabase access token to the backend. The backend verifies it against the project JWKS and proxies registration, login, refresh, and logout through Supabase Auth. The Supabase secret/service-role key is not needed for these flows and must never be placed in frontend variables. Keep all backend credentials in the ignored project-root `.env`; do not put secrets in `VITE_` variables or commit them.

The frontend defaults to `http://localhost:8000`. If you change the API host, copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_API_BASE_URL` there. Only the API URL belongs in frontend environment variables.

**Important:** API keys pasted into chat or public source-control history should be revoked and replaced before use. Configure the replacements locally; do not send them in chat. If provider credentials are absent or a configured service fails, the task is marked failed with an explanatory result rather than silently switching modes.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks` | List task history |
| GET | `/api/tasks/{task_id}` | Get task details |
| POST | `/api/tasks/{task_id}/execute` | Run research workflow |
| GET | `/api/tasks/{task_id}/results` | Get summary and comparison |
| GET | `/api/tasks/{task_id}/sources` | Get source evidence |
| DELETE | `/api/tasks/{task_id}` | Delete one task |
| DELETE | `/api/tasks` | Clear history |
| POST | `/api/tasks/{task_id}/plan` | Generate and save a workflow plan |
| POST | `/api/tasks/{task_id}/resume` | Resume an interrupted or failed workflow |
| GET | `/api/tasks/{task_id}/progress` | Get workflow progress and checkpoints |
| GET | `/api/tasks/{task_id}/checkpoints` | List persisted checkpoints |
| POST | `/api/auth/register` | Register a Supabase Auth user |
| POST | `/api/auth/login` | Create an access session |
| GET | `/api/auth/me` | Get the authenticated user |
| POST | `/api/research/search` | Search and extract public sources |
| GET | `/api/analytics/overview` | Get local usage analytics |
| POST | `/api/reports/generate` | Generate a research report |
| GET | `/api/reports/{report_id}/download?format=csv` | Download a report |

Additional endpoints cover sources, findings, comparisons, verification, agents, approvals, templates, preferences, history, notifications, security audit logs, and browser page analysis. Open `/docs` for request and response schemas.

## Screenshots

Add screenshots of the dashboard, research workspace, and comparison view here.

## Phase 2 ideas

Browser extension integration, user-controlled form workflows, recoverable long-running jobs, accessibility enhancements, voice interaction, and production deployment are outside this MVP.
