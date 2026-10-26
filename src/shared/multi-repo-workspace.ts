import { parseExecutionHostId, type ExecutionHostId } from './execution-host'

export const MULTI_REPO_WORKSPACE_MIN_MEMBERS = 2
export const MULTI_REPO_WORKSPACE_MAX_MEMBERS = 12
export const MULTI_REPO_WORKSPACE_CREATE_CONCURRENCY = 3
export const MULTI_REPO_MEMBER_FAILURE_MESSAGE_MAX_LENGTH = 400
export const MULTI_REPO_SYSTEM_GROUP_NAME = 'Workspaces'

export const MULTI_REPO_MEMBER_STATES = [
  'queued',
  'creating',
  'ready',
  'failed',
  'interrupted'
] as const
export type MultiRepoMemberState = (typeof MULTI_REPO_MEMBER_STATES)[number]

export const MULTI_REPO_MEMBER_FAILURE_CODES = [
  'path_occupied',
  'branch_conflict',
  'git_failed',
  'setup_failed',
  'repo_unavailable',
  'host_unavailable',
  'unknown'
] as const
export type MultiRepoMemberFailureCode = (typeof MULTI_REPO_MEMBER_FAILURE_CODES)[number]

export type MultiRepoMember = {
  /** Stable across retries; doubles as the create progress `creationId`. */
  memberId: string
  repoId: string
  /** Leaf directory under the workspace root. Unique case-insensitively within the workspace. */
  dirName: string
  branchName: string
  baseRef?: string
  state: MultiRepoMemberState
  attempts: number
  failure?: { code: MultiRepoMemberFailureCode; message: string; at: number }
  /** Set once ready; join key to the worktree catalog and WorkspaceLineage. */
  worktreeId?: string
  worktreeInstanceId?: string
}

export type MultiRepoWorkspace = {
  version: 1
  executionHostId: ExecutionHostId
  /** True when Orca created the root directory; gates root removal on delete. */
  rootOwnedByOrca: boolean
  /** Order is the strip and sidebar order. */
  members: MultiRepoMember[]
  /** Set when the user asked for an agent; the client starts it once every member settles. */
  pendingAgentStart?: boolean
}

/** Members that no longer change state without user action. */
export function isMultiRepoMemberSettled(member: Pick<MultiRepoMember, 'state'>): boolean {
  return member.state === 'ready' || member.state === 'failed' || member.state === 'interrupted'
}

export function isMultiRepoWorkspaceSettled(workspace: Pick<MultiRepoWorkspace, 'members'>): boolean {
  return workspace.members.every(isMultiRepoMemberSettled)
}

export const MULTI_REPO_WORKSPACE_ERROR_CODES = [
  'multi_repo_capability_unsupported',
  'multi_repo_invalid_members',
  'multi_repo_repo_not_found',
  'multi_repo_repo_not_git',
  'multi_repo_repo_direct_ssh',
  'multi_repo_mixed_hosts',
  'multi_repo_workspace_not_found',
  'multi_repo_member_not_found',
  'multi_repo_member_not_retryable',
  'multi_repo_member_not_removable',
  'multi_repo_member_not_detachable',
  'multi_repo_member_not_attachable',
  'multi_repo_member_locked',
  'multi_repo_root_unavailable',
  'multi_repo_delete_force_not_named',
  'multi_repo_has_members'
] as const
export type MultiRepoWorkspaceErrorCode = (typeof MULTI_REPO_WORKSPACE_ERROR_CODES)[number]

export class MultiRepoWorkspaceError extends Error {
  readonly code: MultiRepoWorkspaceErrorCode
  readonly data?: Record<string, unknown>

  constructor(code: MultiRepoWorkspaceErrorCode, message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'MultiRepoWorkspaceError'
    this.code = code
    this.data = data
  }
}

/** Per-member preflight for group delete. `null` means the check could not run, never "clean". */
export type MultiRepoDeleteMemberInspection = {
  memberId: string
  repoId: string
  state: MultiRepoMemberState
  worktreeId: string | null
  /** False when the worktree directory or repo is gone; removal then only forgets metadata. */
  worktreeExists: boolean
  dirtyCount: number | null
  unpublishedCommitCount: number | null
  /** Branch is deleted only when merged; false means the branch survives removal. */
  willKeepBranch: boolean | null
}

export type MultiRepoDeleteInspection = {
  folderWorkspaceId: string
  members: MultiRepoDeleteMemberInspection[]
  rootPath: string
  rootOwnedByOrca: boolean
}

export type MultiRepoDeleteMemberOutcome =
  | { memberId: string; status: 'removed'; preservedBranch?: string }
  | { memberId: string; status: 'dropped' }
  | { memberId: string; status: 'failed'; code: string; message: string }

export type MultiRepoDeleteResult = {
  folderWorkspaceId: string
  members: MultiRepoDeleteMemberOutcome[]
  /** True once the folder workspace record is gone (every member removed). */
  workspaceRemoved: boolean
  /** Why the root directory was left on disk; absent when it was removed or the workspace remains. */
  rootKept?: { path: string; reason: 'not_empty' | 'not_owned' | 'remove_failed' }
  remainingMemberCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isMemberState(value: unknown): value is MultiRepoMemberState {
  return MULTI_REPO_MEMBER_STATES.some((state) => state === value)
}

function isFailureCode(value: unknown): value is MultiRepoMemberFailureCode {
  return MULTI_REPO_MEMBER_FAILURE_CODES.some((code) => code === value)
}

function normalizeMember(raw: unknown): MultiRepoMember | null {
  if (!isRecord(raw)) {
    return null
  }
  const memberId = nonEmptyString(raw.memberId)
  const repoId = nonEmptyString(raw.repoId)
  const dirName = nonEmptyString(raw.dirName)
  const branchName = nonEmptyString(raw.branchName)
  if (!memberId || !repoId || !dirName || !branchName || !isMemberState(raw.state)) {
    return null
  }
  const worktreeId = nonEmptyString(raw.worktreeId)
  // A ready member without a worktree cannot be adopted or removed; treat it as interrupted so Retry can adopt.
  const state = raw.state === 'ready' && !worktreeId ? 'interrupted' : raw.state
  const baseRef = nonEmptyString(raw.baseRef)
  const worktreeInstanceId = nonEmptyString(raw.worktreeInstanceId)
  const failureRaw = raw.failure
  const failure =
    isRecord(failureRaw) &&
    isFailureCode(failureRaw.code) &&
    typeof failureRaw.at === 'number' &&
    Number.isFinite(failureRaw.at)
      ? {
          code: failureRaw.code,
          message:
            typeof failureRaw.message === 'string'
              ? failureRaw.message.slice(0, MULTI_REPO_MEMBER_FAILURE_MESSAGE_MAX_LENGTH)
              : '',
          at: failureRaw.at
        }
      : undefined
  return {
    memberId,
    repoId,
    dirName,
    branchName,
    ...(baseRef ? { baseRef } : {}),
    state,
    attempts:
      typeof raw.attempts === 'number' && Number.isInteger(raw.attempts) && raw.attempts >= 0
        ? raw.attempts
        : 0,
    ...(failure ? { failure } : {}),
    ...(worktreeId ? { worktreeId } : {}),
    ...(worktreeInstanceId ? { worktreeInstanceId } : {})
  }
}

/** Garbage returns `undefined` so the workspace survives as a plain folder workspace. */
export function normalizeMultiRepoWorkspace(value: unknown): MultiRepoWorkspace | undefined {
  if (!isRecord(value) || value.version !== 1) {
    return undefined
  }
  const executionHostId = parseExecutionHostId(
    typeof value.executionHostId === 'string' ? value.executionHostId : null
  )?.id
  if (!executionHostId || !Array.isArray(value.members)) {
    return undefined
  }
  const seenMembers = new Set<string>()
  const members: MultiRepoMember[] = []
  for (const rawMember of value.members) {
    const member = normalizeMember(rawMember)
    if (!member || seenMembers.has(member.memberId)) {
      continue
    }
    seenMembers.add(member.memberId)
    members.push(member)
  }
  return {
    version: 1,
    executionHostId,
    rootOwnedByOrca: value.rootOwnedByOrca === true,
    members,
    ...(value.pendingAgentStart === true ? { pendingAgentStart: true } : {})
  }
}
