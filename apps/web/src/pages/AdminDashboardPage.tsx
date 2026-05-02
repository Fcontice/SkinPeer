import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'
import type { ProposalStatus } from '../types/traderNetwork'

interface AdminProposal {
  id: string
  status: ProposalStatus
  verification_code: string
  creator_id: string
  recipient_id: string
  created_at: string
}

interface AdminReport {
  id: string
  reason: string
  reporter_id: string
  subject_user_id: string | null
  proposal_id: string | null
  conversation_id: string | null
  status: 'open' | 'resolved' | 'dismissed'
}

const PROPOSAL_STATUSES: ProposalStatus[] = [
  'draft', 'completed', 'cancelled', 'disputed', 'in_review',
]

export function AdminDashboardPage() {
  const [tab, setTab] = useState<'proposals' | 'reports'>('proposals')
  const [statusFilter, setStatusFilter] = useState('')
  const queryClient = useQueryClient()

  const { data: proposals } = useQuery({
    queryKey: ['admin-proposals', statusFilter],
    queryFn: () =>
      apiFetch<AdminProposal[]>(`/admin/proposals${statusFilter ? `?status=${statusFilter}` : ''}`),
    enabled: tab === 'proposals',
  })

  const { data: reports } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => apiFetch<AdminReport[]>('/admin/reports?status=open'),
    enabled: tab === 'reports',
  })

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'resolved' | 'dismissed' }) =>
      apiFetch(`/admin/reports/${id}`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  })

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-6">Admin dashboard</h1>
      <div className="flex gap-4 mb-6 border-b border-border">
        {(['proposals', 'reports'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-400'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'proposals' && (
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-card border border-border rounded px-3 py-1 text-sm text-white mb-4"
          >
            <option value="">All statuses</option>
            {PROPOSAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <div className="space-y-2">
            {proposals?.map((p) => (
              <Link
                key={p.id}
                to={`/proposals/${p.id}`}
                className="flex items-center justify-between bg-card border border-border rounded p-3 hover:border-accent"
              >
                <span className="font-mono text-sm text-accent">{p.verification_code}</span>
                <span className="text-xs text-gray-400 capitalize">{p.status.replace(/_/g, ' ')}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-3">
          {reports?.length === 0 && <p className="text-gray-400 text-sm">No open reports.</p>}
          {reports?.map((report) => (
            <div key={report.id} className="bg-card border border-danger/40 rounded p-4">
              <p className="text-sm font-medium mb-1">{report.reason}</p>
              <p className="text-xs text-gray-500 mb-2">
                Reporter: {report.reporter_id.slice(0, 8)}…
                {report.subject_user_id && ` · Subject: ${report.subject_user_id.slice(0, 8)}…`}
              </p>
              {report.proposal_id && (
                <Link to={`/proposals/${report.proposal_id}`} className="text-accent text-xs">
                  View proposal →
                </Link>
              )}
              {report.conversation_id && !report.proposal_id && (
                <Link to={`/messages/${report.conversation_id}`} className="text-accent text-xs">
                  View conversation →
                </Link>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => resolveMutation.mutate({ id: report.id, status: 'resolved' })}
                  className="text-xs bg-accent text-bg font-semibold px-3 py-1 rounded"
                >
                  Resolve
                </button>
                <button
                  onClick={() => resolveMutation.mutate({ id: report.id, status: 'dismissed' })}
                  className="text-xs border border-border text-gray-400 px-3 py-1 rounded"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
