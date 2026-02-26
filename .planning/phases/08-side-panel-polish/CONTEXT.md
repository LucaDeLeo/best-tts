# Phase 08 - Context (Auto-Generated)

**Generated:** 2026-01-27T11:53:27Z
**Method:** Claude ↔ Codex dialogue
**Status:** Ready for planning

## Milestone Anchor

**Milestone Goal:** User can generate speech from text using Kokoro TTS running entirely in the browser

## Implementation Decisions

### Side Panel Architecture

**[1. Side Panel API Integration]** *(Both agreed)*
- Add `"sidePanel"` permission to manifest.json
- Create dedicated side panel entry point: `src/sidepanel/index.html`, `src/sidepanel/sidepanel.ts`
- Configure via `"side_panel": {"default_path": "sidepanel/index.html"}` in manifest
- Ensure build outputs `sidepanel/index.html` and bundles it properly

**[2. Side Panel vs Popup Role Split]** *(Both agreed)*
- Side panel: Full library view, settings interface, comprehensive browsing
- Popup: Quick-access player with minimal library preview (recent items)
- Rationale: Popup's 340px width and ephemeral nature suits quick actions; side panel suits deep management

**[8. Side Panel Trigger Mechanism]** *(Both agreed)*
- Use `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false})` to keep popup as default
- Add explicit "Open Side Panel" button in popup
- Add context menu option "Open Best TTS Library"
- Add graceful fallback if Side Panel API unavailable (e.g., older Chrome versions)

### Settings & Storage

**[4. Settings Storage Location]** *(Codex suggested migration)*
- Store settings in `chrome.storage.local` under consolidated `settings` key
- Shape: `{ voice: VoiceId, speed: number, darkMode: 'system' | 'light' | 'dark', shortcuts: {...} }`
- **Migration layer:** On extension update, check for legacy `playbackSpeed` and `selectedVoice` keys, migrate to `settings` object, then delete old keys
- Rationale: Consolidation avoids scattered keys; migration prevents breaking existing installs

**[Storage Sync Between Surfaces]** *(Codex identified gap)*
- Use `chrome.storage.onChanged` listeners in both popup and side panel
- When settings change in one surface, the other updates immediately
- Prevents stale state when both are open simultaneously

### Dark Mode

**[3. Dark Mode Implementation]** *(Both agreed)*
- Use CSS custom properties with `.dark-mode` class on root element
- Add `color-scheme: light dark` meta tag to align native controls (scrollbars, inputs)
- Respect `prefers-color-scheme` as default, allow user override via setting
- Existing media query blocks (styles.css lines 589-620, 838-885, 1029-1072) provide foundation

### Voice Preview

**[5. Voice Preview Feature]** *(Codex suggested improvements)*
- Add "Preview" button next to voice dropdown
- Generate short sample (~2 seconds): "This is the {voice name} voice."
- **Pipeline change:** Generate audio in offscreen document, return blob/data URL to side panel, play directly in side panel context (not via content script)
- Add cancel/debounce to prevent stacking previews
- Rationale: Side panel cannot use content script audio path; direct playback in side panel context is simpler and faster

### Settings UI

**[6. Settings Page Location]** *(Both agreed)*
- Create dedicated "Settings" tab/section within side panel
- No separate options page — keeps everything in one place
- Matches modern extension patterns

**[7. Keyboard Shortcut Configuration]** *(Codex corrected approach)*
- **Global shortcuts** (Ctrl+Shift+S, etc.): Cannot be programmatically changed; Chrome requires users to configure via `chrome://extensions/shortcuts`
  - Display current global shortcut bindings in settings
  - Add "Manage shortcuts" link that opens `chrome://extensions/shortcuts`
- **In-panel shortcuts** (popup/side panel keyboard handlers): These CAN be customized
  - Allow rebinding of in-panel keys only (e.g., space for play, arrows for skip)
  - Store in settings object with defaults as fallback
- Rationale: Chrome's security model prohibits programmatic global shortcut changes

### Shared Code Architecture

**[9. Shared Component Architecture]** *(Both agreed)*
- Extract shared UI components into `src/lib/ui/` modules
- Components: library item rendering, folder list, voice selector
- Use vanilla TypeScript with DOM APIs (no framework)
- Importable by both popup and side panel

**[10. CSS Architecture for Shared Styles]** *(Both agreed)*
- Create `src/lib/styles/shared.css` with common variables, button styles, library item styles
- Theme variables live in shared CSS for consistency
- Both `popup/styles.css` and `sidepanel/styles.css` import shared.css
- Keep page-specific styles separate

### Audio Lifecycle

**[Audio Lifecycle Management]** *(Codex identified gap)*
- **Preview cancellation:** Stop previous preview audio before starting new one
- **Concurrency limits:** Only one preview can play at a time; only one TTS playback per tab
- **Cross-surface awareness:** If playback is active in popup, side panel shows current state (not duplicate controls that could conflict)

### Cross-Browser Fallback

**[Side Panel API Fallback]** *(Codex identified gap)*
- Check for `chrome.sidePanel` API availability before using
- If unavailable: hide "Open Side Panel" button, fall back to expanded popup or options page
- Log warning to console for debugging

## Flagged for Human Review

> **Keyboard Shortcut Configuration Scope**
> - Option A: Full in-panel rebinding UI (user can set custom key combinations for popup/floating player actions)
> - Option B: Simple "View Shortcuts" display showing current bindings + link to Chrome's shortcut manager
>
> Recommendation: Option B is simpler and may be sufficient for v1. Option A adds complexity (conflict detection, modifier key handling, validation). Human decision needed on scope.

> **Voice Preview Text**
> - Option A: Fixed phrase ("This is the {voice name} voice.")
> - Option B: Use first sentence of current text input (if populated)
>
> Recommendation: Option A is more predictable and always available. Option B is contextual but requires text input. Human decision on UX preference.

## Claude's Discretion

- Exact preview text phrasing and length
- Specific CSS variable names and color palette for dark mode
- Layout details of settings section within side panel (tabs vs accordion vs sections)
- Animation timings for theme transitions
- Specific icon choices for settings UI elements
- Exact positioning of "Open Side Panel" button in popup
- Order of settings categories in settings panel
- Debounce timing for voice preview (recommend 300-500ms)

---
*Auto-generated via milestone sprint*
