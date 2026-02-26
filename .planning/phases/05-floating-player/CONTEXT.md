Created the Phase 05 CONTEXT.md file at `.planning/phases/05-floating-player/CONTEXT.md`.

**Summary of decisions:**

**Kept as-is (Codex agreed):**
- [1] Shadow DOM + vanilla TypeScript
- [2] Content script injection
- [3] Show on first PLAY_AUDIO
- [4] Reuse existing state schema (see [13] for ownership clarification)
- [5] Minimal control set
- [9] Inline styles in Shadow DOM
- [10] Reuse existing message types

**Alternatives accepted from Codex:**
- [6] Fixed bottom-right position for MVP (drag deferred)
- [7] Added full dismiss option with popup restore affordance
- [8] Clarified navigation behavior — SW stores state, content script rehydrates

**Suggestions incorporated:**
- Single source of truth in service worker
- Visibility preference setting
- Accessibility (ARIA, keyboard, focus management)
- Z-index and pointer-events strategy
- Progress computation approach

**Clarifications added (Round 3):**
- [13] State ownership — SW owns authoritative state; content script holds derived/cached copy
- [14] Multi-tab behavior — state is tab-scoped via tabId
- [15] SPA soft-navigation lifecycle — content script persists, detects route changes

**Resolved (previously flagged):**
- [11] Popup vs player control arbitration — **Last-write-wins**: Both popup and floating player send commands to the service worker. The SW is the single source of truth; whichever UI sends a command last wins. No locking or priority. Both UIs subscribe to state updates and reflect the current state. This is simple, predictable, and avoids complex arbitration logic.
- [12] Global keyboard shortcuts scope — **Floating player only (no global shortcuts)**: Keyboard shortcuts (Space for play/pause, Escape to dismiss) only work when the floating player has focus. No document-level listeners that could conflict with page shortcuts. Users can click the player to focus it, then use keyboard controls. This avoids conflicts with page functionality and accessibility tools.
- [13] State ownership clarification — **SW owns, content script caches**: "Reuse existing state" means reusing the existing state *schema* and message types, not ownership. The service worker is the single authoritative owner of playback state. The content script maintains a local *derived* copy for rendering the floating player UI. On any state change, SW broadcasts to all subscribers; content script updates its local cache and re-renders. No split-brain because content script never mutates state directly — it sends commands to SW and waits for the authoritative response. This clarifies the apparent tension between [4] and "single source of truth in SW."
- [14] Multi-tab behavior — **State is tab-scoped**: All playback state in the service worker is keyed by `tabId`. Each tab has independent playback state. When a floating player or popup sends a command, it includes the originating `tabId`. The SW updates only that tab's state and broadcasts only to subscribers of that tab. Last-write-wins applies *within* a single tab, not across tabs. One tab's controls cannot affect another tab's playback. The popup queries state for the *active* tab when opened.
- [15] SPA soft-navigation lifecycle — **Content script persists, monitors route changes**: On SPA soft-navigation (pushState, replaceState, popstate), the content script is NOT destroyed. The floating player DOM remains in place. Behavior: (1) If playback is active and the new route is on the same origin, the player remains visible and playback continues uninterrupted. (2) If the user explicitly stops playback before/after navigation, the player hides per normal stop behavior. (3) If the extracted content is no longer relevant to the new route (e.g., user navigated away from the article), the SW does not auto-stop — the user manually stops or it plays to completion. (4) On hard navigation (page reload, cross-origin), the content script is destroyed; SW detects via `tabs.onUpdated` and marks the tab's playback as interrupted; on new content script init, it rehydrates state and shows player if playback was active. Cleanup: content script listens for `beforeunload` to send a cleanup signal, but this is best-effort (not guaranteed on all browsers).

---

## Auto-Discuss Metadata

- **Rounds:** 4
- **Codex Available:** yes
- **Uncertainties Resolution:** all resolved
- **Timestamp:** 2026-01-27T08:45:00Z

<details>
<summary>Codex Review (Round 3) — Clarifications</summary>

**Issues Raised**
- Ambiguity between "reuse existing state" [4] and "single source of truth in SW" — potential split-brain risk.
- Missing consideration: multi-tab behavior with last-write-wins could cause cross-tab interference.
- Missing consideration: SPA soft-navigation lifecycle when content script persists across in-page route changes.

**Resolutions**
- [13] Clarified state ownership: SW owns authoritative state; content script holds a derived/cached copy for rendering. "Reuse existing state" refers to schema reuse, not ownership. No split-brain because content script never mutates directly.
- [14] Added multi-tab scoping: all SW state is keyed by `tabId`. Commands include `tabId`, updates broadcast only to that tab's subscribers. Cross-tab interference is impossible by design.
- [15] Defined SPA soft-navigation behavior: content script and floating player persist; playback continues uninterrupted on same-origin route changes. Hard navigation triggers rehydration from SW state.

**Status:** All concerns resolved. No changes to previously locked decisions.

</details>

<details>
<summary>Codex Review (Round 2)</summary>

**Findings**
- None blocking from a code‑review standpoint (this is an implementation‑decision review without code or diffs).

**Decisions**
- [AGREE] [1] Shadow DOM + vanilla TS fits current codebase and avoids framework overhead.
- [AGREE] [2] Content‑script injection via Shadow DOM is the right place for page‑level UI.
- [AGREE] [3] Show on first `PLAY_AUDIO` aligns with “appears when playback starts.”
- [AGREE] [4] Reuse existing content‑script state to avoid split‑brain bugs.
- [AGREE] [5] Minimal control set mirrors popup and meets core UX.
- [QUESTION] [6] Drag + storage might be overkill for Phase 05. Alternative: fixed bottom‑right now; add drag later if needed.
- [QUESTION] [7] Minimize to icon is fine, but also allow full dismiss with a “restore from popup” affordance. Alternative: collapsed bar with play/pause + expand.
- [QUESTION] [8] “Destroyed on navigation” conflicts with “persists across page navigation.” If hard nav resets the UI, ensure service worker replays state immediately on new content script init (or store state in SW and rehydrate). Clarify expected behavior on tab refresh vs cross‑origin nav.
- [AGREE] [9] Inline `<style>` inside Shadow DOM is simplest and consistent with current style injection.
- [AGREE] [10] Reuse existing message types; only add show/hide if a real need appears.

**Uncertainties** (now resolved)
- [RESOLVED] Popup vs player control arbitration — decided: last-write-wins with SW as single source of truth.
- [RESOLVED] Global keyboard shortcuts — decided: focus-scoped only, no global listeners.

**Gaps / Additional Recommendations**
- [SUGGEST] Define a single source of truth for playback state in the service worker, then have popup + floating player subscribe via messages. This avoids desync on navigation.
- [SUGGEST] Add a “visibility preference” (auto‑show, auto‑hide on stop) to avoid unexpected UI persistence.
- [SUGGEST] Plan z‑index strategy and pointer‑events behavior to avoid blocking page UI; ensure Escape or close always works.
- [SUGGEST] Accessibility: focus management, ARIA labels, and keyboard operability within Shadow DOM.
- [SUGGEST] Decide how progress is computed for streaming chunks (sentence X of Y vs time); ensure updates don’t spam the main thread.

If you want, I can turn these into a concrete decision log or acceptance criteria.

</details>
