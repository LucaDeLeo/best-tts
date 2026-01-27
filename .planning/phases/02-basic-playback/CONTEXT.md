I've created the Phase 02 CONTEXT.md incorporating all the Codex feedback. Here's a summary of the key decisions:

**Items kept as-is [AGREE]:**
- Audio playback with `HTMLAudioElement` (moved to content script in Round 5)
- Centralized `PlaybackState` in service worker (moved from offscreen in Round 5)
- `playbackRate` for speed control
- Sentence progress via `STATUS_UPDATE`
- Popup keyboard handlers with standard shortcuts
- Pause vs stop distinction

**Question addressed [QUESTION] - Text Chunking:**
I accepted Codex's recommendation to use `Intl.Segmenter` instead of regex for sentence splitting. Rationale:
- `Intl.Segmenter` is supported in Chrome 87+ (excellent support for any extension user)
- It handles abbreviations, edge cases, and preserves punctuation correctly
- Splitting happens in offscreen (single source of truth) not popup
- Added max-length fallback for texts without punctuation

**Suggestions incorporated [SUGGEST]:**
1. **Playback settings storage** — Store `playbackRate` separately from voice, with clamping to [0.5, 4.0]
2. **Reuse `STATUS_UPDATE`** — No new `PLAYBACK_PROGRESS` type; extend existing message
3. **Throttle updates** — Guard against `NaN` duration until metadata loads
4. **Focus guard** — Don't fire shortcuts when typing in textarea

**Codex-identified gaps added:**
- Generation token for cancellation (prevents stale audio from playing after skip/stop)
- Auto-advance logic on `ended` event
- Distinct `isGenerating` vs `isPlaying/isPaused` states for UI
- Empty chunk handling and max-length fallback

**Round 3 additions (additional Codex feedback):**

5. **Autoplay restrictions for `HTMLAudioElement.play()`** — User gesture does NOT propagate through async message chains. After TTS generation completes (which involves async network requests), the original user activation has expired. Chrome's autoplay policy applies even in offscreen documents.

   **Key insight:** The original "unlock via message" approach is internally contradictory—sending `UNLOCK_AUDIO` through popup → service worker → offscreen is itself an async message chain, so user activation is already lost by the time it arrives. Additionally, if the offscreen document doesn't exist yet, `chrome.offscreen.createDocument()` is async and completes outside the user-gesture window, undermining any unlock attempt.

   **Revised solution — Content script audio injection:**

   Chrome's offscreen document `audio-playback` reason does NOT grant autoplay privileges. The official documentation only states that this reason causes auto-close after 30 seconds of silence—it says nothing about bypassing autoplay policy. This is an unverified assumption that cannot be relied upon.

   **Primary approach — Play audio in content script (injected into active tab):**

   1. **Content script audio playback:** When the user clicks "Play" in the popup, the popup sends a message to the **content script** (not the offscreen document) to play the audio. Content scripts run in the context of the web page, which may already have user engagement (MEI score > 0). Many pages the user is reading have accumulated engagement, allowing autoplay.

   2. **Flow for playback:**
      - Popup sends `SPEAK` to service worker with text and voice settings.
      - Service worker forwards to offscreen document for TTS generation only (no playback).
      - Offscreen generates audio blob/URL via Kokoro TTS and sends it back to service worker.
      - Service worker forwards the audio URL to the **content script** in the active tab.
      - Content script creates an `<audio>` element and calls `play()`.
      - Content script reports playback events (play, pause, ended, error) back to service worker → popup.

   3. **Why content script works better:**
      - Content scripts inherit the page's autoplay policy based on Media Engagement Index (MEI).
      - Users reading content have often interacted with the page (scrolled, clicked), building MEI.
      - Even if blocked, the error occurs in a context where we can provide meaningful recovery.

   4. **Fallback for pages with no engagement:** If the content script's `play()` fails with `NotAllowedError`:
      - Content script reports the error to the popup.
      - Popup displays: "Click anywhere on the page to enable audio, then try again."
      - The user clicks on the page (granting transient activation to the content script's context).
      - User clicks "Play" again in popup; content script now has engagement and can play.

   5. **Offscreen document role reduced:** The offscreen document is now ONLY responsible for TTS generation (calling Kokoro API, receiving audio data). It does NOT play audio. This is a valid use case per Chrome docs ("Use the offscreen document to... make network requests").

   **Secondary fallback — Popup audio (for context menu / no active tab scenarios):**

   When triggered via context menu on a page where we cannot inject a content script (e.g., chrome:// pages, PDF viewer, extension pages), fall back to popup-based playback:
   - Service worker opens the popup programmatically (`chrome.action.openPopup()` — requires Chrome 127+).
   - Popup receives audio URL and plays in its own DOM.
   - Popup has user activation from the context menu click, so `play()` succeeds.
   - Note: `openPopup()` only works from a user gesture event handler; context menu clicks qualify.

   **Offscreen document lifecycle (simplified):**

   Since the offscreen document only handles TTS generation (not audio playback), we create it **lazily on first SPEAK request**, not eagerly at startup. This complies with Chrome's intent: "offscreen docs are supposed to be created only when the declared reason is active."
   - Service worker checks `hasDocument()` before sending TTS requests.
   - If false, creates the document with reasons `['AUDIO_PLAYBACK']` (still needed for future audio processing features or if we add prefetch) or simply `['WORKERS']` since we're just doing computation.
   - Actually: Use reason `['LOCAL_STORAGE']` or `['WORKERS']` for TTS-only offscreen doc. The `AUDIO_PLAYBACK` reason triggers 30-second auto-close without audio, which we don't want for a generation-only doc.

   **Final decision on offscreen reason:** Use `WORKERS` reason (for running computation/fetch in a document context). This avoids the 30-second auto-close behavior of `AUDIO_PLAYBACK` while still giving us a DOM context for any Web API needs. The offscreen doc can stay alive as long as needed for generation, and Chrome will naturally close it after the extension is idle.

6. **`Intl.Segmenter` locale selection** — Derive locale using this priority:
   1. Explicit user setting in extension options (future phase)
   2. `document.documentElement.lang` from the source page (passed with the text in `SPEAK` message)
   3. `navigator.language` in the offscreen document as final fallback

   The offscreen document will accept an optional `locale` field in the `SPEAK` payload. **Fallback logic:** If `locale` is omitted, use `navigator.language` from the offscreen context (which reflects the browser's language setting). If `locale` is provided but `Intl.Segmenter` throws for that locale (invalid or unsupported), catch the error and retry with `navigator.language`. This ensures correct sentence boundaries for non-English text: a Japanese user with `navigator.language = 'ja'` will get proper Japanese segmentation even if the page lacks a `lang` attribute.

7. **Offscreen document lifecycle and state management** — The offscreen document is used ONLY for TTS generation (not playback), so its lifecycle is simpler:
   - **Lazy creation:** Created on first `SPEAK` request, not at extension startup. MV3 service workers are event-driven and don't run at browser startup without an event, so eager creation is unreliable anyway.
   - **Reason selection:** Use `WORKERS` reason (computation/fetch in DOM context), NOT `AUDIO_PLAYBACK`. The `AUDIO_PLAYBACK` reason triggers 30-second auto-close without audio activity, which we don't want for a generation-only document.
   - **Before teardown:** Not possible to intercept; offscreen docs have no `beforeunload`. This is fine—the doc only holds transient generation state.
   - **On recreation:** The service worker checks `chrome.offscreen.hasDocument()` before sending TTS requests. If false, it recreates the document.
   - **State location:** With audio playback moved to content scripts, `PlaybackState` now lives in the **service worker** (tracks current sentence index, playback status, generation tokens). The offscreen doc is stateless—it receives generation requests and returns audio blobs.
   - **UI state recovery (popup):** When the popup opens, it queries the service worker (not offscreen) for current playback state via `GET_STATUS`. The service worker always responds immediately with its in-memory state. If the service worker was terminated and restarted, state is lost, but this is the same behavior as before and acceptable for Phase 2.
   - **Heartbeat for active playback:** The content script (not offscreen) sends `HEARTBEAT` messages every 2 seconds while audio is playing. The popup tracks `lastHeartbeat` and resets to idle if 8 seconds pass without updates. This detects tab closure or navigation away from the page with active playback.
   - **User experience:** If the tab with audio is closed mid-playback, the popup detects via missed heartbeats and resets to idle. The text remains in the popup textarea; user clicks play to restart.

No items were flagged for human review since all decisions reached consensus.

---

## Auto-Discuss Metadata

- **Rounds:** 6
- **Codex Available:** yes
- **Uncertainties Resolution:** none
- **Timestamp:** 2026-01-27T07:15:00Z

<details>
<summary>Codex Review (Round 2)</summary>

- [AGREE] 1. Audio playback in offscreen with `HTMLAudioElement` keeps the Phase 1 architecture and avoids Web Audio complexity; just make sure `playbackRate` is applied on each new audio element and updated live.
- [QUESTION] 2. I’d avoid regex splitting in the popup. Better: split in offscreen (single source of truth) using `Intl.Segmenter` with a fallback regex, and preserve punctuation. The proposed regex drops punctuation and can hurt prosody; also add a max‑length chunk fallback for texts with no punctuation.
- [AGREE] 3. Centralized `PlaybackState` in offscreen matches the current routing and keeps service worker stateless.
- [SUGGEST] 4. Using `playbackRate` is right; store it as a separate “playback settings” key (or rename `voice-storage` to settings) and clamp to supported range when applying.
- [AGREE] 5. Sentence progress makes sense; just throttle updates and guard against `duration` being `NaN` until metadata loads.
- [AGREE] 6. Popup key handlers are correct for Phase 2; add a focus guard so shortcuts don’t fire while typing in the textarea.
- [SUGGEST] 7. New message types are fine, but consider reusing `STATUS_UPDATE` for progress instead of adding `PLAYBACK_PROGRESS` to avoid overlap.
- [AGREE] 8. Pause vs stop distinction is standard; ensure stop also resets sentence index and clears any queued audio.

Gaps Claude missed
- Cancellation/ordering: if a generation finishes after a skip/stop, it can play stale audio. Use a generation token or abort mechanism to ignore late results.
- Auto‑advance/queue: you’ll need logic to advance to the next sentence on `ended` and optionally prefetch the next sentence to reduce gaps.
- Chunking edge cases: handle empty chunks, long paragraphs without punctuation, and keep punctuation attached to its sentence.
- UI/state separation: track “generating” vs “playing/paused” distinctly so controls and progress don’t mislead.

</details>

<details>
<summary>Codex Review (Round 3)</summary>

- [SUGGEST] Autoplay policy: confirm that offscreen documents with `audio-playback` reason don't face gesture restrictions when playback is message-triggered from popup user interaction; add error handling for `NotAllowedError` as defensive measure.
- [SUGGEST] `Intl.Segmenter` locale: need a locale derivation strategy—page lang attribute, user setting, or navigator.language fallback—otherwise sentence boundaries will be wrong for non-English.
- [SUGGEST] Offscreen lifecycle: plan for document teardown (Chrome closes after 30s inactivity). State is lost; decide whether to persist or accept re-creation on next action.

</details>

<details>
<summary>Codex Review (Round 4)</summary>

- [FIXED] Autoplay unlock contradiction: The original "UNLOCK_AUDIO via message chain" approach contradicts the stated problem (user activation doesn't propagate through async chains). Revised to: (1) eager offscreen creation at extension load, (2) rely on `audio-playback` justification's built-in privileges, (3) defensive popup-side fallback if `NotAllowedError` occurs.
- [FIXED] Invalid silent WAV: 44-byte WAV with zero data bytes has 0ms duration and won't play. Replaced with 45-byte WAV containing actual samples (used only in popup fallback).
- [FIXED] Offscreen creation timing: Added explicit "eager creation" strategy—offscreen document is created at extension load, not on first user interaction. This avoids the async creation delay being inside the user-gesture window.

</details>

<details>
<summary>Codex Review (Round 5)</summary>

- [FIXED] Popup fallback contradiction: Playing silent audio in popup then re-sending `SPEAK` still triggers offscreen playback via async message chain—user activation is lost by the time offscreen receives it. **Solution:** Moved audio playback to content scripts, which inherit the page's Media Engagement Index. Offscreen document now only handles TTS generation.
- [FIXED] Eager offscreen creation non-compliance: MV3 service workers don't run at browser startup without an event; "eager creation at extension load" requires explicit event triggers (`onStartup`, `onInstalled`). Additionally, offscreen docs should only be created when their declared reason is active. **Solution:** Changed to lazy creation on first `SPEAK` request. Use `WORKERS` reason (for computation) instead of `AUDIO_PLAYBACK` since we're not playing audio in offscreen.
- [FIXED] Unverified autoplay privilege assumption: Chrome documentation does NOT state that `audio-playback` reason grants autoplay privileges—it only mentions the 30-second auto-close behavior. **Solution:** Eliminated reliance on this assumption by moving playback to content scripts, which have verifiable autoplay behavior tied to page engagement (MEI).

</details>
