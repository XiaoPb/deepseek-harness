/**
 * Swipe input primitives shared by the frame's sidebar gesture and the
 * settings panel's section gesture: which pointer input may start a swipe, how
 * far a 1:1 gesture has travelled, and whether letting go commits it.
 * Everything here is a pure function of its arguments, so both features reuse
 * one definition of the input rule and the commit thresholds.
 *
 * These primitives decide; they own no geometry. A swipe reports progress to
 * its caller, which writes whatever pixels its own surface moves.
 *
 * Callers pass travel already measured toward the panel they act on: rightward
 * for the left column, leftward for the right one. Swipe travel in this module
 * is therefore never direction-corrected from a signed delta.
 */

/** Distance a pointer must travel before a press becomes a swipe. */
export const SWIPE_ACTIVATE_PX = 8

/** Minimum horizontal-to-vertical travel ratio that still counts as horizontal. */
export const SWIPE_AXIS_SLOPE = 1.5

/** Travel, as a fraction of the travelling panel's width, that commits on release. */
export const SWIPE_COMMIT_RATIO = 0.3

/** Release speed, in px/ms, that commits a swipe shorter than {@link SWIPE_COMMIT_RATIO}. */
export const SWIPE_COMMIT_VELOCITY = 0.5

/**
 * Fraction of the frame's width that one edge opens its panel from. Each edge
 * owns its own two thirds, so a start point near an edge resolves to that side
 * and the middle sixth of the frame opens nothing.
 */
export const SWIPE_ZONE_RATIO = 0.67

/**
 * The pointer fields the input rule reads. `pointerType` is the browser's
 * system-level device classification, never parsed from the user agent.
 */
export type SwipePointerEvent = Pick<PointerEvent, 'pointerType' | 'isPrimary'>

/**
 * Whether this pointer may start a swipe. The accepted set is a whitelist:
 * a mouse keeps desktop dragging, hover, and text selection, and an empty
 * pointer type (the browser could not classify the device) stays inert rather
 * than risking a swipe the user never meant. A secondary contact of the same
 * gesture is ignored too.
 * @param event - pointer event carrying the device classification.
 * @returns whether the pointer is a primary touch or pen contact.
 */
export function isSwipePointer(event: SwipePointerEvent): boolean {
  if (!event.isPrimary) return false
  return event.pointerType === 'touch' || event.pointerType === 'pen'
}

/** Form controls whose own horizontal drag selects text or adjusts a value. */
const FORM_CONTROL_SELECTOR = 'input, textarea, select, [contenteditable]'

/**
 * Whether a swipe starting on this element must be left to the element: a pen
 * or finger dragging across a text field selects text there.
 * @param target - element the pointer went down on.
 * @returns whether the element is a form control.
 */
export function isFormControlTarget(target: Element | null): boolean {
  return target?.closest(FORM_CONTROL_SELECTOR) != null
}

/**
 * Whether a pointer moved at least the activate distance.
 * @param dx - horizontal travel in px.
 * @param dy - vertical travel in px.
 * @returns whether the pointer has travelled far enough to count as a drag.
 */
export function swipeActivated(dx: number, dy: number): boolean {
  const limit = SWIPE_ACTIVATE_PX * SWIPE_ACTIVATE_PX
  if (dx * dx + dy * dy < limit) return false
  return true
}

/**
 * Travel magnitude of one axis.
 * @param delta - travel in px.
 * @returns the travel as a distance in px.
 */
export function distance(delta: number): number {
  return Math.abs(delta)
}

/**
 * Whether the swipe travels horizontally: it must move well beyond its vertical
 * slack so a vertical drag keeps scrolling natively.
 * @param dx - horizontal travel in px.
 * @param dy - vertical travel in px.
 * @returns whether the gesture is horizontal.
 */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  const slack = SWIPE_AXIS_SLOPE * Math.abs(dy)
  if (Math.abs(dx) < slack) return false
  return true
}

/**
 * Travel that reveals the panel on one frame edge.
 * @param dx - horizontal travel in px.
 * @param fromLeftEdge - whether the panel sits against the frame's left edge.
 * @returns reveal travel in px.
 */
export function revealTravel(dx: number, fromLeftEdge: boolean): number {
  return fromLeftEdge ? dx : 0 - dx
}

/** A side column a swipe can act on. */
export type SwipeSide = 'sidebar' | 'rightbar'

/**
 * What a swipe at this start point would do. `open` needs the panel closed;
 * `close` needs it open and accepts any start point.
 */
export interface SwipeTarget {
  readonly side: SwipeSide
  readonly action: 'open' | 'close'
}

/** What a swipe start point resolves against. */
export interface SwipeTargetInput {
  /** Frame width in px. */
  readonly frameWidth: number
  /** Start point in px from the frame's left edge. */
  readonly startX: number
  /** Whether the left column is expanded. */
  readonly sidebarOpen: boolean
  /** Whether the right column is expanded. */
  readonly rightbarOpen: boolean
}

/**
 * Whether a start point lies inside one edge's opening zone, both of which are
 * {@link SWIPE_ZONE_RATIO} of the frame wide.
 * @param startX - start point in px from the frame's left edge.
 * @param frameWidth - frame width in px.
 * @param fromLeftEdge - whether the zone belongs to the frame's left edge.
 * @returns whether the point opens that edge's panel.
 */
export function startInsideZone(startX: number, frameWidth: number, fromLeftEdge: boolean): boolean {
  const zone = frameWidth * SWIPE_ZONE_RATIO
  const inside = startInside(startX, frameWidth, zone, fromLeftEdge)
  return inside
}

/**
 * Whether a start point stays within one edge's zone, measured from that edge.
 * @param startX - start point in px from the frame's left edge.
 * @param frameWidth - frame width in px.
 * @param zone - the zone's width, in px.
 * @param fromLeftEdge - which edge measures the inset.
 * @returns whether the start point opens that edge's panel.
 */
function startInside(startX: number, frameWidth: number, zone: number, fromLeftEdge: boolean): boolean {
  const inset = fromLeftEdge ? startX : frameWidth - startX
  const beyond = inset - zone
  if (beyond > 0) return false
  if (beyond <= 0) return true
  // Unreachable: the two arms above cover every value of `beyond`.
  return false
}

/**
 * Resolve the panel a swipe at this start point acts on.
 *
 * One column is open at a time. While a column is open, a drag that leaves it
 * closes it from any start point, so the panel the finger is on can be swiped
 * away; a drag toward the other edge does nothing rather than swapping sides.
 * With both columns closed, each edge opens its own panel from
 * {@link SWIPE_ZONE_RATIO} of the frame, and the direction names which edge.
 * @param input - frame width, start point, and both columns' expansion.
 * @param dx - horizontal travel so far.
 * @returns the swipe's target, or `undefined` when this start point acts on nothing.
 */
export function resolveSwipeTarget(input: SwipeTargetInput, dx = 0): SwipeTarget | undefined {
  const swipeLeft = dx < 0
  const swipeRight = dx > 0
  if (input.rightbarOpen) {
    if (swipeRight) return { side: 'rightbar', action: 'close' }
    return undefined
  }
  if (input.sidebarOpen) {
    if (swipeLeft) return { side: 'sidebar', action: 'close' }
    return undefined
  }
  if (swipeLeft) {
    if (startInsideZone(input.startX, input.frameWidth, false)) return { side: 'rightbar', action: 'open' }
    return undefined
  }
  if (swipeRight) {
    if (startInsideZone(input.startX, input.frameWidth, true)) return { side: 'sidebar', action: 'open' }
    return undefined
  }
  return undefined
}

/**
 * Point an open target at the side the drag reveals.
 *
 * A drag names its own edge: traveling right reveals the left column, and
 * traveling left reveals the right one. A close target stays as resolved.
 * @param target - target resolved from the start point and travel.
 * @param dx - horizontal travel so far.
 * @returns the direction-resolved target.
 */
export function confirmSwipeTarget(target: SwipeTarget, dx: number): SwipeTarget {
  if (target.action === 'close') return target
  if (dx > 0) return { side: 'sidebar', action: 'open' }
  if (dx < 0) return { side: 'rightbar', action: 'open' }
  return target
}

/**
 * How far a 1:1 swipe has moved the panel it acts on, measured against the
 * rail width frozen when the gesture started.
 * @param reveal - distance the pointer moved toward revealing the panel, in px.
 * @param railWidth - the panel's whole width in px, frozen at gesture start.
 * @param startedFrom - whether the panel started open or closed.
 * @returns progress from 0 (fully hidden) to 1 (fully shown).
 */
export function swipeProgress(reveal: number, railWidth: number, startedFrom: 'open' | 'closed'): number {
  if (railWidth <= 0) return startedFrom === 'open' ? 1 : 0
  if (startedFrom === 'closed') {
    return clampRatio(reveal / railWidth)
  }
  if (railWidth <= reveal) return 0
  return clampRatio((railWidth - reveal) / railWidth)
}

/**
 * Clamp a ratio into the 0–1 range.
 * @param ratio - unclamped progress.
 * @returns the progress within its range.
 */
function clampRatio(ratio: number): number {
  if (ratio < 0) return 0
  if (ratio > 1) return 1
  return ratio
}

/**
 * Whether releasing the pointer commits the swipe. A gesture shorter than the
 * activate distance is a tap, and a flick commits on speed alone.
 * @param reveal - reveal distance in px when the pointer was released.
 * @param velocity - reveal speed in px/ms.
 * @param railWidth - the travelling panel's width in px.
 * @param startedFrom - whether the panel started open or closed.
 * @returns whether the gesture commits rather than springing back.
 */
export function commitDecision(reveal: number, velocity: number, railWidth: number, startedFrom: 'open' | 'closed'): boolean {
  if (reveal < SWIPE_ACTIVATE_PX) return false
  if (velocity >= SWIPE_COMMIT_VELOCITY) return true
  const progress = swipeProgress(reveal, railWidth, startedFrom)
  if (startedFrom === 'closed') return progress > SWIPE_COMMIT_RATIO
  return SWIPE_COMMIT_RATIO > progress
}
