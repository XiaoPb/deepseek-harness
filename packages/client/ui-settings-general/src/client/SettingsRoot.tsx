/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel with the section nav rail. In browsers below 768px the panel fills
 * the viewport and the rail turns into a horizontal strip; Windows and macOS
 * desktop windows retain the rail
 * (SettingsRoot.module.css). The shell is a pure composition face —
 * slot-owned text (trigger label, panel title, close label, sections) arrives
 * from registrants through slots; accessible names resolve from localized
 * content (trigger: shell locale; dialog: aria-labelledby the title node;
 * close: visually-hidden slot text). Modal open state and the active section
 * id belong to the declared owner store; the onboarding coordinator mounts
 * exactly one ordered registrant while the sessions-derived empty-Hero fact
 * is active. Visible dialog chrome belongs to the step, so a
 * mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator, Tooltip, useModalLayer,
  IconAgentPresetOutlineMedium, IconArchiveOutlineMedium, IconCloseOutlineRegular, IconDataOutlineMedium,
  IconPersonalizationOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
  SWIPE_ACTIVATE_PX, isFormControlTarget, isHorizontalSwipe, isSwipePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'
import { DesktopUpdateIndicator } from './DesktopUpdateIndicator.tsx'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800

/** Frame width below which the rail becomes a horizontal strip (the frame's own drawer breakpoint). */
const STRIP_QUERY = '(max-width: 767px)'

/**
 * Share of the panel's width a section swipe must cross before it changes
 * sections. It is a ratio of the measured content width, so a phone commits
 * after a short drag and a tablet needs proportionally more; a fifth stays
 * above a tap that drifts.
 */
const SWIPE_THRESHOLD_RATIO = 0.18

/** Section content travel, in px, of the entry animation a committed change runs. */
const CONTENT_SHIFT_PX = 24

/** Travel, in px, at which a swipe follows the pointer. */
const SWIPE_FOLLOW_PX = 6

/** Content opacity at full swipe progress. */
const CONTENT_FADED_OPACITY = 0.6

/** Spring-back duration, in ms, when a swipe does not change sections. */
const SPRING_BACK_MS = 180

/** Pointer phase of one section swipe; it never enters React state. */
interface SwipeRun {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  width: number
  /** Horizontal travel so far, in px. */
  dx: number
  active: boolean
}

/**
 * Whether a pointer may start a section swipe: at least the activate distance
 * in any direction, then horizontal. A press below that distance stays a tap.
 * @param dx - horizontal travel in px.
 * @param dy - vertical travel in px.
 * @returns whether the movement is a horizontal swipe.
 */
function swipeStarted(dx: number, dy: number): boolean {
  const travelled = Math.abs(dx * dx + dy * dy)
  if (travelled < SWIPE_ACTIVATE_PX * SWIPE_ACTIVATE_PX) return false
  return isHorizontalSwipe(dx, dy)
}

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'account') return <IconUserOutlineMedium size={16} />
  if (id === 'models') return <IconDataOutlineMedium size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium size={16} />
  if (id === 'archived-sessions') return <IconArchiveOutlineMedium size={16} />
  return <IconSettingsOutlineMedium size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Whether the frame is narrow enough for the shell's strip navigation, where a
 * horizontal swipe changes sections. Desktop rails keep their own interactions.
 * @returns whether the strip presentation is in force.
 */
function useStripNavigation(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia(STRIP_QUERY) : undefined
  const read = useCallback((): boolean => query?.matches ?? false, [query])
  const [strip, setStrip] = useState(read)
  useEffect(() => {
    if (query === undefined || typeof query.addEventListener !== 'function') return
    const update = (): void => { setStrip(query.matches) }
    query.addEventListener('change', update)
    update()
    return () => { query.removeEventListener('change', update) }
  }, [query])
  return strip
}

/**
 * The section the keyboard moves to from the active one. No wrap-around: the
 * first and last sections keep their position, so the order of the strip stays
 * predictable.
 * @param key - the pressed key.
 * @param ids - section ids in display order.
 * @param active - the section currently shown.
 * @returns the section to select, or `undefined` when the press changes nothing.
 */
function keyboardTarget(key: string, ids: readonly string[], active: string | undefined): string | undefined {
  const index = active === undefined ? -1 : ids.indexOf(active)
  if (index === -1) return ids[0]
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  if (key === 'ArrowLeft') return ids[index - 1]
  if (key === 'ArrowRight') return ids[index + 1]
  return undefined
}

/**
 * Body-portaled modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 *
 * In the strip presentation the two outer regions of the strip's axis change
 * sections: a horizontal swipe across the content (a finger or a pen, never a
 * mouse), and the arrow, Home, and End keys on the navigation. A swipe moves
 * the content 1:1 with the pointer through CSS variables and commits past
 * {@link SWIPE_THRESHOLD_RATIO} of the panel's width; either mode stops at the
 * first and last section instead of wrapping.
 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()

  const strip = useStripNavigation()
  const panel = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const swipe = useRef<SwipeRun | null>(null)
  const spring = useRef<number | null>(null)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  useModalLayer(panel, true, onClose)

  const ids = rows.map(row => row.id)

  // The strip scrolls sideways: wherever the selection lands, its cell is
  // brought into view so a swipe to the far end shows a matching tab.
  useLayoutEffect(() => {
    if (!strip || active === undefined) return
    const cell = cells.current.get(active)
    if (cell === undefined) return
    if (typeof cell.scrollIntoView !== 'function') return
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, strip])

  /** Write the swipe's progress onto the content, outside React. */
  const paint = useCallback((progress: number): void => {
    const element = options.current
    if (element === null) return
    const product = progress * CONTENT_SHIFT_PX
    const shift = Math.round(product)
    element.style.setProperty('--dsh-settings-swipe-x', `${shift}px`)
    element.style.setProperty('--dsh-settings-swipe-opacity', String(1 - progress * (1 - CONTENT_FADED_OPACITY)))
  }, [])

  /**
   * Follow the pointer: the content travels with the finger (leftward for the
   * next section, rightward for the previous one) and fades as it goes.
   * @param travel - signed pointer travel in px; negative moves toward the next section.
   */
  const follow = useCallback((travel: number): void => {
    const element = options.current
    if (element === null) return
    const width = element.clientWidth
    if (width <= 0) return
    element.style.setProperty('--dsh-settings-swipe-x', `${Math.round(travel)}px`)
    element.style.setProperty('--dsh-settings-swipe-opacity', String(1 - (Math.abs(travel) / width) * (1 - CONTENT_FADED_OPACITY)))
  }, [])

  /** Return the content to rest; reduced motion skips the interpolation. */
  const springBack = useCallback((): void => {
    const element = options.current
    if (element === null) return
    element.removeAttribute('data-swiping')
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.removeAttribute('style')
      return
    }
    element.style.setProperty('--dsh-settings-swipe-transition', `${SPRING_BACK_MS}ms`)
    paint(0)
    spring.current = window.setTimeout(() => {
      spring.current = null
      element.removeAttribute('style')
    }, SPRING_BACK_MS)
  }, [paint])

  useEffect(() => () => {
    if (spring.current !== null) window.clearTimeout(spring.current)
  }, [])

  // A committed section change starts from the opposite edge; a spring-back
  // keeps the content where the pointer left it. Browsers without the
  // animation API show the new section immediately.
  useLayoutEffect(() => {
    const element = options.current
    if (element === null) return
    element.removeAttribute('style')
    if (!strip) return
    if (typeof element.animate !== 'function') return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    element.animate(
      [{ opacity: CONTENT_FADED_OPACITY, transform: `translateX(${CONTENT_SHIFT_PX}px)` }, { opacity: 1, transform: 'none' }],
      { duration: SPRING_BACK_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  }, [active, strip])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!strip || swipe.current !== null) return
    if (!isSwipePointer(event.nativeEvent)) return
    if (isFormControlTarget(event.target as Element)) return
    // The strip scrolls itself: its own drag stays with the browser.
    if ((event.target as Element).closest(`.${css.navList}`) !== null) return
    const element = options.current
    if (element === null) return
    if (spring.current !== null) {
      window.clearTimeout(spring.current)
      spring.current = null
      element.removeAttribute('style')
    }
    // Capture at the press: a rightward swipe starts near the panel's left edge,
    // where the next point can land outside this content column, and a capture
    // that moves away from the pressing target releases it — which would cancel
    // the gesture before the pointer is lifted.
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    swipe.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      width: element.clientWidth, dx: 0, active: false,
    }
  }, [strip])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const run = swipe.current
    if (run === null || run.pointerId !== event.pointerId) return
    const dx = event.clientX - run.startX
    const dy = event.clientY - run.startY
    if (!run.active) {
      // A short press stays a tap; past the follow distance the content starts
      // tracking the finger.
      if (Math.abs(dx) < SWIPE_FOLLOW_PX) return
      if (!swipeStarted(dx, dy)) return
      if (run.width <= 0) return
      run.active = true
      options.current?.setAttribute('data-swiping', '')
    }
    run.dx = dx
    follow(dx)
  }, [follow])

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const run = swipe.current
    if (run === null || run.pointerId !== event.pointerId) return
    swipe.current = null
    if (!run.active) return
    const direction = run.dx < 0 ? 1 : -1
    const reveal = run.dx < 0 ? 0 - run.dx : run.dx
    const target = active === undefined ? undefined : ids[ids.indexOf(active) + direction]
    const commit = reveal >= run.width * SWIPE_THRESHOLD_RATIO
    if (commit && target !== undefined) {
      onSelect(target)
      options.current?.removeAttribute('style')
      return
    }
    springBack()
  }, [active, ids, onSelect, springBack])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const run = swipe.current
    if (run === null || run.pointerId !== event.pointerId) return
    swipe.current = null
    if (run.active) springBack()
  }, [springBack])

  const onNavKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!strip) return
    const target = keyboardTarget(event.key, ids, active)
    if (target === undefined) return
    event.preventDefault()
    onSelect(target)
    cells.current.get(target)?.focus()
  }, [active, ids, strip])

  // Portalled beside #root like the Modal primitive: a covering surface mounted
  // inside the root would precede the columns' chrome in document order, so a
  // chrome row that declares window drag after it would override its subtraction.
  // Beside the root, base.css's `body > :not(#root)` rule subtracts it instead.
  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={panel} tabIndex={-1} data-shortcut-modal="settings" className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* The four seats stay direct children of the panel and take their
            places from its grid: title and header share the first row, the
            navigation and the active section the second. */}
        <div className={css.navTitle} id={titleId} tabIndex={-1}
          data-modal-autofocus={active === undefined ? '' : undefined}>{renderSlot('settings.header', {})}</div>
        <nav className={css.nav} onKeyDown={onNavKeyDown}>
          <div className={css.navList}>
            {rows.map((row) => {
              const selected = row.id === active
              return (
                <button
                  key={row.id}
                  ref={(element) => {
                    if (element === null) cells.current.delete(row.id)
                    else cells.current.set(row.id, element)
                  }}
                  type="button"
                  className={clsx(css.navCell, selected && css.active)}
                  aria-current={selected ? 'true' : undefined}
                  tabIndex={selected ? 0 : -1}
                  data-modal-autofocus={selected ? '' : undefined}
                  onFocus={(event): void => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
                  onClick={() => { onSelect(row.id) }}
                >
                  <span className={css.navIcon} aria-hidden="true">
                    {renderSlot('settings.section.icon', { size: 16, active: selected }, {
                      only: row.id, fallback: navIcon(row.id),
                    })}
                  </span>
                  <span className={css.navLabel}>{row.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
        <div className={css.header}>
          <div className={css.actions}>{renderSlot('settings.action', {})}</div>
          <button type="button" className={css.close} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
            <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
          </button>
        </div>
        <div
          ref={options}
          className={css.options}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
        >          {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useSessions, renderSlot, t,
    useDesktopUpdate, openDesktopUpdate, useStore, actions, useShortcuts,
  } = props
  const { open, activeId } = useStore(state => state)
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'settings.open'))
  const { close, openSection } = actions
  const [requestedOnboarding, setRequestedOnboarding] = useState<string | undefined>()
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdConnecting, setHoldConnecting] = useState(false)
  const connectingShownAt = useRef<number | undefined>(undefined)

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const desktopUpdate = useDesktopUpdate(state => state)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions((state) => {
    const main = Object.values(state.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)
    return state.phase === 'ready' && (main === undefined || main.blank)
  })
  const onboardingStep = requestedOnboarding !== undefined
    ? onboardingSteps.find(step => step.id === requestedOnboarding)
    : onboardingActive
      ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
      : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const onboardingStepSeen = useRef(onboardingStep)
  // An onboarding step owns the viewport and marks `#root` inert. The panel portals
  // beside `#root`, outside that mark, so a step that appears while the panel is open
  // takes the panel down rather than leaving it focusable behind the onboarding mask.
  useEffect(() => {
    const appeared = onboardingStepSeen.current === undefined && onboardingStep !== undefined
    onboardingStepSeen.current = onboardingStep
    if (appeared && open) close()
  }, [onboardingStep, open, close])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
  }, [connectionState])

  // The confirmation window starts when the recovered pill becomes visible,
  // which the connecting minimum-visible hold can delay past the transition.
  useLayoutEffect(() => {
    if (!showRecovery || holdConnecting) return
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [showRecovery, holdConnecting])

  useLayoutEffect(() => {
    if (connectionState === 'connecting') {
      connectingShownAt.current = Date.now()
      return
    }
    const shownAt = connectingShownAt.current
    if (shownAt === undefined) return
    connectingShownAt.current = undefined
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (remaining <= 0) return
    setHoldConnecting(true)
    const timeout = window.setTimeout(() => { setHoldConnecting(false) }, remaining)
    return () => {
      window.clearTimeout(timeout)
      setHoldConnecting(false)
    }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setRequestedOnboarding(undefined)
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'connecting' || holdConnecting) {
    connectionIndicator = 'connecting'
  } else if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        {renderSlot('settings.launcher', {
          wide, settingsOpen: open, openSettings: (sectionId) => {
            if (sectionId === undefined) actions.open()
            else actions.openSection(sectionId)
          },
          ...(shortcut?.keys.length ? { settingsShortcut: { keys: shortcut.keys, aria: shortcut.aria } } : {}),
          openOnboarding: (id) => { close(); setRequestedOnboarding(id) },
        }, { fallback: <Tooltip disabled={open} label={t('trigger')} shortcutKeys={shortcut?.keys}>
          <button
            type="button"
            className={clsx(css.trigger, !wide && css.rail)}
            aria-label={t('trigger')}
            aria-keyshortcuts={shortcut?.aria}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => { actions.open() }}
          >
            {renderSlot('settings.trigger', { wide })}
          </button>
        </Tooltip> })}
        <ConnectionIndicator
          state={wide && desktopUpdate.presentation?.phase !== 'installing' ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
        <DesktopUpdateIndicator wide={wide} hidden={connectionIndicator !== undefined && desktopUpdate.presentation?.phase !== 'installing'}
          t={t} view={desktopUpdate} onOpen={openDesktopUpdate} />
      </div>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={actions.select}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        explicit: requestedOnboarding !== undefined,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
