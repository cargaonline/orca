import {
  keybindingMatchesAction,
  matchKeybindingDigitIndex,
  type KeybindingActionId,
  type KeybindingMatchOptions,
  type KeybindingOverrides
} from './keybindings'
import type { WindowShortcutAction, WindowShortcutInput } from './window-shortcut-policy'

export type WorkspaceRepoSelection =
  | { kind: 'next' | 'previous' }
  | { kind: 'index'; index: number }

export function workspaceRepoSelectionActionId(
  selection: WorkspaceRepoSelection
): KeybindingActionId {
  if (selection.kind === 'index') {
    return 'workspace.selectRepoByIndex'
  }
  return selection.kind === 'next' ? 'workspace.nextRepo' : 'workspace.previousRepo'
}

export function resolveWorkspaceRepoShortcut(
  input: WindowShortcutInput,
  platform: NodeJS.Platform,
  keybindings: KeybindingOverrides | undefined,
  options: KeybindingMatchOptions
): WindowShortcutAction | null {
  const repoIndex = matchKeybindingDigitIndex(
    'workspace.selectRepoByIndex',
    input,
    platform,
    keybindings,
    options
  )
  if (repoIndex !== null) {
    return { type: 'selectWorkspaceRepo', selection: { kind: 'index', index: repoIndex } }
  }
  if (keybindingMatchesAction('workspace.nextRepo', input, platform, keybindings, options)) {
    return { type: 'selectWorkspaceRepo', selection: { kind: 'next' } }
  }
  if (keybindingMatchesAction('workspace.previousRepo', input, platform, keybindings, options)) {
    return { type: 'selectWorkspaceRepo', selection: { kind: 'previous' } }
  }
  return null
}
