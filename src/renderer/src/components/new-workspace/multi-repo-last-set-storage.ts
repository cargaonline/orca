import { recordCreateInLastSet, type LastMultiRepoSet } from './multi-repo-composer-model'

// Device-local, like the Jira view mode, rather than synced through ui.set: the host never sees it.
const STORAGE_KEY = 'orca.new-workspace.last-multi-repo-set.v1'

function isLastMultiRepoSet(value: unknown): value is LastMultiRepoSet {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<LastMultiRepoSet>
  return (
    Array.isArray(candidate.projectIds) &&
    candidate.projectIds.length > 0 &&
    candidate.projectIds.every((id) => typeof id === 'string' && id !== '') &&
    typeof candidate.singleCreatesSince === 'number' &&
    Number.isInteger(candidate.singleCreatesSince) &&
    candidate.singleCreatesSince >= 0
  )
}

export function loadLastMultiRepoSet(): LastMultiRepoSet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isLastMultiRepoSet(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveLastMultiRepoSet(value: LastMultiRepoSet | null): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // The remembered set is a shortcut; the composer works without it.
  }
}

/** A single-project create counts toward clearing the "Same as last time" link. */
export function recordSingleProjectCreate(projectId: string | null): void {
  if (!projectId) {
    return
  }
  saveLastMultiRepoSet(recordCreateInLastSet(loadLastMultiRepoSet(), [projectId]))
}
