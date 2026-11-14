/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * receives live parameters from that solve. The root-scoped main slot selects
 * the Conversation or a global panel. Each column occupant owns its Session
 * binding and reports the geometry it needs.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { CENTER_MIN, clampWidth, computeColumns, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_DRAWER_BREAKPOINT } from './columns.ts'
import {
  confirmSwipeTarget, isFormControlTarget, isHorizontalSwipe, isSwipePointer, resolveSwipeTarget, swipeActivated,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SwipeTarget } from '@deepseek-ai/dsh-client-ui-primitives'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Browser posture supplied by the root registration. */
export interface AppFrameInjected {
  hooks: { foldedLandscape: HostObservable<boolean> }
  /** One-direction commands for the right column's occupant; no-ops until it registers them. */
  frame: {
    openRightbarIntent: () => void
    closeRightbarIntent: () => void
  }
}

/** Full composed props: runtime, child slots, store, locale, and injected posture. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.bottom' | 'shell.overlay' | 'shell.leading'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>
  & InjectFace<AppFrameInjected>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode; inert: boolean }) {
  return <div className={css.centerCol} {...{ inert: props.inert ? '' : undefined }}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return <div className={css.mainPanel} data-global-panel={panelId !== null || undefined}>
    {renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })}
  </div>
}

/** One in-flight swipe between its press and its release. */
interface SwipeRun {
  pointerId: number
  x: number
  y: number
  active: boolean
  target: SwipeTarget | undefined
}

/**
 * Advance one swipe to the pointer's current point: a press becomes a swipe once
 * it travels far enough horizontally, and the target resolves from the start
 * point at that moment.
 * @param run - the swipe being tracked; updated in place.
 * @param clientX - pointer position in px from the frame's left edge.
 * @param clientY - pointer position in px from the frame's top edge.
 * @param frameWidth - frame width in px.
 * @param sidebarOpen - whether the left column is expanded.
 * @param rightbarOpen - whether the right column is expanded.
 */
function trackSwipe(
  run: SwipeRun,
  clientX: number,
  clientY: number,
  frameWidth: number,
  sidebarOpen: boolean,
  rightbarOpen: boolean,
): void {
  if (run.active) return
  const dx = clientX - run.x
  const dy = clientY - run.y
  if (!swipeActivated(dx, dy)) return
  if (!isHorizontalSwipe(dx, dy)) return
  run.active = true
  const resolved = resolveSwipeTarget({ frameWidth, startX: run.x, sidebarOpen, rightbarOpen }, dx)
  run.target = resolved === undefined ? undefined : confirmSwipeTarget(resolved, dx)
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode; inert: boolean }) {
  return <div className={css.rightbarCol} data-rightbar-col {...{ inert: props.inert ? '' : undefined }}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  useFoldedLandscape,
  actions,
  frame,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth
  const foldedLandscape = useFoldedLandscape(matches => matches)

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const drawer = viewport < SIDEBAR_DRAWER_BREAKPOINT && !windowsTitlebar
  const centeredSidebar = foldedLandscape && viewport >= SIDEBAR_DRAWER_BREAKPOINT
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const drawerOpen = drawer && !sidebarCollapsed
  // Entering drawer mode from a collapsed rail hides the backing immediately.
  const [sidebarTransition, setSidebarTransition] = useState({ drawer, collapsed: sidebarCollapsed, instant: true })
  if (sidebarTransition.drawer !== drawer || sidebarTransition.collapsed !== sidebarCollapsed) {
    setSidebarTransition({ drawer, collapsed: sidebarCollapsed, instant: drawer && sidebarCollapsed && sidebarTransition.collapsed })
  }
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Desktop reopen controls occupy the frame's shell.leading seat (macOS) or
  // the Windows caption row; neither platform keeps an icon rail.
  const darwin = document.documentElement.dataset.platform === 'darwin'
  const collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(
    viewport, !layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference, collapsedWidth, centeredSidebar,
  )
  const cols = computeColumns(
    viewport, drawer ? 0 : sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0, collapsedWidth, centeredSidebar,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  // Track easing is scoped to discrete open/close and fold changes: data-animating
  // goes up when the sidebar presentation or the rightbar track flips and comes down
  // at transition end (timeout as the reduced-motion/covered-frame fallback).
  // Steady-state viewport updates stay instant (AppFrame.module.css), and so
  // does a toggle arriving together with a viewport change — that is the
  // responsive auto-collapse firing mid window-resize, where easing would
  // chase the live window edge. The counter restarts the settle window when a
  // re-toggle interrupts a running transition.
  const [animating, setAnimating] = useState(0)
  const trackToggle = `${sidebarCollapsed}:${layoutInfo.rightbarTrack}:${centeredSidebar}`
  const previousToggle = useRef(trackToggle)
  const previousViewport = useRef(viewport)
  // Arm the transition before child layout effects measure the new column widths.
  const animateTracks = previousViewport.current === viewport && (animating > 0 || previousToggle.current !== trackToggle)
  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewport
    previousViewport.current = viewport
    if (viewportChanged) {
      previousToggle.current = trackToggle
      setAnimating(0)
      return
    }
    if (previousToggle.current === trackToggle) return
    previousToggle.current = trackToggle
    setAnimating(token => token + 1)
  }, [trackToggle, viewport])
  useEffect(() => {
    if (animating === 0) return
    const frame = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (frame === null) return
    const settle = () => { setAnimating(0) }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === frame && event.propertyName === 'grid-template-columns') settle()
    }
    frame.addEventListener('transitionend', onTransitionEnd)
    const timer = setTimeout(settle, 600)
    return () => {
      frame.removeEventListener('transitionend', onTransitionEnd)
      clearTimeout(timer)
    }
  }, [animating])
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])

  // Swipe on a touch screen: the gesture names its side and commits in the
  // direction it was dragged, so a state that changed mid-gesture cannot invert
  // it. A mouse never starts one, which keeps desktop dragging and selection.
  // The target resolves on the first qualifying move, because only travel names
  // the edge a fresh swipe opens; an open column resolves from any start point,
  // so the panel itself can be swiped away.
  const swipeStart = useRef<SwipeRun | null>(null)
  const requestRightbar = useCallback((open: boolean) => {
    if (open) frame.openRightbarIntent()
    else frame.closeRightbarIntent()
  }, [frame])

  const onFramePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (swipeStart.current !== null) return
    if (!isSwipePointer(event.nativeEvent)) return
    if (isFormControlTarget(event.target as Element)) return
    // A covering dialog owns the gesture: the settings panel slides its own
    // sections, and a modal that leaves the frame swiping behind it would move
    // columns the user cannot see. The left drawer is a modal too, but it lives
    // inside the frame and must keep the swipe that closes it.
    if (document.querySelector('[aria-modal="true"]:not([data-shortcut-modal="sidebar"])') !== null) return
    swipeStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      target: undefined,
    }
  }, [])
  const onFramePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const run = swipeStart.current
    if (run === null || run.pointerId !== event.pointerId || run.active) return
    trackSwipe(run, event.clientX, event.clientY, viewport, !sidebarCollapsed, layoutInfo.rightbarShown)
  }, [viewport, sidebarCollapsed, layoutInfo.rightbarShown])
  const onFramePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const run = swipeStart.current
    if (run === null || run.pointerId !== event.pointerId) return
    // A cancelled sequence still carries where the finger got to: the browser
    // cancels the pointer when it claims the drag for scrolling or for a
    // long-press, and the swipe the user drew is the same gesture either way.
    if (!run.active) trackSwipe(run, event.clientX, event.clientY, viewport, !sidebarCollapsed, layoutInfo.rightbarShown)
    swipeStart.current = null
    if (!run.active || run.target === undefined) return
    if (run.target.side === 'sidebar') actions.setSidebarExpanded(run.target.action === 'open')
    else requestRightbar(run.target.action === 'open')
  }, [actions, requestRightbar, viewport, sidebarCollapsed, layoutInfo.rightbarShown])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  // The rendered template lets the grid solve the squeeze natively: the centre
  // declares its protected minimum and the right column bids up to the clamped
  // preference, so a window resize lands in the same layout pass as the frame
  // edge. The JS solve lags the viewport by a ResizeObserver + rAF frame; when
  // it priced the squeeze itself, the centre column absorbed each width change
  // whole and was corrected two frames later — visible jitter. cols keeps only
  // the discrete decisions (track present, collapse state) and the drag base.
  const rightbarMax = cols.rightbar === 0 ? 0 : clampWidth(rightbarPreference, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO)
  const sidebarWidth = drawer
    ? Math.min(layoutInfo.sidebar || SIDEBAR_DEFAULT, Math.max(0, viewport - 48))
    : cols.sidebar
  const sidebar = useMemo(() => renderSlot('sidebar', {
    collapsed: sidebarCollapsed,
    width: sidebarWidth,
    drawer,
  }), [renderSlot, sidebarCollapsed, sidebarWidth, drawer])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])
  // The leading seat serves drawers and fully hidden macOS sidebars.
  // Windows native captions keep their controls in the caption row instead.
  // AppFrame.module.css reserves clearance for the seat's rendered controls.
  const leading = useMemo(() => renderSlot('shell.leading', {}), [renderSlot])
  const leadingMounted = drawer || darwin && sidebarCollapsed

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        ...(windowsTitlebar
          ? { '--dsh-windows-sidebar-width': `${cols.sidebar}px` } : {}),
        gridTemplateColumns:
          `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : CENTER_MIN}px, 1fr) minmax(0px, ${rightbarMax}px)`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-sidebar-drawer={drawer || undefined}
      data-sidebar-instant={drawer && sidebarCollapsed && sidebarTransition.instant || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-dragging={dragging || undefined}
      data-animating={animateTracks || undefined}
      onPointerDown={onFramePointerDown}
      onPointerMove={onFramePointerMove}
      onPointerUp={onFramePointerEnd}
      onPointerCancel={onFramePointerEnd}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      {drawer && <div className={css.drawerMask} data-sidebar-mask aria-hidden="true"
        onClick={drawerOpen ? () => { actions.toggleSidebar() } : undefined} />}
      <div className={css.sidebarCol}
        style={drawer ? { width: sidebarWidth } : undefined}
        {...{ inert: drawer && sidebarCollapsed ? '' : undefined }}>
        {sidebar}
      </div>
      <>
        <CenterColumn inert={drawerOpen}>{main}</CenterColumn>
        <RightbarColumn inert={drawerOpen}>
          {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
      </>
      <div className={css.bottomRow} data-shell-bottom {...{ inert: drawerOpen ? '' : undefined }}>
        {renderSlot('shell.bottom', {})}
      </div>
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {leadingMounted && (
        <div className={css.leadingSeat} data-shell-leading {...{ inert: drawerOpen ? '' : undefined }}>
          {leading}
        </div>
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!drawer && !centeredSidebar && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
