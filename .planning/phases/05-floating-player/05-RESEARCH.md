# Phase 05: Floating Player - Research

**Researched:** 2026-01-27
**Domain:** Chrome Extension Content Script UI / Shadow DOM / Playback Controls
**Confidence:** HIGH

## Summary

This phase implements a floating mini player that appears on webpages during TTS playback. The research confirms that Shadow DOM is the correct isolation technique for Chrome extension content script UIs, inline styles work well within Shadow DOM (no pseudo-selector limitations for basic controls), and the existing codebase architecture already supports the necessary message passing patterns.

Key findings:
- Shadow DOM provides complete CSS isolation without z-index conflicts with page styles
- Inline styles within Shadow DOM are simpler than CSS-in-JS for simple components
- The existing service worker state management and message types can be reused directly
- ARIA roles and keyboard focus management require explicit implementation but are straightforward
- SPA navigation detection should use the Navigation API (`navigation.navigate`) where available, with fallback to `popstate`/`pushState` monitoring
- Hard navigation detection via `tabs.onUpdated` in the service worker enables state rehydration

**Primary recommendation:** Create a vanilla TypeScript Shadow DOM component with inline styles, reusing existing message types and state patterns from the codebase.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Shadow DOM API | Web Platform | CSS isolation from page styles | Native browser API, perfect encapsulation |
| Vanilla TypeScript | (existing) | Component implementation | Per CONTEXT.md - no framework overhead |
| Inline styles | N/A | Styling within Shadow DOM | Simple, no build step, sufficient for MVP |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Navigation API | Chrome 102+ | SPA route detection | When monitoring soft navigation |
| `tabs.onUpdated` | Chrome API | Hard navigation detection | Service worker state cleanup/rehydration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shadow DOM | iframe | Complete isolation but heavier, message-passing overhead |
| Inline styles | CSS-in-JS (Emotion) | Needed for pseudo-selectors like `:hover`, but overkill for simple controls |
| Vanilla TS | Lit/Preact | Framework benefits but adds bundle size, per CONTEXT.md decision |

**Installation:**
No new dependencies required. Shadow DOM and Navigation API are native browser APIs.

## Architecture Patterns

### Recommended Project Structure
```
src/
  content/
    content-script.ts      # Existing - add floating player initialization
    highlight-styles.ts    # Existing
    floating-player.ts     # NEW - Shadow DOM component
  lib/
    messages.ts            # Existing - reuse message types
    playback-state.ts      # Existing - reuse state schema
```

### Pattern 1: Shadow DOM Component Factory
**What:** Create Shadow DOM root, attach styles and DOM, expose update methods
**When to use:** Any content script UI that needs page CSS isolation
**Example:**
```typescript
// Source: Chrome Extensions docs + Shadow DOM Web Platform
function createFloatingPlayer(): {
  root: ShadowRoot;
  update: (state: PlayerUIState) => void;
  destroy: () => void;
} {
  const host = document.createElement('div');
  host.id = 'besttts-floating-player';
  const shadow = host.attachShadow({ mode: 'closed' }); // closed for security

  // Inject styles inline within shadow root
  const style = document.createElement('style');
  style.textContent = getPlayerStyles();
  shadow.appendChild(style);

  // Create player DOM
  const container = document.createElement('div');
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Audio player');
  shadow.appendChild(container);

  document.body.appendChild(host);

  return {
    root: shadow,
    update: (state) => renderState(container, state),
    destroy: () => host.remove()
  };
}
```

### Pattern 2: State Subscription Pattern
**What:** Content script subscribes to SW state changes, caches locally for rendering
**When to use:** Any UI that reflects service worker authoritative state
**Example:**
```typescript
// Source: Existing codebase pattern (content-script.ts)
// Content script holds cached state for rendering
let cachedState: PlaybackState | null = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MessageType.STATUS_UPDATE) {
    cachedState = message.status;
    updatePlayerUI(cachedState);
  }
});

// Commands go to SW, never mutate local state directly
function handlePlayPause() {
  const type = cachedState?.status === 'playing'
    ? MessageType.PAUSE_AUDIO
    : MessageType.RESUME_AUDIO;
  chrome.runtime.sendMessage({ target: 'service-worker', type });
}
```

### Pattern 3: Focus-Scoped Keyboard Handlers
**What:** Only handle keyboard events when component has focus
**When to use:** Extension UIs that shouldn't interfere with page shortcuts
**Example:**
```typescript
// Source: CONTEXT.md decision [12]
container.addEventListener('keydown', (e) => {
  // Only active when player has focus
  switch (e.key) {
    case ' ':
    case 'Enter':
      e.preventDefault();
      handlePlayPause();
      break;
    case 'Escape':
      e.preventDefault();
      dismissPlayer();
      break;
  }
});
// Make focusable
container.tabIndex = 0;
```

### Anti-Patterns to Avoid
- **Document-level keyboard listeners:** Conflicts with page functionality and a11y tools
- **z-index arms race:** Shadow DOM avoids this; don't use extremely high z-index values
- **Mutating state in content script:** Always send commands to SW, wait for authoritative response
- **Using `mode: 'open'` without reason:** `closed` mode prevents page scripts from accessing internal state

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS isolation | Custom namespacing | Shadow DOM | Page CSS can use `!important`, namespace collisions possible |
| SPA navigation detection | Custom mutation observers | Navigation API + popstate fallback | Navigation API handles all edge cases |
| Hard navigation detection | beforeunload + hacks | `tabs.onUpdated` in SW | Reliable, service worker guaranteed to see it |
| Progress calculation | Custom time tracking | Use chunk index from existing state | Already computed: `currentChunkIndex / totalChunks` |
| Focus trapping | Manual tab index management | Native `tabindex` + focus events | Browser handles focus order within shadow root |

**Key insight:** The existing codebase already handles the complex parts (state management, message passing, playback orchestration). The floating player is primarily a UI rendering concern.

## Common Pitfalls

### Pitfall 1: CSS Leakage Despite Shadow DOM
**What goes wrong:** Page styles using `* { ... !important }` or CSS custom properties can leak
**Why it happens:** Shadow DOM inherits some properties by default (color, font)
**How to avoid:** Reset inherited properties explicitly in shadow root styles
**Warning signs:** Player looks different on sites with aggressive CSS resets

```css
/* Reset inherited properties in shadow root */
:host {
  all: initial;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  color: #1a1a1a;
}
```

### Pitfall 2: z-index Not Working
**What goes wrong:** Player appears behind page elements despite high z-index
**Why it happens:** z-index only works within stacking context; page may create new contexts
**How to avoid:** Use `position: fixed` on host element (creates new stacking context at document level)
**Warning signs:** Player visible on some pages, hidden on others

```css
/* Host element styles (applied to host, not shadow root) */
#besttts-floating-player {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647; /* Max safe integer - works because fixed positioning */
}
```

### Pitfall 3: Split-Brain State
**What goes wrong:** Player UI shows different state than popup or reality
**Why it happens:** Content script mutates local state independently of SW
**How to avoid:** Content script NEVER mutates state; only sends commands, waits for STATUS_UPDATE
**Warning signs:** Play/pause button state doesn't match actual playback

### Pitfall 4: Focus Lost on Navigation
**What goes wrong:** Player becomes non-interactive after SPA navigation
**Why it happens:** Framework may move/recreate DOM, breaking event listeners
**How to avoid:** Attach player to `document.body`, monitor for removal, re-inject if needed
**Warning signs:** Player visible but buttons don't respond after navigation

### Pitfall 5: Accessibility Gaps in Shadow DOM
**What goes wrong:** Screen readers don't announce player state changes
**Why it happens:** ARIA live regions inside shadow DOM may not propagate
**How to avoid:** Use `aria-live="polite"` on container, test with actual screen reader
**Warning signs:** No announcements when switching tracks or showing errors

## Code Examples

Verified patterns from official sources and existing codebase:

### Shadow DOM Host Element Creation
```typescript
// Source: Shadow DOM Web Platform spec + Chrome Extensions docs
function createShadowHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'besttts-floating-player';

  // Critical: position fixed escapes all stacking contexts
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647',
    // Prevent host from blocking page interaction when collapsed
    pointerEvents: 'none'
  });

  return host;
}
```

### Inline Styles for Player Controls
```typescript
// Source: Existing codebase pattern (overlay-highlighter.ts)
function getPlayerStyles(): string {
  return `
    :host {
      all: initial;
    }

    .player-container {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      color: #1a1a1a;
    }

    .player-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: #4a9eff;
      color: white;
      cursor: pointer;
    }

    .player-btn:hover {
      background: #3a8eef;
    }

    .player-btn:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      .player-container {
        background: #2a2a2a;
        color: #e5e5e5;
      }
    }
  `;
}
```

### Accessibility Attributes
```typescript
// Source: ARIA best practices + CONTEXT.md decisions
function createAccessibleButton(
  icon: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'player-btn';
  btn.setAttribute('aria-label', label);
  btn.textContent = icon; // Or use SVG
  btn.onclick = onClick;
  return btn;
}

function createPlayerContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'player-container';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Best TTS Audio Player');
  container.tabIndex = 0; // Make focusable for keyboard users
  return container;
}
```

### SPA Navigation Detection
```typescript
// Source: Navigation API + History API MDN docs
function setupNavigationMonitoring(onNavigate: (url: string) => void): void {
  // Modern Navigation API (Chrome 102+)
  if ('navigation' in window) {
    (window as any).navigation.addEventListener('navigate', (event: any) => {
      onNavigate(event.destination.url);
    });
    return;
  }

  // Fallback: History API
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    originalPushState(...args);
    onNavigate(location.href);
  };

  history.replaceState = (...args) => {
    originalReplaceState(...args);
    onNavigate(location.href);
  };

  window.addEventListener('popstate', () => {
    onNavigate(location.href);
  });
}
```

### Service Worker Hard Navigation Detection
```typescript
// Source: Chrome Extensions tabs.onUpdated API
// In service-worker.ts
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    // Hard navigation started - mark state as interrupted
    const state = getPlaybackState();
    if (state.activeTabId === tabId && state.status !== 'idle') {
      updatePlaybackState({
        status: 'interrupted', // New status for rehydration
        interruptedAt: Date.now()
      });
    }
  }

  if (changeInfo.status === 'complete') {
    // Page loaded - content script will rehydrate if needed
    // Content script will request state via GET_STATUS
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| History API (pushState/popstate) | Navigation API | Chrome 102 (2022) | Unified navigation handling |
| z-index:9999 wars | Shadow DOM isolation | Always available | No page conflicts |
| `mode: 'open'` default | `mode: 'closed'` recommended | Best practice 2025 | Security improvement |
| iframe for isolation | Shadow DOM | 2020s consensus | Better performance, simpler API |

**Deprecated/outdated:**
- Using `<template shadowroot>` without `shadowrootmode`: Old syntax, now requires `shadowrootmode` attribute
- Relying on CSS !important for isolation: Fragile, Shadow DOM is correct approach
- Using `all: unset` instead of `all: initial`: `initial` resets to spec defaults, `unset` can inherit

## Open Questions

Things that couldn't be fully resolved:

1. **Player position persistence across sessions**
   - What we know: Fixed bottom-right for MVP per CONTEXT.md decision
   - What's unclear: Future drag-to-position would need storage strategy
   - Recommendation: Defer to future phase; fixed position sufficient for MVP

2. **Animation/transition support**
   - What we know: Inline styles support transitions; pseudo-selectors like `:hover` work
   - What's unclear: Complex animations may need keyframes in style block
   - Recommendation: Use CSS transitions for hover/focus; add @keyframes if needed for show/hide

3. **Top layer API for guaranteed visibility**
   - What we know: `<dialog>` and Popover API use top layer, escaping z-index entirely
   - What's unclear: Whether custom elements can access top layer without being dialog/popover
   - Recommendation: Not needed for MVP; fixed positioning with max z-index is sufficient

## Sources

### Primary (HIGH confidence)
- `/websites/developer_chrome_extensions` (Context7) - Content scripts, message passing, tabs API
- MDN Web Docs - Shadow DOM, Navigation API, History API, ARIA roles
- Chrome for Developers - tabs.onUpdated, webNavigation events

### Secondary (MEDIUM confidence)
- Smashing Magazine 2025/07 - Shadow DOM implementation patterns, form accessibility constraints
- DEV.to articles on Shadow DOM in Chrome extensions - Practical CSS isolation patterns

### Tertiary (LOW confidence)
- Medium articles on z-index and stacking contexts - General web development patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native browser APIs, well-documented
- Architecture: HIGH - Patterns match existing codebase, verified against Chrome docs
- Pitfalls: HIGH - Common issues documented across multiple authoritative sources

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (stable APIs, unlikely to change)
