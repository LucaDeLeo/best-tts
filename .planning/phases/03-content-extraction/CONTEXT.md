Phase 03 CONTEXT.md has been created. Key decisions from the Codex dialogue:

1. **Accepted Codex's toolbar click alternative**: Changed from toolbar click to context menu for full-page extraction since MV3 doesn't allow both popup AND `action.onClicked` reliably.

2. **Incorporated Codex suggestions**:
   - Handle selection in form fields (`input/textarea`, contenteditable) with `selectionStart/End`
   - Simplified message flow using direct response instead of separate `EXTRACTION_RESULT` message type
   - Added robust SPA handling strategy (see below)
   - Include page title/URL in extraction results for better UX

3. **SPA Content Readiness Strategy** (expanded from single retry):
   - **Primary approach**: MutationObserver watching for content stabilization (no DOM mutations for 300ms)
   - **Timeout ceiling**: 3 seconds max wait, then extract whatever is available
   - **Fallback**: If Readability returns insufficient content (<100 chars), show toast suggesting selection mode
   - **Rationale**: Single 500ms retry is insufficient for heavy SPAs (React hydration, lazy-loaded content). MutationObserver-based detection adapts to actual page behavior rather than guessing timing.

4. **MV3 Service Worker Lifetime & Message Flow**:

   **Two distinct flows based on trigger source:**

   **A. Popup-triggered extraction (selection or full-page via popup button):**
   - Popup uses `chrome.runtime.connect()` to establish a long-lived port to service worker
   - Service worker forwards extraction request to content script via `tabs.sendMessage`
   - Content script returns result directly via `sendResponse` (returns `true` to keep channel open for async work)
   - Service worker relays result back to popup over the port
   - **Popup close mitigation**: Service worker listens for `port.onDisconnect`; if popup closes mid-extraction, SW stores result in `chrome.storage.session` and sets a flag. When popup reopens, it checks for pending results.
   - **Rationale**: Port keeps SW alive while popup is open; storage fallback handles early close

   **B. Context-menu-triggered extraction (no popup involved):**
   - Context menu handler in SW calls `tabs.sendMessage` to content script
   - Content script performs extraction and returns result via `sendResponse` (returns `true` for async)
   - **No separate message type needed**: Direct response is sufficient; SW receives result in the `sendMessage` callback
   - **SW lifetime**: The `sendMessage` callback keeps SW alive until content script responds or times out (30s MV3 limit)
   - **Timeout handling**: Content script sets internal 10s timeout; if exceeded, returns partial/error result rather than hanging

   **Failure handling (both flows):**
   - If `sendMessage` to content script fails (tab closed, content script not injected), SW shows notification via `chrome.notifications` API
   - Content script never needs to "detect disconnected port" in context-menu flow since it uses request/response, not ports
   - For popup flow, port disconnect is detected by SW (not content script); content script just responds normally

   **No separate `EXTRACTION_RESULT` message type**: Both flows use direct `sendResponse`. The original Codex suggestion to simplify is fully adopted—no secondary `runtime.sendMessage` from content script needed.

5. **Flagged for human review**: Context menu structure (two items vs nested submenu)

---

## Auto-Discuss Metadata

- **Rounds:** 3
- **Codex Available:** yes
- **Uncertainties Resolution:** none
- **Timestamp:** 2026-01-27T06:07:02Z

<details>
<summary>Codex Review (Round 2)</summary>

1. [AGREE] Readability is the right default for article extraction; proven, lightweight, and fits content‑script DOM access.

2. [AGREE] Context menu for selection is standard and low‑friction. Add a note to also handle selection inside `input/textarea` since `window.getSelection()` won’t capture that.

3. [QUESTION] Toolbar click conflicts with popup: in MV3 you can’t have both a popup and `action.onClicked` reliably. Alternative: keep popup as the primary trigger and add a context‑menu “Read this page” item for full‑page extraction.

4. [AGREE] Content script is the right place for Readability due to DOM requirements.

5. [AGREE] Flow aligns with existing SW orchestration. Consider whether `EXTRACTION_RESULT` is needed or if a direct response is enough to avoid extra message types.

6. [AGREE] Failure toast is good; threshold should be configurable and language‑agnostic. Consider also handling “empty but non‑error” results by suggesting selection mode.

7. [AGREE] Context menu first is fine; shortcut can wait.

8. [AGREE] Graceful failure on paywalls is correct.

9. [AGREE] Skipping iframes is fine for Phase 3.

10. [AGREE] Message types are sensible, but see #5 for possible simplification.

Gaps Claude missed
- Action vs popup conflict for full‑page trigger (decide which owns the toolbar click).
- Selection in form fields (`input/textarea` / contenteditable) needs special handling.
- Consider when to run extraction on SPAs (e.g., wait for `DOMContentLoaded` or a small delay/retry).
- Potentially include page title/URL in extraction result for better UX (“Reading: …”) and debugging.

</details>
