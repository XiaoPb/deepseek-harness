// @vitest-environment jsdom
/**
 * The swipe primitives: which pointer may swipe, which panel a start point
 * resolves to, how far a 1:1 gesture has travelled, and when releasing it
 * commits.
 */
import { describe, expect, it } from 'vitest'
import {
  SWIPE_ACTIVATE_PX, commitDecision, confirmSwipeTarget, distance, isFormControlTarget, isHorizontalSwipe,
  isSwipePointer, resolveSwipeTarget, revealTravel, startInsideZone, swipeActivated, swipeProgress,
} from '../src/swipe.ts'
import type { SwipeTargetInput } from '../src/swipe.ts'

const FRAME = 1000

function frame(overrides: Partial<SwipeTargetInput> = {}): SwipeTargetInput {
  return { frameWidth: FRAME, startX: 100, sidebarOpen: false, rightbarOpen: false, ...overrides }
}

function pointer(pointerType: string, isPrimary: boolean): Pick<PointerEvent, 'pointerType' | 'isPrimary'> {
  return { pointerType, isPrimary }
}

describe('isSwipePointer', () => {
  it('accepts a finger and a pen as direct manipulation', () => {
    expect(isSwipePointer(pointer('touch', true))).toBe(true)
    expect(isSwipePointer(pointer('pen', true))).toBe(true)
  })

  it('ignores every secondary contact of a multi-touch gesture', () => {
    expect(isSwipePointer(pointer('touch', false))).toBe(false)
  })
})

describe('isFormControlTarget', () => {
  it('leaves a gesture that starts on a field to the field', () => {
    const field = document.createElement('div')
    field.innerHTML = '<label><input value="x"></label>'
    expect(isFormControlTarget(field.querySelector('input'))).toBe(true)
  })

  it('claims a gesture that starts anywhere else', () => {
    const surface = document.createElement('div')
    surface.innerHTML = '<p><span>text</span></p>'
    expect(isFormControlTarget(surface.querySelector('span'))).toBe(false)
  })

  it('claims a gesture that started off the document', () => {
    expect(isFormControlTarget(null)).toBe(false)
  })
})

describe('distance', () => {
  it('reads travel as a magnitude', () => {
    expect(distance(-30)).toBe(30)
  })

  it('leaves forward travel unchanged', () => {
    expect(distance(30)).toBe(30)
  })
})

describe('swipeActivated', () => {
  it('waits for the activate distance in any direction', () => {
    expect(swipeActivated(0, SWIPE_ACTIVATE_PX)).toBe(true)
    expect(swipeActivated(SWIPE_ACTIVATE_PX, 0)).toBe(true)
  })

  it('keeps a press below the activate distance out of the gesture', () => {
    expect(swipeActivated(0, 7)).toBe(false)
  })
})

describe('isHorizontalSwipe', () => {
  it('claims a nearly horizontal drag for the swipe', () => {
    expect(isHorizontalSwipe(60, 0)).toBe(true)
  })

  it('keeps a drag with an even slope for the browser', () => {
    expect(isHorizontalSwipe(60, 45)).toBe(false)
  })
})

describe('revealTravel', () => {
  it('counts rightward travel for a left panel', () => {
    expect(revealTravel(30, true)).toBe(30)
  })

  it('counts leftward travel for a right panel', () => {
    expect(revealTravel(30, false)).toBe(0 - 30)
  })
})

describe('startInsideZone', () => {
  it('reaches its own two thirds from either edge', () => {
    expect(startInsideZone(0, FRAME, true)).toBe(true)
    expect(startInsideZone(670, FRAME, true)).toBe(true)
    expect(startInsideZone(FRAME, FRAME, false)).toBe(true)
    expect(startInsideZone(330, FRAME, false)).toBe(true)
  })

  it('leaves the narrow middle to neither edge', () => {
    const frameWidth = 3000
    expect(startInsideZone(2200, frameWidth, true)).toBe(false)
    expect(startInsideZone(800, frameWidth, false)).toBe(false)
  })
})

describe('resolveSwipeTarget', () => {
  it('opens the left column on a rightward drag from the left two thirds', () => {
    expect(resolveSwipeTarget(frame({ startX: 0 }), 240)).toEqual({ side: 'sidebar', action: 'open' })
    expect(resolveSwipeTarget(frame({ startX: 300 }), 240)).toEqual({ side: 'sidebar', action: 'open' })
  })

  it('opens the right column on a leftward drag from the right two thirds', () => {
    expect(resolveSwipeTarget(frame({ startX: FRAME }), -240)).toEqual({ side: 'rightbar', action: 'open' })
    expect(resolveSwipeTarget(frame({ startX: 700 }), -240)).toEqual({ side: 'rightbar', action: 'open' })
  })

  it('opens nothing from the narrow middle', () => {
    expect(resolveSwipeTarget(frame({ startX: 730 }), 240)).toBeUndefined()
    expect(resolveSwipeTarget(frame({ startX: 270 }), -240)).toBeUndefined()
  })

  it('opens nothing when the drag heads for the other edge', () => {
    expect(resolveSwipeTarget(frame({ startX: 0 }), -240)).toBeUndefined()
    expect(resolveSwipeTarget(frame({ startX: FRAME }), 240)).toBeUndefined()
  })

  it('closes the left column on any leftward drag', () => {
    expect(resolveSwipeTarget(frame({ startX: 20, sidebarOpen: true }), -120)).toEqual({ side: 'sidebar', action: 'close' })
    expect(resolveSwipeTarget(frame({ startX: 900, sidebarOpen: true }), -120)).toEqual({ side: 'sidebar', action: 'close' })
  })

  it('closes the right column on any rightward drag', () => {
    expect(resolveSwipeTarget(frame({ startX: 900, rightbarOpen: true }), 120)).toEqual({ side: 'rightbar', action: 'close' })
    expect(resolveSwipeTarget(frame({ startX: 40, rightbarOpen: true }), 120)).toEqual({ side: 'rightbar', action: 'close' })
  })

  it('holds an open column against the drag toward the other edge', () => {
    expect(resolveSwipeTarget(frame({ startX: 300, sidebarOpen: true }), 240)).toBeUndefined()
    expect(resolveSwipeTarget(frame({ startX: 700, rightbarOpen: true }), -240)).toBeUndefined()
  })

  it('resolves nothing before the pointer has travelled', () => {
    expect(resolveSwipeTarget(frame({ startX: 20 }))).toBeUndefined()
  })
})

describe('confirmSwipeTarget', () => {
  it('keeps a close target as resolved', () => {
    const target = { side: 'sidebar', action: 'close' } as const
    expect(confirmSwipeTarget(target, 200)).toBe(target)
  })

  it('keeps an open target until travel names a side', () => {
    const target = { side: 'sidebar', action: 'open' } as const
    expect(confirmSwipeTarget(target, 0)).toBe(target)
  })

  it('points an open target at the side the drag reveals', () => {
    const target = { side: 'sidebar', action: 'open' } as const
    expect(confirmSwipeTarget(target, 40)).toEqual({ side: 'sidebar', action: 'open' })
    expect(confirmSwipeTarget(target, -40)).toEqual({ side: 'rightbar', action: 'open' })
  })
})

describe('swipeProgress', () => {
  it('maps half a rail width of reveal to half progress while opening', () => {
    expect(swipeProgress(140, 280, 'closed')).toBe(0.5)
  })

  it('clamps reveal past the rail', () => {
    expect(swipeProgress(1000, 280, 'closed')).toBe(1)
    expect(swipeProgress(0, 280, 'closed')).toBe(0)
  })

  it('counts down from fully shown while the panel started open', () => {
    expect(swipeProgress(0, 280, 'open')).toBe(1)
    expect(swipeProgress(280, 280, 'open')).toBe(0)
    expect(swipeProgress(900, 280, 'open')).toBe(0)
  })

  it('stays at the resting progress when the panel has no width to divide by', () => {
    expect(swipeProgress(200, 0, 'closed')).toBe(0)
    expect(swipeProgress(200, 0, 'open')).toBe(1)
  })

  it('never reports negative progress', () => {
    expect(swipeProgress(0 - 40, 280, 'closed')).toBe(0)
  })
})

describe('confirmSwipeTarget', () => {
  it('names the edge the drag travels toward', () => {
    const open = { side: 'sidebar', action: 'open' } as const
    expect(confirmSwipeTarget(open, 240)).toEqual({ side: 'sidebar', action: 'open' })
    expect(confirmSwipeTarget(open, -240)).toEqual({ side: 'rightbar', action: 'open' })
    expect(confirmSwipeTarget(open, 0)).toBe(open)
  })

  it('keeps a close target as resolved', () => {
    const closing = { side: 'rightbar', action: 'close' } as const
    expect(confirmSwipeTarget(closing, 240)).toBe(closing)
  })
})

describe('commitDecision', () => {
  it('treats a release shorter than the activate distance as a tap', () => {
    expect(commitDecision(SWIPE_ACTIVATE_PX - 1, 4, 280, 'closed')).toBe(false)
  })

  it('commits an opening past 30% of the rail', () => {
    expect(commitDecision(121, 0, 400, 'closed')).toBe(true)
  })

  it('springs an opening back at 30% of the rail', () => {
    expect(commitDecision(120, 0, 400, 'closed')).toBe(false)
  })

  it('commits a closing once more than 70% of the rail has been dismissed', () => {
    expect(commitDecision(281, 0, 400, 'open')).toBe(true)
  })

  it('commits on a flick regardless of distance', () => {
    expect(commitDecision(20, 0.5, 400, 'closed')).toBe(true)
  })
})
