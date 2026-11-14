# Agent Note: Swipe gestures an input whitelist, frame intents, and no wrap-around

Status: implemented

English | [中文](2026-11-14-swipe-gesture-input-and-frame-intents.zh.md)

## Problem

Touch users of the Web client had no gesture for the two things they reach for most. The left and right columns open only from buttons, and below 768px the settings panel's section navigation becomes a horizontal strip that only answers taps.

Three questions decided the shape of the work, and each one could reasonably have gone the other way:

1. **Which pointers count as a swipe.** A trackpad drag, a pen stroke, and a finger all arrive as pointer events, and a page-wide swipe listener that accepts them indiscriminately takes text selection, desktop column dragging, and hover interaction away from the users who rely on them.
2. **Who owns the right column's expansion.** The state is a per-Session store inside `ui-sidebar-right`; the frame is a base package that never imports it. A gesture host in the frame cannot reach that state, and the frame's existing `ctx.layout` reports are outputs from the occupant, not commands into it.
3. **What a swipe past the first or last section does.** The count of sections differs per profile, so either behavior has to be defined for a list the shell does not own.

## Decision

### The swipe input rule is a whitelist

`isSwipePointer` accepts `pointerType` `touch` and `pen` only, and only for the primary contact. `pointerType` is the browser's system-level device classification, never parsed from the user agent, so the rule is exact and testable: a mouse and an empty classification keep their existing interactions, including the 8px column drag handles that remain the desktop path.

A pen is a direct-pointing instrument, so it belongs with the finger. The cost is that a horizontal drag across a text field is also how text is selected with a pen or a finger, so `isFormControlTarget` leaves a gesture that starts on a form control to the field. A start point inside a marked scrolling container with room left in the drag direction belongs to the scroll as well.

The rule lives in `ui-layout`, and the settings panel imports that one pure module through the frame's `./src/*` subpath because a feature plugin must not take a value dependency on another feature plugin's client entry.

### The frame exposes right column intents, not state

`ctx.layout` gained `openRightbarIntent()` and `closeRightbarIntent()`, plus a registration the occupant calls: `registerRightbarIntents({ open, close })` on the concrete `LayoutController`, whose disposer restores the previous registration so an unload leaves the face as it found it. With no registration the intents are no-ops, and a profile without a right column therefore needs no special case.

`ui-sidebar-right` registers the intents in its own apply and answers them with `ISidebarRight.setExpanded(expanded)`, a one-direction command beside `toggleExpanded()`. A gesture names the direction it committed; asking a toggle would invert the gesture when the state had already changed. The intent acts on the Session the controller names as on screen, and does nothing with no Session on screen or one whose store the runtime has not minted; an intent is not allowed to fail loudly the way a click does.

The frame does not draw the drawer animation for a swipe: the sidebar geometry keeps its endpoint transition, and the intents change the same store the buttons already change.

### The strip presentation changes section without wrapping

The settings panel reads the strip presentation from `matchMedia('(max-width: 767px)')` itself, next to the CSS that already switches the rail to a strip at that width.

The strip answers a horizontal swipe across the content, a quarter of the panel's width, with the content following the pointer through CSS variables and no React state during the drag, and it answers the arrow, Home, and End keys on the navigation. Both stop at the first and last section. Settings sections are an ordered list of features, and returning from the last to the first after a swipe loses the user's place, so the rule is uniform for every profile.

The same keys stay inert in the desktop rail, where a vertical list of rows keeps its ordinary Tab and click behavior, and every strip cell keeps one tab stop with focus following the selection.

The modal itself does not disable a frame gesture: the frame has no gesture host, so there is nothing to disable. When the frame gains one, its start conditions must reject a pointer that went down inside an open dialog.

## Alternatives considered

- **`pointerType !== 'mouse'` as the rule.** Rejected: it admits an empty classification, the case where the browser could not tell what pressed, which is exactly when a bad guess costs the most.
- **A coarse-pointer media query as the rule.** Rejected: a coarse-pointer machine can still be driven by a touchpad or a mouse; the event classification is per contact, not per device.
- **A state getter on `ctx.layout` for the right column.** Rejected: the frame would then read and write another package's per-Session state, and the store's owner would have two writers.
- **A toggle intent.** Rejected: it turns a committed direction into a race with any other change to the column between the pointer-down and the release.
- **Wrapping past the ends.** Rejected: it loses the user's place and hides how many sections exist.
- **The segmented tab primitive for the strip.** Rejected for now: the settings navigation is a ledger projection with icon seating and focus-restore behavior of its own, and moving it is a larger change than the gesture needs.

## Consequences

- The gesture primitives are pure functions with unit tests; the DOM-reading parts are covered by their own specs.
- The settings panel and the eventual frame gesture share one input rule and one progress curve, so the two cannot drift into different thresholds.
- A device that reports no pointer classification gets no gesture at all. That is deliberate: silence is better than a sidebar opening under a user's hand.
- `ui-layout`'s `./client` entry exports the drawer breakpoint, so `ui-sidebar-right` reads the frame's own threshold instead of a second literal.
