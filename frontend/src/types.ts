export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface PlanStep {
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface Task {
  id: string
  instruction: string
  status: TaskStatus
  created_at: string
  updated_at: string
  plan: PlanStep[]
  mode: 'demo' | 'live'
}

export interface Source {
  id: number
  title: string
  url: string
  extracted_content: string
}

export interface Result {
  summary: string
  comparison_data: Record<string, string>[]
  recommendations: string[]
  plan: PlanStep[]
  mode: 'demo' | 'live'
}
