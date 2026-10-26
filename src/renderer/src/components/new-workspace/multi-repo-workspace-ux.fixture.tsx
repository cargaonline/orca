// UX mockups for docs/multi-repo-workspaces-ux.md. Static markup built from real primitives and
// tokens; not wired to the store. Replace with fixtures of the real components when they exist.
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderTree,
  GitBranch,
  Loader2,
  Plus,
  RotateCw,
  X
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import { defineFixture } from '../../component-fixtures/component-fixture'

type RepoRowState = 'ready' | 'creating' | 'queued' | 'failed'

function RepoDot({ color }: { color: string }): React.JSX.Element {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
}

const REPOS = [
  { name: 'api', color: '#4f8cff' },
  { name: 'web', color: '#e0a030' },
  { name: 'infra', color: '#4fb286' }
]

function ComposerShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="w-full rounded-xl border border-border bg-card p-5 shadow-floating">
      {children}
    </div>
  )
}

function ProjectChips({ withLast }: { withLast?: boolean }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Projects
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {REPOS.map((repo) => (
          <span
            key={repo.name}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background pl-2 pr-1 text-sm"
          >
            <RepoDot color={repo.color} />
            {repo.name}
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${repo.name}`}>
              <X />
            </Button>
          </span>
        ))}
        <Button variant="outline" size="sm" className="h-7">
          <Plus /> Add project
        </Button>
      </div>
      {withLast ? (
        <div className="text-xs text-muted-foreground">
          Same as last time: <span className="text-foreground">api, web, infra</span>
        </div>
      ) : null}
    </div>
  )
}

function CreateBody({ advanced }: { advanced: boolean }): React.JSX.Element {
  return (
    <ComposerShell>
      <div className="mb-4 text-base font-semibold">New workspace</div>
      <div className="space-y-4">
        <ProjectChips withLast />
        <div className="space-y-1.5">
          <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Name
          </div>
          <Input defaultValue="checkout-flow" aria-label="Workspace name" />
          <div className="text-xs text-muted-foreground">
            Branch <span className="font-mono">checkout-flow</span> in all 3 projects
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
          aria-expanded={advanced}
        >
          {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Advanced
        </button>
        {advanced ? (
          <div className="overflow-hidden rounded-md border border-border text-sm">
            <div className="grid grid-cols-[88px_1fr_1fr] gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Project</span>
              <span>Branch</span>
              <span>Start from</span>
            </div>
            {[
              { n: 'api', c: '#4f8cff', b: 'checkout-flow', s: 'origin/main', err: null },
              {
                n: 'web',
                c: '#e0a030',
                b: 'checkout-flow-web',
                s: 'origin/develop',
                err: null
              },
              {
                n: 'infra',
                c: '#4fb286',
                b: 'checkout-flow',
                s: 'origin/main',
                err: 'Branch already exists in infra'
              }
            ].map((row) => (
              <div
                key={row.n}
                className="grid grid-cols-[88px_1fr_1fr] items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="flex h-8 items-center gap-1.5">
                  <RepoDot color={row.c} />
                  {row.n}
                </span>
                <div className="space-y-1">
                  <Input
                    defaultValue={row.b}
                    className="h-8 font-mono text-xs"
                    aria-invalid={row.err ? true : undefined}
                    aria-label={`Branch in ${row.n}`}
                  />
                  {row.err ? <div className="text-xs text-destructive">{row.err}</div> : null}
                </div>
                <Button variant="outline" size="sm" className="justify-between font-mono text-xs">
                  {row.s}
                  <ChevronDown />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button disabled={advanced}>
          Create in 3 projects
          <ShortcutKeyCombo keys={['⌘', '↵']} keyCapClassName="" />
        </Button>
      </div>
    </ComposerShell>
  )
}

export const createDialog = defineFixture({
  width: 520,
  render: () => <CreateBody advanced={false} />
})

export const createDialogAdvancedWithConflict = defineFixture({
  width: 560,
  render: () => <CreateBody advanced />
})

export const createDialogDisabledProjects = defineFixture({
  width: 380,
  render: () => (
    <div className="w-full rounded-md border border-border bg-popover p-1 text-sm shadow-floating">
      <div className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Add project
      </div>
      {[
        { n: 'web', note: null, on: true, checked: true },
        { n: 'infra', note: null, on: true, checked: false },
        { n: 'billing-svc', note: 'On ssh: build-box. A workspace folder cannot span hosts.', on: false, checked: false },
        { n: 'notes', note: 'Folder project, no git worktrees.', on: false, checked: false }
      ].map((row) => (
        <div
          key={row.n}
          aria-disabled={!row.on}
          className={cn(
            'flex items-start gap-2 rounded-sm px-2 py-1.5',
            row.on ? 'hover:bg-accent' : 'opacity-60'
          )}
        >
          <Checkbox checked={row.checked} disabled={!row.on} className="mt-0.5" />
          <div className="min-w-0">
            <div>{row.n}</div>
            {row.note ? <div className="text-xs text-muted-foreground">{row.note}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
})

function StatusGlyph({ state }: { state: RepoRowState }): React.JSX.Element {
  if (state === 'creating') {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
  }
  if (state === 'ready') {
    return <Check className="size-3.5 text-muted-foreground" />
  }
  if (state === 'failed') {
    return <AlertTriangle className="size-3.5 text-destructive" />
  }
  return <span className="size-3.5 rounded-full border border-dashed border-border" />
}

function ChildRow({
  repo,
  state,
  detail,
  active,
  dirty
}: {
  repo: (typeof REPOS)[number]
  state: RepoRowState
  detail: string
  active?: boolean
  dirty?: string
}): React.JSX.Element {
  return (
    <div
      data-current={active ? 'true' : undefined}
      className={cn(
        'ml-4 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent'
      )}
    >
      <StatusGlyph state={state} />
      <RepoDot color={repo.color} />
      <span className="font-medium">{repo.name}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {detail}
      </span>
      {dirty ? <span className="text-2xs text-muted-foreground">{dirty}</span> : null}
      {state === 'failed' ? (
        <Button variant="ghost" size="xs">
          <RotateCw /> Retry
        </Button>
      ) : null}
    </div>
  )
}

function SidebarFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="w-full rounded-md border border-border bg-sidebar p-2 text-sidebar-foreground">
      {children}
    </div>
  )
}

function GroupHeader({
  name,
  chip,
  chipVariant = 'hostContext'
}: {
  name: string
  chip: string
  chipVariant?: 'hostContext' | 'destructive-chip'
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent">
      <ChevronDown className="size-3.5 text-muted-foreground" />
      <FolderTree className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <Badge variant="hostContext">{chip}</Badge>
      {chipVariant === 'destructive-chip' ? null : null}
    </div>
  )
}

export const sidebarCreatingPartialFailure = defineFixture({
  width: 340,
  render: () => (
    <SidebarFrame>
      <GroupHeader name="checkout-flow" chip="3 repos · 1 failed" />
      <ChildRow repo={REPOS[0]} state="ready" detail="checkout-flow" />
      <ChildRow repo={REPOS[1]} state="failed" detail="Could not fetch origin/develop" />
      <ChildRow repo={REPOS[2]} state="creating" detail="Running setup…" />
      <div role="status" className="sr-only">
        api ready. web failed. infra creating.
      </div>
    </SidebarFrame>
  )
})

export const sidebarReadyCollapsedAndExpanded = defineFixture({
  width: 340,
  render: () => (
    <SidebarFrame>
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        <ChevronDown className="size-3.5" />
        Workspaces
        <span className="font-normal normal-case">2</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="New workspace">
          <Plus />
        </Button>
      </div>
      <GroupHeader name="checkout-flow" chip="3 repos" />
      <ChildRow repo={REPOS[0]} state="ready" detail="checkout-flow · +2" dirty="3 changed" active />
      <ChildRow repo={REPOS[1]} state="ready" detail="checkout-flow · clean" />
      <ChildRow repo={REPOS[2]} state="ready" detail="checkout-flow · 1 unpushed" />
      <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent">
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <FolderTree className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">billing-migration</span>
        <span className="text-2xs text-muted-foreground">2 changed</span>
        <Badge variant="hostContext">2 repos</Badge>
      </div>
    </SidebarFrame>
  )
})

export const siblingSwitcherStrip = defineFixture({
  width: 720,
  render: () => (
    <nav
      aria-label="Repos in checkout-flow"
      className="flex h-9 items-center gap-1 rounded-md border border-border bg-background px-2"
    >
      <FolderTree className="size-4 text-muted-foreground" />
      <span className="mr-2 max-w-40 truncate text-sm font-medium">checkout-flow</span>
      {[{ name: 'All', n: '1' }, ...REPOS.map((r, i) => ({ name: r.name, n: String(i + 2) }))].map(
        (item, i) => (
          <Button
            key={item.name}
            variant={i === 1 ? 'secondary' : 'ghost'}
            size="xs"
            aria-current={i === 1 ? 'page' : undefined}
            className="gap-1.5"
          >
            {i > 0 ? <RepoDot color={REPOS[i - 1].color} /> : null}
            {item.name}
            {i === 1 ? <span className="text-2xs text-muted-foreground">3 changed</span> : null}
          </Button>
        )
      )}
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <GitBranch className="size-3.5" />
        <span className="font-mono">checkout-flow</span>
        <ShortcutKeyCombo keys={['⌘', '⌥', '1–9']} />
      </span>
    </nav>
  )
})

export const rootViewSummary = defineFixture({
  width: 320,
  render: () => (
    <div className="w-full rounded-md border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="truncate text-sm font-medium">checkout-flow</div>
        <div className="mt-1 text-xs text-muted-foreground">3 repos · 1 with changes</div>
      </div>
      <div className="space-y-1 p-2">
        {[
          { r: REPOS[0], l: 'checkout-flow', s: '3 changed · 2 ahead' },
          { r: REPOS[1], l: 'checkout-flow', s: 'Clean' },
          { r: REPOS[2], l: 'checkout-flow', s: '1 unpushed commit' }
        ].map((row) => (
          <div
            key={row.r.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-accent"
          >
            <RepoDot color={row.r.color} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{row.r.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{row.l}</div>
            </div>
            <span className="text-xs text-muted-foreground">{row.s}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export const deleteConfirmPartialFailure = defineFixture({
  width: 480,
  render: () => (
    <ComposerShell>
      <div className="text-base font-semibold">Delete checkout-flow?</div>
      <p className="mt-1 text-sm text-muted-foreground">
        This removes the workspace folder and 3 worktrees. Commits and branches are kept in each
        project.
      </p>
      <ul className="mt-4 divide-y divide-border rounded-md border border-border text-sm">
        {[
          { r: REPOS[0], note: '3 uncommitted files', warn: true, st: 'idle' },
          { r: REPOS[1], note: 'Clean', warn: false, st: 'done' },
          { r: REPOS[2], note: '1 unpushed commit on checkout-flow', warn: true, st: 'failed' }
        ].map((row) => (
          <li key={row.r.name} className="flex items-start gap-2 px-3 py-2">
            <RepoDot color={row.r.color} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {row.r.name} <span className="font-mono text-xs text-muted-foreground">checkout-flow</span>
              </div>
              <div
                className={cn(
                  'text-xs',
                  row.warn ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {row.st === 'failed' ? 'Could not remove: files in use. Close terminals and retry.' : row.note}
              </div>
            </div>
            {row.st === 'done' ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5" /> Removed
              </span>
            ) : null}
            {row.st === 'failed' ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="size-3.5" /> Failed
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost">Close</Button>
        <Button variant="destructive">
          <RotateCw /> Retry 1 failed
        </Button>
      </div>
    </ComposerShell>
  )
})

export const mobileGroupList = defineFixture({
  width: 390,
  render: () => (
    <div className="w-full rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 px-1 py-2">
        <FolderTree className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">checkout-flow</div>
          <div className="text-xs text-muted-foreground">3 repos · 1 with changes</div>
        </div>
        <ChevronDown className="size-4 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        {[
          { r: REPOS[0], s: '3 changed' },
          { r: REPOS[1], s: 'Clean' },
          { r: REPOS[2], s: '1 unpushed' }
        ].map((row) => (
          <div
            key={row.r.name}
            className="ml-4 flex min-h-12 items-center gap-2 rounded-lg border border-border px-3"
          >
            <RepoDot color={row.r.color} />
            <span className="flex-1 text-sm font-medium">{row.r.name}</span>
            <span className="text-xs text-muted-foreground">{row.s}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
        ))}
      </div>
      <Button variant="outline" className="mt-3 h-11 w-full">
        Open terminal in workspace folder
      </Button>
    </div>
  )
})
