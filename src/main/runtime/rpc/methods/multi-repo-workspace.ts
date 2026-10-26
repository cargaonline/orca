import { defineMethod } from '../core'
import { resolveRpcWorkspaceCreatorProvenance } from '../workspace-creator-context'
import { getMultiRepoWorkspaceService } from '../../multi-repo-workspace/multi-repo-workspace-runtime-port'
import {
  MultiRepoWorkspaceCreate,
  MultiRepoWorkspaceDelete,
  MultiRepoWorkspaceMemberSelector,
  MultiRepoWorkspaceSelector
} from '../../../../shared/rpc-contract/multi-repo-workspace-params'

export const MULTI_REPO_WORKSPACE_METHODS = [
  defineMethod({
    name: 'multiRepoWorkspace.create',
    permission: 'workspace',
    params: MultiRepoWorkspaceCreate,
    handler: async (params, context) => ({
      folderWorkspace: await getMultiRepoWorkspaceService(context.runtime).create({
        ...params,
        creatorProvenance: resolveRpcWorkspaceCreatorProvenance(context)
      })
    })
  }),
  defineMethod({
    name: 'multiRepoWorkspace.retryMember',
    permission: 'workspace',
    params: MultiRepoWorkspaceMemberSelector,
    handler: async (params, { runtime }) => ({
      folderWorkspace: await getMultiRepoWorkspaceService(runtime).retryMember(
        params.folderWorkspaceId,
        params.memberId
      )
    })
  }),
  defineMethod({
    name: 'multiRepoWorkspace.removeMember',
    permission: 'workspace',
    params: MultiRepoWorkspaceMemberSelector,
    handler: async (params, { runtime }) => ({
      folderWorkspace: await getMultiRepoWorkspaceService(runtime).removeMember(
        params.folderWorkspaceId,
        params.memberId
      )
    })
  }),
  defineMethod({
    name: 'multiRepoWorkspace.detachMember',
    permission: 'workspace',
    params: MultiRepoWorkspaceMemberSelector,
    handler: async (params, { runtime }) => ({
      folderWorkspace: await getMultiRepoWorkspaceService(runtime).detachMember(
        params.folderWorkspaceId,
        params.memberId
      )
    })
  }),
  defineMethod({
    name: 'multiRepoWorkspace.attachMember',
    permission: 'workspace',
    params: MultiRepoWorkspaceMemberSelector,
    handler: async (params, { runtime }) => ({
      folderWorkspace: await getMultiRepoWorkspaceService(runtime).attachMember(
        params.folderWorkspaceId,
        params.memberId
      )
    })
  }),
  defineMethod({
    name: 'multiRepoWorkspace.inspectDelete',
    permission: 'workspace',
    params: MultiRepoWorkspaceSelector,
    handler: async (params, { runtime }) =>
      getMultiRepoWorkspaceService(runtime).inspectDelete(params.folderWorkspaceId)
  }),
  defineMethod({
    name: 'multiRepoWorkspace.delete',
    permission: 'workspace',
    params: MultiRepoWorkspaceDelete,
    handler: async (params, { runtime }) => getMultiRepoWorkspaceService(runtime).delete(params)
  })
]
