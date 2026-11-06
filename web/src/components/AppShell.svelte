<script lang="ts">
  import { onMount } from 'svelte'
  import {
    DetailDrawer,
    IconButton,
    PageHeader,
    SegmentedControl,
    Tooltip,
    TopBar,
    type TypeaheadOption,
  } from '@kenn-io/kit-ui'
  import KanbanIcon from '@lucide/svelte/icons/square-kanban'
  import Rows2Icon from '@lucide/svelte/icons/rows-2'
  import Rows4Icon from '@lucide/svelte/icons/rows-4'
  import ListIcon from '@lucide/svelte/icons/list'
  import Columns3Icon from '@lucide/svelte/icons/columns-3'
  import LayoutPanelLeftIcon from '@lucide/svelte/icons/layout-panel-left'
  import LayoutPanelTopIcon from '@lucide/svelte/icons/layout-panel-top'
  import MonitorIcon from '@lucide/svelte/icons/monitor'
  import MenuIcon from '@lucide/svelte/icons/menu'
  import MoonIcon from '@lucide/svelte/icons/moon'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SunIcon from '@lucide/svelte/icons/sun'

  import type { TokenOut, UIIssueReference } from '../lib/api/generated'
  import type { WebDaemonInfo } from '../lib/daemons/client'
  import type { KataRoute, ShareableFilters, SystemView } from '../lib/router'
  import {
    deriveKataAreas,
    defaultKataTaskSearchFilters,
    projectKataWorkspaceView,
  } from '../lib/kata/authority'
  import {
    boardColumnLimitsFromMetadata,
    boardColumnsFromMetadata,
    unionBoardColumns,
    type BoardColumnID,
    type BoardMovePlan,
  } from '../lib/kata/board'
  import { createKataLinkFilters } from '../lib/kata/linkFilters'
  import { normalizeKataUISnapshot } from '../lib/kata/projection'
  import type {
    KataTaskMutationResponse,
    KataCommentReplyIntent,
    KataTaskCloseRequest,
    KataTaskEditPatch,
    KataTaskSearchFilters,
    KataTaskStatusFilter,
    KataTaskSummary,
    KataTaskViewName,
  } from '../lib/kata/types'
  import type { UISnapshot } from '../lib/state/snapshot'
  import { defaultPreferences, type Preferences } from '../lib/state/preferences'
  import AccessManagement from './AccessManagement.svelte'
  import BoardColumnsEditor from './BoardColumnsEditor.svelte'
  import IssueBoard from './IssueBoard.svelte'
  import type { MutationContext, MutationResult } from '../lib/mutations/controller'
  import CredentialAudit from './CredentialAudit.svelte'
  import ProjectSyncStatus from './ProjectSyncStatus.svelte'
  import IssueCollection from './IssueCollection.svelte'
  import IssueDetail from './IssueDetail.svelte'
  import IssueFilters from './IssueFilters.svelte'
  import IssueGraph from './IssueGraph.svelte'
  import InboxProjectChooser from './InboxProjectChooser.svelte'
  import KataDaemonSwitcher from './KataDaemonSwitcher.svelte'
  import QuickCapture from './QuickCapture.svelte'
  import Sidebar from './Sidebar.svelte'
  import SplitLayout from './SplitLayout.svelte'

  type AppRoute = Exclude<KataRoute, { kind: 'route-error' }>
  type ChildParent = { projectID: number; projectUID: string; issueUID: string }

  interface Props {
    route: AppRoute
    snapshot: UISnapshot
    loading: boolean
    canMutate: boolean
    mutationPending: boolean
    mutationMessage?: string | undefined
    draftResetGeneration: number
    draftFenceGeneration?: number | undefined
    ownerOptions: TypeaheadOption[]
    preferences?: Preferences | undefined
    daemons?: WebDaemonInfo[] | undefined
    activeDaemonID?: string | undefined
    daemonSwitching?: boolean | undefined
    reconnecting?: boolean | undefined
    stale?: boolean | undefined
    readOnly?: boolean | undefined
    daemonError?: string | undefined
    credentialTokens?: readonly TokenOut[] | undefined
    credentialLoading?: boolean | undefined
    credentialError?: string | undefined
    onPreferencesChange?: ((preferences: Preferences) => void) | undefined
    onSelectDaemon?: ((id: string) => void) | undefined
    onAccessMutation?:
      | ((
          draft: unknown,
          mutate: (context: MutationContext) => Promise<MutationResult>,
        ) => Promise<boolean>)
      | undefined
    onRefreshCredentials?: (() => void | Promise<void>) | undefined
    onBackFromCredentials?: (() => void | Promise<void>) | undefined
    onSearchEmpty?: (() => void) | undefined
    onNavigate: (route: AppRoute) => void | Promise<void>
    onCreateProject: (name: string) => Promise<KataTaskMutationResponse>
    onDesignateInbox: (projectUID: string) => Promise<void>
    onCreateIssue: (title: string, parent?: ChildParent) => void | Promise<void>
    searchReferences: (query: string) => Promise<UIIssueReference[]>
    onMoveIssue: (toProjectUID: string) => boolean | Promise<boolean>
    onPatchMetadata: (uid: string, patch: Record<string, unknown>) => boolean | Promise<boolean>
    onUploadAttachment?: ((uid: string, file: File) => Promise<void>) | undefined
    onAddComment: (
      uid: string,
      body: string,
      reply?: KataCommentReplyIntent,
    ) => boolean | Promise<boolean>
    onEditIssue: (uid: string, patch: KataTaskEditPatch) => boolean | Promise<boolean>
    onAssignOwner: (uid: string, owner: string) => boolean | Promise<boolean>
    onClaimAssignment?:
      | ((uid: string, ttlSeconds: number) => boolean | Promise<boolean>)
      | undefined
    onUnassignOwner: (uid: string) => boolean | Promise<boolean>
    onSetPriority: (uid: string, priority: number | null) => boolean | Promise<boolean>
    onAddLabel: (uid: string, label: string) => boolean | Promise<boolean>
    onRemoveLabel: (uid: string, label: string) => void | Promise<void>
    onCloseIssue: (request: KataTaskCloseRequest) => boolean | Promise<boolean>
    onReopenIssue: () => void | Promise<void>
    onDeleteIssue: () => boolean | Promise<boolean>
    onCreateRecurrence: (
      projectID: number,
      input: import('../lib/kata/types').KataCreateRecurrenceInput,
    ) => Promise<void>
    onPatchRecurrence: (
      id: number,
      input: import('../lib/kata/types').KataPatchRecurrenceInput,
      etag: string,
    ) => Promise<void>
    onDeleteRecurrence: (recurrence: import('../lib/kata/types').KataRecurrence) => Promise<boolean>
    onMoveBoardIssue?:
      | ((issue: KataTaskSummary, plan: BoardMovePlan) => Promise<boolean>)
      | undefined
    onCompleteBoardIssue?:
      | ((issue: KataTaskSummary, request: KataTaskCloseRequest) => Promise<boolean>)
      | undefined
    /** Saves a project board's columns and their limits to that project's metadata. */
    onSaveBoardColumns?:
      | ((
          projectUID: string | undefined,
          columns: string[],
          limits: Record<string, number>,
        ) => Promise<boolean>)
      | undefined
    /** Creates an issue in a project, with a board column's label when it has one. */
    onCreateBoardIssue?:
      | ((projectID: number, title: string, label: string | undefined) => Promise<boolean>)
      | undefined
    /** Loads the next page of the board's closed issues from the server. */
    onShowMoreBoardDone?: (() => void) | undefined
  }

  let {
    route,
    snapshot,
    loading,
    canMutate,
    mutationPending,
    mutationMessage = undefined,
    draftResetGeneration,
    draftFenceGeneration = 0,
    ownerOptions,
    preferences = defaultPreferences,
    daemons = [],
    activeDaemonID = undefined,
    daemonSwitching = false,
    reconnecting = false,
    stale = false,
    readOnly = false,
    daemonError = undefined,
    credentialTokens = [],
    credentialLoading = false,
    credentialError = undefined,
    onPreferencesChange = () => {},
    onSelectDaemon = () => {},
    onAccessMutation = undefined,
    onRefreshCredentials = () => {},
    onBackFromCredentials = () => {},
    onSearchEmpty = undefined,
    onNavigate,
    onCreateProject,
    onDesignateInbox,
    onCreateIssue,
    searchReferences,
    onMoveIssue,
    onPatchMetadata,
    onUploadAttachment,
    onAddComment,
    onEditIssue,
    onAssignOwner,
    onClaimAssignment = async () => false,
    onUnassignOwner,
    onSetPriority,
    onAddLabel,
    onRemoveLabel,
    onCloseIssue,
    onReopenIssue,
    onDeleteIssue,
    onCreateRecurrence,
    onPatchRecurrence,
    onDeleteRecurrence,
    onMoveBoardIssue = async () => false,
    onCompleteBoardIssue = async () => false,
    onSaveBoardColumns = async () => false,
    onShowMoreBoardDone = undefined,
    onCreateBoardIssue = undefined,
  }: Props = $props()

  let connectionNow = $state(Date.now())
  onMount(() => {
    const timer = setInterval(() => {
      connectionNow = Date.now()
    }, 1000)
    return () => clearInterval(timer)
  })
  let activeConnection = $derived(daemons.find((daemon) => daemon.id === activeDaemonID))
  let credentialExpired = $derived(
    snapshot.capabilities.expires_at !== undefined &&
      Date.parse(snapshot.capabilities.expires_at) <= connectionNow,
  )
  let connectionStatus = $derived(
    daemonSwitching
      ? 'Connecting'
      : activeConnection?.health === 'auth_required' ||
          /authentication required/i.test(daemonError ?? '')
        ? 'Authentication required'
        : credentialExpired
          ? 'Credential expired'
          : reconnecting
            ? 'Reconnecting'
            : stale || daemonError || activeConnection?.health === 'down'
              ? 'Connection unavailable'
              : activeConnection?.health === 'upgrade_required'
                ? 'Upgrade required'
                : loading
                  ? 'Connecting'
                  : readOnly || !snapshot.capabilities.writable
                    ? 'Read-only'
                    : 'Connected',
  )
  const actorlessConnectionLabels: Record<string, string> = {
    none: 'Local connection',
    web_local: 'Local connection',
    static_token: 'Shared daemon token',
    bootstrap: 'Bootstrap token',
    insecure_readonly: 'Anonymous (read-only)',
    unauthenticated_private_network: 'Unauthenticated private network',
    trusted_proxy_absent: 'Proxy without account',
  }
  let connectionAccount = $derived(
    daemonSwitching || stale || reconnecting || loading || daemonError || credentialExpired
      ? '—'
      : snapshot.capabilities.account ||
          (snapshot.capabilities.auth_kind === undefined
            ? 'Not reported by hub'
            : actorlessConnectionLabels[snapshot.capabilities.auth_kind] || 'No account'),
  )

  let captureOpen = $state(false)
  let inboxChooserOpen = $state(false)
  let mobileNavigationOpen = $state(false)
  let linkFilters = $state(createKataLinkFilters('all'))
  let navigationGeneration = $state(0)
  let credentialRoute = $derived(route.view === 'credentials')
  let accessAdministrationAvailable = $derived(
    snapshot.capabilities.access_admin === true &&
      !credentialExpired &&
      !stale &&
      !reconnecting &&
      !daemonError &&
      !daemonSwitching &&
      (!activeDaemonID || activeConnection?.local === true),
  )
  let graphSelectedUID = $derived<string | null>(
    route.issueUID && route.graph ? route.issueUID : null,
  )

  let projection = $derived(normalizeKataUISnapshot(snapshot))
  let inboxProject = $derived(
    projection.projects.find((project) => project.metadata.role === 'inbox'),
  )
  let hasInbox = $derived(inboxProject !== undefined)
  let viewName = $derived(viewNameForRoute(route))
  let searchFilters = $derived(searchFiltersForRoute(route, viewName))
  let currentView = $derived(
    projectKataWorkspaceView({
      view: viewName,
      filters: searchFilters,
      snapshot: projection,
      issues: projection.issues,
    }),
  )
  let pendingQuery = $state('')
  let countedQuery = $state('')
  function submitSearch(query: string): void {
    query = query.trim()
    if (!query || query === countedQuery) return
    pendingQuery = query
  }
  $effect(() => {
    if (loading || stale) return
    const query = searchFilters.query.trim()
    if (query !== countedQuery) countedQuery = ''
    if (!pendingQuery || query !== pendingQuery) return
    if (currentView.groups.every((group) => group.issues.length === 0)) {
      countedQuery = pendingQuery
      onSearchEmpty?.()
    }
    pendingQuery = ''
  })
  let areas = $derived(deriveKataAreas(projection.projects))
  let selectedProject = $derived.by(() => {
    const scope = searchFilters.scope
    return scope.kind === 'project'
      ? projection.projects.find((project) => project.uid === scope.project_uid)
      : undefined
  })
  let boardRoute = $derived(route.board === true && !credentialRoute)
  // A project board uses its own columns; the all-projects board shows the
  // union of every project's columns.
  let boardColumns = $derived(
    selectedProject
      ? boardColumnsFromMetadata(selectedProject.metadata)
      : unionBoardColumns(projection.projects.map((project) => project.metadata)),
  )

  // Limits belong to a project board; the all-projects board shows none.
  let boardLimits = $derived(
    selectedProject ? boardColumnLimitsFromMetadata(selectedProject.metadata) : {},
  )
  let boardIssues = $derived(
    selectedProject
      ? projection.issues.filter((issue) => issue.project_uid === selectedProject!.uid)
      : projection.issues,
  )
  let boardLabelSuggestions = $derived(
    [...new Set(projection.issues.flatMap((issue) => issue.labels ?? []))].sort(),
  )
  let columnsEditorOpen = $state(false)
  let selectedCommentUID = $state<string | undefined>()
  let returnComment = $state<{ issueUID: string; commentUID: string } | undefined>()
  let selectedIssueUID = $derived(route.issueUID ?? null)
  let scopedAuthority = $derived(snapshot.capabilities.scope !== undefined)
  let projectWideMutationAllowed = $derived(canMutate && !scopedAuthority)
  let childParent = $derived.by<ChildParent | undefined>(() => {
    const issue = projection.selected_detail?.issue
    if (!issue) return undefined
    return {
      projectID: issue.project_id,
      projectUID: issue.project_uid,
      issueUID: issue.uid,
    }
  })
  const controlID = $props.id()
  const newTaskReasonID = `${controlID}-new-task-reason`
  let writeBlockedReason = $derived(
    canMutate
      ? undefined
      : stale
        ? 'Changes are paused while the snapshot may be out of date.'
        : readOnly || !snapshot.capabilities.writable
          ? 'This credential is read-only.'
          : 'Changes are paused while Kata connects.',
  )
  let pendingReason = $derived(
    mutationPending ? 'Wait for the current change to finish.' : undefined,
  )
  let newTaskBlockedReason = $derived(
    writeBlockedReason ??
      (scopedAuthority && childParent === undefined
        ? 'Open a task first. This credential can only add subtasks.'
        : pendingReason),
  )
  let projectCreationBlockedReason = $derived(
    writeBlockedReason ??
      (scopedAuthority ? 'This credential cannot create projects.' : pendingReason),
  )

  let columnsEditBlockedReason = $derived(
    selectedProject
      ? (writeBlockedReason ??
          (scopedAuthority ? 'This credential cannot change project settings.' : pendingReason))
      : 'This board combines every project’s columns. Open a project to edit its columns.',
  )

  function toggleBoardColumn(columnID: BoardColumnID): void {
    const collapsed = preferences.collapsedBoardColumns.includes(columnID)
    onPreferencesChange({
      ...preferences,
      collapsedBoardColumns: collapsed
        ? preferences.collapsedBoardColumns.filter((id) => id !== columnID)
        : [...preferences.collapsedBoardColumns, columnID],
    })
  }

  function navigate(next: AppRoute): void {
    const query = (next.filters.text ?? '').trim()
    if (query !== countedQuery) countedQuery = ''
    if (query !== pendingQuery) pendingQuery = ''
    navigationGeneration += 1
    void onNavigate(next)
  }

  function openView(name: KataTaskViewName): void {
    mobileNavigationOpen = false
    navigate({
      kind: 'kata',
      view: systemViewName(name),
      graph: false,
      // The board spans a project or all open work, not the dated system views.
      ...(route.board && name === 'all' ? { board: true as const } : {}),
      filters: emptyShareableFilters(),
    })
  }

  function openProject(projectUID: string): void {
    mobileNavigationOpen = false
    navigate({
      kind: 'kata',
      projectUID,
      graph: false,
      ...(route.board ? { board: true as const } : {}),
      filters: emptyShareableFilters(),
    })
  }

  function openCredentials(): void {
    mobileNavigationOpen = false
    navigate({
      kind: 'kata',
      view: 'credentials',
      graph: false,
      filters: emptyShareableFilters(),
    })
  }

  // The landing route has no view and means Inbox, but adding a scope or issue
  // to it would read as All Open. Pin Inbox so these moves stay in Inbox.
  function withResolvedView(current: AppRoute): AppRoute {
    if (current.view || viewName !== 'inbox') return current
    return { ...current, view: 'inbox' }
  }

  function updateFilters(
    filters: KataTaskSearchFilters,
    changed: keyof KataTaskSearchFilters,
  ): void {
    const shareable = shareableFilters(filters, viewName, changed)
    if (filters.scope.kind === 'project') {
      navigate({
        ...withResolvedView(route),
        projectUID: filters.scope.project_uid,
        filters: shareable,
      })
      return
    }
    const next = { ...route, filters: shareable }
    delete next.projectUID
    navigate(next)
  }

  function selectIssue(issueUID: string): void {
    navigate({
      ...withResolvedView(route),
      issueUID,
      graph: false,
      filters: route.filters,
    })
  }

  function openGraph(issueUID: string): void {
    const next: AppRoute = {
      ...withResolvedView(route),
      issueUID,
      graph: true,
      filters: route.filters,
    }
    delete next.board
    navigate(next)
  }

  function closeIssueDrawer(): void {
    const next = { ...route }
    delete next.issueUID
    navigate(next)
  }

  function setLayout(layout: string): void {
    const next: AppRoute = { ...route, graph: false }
    if (layout === 'board') {
      next.board = true
      // The board covers a project or all open work; dated views fall back to All Open.
      if (next.view && next.view !== 'all-open' && !next.projectUID) next.view = 'all-open'
      else if (next.view && next.projectUID) delete next.view
    } else {
      delete next.board
    }
    // Status filters mean different defaults in each layout.
    navigate({ ...next, filters: { ...next.filters, status: [] } })
  }

  function closeGraph(): void {
    if (!route.issueUID) return
    navigate({ ...route, graph: false })
  }

  function toggleSplitDirection(): void {
    onPreferencesChange({
      ...preferences,
      splitDirection: preferences.splitDirection === 'vertical' ? 'horizontal' : 'vertical',
    })
  }

  function resizeSplit(size: number): void {
    onPreferencesChange({ ...preferences, splitSize: size })
  }

  function cycleTheme(): void {
    const theme =
      preferences.theme === 'system' ? 'light' : preferences.theme === 'light' ? 'dark' : 'system'
    onPreferencesChange({ ...preferences, theme })
  }

  function beginNewTask(): void {
    if (newTaskBlockedReason) return
    if (scopedAuthority) {
      captureOpen = true
      return
    }
    if (hasInbox) captureOpen = true
    else inboxChooserOpen = true
  }

  async function chooseInbox(projectUID: string): Promise<void> {
    await onDesignateInbox(projectUID)
    inboxChooserOpen = false
    captureOpen = true
  }

  function submitCapture(title: string): void | Promise<void> {
    return scopedAuthority && childParent ? onCreateIssue(title, childParent) : onCreateIssue(title)
  }

  function themeLabel(): string {
    return preferences.theme[0]!.toUpperCase() + preferences.theme.slice(1)
  }

  function viewNameForRoute(current: AppRoute): KataTaskViewName {
    if (current.view === 'credentials') return 'all'
    // The board spans a project or all open work, never a dated system view.
    if (current.board) return 'all'
    if (current.view) return current.view === 'all-open' ? 'all' : current.view
    return current.projectUID || current.issueUID ? 'all' : 'inbox'
  }

  function systemViewName(name: KataTaskViewName): SystemView {
    return name === 'all' ? 'all-open' : name
  }

  function searchFiltersForRoute(
    current: AppRoute,
    currentView: KataTaskViewName,
  ): KataTaskSearchFilters {
    const defaults = defaultKataTaskSearchFilters(currentView)
    if (current.board) defaults.status = 'all'
    return {
      scope: current.projectUID
        ? { kind: 'project', project_uid: current.projectUID }
        : { kind: 'all' },
      status: statusFilter(current.filters.status, defaults.status),
      owner: current.filters.owner.length === 1 ? current.filters.owner[0]! : '',
      label: current.filters.label.length === 1 ? current.filters.label[0]! : '',
      query: current.filters.text ?? '',
      relationships: [...current.filters.relationship],
    }
  }

  function statusFilter(
    values: readonly string[],
    fallback: KataTaskStatusFilter,
  ): KataTaskStatusFilter {
    if (values.length !== 1) return values.length === 0 ? fallback : 'all'
    const value = values[0]
    return value === 'open' || value === 'ready' || value === 'closed' || value === 'all'
      ? value
      : 'all'
  }

  function shareableFilters(
    filters: KataTaskSearchFilters,
    currentView: KataTaskViewName,
    changed: keyof KataTaskSearchFilters,
  ): ShareableFilters {
    const defaultStatus = route.board ? 'all' : defaultKataTaskSearchFilters(currentView).status
    const result: ShareableFilters = {
      status:
        changed === 'status'
          ? filters.status === defaultStatus
            ? []
            : [filters.status]
          : [...route.filters.status],
      owner:
        changed === 'owner'
          ? filters.owner.trim()
            ? [filters.owner.trim()]
            : []
          : [...route.filters.owner],
      label:
        changed === 'label'
          ? filters.label.trim()
            ? [filters.label.trim()]
            : []
          : [...route.filters.label],
      relationship: [...(filters.relationships ?? [])],
    }
    if (filters.query.trim()) result.text = filters.query.trim()
    return result
  }

  function emptyShareableFilters(): ShareableFilters {
    return { status: [], owner: [], label: [], relationship: [] }
  }

  function scopeLabel(): string {
    if (selectedProject) return selectedProject.name
    return (
      [
        { name: 'inbox', label: 'Inbox' },
        { name: 'today', label: 'Today' },
        { name: 'delegated', label: 'Delegated' },
        { name: 'scheduled', label: 'Scheduled' },
        { name: 'all', label: 'All Open' },
        { name: 'logbook', label: 'Logbook' },
      ].find((view) => view.name === viewName)?.label ?? 'Kata'
    )
  }
</script>

{#snippet newTaskButton()}
  <!-- aria-disabled keeps the blocked button focusable so keyboard users reach its reason. -->
  <button
    type="button"
    class="accent-button header-action"
    aria-label="New task"
    aria-disabled={newTaskBlockedReason ? 'true' : undefined}
    aria-describedby={newTaskBlockedReason ? newTaskReasonID : undefined}
    title={newTaskBlockedReason ? undefined : 'New task'}
    onclick={beginNewTask}
  >
    <PlusIcon size={13} strokeWidth={1.9} aria-hidden="true" />
    <span class="header-action-label">New task</span>
  </button>
{/snippet}

{#snippet navigationSidebar()}
  <Sidebar
    {areas}
    currentView={{
      name: currentView.view,
      groups: currentView.groups,
      fetched_at: currentView.fetched_at,
    }}
    {searchFilters}
    {projectCreationBlockedReason}
    {draftFenceGeneration}
    credentialAuditAvailable={snapshot.capabilities.token_audit_read === true}
    credentialAuditActive={credentialRoute}
    onOpenView={openView}
    onOpenProject={openProject}
    {onCreateProject}
    onOpenCredentials={openCredentials}
  />
{/snippet}

<section class="kata-feature" aria-label="Kata workspace">
  {#if connectionStatus !== 'Connected'}
    <div class="active-connection" role="status" aria-label="Active connection">
      <span
        >Hub: <strong>{activeDaemonID ?? (globalThis.location?.host || 'Local daemon')}</strong
        ></span
      >
      <span>Account: <strong>{connectionAccount}</strong></span>
      <span>Credential: <strong>{connectionStatus}</strong></span>
      {#if stale}
        <span>Snapshot may be out of date. Changes are paused.</span>
      {/if}
    </div>
  {/if}
  <TopBar class="kata-header" ariaLabel="Kata workspace">
    {#snippet left()}
      <h1 class="kata-brand">Kata</h1>
      {#if daemons.length > 0}
        <KataDaemonSwitcher
          {daemons}
          activeId={activeDaemonID}
          activeStatusLabel={daemonError ?? (reconnecting ? 'Reconnecting…' : undefined)}
          activeStatusTone={daemonError ? 'error' : undefined}
          disabled={daemonSwitching || mutationPending}
          onSelect={onSelectDaemon}
        />
      {:else if daemonError || reconnecting}
        <span
          class="daemon-fallback-status"
          class:error={daemonError}
          role="status"
          aria-label="Kata daemon status"
        >
          {daemonError ?? 'Reconnecting…'}
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      <div class="kata-header-actions">
        <span class="mobile-navigation-trigger">
          <IconButton
            ariaLabel="Open navigation"
            title="Open navigation"
            onclick={() => {
              mobileNavigationOpen = true
            }}
          >
            <MenuIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        </span>
        <IconButton ariaLabel={`Theme: ${themeLabel()}`} title="Change theme" onclick={cycleTheme}>
          {#if preferences.theme === 'light'}
            <SunIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {:else if preferences.theme === 'dark'}
            <MoonIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {:else}
            <MonitorIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {/if}
        </IconButton>
        {#if !credentialRoute}
          <SegmentedControl
            class="layout-toggle"
            ariaLabel="Layout"
            value={boardRoute ? 'board' : 'list'}
            options={[
              { value: 'list', label: 'List', title: 'List and detail' },
              { value: 'board', label: 'Board', title: 'Columns of cards' },
            ]}
            onchange={setLayout}
          >
            {#snippet segment(option)}
              <span class="layout-segment">
                {#if option.value === 'board'}
                  <KanbanIcon size={14} strokeWidth={1.8} aria-hidden="true" />
                {:else}
                  <ListIcon size={14} strokeWidth={1.8} aria-hidden="true" />
                {/if}
                <span class="layout-segment-label">{option.label}</span>
              </span>
            {/snippet}
          </SegmentedControl>
        {/if}
        {#if !credentialRoute && !boardRoute}
          <IconButton
            ariaLabel={preferences.splitDirection === 'vertical'
              ? 'Switch to side-by-side layout'
              : 'Switch to stacked layout'}
            title={preferences.splitDirection === 'vertical'
              ? 'Side-by-side (list left, detail right)'
              : 'Stacked (list top, detail bottom)'}
            onclick={toggleSplitDirection}
          >
            {#if preferences.splitDirection === 'vertical'}
              <LayoutPanelLeftIcon size={15} strokeWidth={1.8} aria-hidden="true" />
            {:else}
              <LayoutPanelTopIcon size={15} strokeWidth={1.8} aria-hidden="true" />
            {/if}
          </IconButton>
        {/if}
        {#if !credentialRoute}
          {#if newTaskBlockedReason}
            <Tooltip text={newTaskBlockedReason} align="end">
              {@render newTaskButton()}
            </Tooltip>
            <span id={newTaskReasonID} class="kit-sr-only">{newTaskBlockedReason}</span>
          {:else}
            {@render newTaskButton()}
          {/if}
        {/if}
      </div>
    {/snippet}
  </TopBar>
  {#if selectedProject && !credentialRoute && !stale && !daemonSwitching && !reconnecting && !credentialExpired && !daemonError && !scopedAuthority && (!activeDaemonID || activeConnection?.local === true)}
    {#key `${activeDaemonID ?? 'direct'}:${draftFenceGeneration}:${selectedProject.uid}`}
      <ProjectSyncStatus projectID={selectedProject.id} projectUID={selectedProject.uid} />
    {/key}
  {/if}
  <div class="kata-layout" aria-busy={loading}>
    <div class="desktop-navigation">
      {@render navigationSidebar()}
    </div>

    <div class="kata-main">
      {#if credentialRoute}
        <div class="credential-scene">
          <CredentialAudit
            tokens={credentialTokens}
            loading={credentialLoading}
            error={snapshot.capabilities.token_audit_read
              ? credentialError
              : 'Credential inventory is unavailable for this session.'}
            onRefresh={onRefreshCredentials}
            onBack={onBackFromCredentials}
          />
          {#if accessAdministrationAvailable}
            <section class="access-administration" aria-label="Teams and visibility">
              <PageHeader level={2} title="Teams and visibility" />
              {#if onAccessMutation}
                {#key `${activeDaemonID ?? 'direct'}:${draftFenceGeneration}`}
                  <AccessManagement
                    projects={snapshot.catalog}
                    pending={mutationPending || loading || !accessAdministrationAvailable}
                    message={mutationMessage}
                    onMutation={onAccessMutation}
                  />
                {/key}
              {/if}
            </section>
          {/if}
        </div>
      {:else}
        {#if mutationMessage}
          <p class="mutation-message" role="alert">{mutationMessage}</p>
        {/if}
        {#if boardRoute}
          {@render boardPane()}
        {:else if route.issueUID}
          <SplitLayout
            orientation={preferences.splitDirection}
            primarySize={preferences.splitSize}
            minPrimary={preferences.splitDirection === 'vertical' ? 220 : 320}
            minSecondary={preferences.splitDirection === 'vertical' ? 220 : 360}
            responsiveBreakpoint={700}
            ariaLabel="Resize Kata panes"
            onResize={resizeSplit}
            primary={listPane}
            secondary={detailPane}
          />
        {:else}
          {@render listPane()}
        {/if}
      {/if}
    </div>
  </div>
</section>

{#if boardRoute && route.issueUID}
  <DetailDrawer
    title={projection.selected_detail?.issue.title ?? 'Issue'}
    ariaLabel="Issue detail"
    width="min(780px, 100vw)"
    onclose={closeIssueDrawer}
  >
    <div class="drawer-detail">
      {@render detailPane()}
    </div>
  </DetailDrawer>
{/if}

{#if mobileNavigationOpen}
  <DetailDrawer
    title="Kata navigation"
    width="min(320px, calc(100vw - 40px))"
    onclose={() => {
      mobileNavigationOpen = false
    }}
  >
    {@render navigationSidebar()}
  </DetailDrawer>
{/if}

{#snippet listPane()}
  <div class="list-column kata-list">
    {#if route.issueUID && route.graph}
      {#if projection.selected_graph && projection.selected_detail}
        <IssueGraph
          graph={projection.selected_graph}
          sourceIssue={projection.selected_detail.issue}
          selectedUID={graphSelectedUID}
          layoutDirection={preferences.splitDirection === 'horizontal' ? 'LR' : 'TB'}
          onBack={closeGraph}
          onSelectIssue={(uid) => {
            graphSelectedUID = uid
          }}
        />
      {:else}
        <section class="detail-unavailable" role="status" aria-label="Selected issue status">
          The reachable graph is unavailable from the current authority.
        </section>
      {/if}
    {:else}
      <IssueFilters
        filters={searchFilters}
        projects={projection.projects}
        onChange={updateFilters}
        onSubmitSearch={submitSearch}
      />
      <IssueCollection
        {navigationGeneration}
        currentView={{
          name: currentView.view,
          groups: currentView.groups,
          fetched_at: currentView.fetched_at,
        }}
        issueCatalog={projection.issues}
        scopeLabel={scopeLabel()}
        scopedProjectName={selectedProject?.name ?? null}
        {selectedIssueUID}
        {loading}
        statusFilter={searchFilters.status}
        readyIssueUIDs={projection.member_issue_uid_set}
        onSelect={(issue) => selectIssue(issue.uid)}
        onOpenGraph={(issue) => openGraph(issue.uid)}
      />
    {/if}
  </div>
{/snippet}

{#snippet boardPane()}
  <div class="list-column board-pane">
    <div class="board-toolbar">
      <IssueFilters
        filters={searchFilters}
        projects={projection.projects}
        onChange={updateFilters}
        onSubmitSearch={submitSearch}
      />
      <SegmentedControl
        class="density-toggle"
        ariaLabel="Card density"
        value={preferences.boardCompact ? 'compact' : 'comfortable'}
        options={[
          { value: 'comfortable', label: 'Comfortable cards', title: 'Comfortable cards' },
          { value: 'compact', label: 'Compact cards', title: 'Compact cards: one line each' },
        ]}
        onchange={(value) =>
          onPreferencesChange({ ...preferences, boardCompact: value === 'compact' })}
      >
        {#snippet segment(option)}
          {#if option.value === 'compact'}
            <Rows4Icon size={14} strokeWidth={1.8} aria-hidden="true" />
          {:else}
            <Rows2Icon size={14} strokeWidth={1.8} aria-hidden="true" />
          {/if}
        {/snippet}
      </SegmentedControl>
      <span class="board-columns-action">
        {#if columnsEditBlockedReason}
          <Tooltip text={columnsEditBlockedReason} align="end">
            <IconButton ariaLabel="Edit board columns" disabled>
              <Columns3Icon size={15} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        {:else}
          <IconButton
            ariaLabel="Edit board columns"
            title="Edit board columns"
            onclick={() => {
              columnsEditorOpen = true
            }}
          >
            <Columns3Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        {/if}
      </span>
    </div>
    <IssueBoard
      issues={boardIssues}
      columns={boardColumns}
      {selectedIssueUID}
      showProject={!selectedProject}
      {loading}
      moveBlockedReason={writeBlockedReason ??
        (scopedAuthority ? 'This credential can only change one task.' : undefined)}
      onOpenIssue={(issue) => selectIssue(issue.uid)}
      onMoveIssue={onMoveBoardIssue}
      onCompleteIssue={onCompleteBoardIssue}
      doneTotal={snapshot.closed_total}
      onShowMoreDone={onShowMoreBoardDone}
      compact={preferences.boardCompact}
      limits={boardLimits}
      onAddCard={selectedProject &&
      onCreateBoardIssue &&
      !readOnly &&
      snapshot.capabilities.writable &&
      !scopedAuthority
        ? (title, label) => onCreateBoardIssue(selectedProject!.id, title, label)
        : undefined}
      collapsedColumns={preferences.collapsedBoardColumns}
      onToggleColumn={toggleBoardColumn}
    />
  </div>
  <BoardColumnsEditor
    open={columnsEditorOpen}
    columns={boardColumns}
    suggestions={boardLabelSuggestions}
    savedWhere={`Saved to ${selectedProject?.name ?? 'this project'} for everyone who opens its board.`}
    limits={boardLimits}
    onSave={(columns, limits) => onSaveBoardColumns(selectedProject?.uid, columns, limits)}
    onClose={() => {
      columnsEditorOpen = false
    }}
  />
{/snippet}

{#snippet detailPane()}
  <div class="detail-column">
    {#if projection.selected_state === 'available' && projection.selected_detail}
      <IssueDetail
        issue={projection.selected_detail}
        events={[...projection.selected_history]}
        issueCatalog={projection.issues}
        {searchReferences}
        {linkFilters}
        onLinkFiltersChange={(next) => {
          linkFilters = next
        }}
        projects={[...projection.projects]}
        {ownerOptions}
        selectedRecurrences={[...projection.selected_recurrences]}
        actionsDisabled={!canMutate || mutationPending}
        authorityBlocked={!canMutate}
        attachmentsEnabled={snapshot.capabilities.attachments ?? false}
        {onUploadAttachment}
        administrativeActionsAllowed={!scopedAuthority}
        {draftResetGeneration}
        {draftFenceGeneration}
        movePending={mutationPending}
        {onMoveIssue}
        {onPatchMetadata}
        {onAddComment}
        commentError={mutationMessage}
        {selectedCommentUID}
        {returnComment}
        {onEditIssue}
        {onAssignOwner}
        {onClaimAssignment}
        {onUnassignOwner}
        {onSetPriority}
        {onAddLabel}
        {onRemoveLabel}
        {onCloseIssue}
        {onReopenIssue}
        {onDeleteIssue}
        onSelectIssue={(target) => {
          returnComment = target.returnComment
          selectedCommentUID = target.commentUID
          selectIssue(target.uid)
        }}
        onOpenGraph={(issue) => openGraph(issue.uid)}
        {onCreateRecurrence}
        {onPatchRecurrence}
        {onDeleteRecurrence}
      />
    {:else}
      <section class="detail-unavailable" role="status" aria-label="Selected issue status">
        {projection.selected_state === 'archived'
          ? 'This issue is archived.'
          : 'This issue is unavailable from the current authority.'}
      </section>
    {/if}
  </div>
{/snippet}

<QuickCapture
  open={captureOpen}
  disabled={newTaskBlockedReason !== undefined}
  {draftFenceGeneration}
  inboxName={scopedAuthority ? undefined : inboxProject?.name}
  onClose={() => {
    captureOpen = false
  }}
  onSubmit={submitCapture}
  onChangeInbox={projectWideMutationAllowed
    ? () => {
        captureOpen = false
        inboxChooserOpen = true
      }
    : undefined}
/>

<InboxProjectChooser
  open={inboxChooserOpen}
  projects={projection.projects.map((project) => ({ uid: project.uid, name: project.name }))}
  onClose={() => {
    inboxChooserOpen = false
  }}
  onSelect={chooseInbox}
/>

<style>
  .kata-feature {
    height: 100%;
    min-height: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .active-connection {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    padding: 0.375rem 0.75rem;
    border-start-start-radius: 0;
    border-end-start-radius: 0;
    border-inline-start: 0.25rem solid var(--accent-yellow);
    background: var(--bg-connection);
    color: var(--text-connection);
    font-size: var(--font-size-xs);
    overflow-wrap: anywhere;
  }

  .kata-brand {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 650;
    line-height: 1.2;
    white-space: nowrap;
  }

  .daemon-fallback-status {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .daemon-fallback-status.error {
    color: var(--accent-red);
  }

  .kata-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex: 0 0 auto;
  }

  .header-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  .accent-button {
    border: 1px solid var(--accent-blue);
    border-radius: var(--radius-sm);
    background: var(--accent-blue);
    color: var(--bg-surface);
    min-height: 28px;
    padding: 4px 10px;
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .accent-button:hover:not([aria-disabled='true']) {
    filter: brightness(1.08);
  }

  .accent-button[aria-disabled='true'] {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .kata-layout {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .desktop-navigation {
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .mobile-navigation-trigger {
    display: none;
  }

  .kata-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .credential-scene {
    min-width: 0;
    flex: 1;
    overflow: auto;
    /* Reserve the scrollbar's width so controls do not shift when a search
       changes whether the credential table overflows. */
    scrollbar-gutter: stable;
  }

  .access-administration {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--bg-primary);
    border-top: 1px solid var(--border-default);
  }

  .list-column {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-surface);
    container-type: inline-size;
    container-name: list-pane;
  }

  .board-pane {
    background: var(--bg-primary);
  }

  .board-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding-inline-end: var(--space-4);
    border-bottom: 1px solid var(--border-default);
    background: var(--bg-surface);
  }

  .board-toolbar > :global(:first-child) {
    min-width: 0;
    flex: 1;
  }

  .board-toolbar :global(.kata-search-panel) {
    border-bottom: 0;
  }

  .board-columns-action {
    flex: 0 0 auto;
  }

  .layout-segment {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .detail-column {
    min-width: 0;
    width: 100%;
    min-height: 0;
    display: flex;
    border-left: 1px solid var(--border-default);
  }

  /* In the board's drawer the detail has no list beside it, so no divider. */
  .drawer-detail {
    display: flex;
    min-height: 100%;
  }

  .drawer-detail .detail-column {
    border-left: 0;
  }

  .detail-unavailable {
    margin: auto;
    padding: var(--space-6);
    color: var(--text-muted);
    text-align: center;
  }

  .mutation-message {
    position: absolute;
    z-index: 10;
    top: var(--space-3);
    right: var(--space-3);
    max-width: min(420px, calc(100% - 24px));
    margin: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
  }

  @media (max-width: 760px) {
    .kata-layout {
      grid-template-columns: 1fr;
    }

    .desktop-navigation {
      display: none;
    }

    .mobile-navigation-trigger {
      display: inline-flex;
    }

    .layout-segment-label {
      display: none;
    }
  }

  /* Phones: the header keeps every control by showing icons only; the
     button's aria-label keeps its name. */
  @media (max-width: 640px) {
    .header-action-label {
      display: none;
    }
  }
</style>
