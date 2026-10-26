import { randomUUID } from 'node:crypto'
import { access, rmdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import {
  MULTI_REPO_SYSTEM_GROUP_NAME,
  MULTI_REPO_WORKSPACE_CREATE_CONCURRENCY,
  MULTI_REPO_WORKSPACE_MAX_MEMBERS,
  MULTI_REPO_WORKSPACE_MIN_MEMBERS,
  MultiRepoWorkspaceError,
  isMultiRepoWorkspaceSettled,
  type MultiRepoDeleteInspection,
  type MultiRepoDeleteResult,
  type MultiRepoMember,
  type MultiRepoWorkspace
} from '../../../shared/multi-repo-workspace'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { isFolderRepo } from '../../../shared/repo-kind'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type { Repo } from '../../../shared/repo-types'
import type { WorkspaceCreatorProvenance } from '../../../shared/worktree/types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { sanitizeWorktreeName } from '../../ipc/worktree-logic'
import { track } from '../../telemetry/client'
import { worktreeRowTarget } from '../../persistence/host-qualified-worktree-meta'
import { recordCreatedWorktreeLineage } from '../runtime-worktree-lineage-recording'
import {
  deleteMultiRepoWorkspace,
  inspectMultiRepoDelete,
  type MultiRepoDeleteRequest
} from './multi-repo-workspace-delete'
import { PlacedWorktreePathOccupiedError } from './placed-worktree-path-occupied-error'
import { classifyMultiRepoMemberFailure } from './multi-repo-member-failure'
import { allocateMemberDirNames, allocateMultiRepoRoot } from './multi-repo-root-allocation'
import type { MultiRepoWorkspacePort } from './multi-repo-workspace-port'
import {
  patchMultiRepoMember,
  requireMultiRepoMember,
  requireMultiRepoWorkspace,
  writeMultiRepoRecord
} from './multi-repo-workspace-record'
import { bucketMultiRepoMemberCount } from '../../../shared/telemetry-multi-repo-workspace-event-schemas'

export type MultiRepoWorkspaceCreateInput = {
  name: string
  members: { repoId: string; branchName?: string; baseRef?: string }[]
  clientMutationId?: string
  createdWithAgent?: TuiAgent
  creatorProvenance?: WorkspaceCreatorProvenance
}

export class MultiRepoWorkspaceService {
  private readonly activeMembers = new Set<string>()
  private readonly createsByMutationId = new Map<string, Promise<FolderWorkspace>>()

  constructor(private readonly port: MultiRepoWorkspacePort) {}

  create(input: MultiRepoWorkspaceCreateInput): Promise<FolderWorkspace> {
    const key = input.clientMutationId
    if (!key) {
      return this.createOnce(input)
    }
    const existing = this.createsByMutationId.get(key)
    if (existing) {
      return existing
    }
    const created = this.createOnce(input)
    this.createsByMutationId.set(key, created)
    created.catch(() => this.createsByMutationId.delete(key))
    return created
  }

  async retryMember(folderWorkspaceId: string, memberId: string): Promise<FolderWorkspace> {
    const store = this.port.requireStore()
    const member = requireMultiRepoMember(
      requireMultiRepoWorkspace(store, folderWorkspaceId).multiRepo,
      memberId
    )
    if (member.state !== 'failed' && member.state !== 'interrupted') {
      throw new MultiRepoWorkspaceError(
        'multi_repo_member_not_retryable',
        'Only failed or interrupted members can be retried.'
      )
    }
    if (this.activeMembers.has(memberId)) {
      throw new MultiRepoWorkspaceError(
        'multi_repo_member_not_retryable',
        'This member is already being created.'
      )
    }
    patchMultiRepoMember(store, folderWorkspaceId, memberId, (current) => ({
      ...current,
      state: 'queued',
      failure: undefined
    }))
    this.port.notifyChanged()
    await this.runMembers(folderWorkspaceId, [memberId], { reportRetry: true })
    return requireMultiRepoWorkspace(store, folderWorkspaceId)
  }

  async removeMember(folderWorkspaceId: string, memberId: string): Promise<FolderWorkspace> {
    const store = this.port.requireStore()
    const member = requireMultiRepoMember(
      requireMultiRepoWorkspace(store, folderWorkspaceId).multiRepo,
      memberId
    )
    if (member.state !== 'failed' && member.state !== 'interrupted') {
      throw new MultiRepoWorkspaceError(
        'multi_repo_member_not_removable',
        'Only failed or interrupted members can be removed. Nothing on disk is deleted.'
      )
    }
    const updated = writeMultiRepoRecord(store, folderWorkspaceId, (current) => ({
      ...current,
      members: current.members.filter((entry) => entry.memberId !== memberId)
    }))
    this.port.notifyChanged()
    return updated ?? requireMultiRepoWorkspace(store, folderWorkspaceId)
  }

  async detachMember(folderWorkspaceId: string, memberId: string): Promise<FolderWorkspace> {
    const store = this.port.requireStore()
    const workspace = requireMultiRepoWorkspace(store, folderWorkspaceId)
    const member = requireMultiRepoMember(workspace.multiRepo, memberId)
    if (member.state !== 'ready' || !member.worktreeId) {
      throw new MultiRepoWorkspaceError(
        'multi_repo_member_not_detachable',
        'Only a ready member can be removed from the workspace.'
      )
    }
    const target = worktreeRowTarget(store, { id: member.worktreeId })
    if (target) {
      store.removeWorktreeLineage?.(target)
    }
    const updated = writeMultiRepoRecord(store, folderWorkspaceId, (current) => ({
      ...current,
      members: current.members.filter((entry) => entry.memberId !== memberId),
      detachedMembers: [...(current.detachedMembers ?? []), member]
    }))
    this.port.notifyChanged()
    return updated ?? requireMultiRepoWorkspace(store, folderWorkspaceId)
  }

  async attachMember(folderWorkspaceId: string, memberId: string): Promise<FolderWorkspace> {
    const store = this.port.requireStore()
    const workspace = requireMultiRepoWorkspace(store, folderWorkspaceId)
    const member = workspace.multiRepo.detachedMembers?.find((entry) => entry.memberId === memberId)
    const worktreeId = member?.worktreeId
    if (!member || !worktreeId || !store.getWorktreeMeta(worktreeId)) {
      throw new MultiRepoWorkspaceError(
        'multi_repo_member_not_attachable',
        'This workspace cannot be restored; its worktree no longer exists.'
      )
    }
    this.recordMemberLineage(workspace, worktreeId, member.worktreeInstanceId)
    const updated = writeMultiRepoRecord(store, folderWorkspaceId, (current) => ({
      ...current,
      members: [...current.members, member],
      detachedMembers: (current.detachedMembers ?? []).filter(
        (entry) => entry.memberId !== memberId
      )
    }))
    this.port.notifyChanged()
    return updated ?? requireMultiRepoWorkspace(store, folderWorkspaceId)
  }

  inspectDelete(folderWorkspaceId: string): Promise<MultiRepoDeleteInspection> {
    return inspectMultiRepoDelete(this.port, folderWorkspaceId)
  }

  delete(request: MultiRepoDeleteRequest): Promise<MultiRepoDeleteResult> {
    return deleteMultiRepoWorkspace(this.port, request, (memberId) =>
      this.activeMembers.has(memberId)
    )
  }

  private async createOnce(input: MultiRepoWorkspaceCreateInput): Promise<FolderWorkspace> {
    const store = this.port.requireStore()
    const repos = this.validateRepos(input.members.map((member) => member.repoId))
    const workspaceDir = store.getSettings().workspaceDir
    if (!isAbsolute(workspaceDir)) {
      throw new MultiRepoWorkspaceError(
        'multi_repo_root_unavailable',
        'Set an absolute workspace directory in Settings first.'
      )
    }
    const group = await this.ensureSystemGroup(workspaceDir)
    const rootPath = await allocateMultiRepoRoot(workspaceDir, input.name)
    let workspace: FolderWorkspace
    try {
      workspace = await this.port.createFolderWorkspace({
        projectGroupId: group.id,
        name: input.name.trim(),
        folderPath: rootPath,
        connectionId: null,
        ...(input.creatorProvenance ? { creatorProvenance: input.creatorProvenance } : {}),
        ...(input.createdWithAgent ? { createdWithAgent: input.createdWithAgent } : {})
      })
    } catch (error) {
      await rmdir(rootPath).catch(() => {})
      throw error
    }
    const dirNames = allocateMemberDirNames(repos.map((repo) => repo.path))
    const defaultBranch = sanitizeWorktreeName(input.name)
    const members: MultiRepoMember[] = input.members.map((requested, index) => ({
      memberId: randomUUID(),
      repoId: requested.repoId,
      dirName: dirNames[index],
      branchName: requested.branchName ?? defaultBranch,
      ...(requested.branchName ? { branchExplicit: true } : {}),
      ...(requested.baseRef ? { baseRef: requested.baseRef } : {}),
      state: 'queued',
      attempts: 0
    }))
    const multiRepo: MultiRepoWorkspace = {
      version: 1,
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      rootOwnedByOrca: true,
      members,
      ...(input.createdWithAgent ? { pendingAgentStart: true } : {})
    }
    const stored = store.updateFolderWorkspace?.(workspace.id, { multiRepo })
    if (!stored) {
      await this.port.deleteFolderWorkspace(workspace.id)
      await rmdir(rootPath).catch(() => {})
      throw new MultiRepoWorkspaceError(
        'multi_repo_root_unavailable',
        'Could not record the workspace.'
      )
    }
    this.port.notifyChanged()
    const startedAt = Date.now()
    void this.runMembers(
      workspace.id,
      members.map((member) => member.memberId),
      { startedAt }
    ).catch((error: unknown) => {
      console.warn('[multi-repo-workspace] create run failed', error)
    })
    return stored
  }

  private validateRepos(repoIds: readonly string[]): Repo[] {
    if (
      repoIds.length < MULTI_REPO_WORKSPACE_MIN_MEMBERS ||
      repoIds.length > MULTI_REPO_WORKSPACE_MAX_MEMBERS ||
      new Set(repoIds).size !== repoIds.length
    ) {
      throw new MultiRepoWorkspaceError(
        'multi_repo_invalid_members',
        'Pick between 2 and 12 different projects.'
      )
    }
    const all = this.port.requireStore().getRepos()
    return repoIds.map((repoId) => {
      const repo = all.find((entry) => entry.id === repoId)
      if (!repo) {
        throw new MultiRepoWorkspaceError('multi_repo_repo_not_found', 'Project was not found.', {
          repoId
        })
      }
      if (isFolderRepo(repo)) {
        throw new MultiRepoWorkspaceError(
          'multi_repo_repo_not_git',
          'Folder projects cannot join.',
          {
            repoId
          }
        )
      }
      if (repo.connectionId || getRepoExecutionHostId(repo).startsWith('ssh:')) {
        throw new MultiRepoWorkspaceError(
          'multi_repo_repo_direct_ssh',
          'Direct SSH projects cannot join a multi-repo workspace.',
          { repoId }
        )
      }
      if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
        throw new MultiRepoWorkspaceError(
          'multi_repo_mixed_hosts',
          'All projects must live on this host.',
          { repoId }
        )
      }
      if (isWslUncPath(repo.path)) {
        throw new MultiRepoWorkspaceError(
          'multi_repo_repo_wsl',
          'WSL projects cannot join a multi-repo workspace yet.',
          { repoId }
        )
      }
      return repo
    })
  }

  private async ensureSystemGroup(workspaceDir: string): Promise<{ id: string }> {
    const existing = this.port
      .requireStore()
      .getProjectGroups?.()
      .find(
        (group) =>
          group.name === MULTI_REPO_SYSTEM_GROUP_NAME &&
          !group.connectionId &&
          group.parentPath !== null &&
          group.parentPath !== undefined &&
          normalizeRuntimePathForComparison(group.parentPath) ===
            normalizeRuntimePathForComparison(workspaceDir)
      )
    return (
      existing ??
      (await this.port.createProjectGroup({
        name: MULTI_REPO_SYSTEM_GROUP_NAME,
        parentPath: workspaceDir,
        createdFrom: 'manual'
      }))
    )
  }

  private async runMembers(
    folderWorkspaceId: string,
    memberIds: readonly string[],
    options: { startedAt?: number; reportRetry?: boolean }
  ): Promise<void> {
    const queue = [...memberIds]
    const worker = async (): Promise<void> => {
      for (let memberId = queue.shift(); memberId; memberId = queue.shift()) {
        await this.runMember(folderWorkspaceId, memberId, options.reportRetry === true)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(MULTI_REPO_WORKSPACE_CREATE_CONCURRENCY, queue.length) },
        worker
      )
    )
    if (options.startedAt !== undefined) {
      this.reportCreated(folderWorkspaceId, options.startedAt)
    }
  }

  private async runMember(
    folderWorkspaceId: string,
    memberId: string,
    reportRetry: boolean
  ): Promise<void> {
    const store = this.port.requireStore()
    this.activeMembers.add(memberId)
    try {
      const workspace = requireMultiRepoWorkspace(store, folderWorkspaceId)
      const member = requireMultiRepoMember(workspace.multiRepo, memberId)
      patchMultiRepoMember(store, folderWorkspaceId, memberId, (current) => ({
        ...current,
        state: 'creating',
        attempts: current.attempts + 1
      }))
      this.port.notifyChanged()
      const adopted = member.attempts > 0 ? await this.tryAdopt(workspace, member) : null
      if (adopted) {
        this.markReady(folderWorkspaceId, memberId, adopted)
      } else {
        const result = await this.port.createWorktree({
          repoSelector: member.repoId,
          name: workspace.name,
          ...(member.branchExplicit ? { branchNameOverride: member.branchName } : {}),
          ...(member.baseRef ? { baseBranch: member.baseRef } : {}),
          placement: { parentDir: workspace.folderPath, leafName: member.dirName },
          creationId: member.memberId,
          activate: false,
          ...(workspace.creatorProvenance ? { creatorProvenance: workspace.creatorProvenance } : {})
        })
        this.recordMemberLineage(workspace, result.worktree.id, result.worktree.instanceId)
        this.markReady(folderWorkspaceId, memberId, {
          worktreeId: result.worktree.id,
          instanceId: result.worktree.instanceId,
          branch: result.worktree.branch
        })
      }
      if (reportRetry) {
        track('multi_repo_member_retry', { result: 'ready' })
      }
    } catch (error) {
      patchMultiRepoMember(store, folderWorkspaceId, memberId, (current) => ({
        ...current,
        state: 'failed',
        failure: classifyMultiRepoMemberFailure(error)
      }))
      if (reportRetry) {
        track('multi_repo_member_retry', { result: 'failed' })
      }
    } finally {
      this.activeMembers.delete(memberId)
      this.port.notifyChanged()
    }
  }

  private markReady(
    folderWorkspaceId: string,
    memberId: string,
    created: { worktreeId: string; instanceId?: string; branch?: string }
  ): void {
    const store = this.port.requireStore()
    patchMultiRepoMember(store, folderWorkspaceId, memberId, (current) => ({
      ...current,
      state: 'ready',
      failure: undefined,
      worktreeId: created.worktreeId,
      ...(created.instanceId ? { worktreeInstanceId: created.instanceId } : {}),
      ...(created.branch ? { branchName: created.branch.replace(/^refs\/heads\//, '') } : {})
    }))
  }

  /** Idempotent retry: adopt a worktree already registered at the expected path, never delete anything. */
  private async tryAdopt(
    workspace: FolderWorkspace & { multiRepo: MultiRepoWorkspace },
    member: MultiRepoMember
  ): Promise<{ worktreeId: string; instanceId?: string; branch: string } | null> {
    const expected = normalizeRuntimePathForComparison(join(workspace.folderPath, member.dirName))
    const detected = await this.port.listDetectedWorktrees(member.repoId).catch(() => null)
    const match = detected?.worktrees.find(
      (entry) => normalizeRuntimePathForComparison(entry.path) === expected
    )
    if (!match) {
      if (await pathExists(join(workspace.folderPath, member.dirName))) {
        throw new PlacedWorktreePathOccupiedError(join(workspace.folderPath, member.dirName))
      }
      return null
    }
    const branch = match.branch.replace(/^refs\/heads\//, '')
    if (match.repoId !== member.repoId || (member.branchExplicit && branch !== member.branchName)) {
      throw new PlacedWorktreePathOccupiedError(match.path)
    }
    const store = this.port.requireStore()
    const target = worktreeRowTarget(store, { id: match.id, hostId: match.hostId })
    const meta = target ? store.setWorktreeMeta(target, {}) : undefined
    const instanceId = meta?.instanceId ?? match.instanceId
    this.recordMemberLineage(workspace, match.id, instanceId)
    return { worktreeId: match.id, instanceId, branch }
  }

  private recordMemberLineage(
    workspace: FolderWorkspace,
    worktreeId: string,
    instanceId: string | undefined
  ): void {
    const store = this.port.requireStore()
    recordCreatedWorktreeLineage(
      store,
      { id: worktreeId, instanceId, hostId: undefined },
      {
        kind: 'lineage',
        parent: {
          type: 'folder',
          workspaceKey: folderWorkspaceKey(workspace.id),
          folderWorkspace: workspace,
          instanceId: null
        },
        origin: 'cli',
        capture: { source: 'explicit-cli-flag', confidence: 'explicit' }
      }
    )
  }

  private reportCreated(folderWorkspaceId: string, startedAt: number): void {
    const workspace = this.port
      .requireStore()
      .getFolderWorkspaces?.()
      .find((entry) => entry.id === folderWorkspaceId)
    const multiRepo = workspace?.multiRepo
    if (!multiRepo || !isMultiRepoWorkspaceSettled(multiRepo)) {
      return
    }
    track('multi_repo_workspace_created', {
      member_count_bucket: bucketMultiRepoMemberCount(multiRepo.members.length),
      ready_count: multiRepo.members.filter((member) => member.state === 'ready').length,
      failed_count: multiRepo.members.filter((member) => member.state === 'failed').length,
      total_duration_ms: Date.now() - startedAt,
      execution_host: 'local'
    })
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
