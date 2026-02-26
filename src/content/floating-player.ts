/**
 * Floating player Shadow DOM component for in-page playback controls.
 *
 * Per CONTEXT.md:
 * - Shadow DOM with closed mode for CSS isolation and security
 * - Fixed bottom-right position with max z-index
 * - Inline styles to prevent page CSS leakage
 * - Content script owns a cached copy of state; SW is authoritative
 * - Focus-scoped keyboard handlers (no global listeners)
 */

import { MessageType } from '../lib/messages';

// Speed presets for cycling
const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// Component state interface
export interface PlayerUIState {
  status: 'idle' | 'generating' | 'playing' | 'paused';
  currentChunk: number;
  totalChunks: number;
  playbackSpeed: number;
}

// Singleton instance tracking
let playerInstance: ReturnType<typeof createFloatingPlayer> | null = null;
let hostElement: HTMLElement | null = null;

// Current state for computing correct actions
let currentState: PlayerUIState = {
  status: 'idle',
  currentChunk: 0,
  totalChunks: 0,
  playbackSpeed: 1.0
};

/**
 * Send playback command to service worker.
 * Silent catch since service worker might not be listening.
 */
function sendPlaybackCommand(type: string, payload?: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type,
    ...payload
  }).catch(() => {
    // Service worker might not be listening
  });
}

/**
 * Get inline styles for the player component.
 * Uses :host { all: initial } to reset inherited properties.
 */
function getPlayerStyles(): string {
  return `
    :host {
      all: initial;
    }

    .player-container {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: #fafaf9;
      border: 1px solid #e7e5e4;
      border-radius: 14px;
      box-shadow: 0 4px 15px rgba(28, 25, 23, 0.1), 0 1px 3px rgba(28, 25, 23, 0.06);
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #1c1917;
      -webkit-font-smoothing: antialiased;
    }

    .player-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border: none;
      border-radius: 50%;
      background: #d97706;
      color: #fafaf9;
      cursor: pointer;
      font-size: 15px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .player-btn:hover {
      background: #b45309;
      transform: scale(1.06);
      box-shadow: 0 2px 8px rgba(217, 119, 6, 0.3);
    }

    .player-btn:active {
      transform: scale(0.95);
    }

    .player-btn:focus {
      outline: 2px solid #d97706;
      outline-offset: 2px;
    }

    .player-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .player-btn.dismiss {
      background: #e7e5e4;
      color: #78716c;
      width: 26px;
      height: 26px;
      font-size: 11px;
    }

    .player-btn.dismiss:hover {
      background: #d6d3d1;
      color: #57534e;
      box-shadow: none;
    }

    .progress-text {
      min-width: 55px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      color: #78716c;
      font-weight: 500;
    }

    .speed-display {
      min-width: 44px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      color: #57534e;
      transition: all 0.15s ease;
    }

    .speed-display:hover {
      background: rgba(28, 25, 23, 0.06);
      color: #1c1917;
    }

    .hidden {
      display: none !important;
    }

    @media (prefers-color-scheme: dark) {
      .player-container {
        background: #292524;
        border-color: #44403c;
        color: #fafaf9;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .player-btn {
        background: #f59e0b;
        color: #1c1917;
      }

      .player-btn:hover {
        background: #fbbf24;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      }

      .player-btn.dismiss {
        background: #44403c;
        color: #a8a29e;
      }

      .player-btn.dismiss:hover {
        background: #57534e;
        color: #d6d3d1;
      }

      .progress-text {
        color: #a8a29e;
      }

      .speed-display {
        color: #a8a29e;
      }

      .speed-display:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fafaf9;
      }
    }
  `;
}

/**
 * Create accessible button element.
 */
function createButton(
  className: string,
  label: string,
  icon: string
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `player-btn ${className}`;
  btn.setAttribute('aria-label', label);
  btn.textContent = icon;
  return btn;
}

/**
 * Create the player DOM structure within the shadow root.
 */
function createPlayerDOM(shadow: ShadowRoot): {
  container: HTMLDivElement;
  prevBtn: HTMLButtonElement;
  playPauseBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  speedDisplay: HTMLSpanElement;
  progressDisplay: HTMLSpanElement;
  dismissBtn: HTMLButtonElement;
} {
  // Add styles
  const style = document.createElement('style');
  style.textContent = getPlayerStyles();
  shadow.appendChild(style);

  // Create container
  const container = document.createElement('div');
  container.className = 'player-container hidden'; // Start hidden
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Best TTS Audio Player');
  container.tabIndex = 0; // Make focusable for keyboard users

  // Create controls
  const prevBtn = createButton('prev', 'Previous sentence', '\u23EE'); // Previous track symbol
  const playPauseBtn = createButton('play-pause', 'Play', '\u25B6'); // Play symbol
  const nextBtn = createButton('next', 'Next sentence', '\u23ED'); // Next track symbol
  const stopBtn = createButton('stop', 'Stop playback', '\u23F9'); // Stop symbol

  // Speed display
  const speedDisplay = document.createElement('span');
  speedDisplay.className = 'speed-display';
  speedDisplay.textContent = '1.0x';

  // Progress display
  const progressDisplay = document.createElement('span');
  progressDisplay.className = 'progress-text';
  progressDisplay.textContent = '0/0';

  // Dismiss button
  const dismissBtn = createButton('dismiss', 'Dismiss player', '\u2715'); // X symbol

  // Assemble
  container.appendChild(prevBtn);
  container.appendChild(playPauseBtn);
  container.appendChild(nextBtn);
  container.appendChild(stopBtn);
  container.appendChild(speedDisplay);
  container.appendChild(progressDisplay);
  container.appendChild(dismissBtn);

  shadow.appendChild(container);

  return {
    container,
    prevBtn,
    playPauseBtn,
    nextBtn,
    stopBtn,
    speedDisplay,
    progressDisplay,
    dismissBtn
  };
}

/**
 * Options for createFloatingPlayer factory function.
 */
export interface FloatingPlayerOptions {
  /** Callback invoked when user dismisses the player */
  onDismiss?: () => void;
}

/**
 * Create the floating player Shadow DOM component.
 *
 * Returns a singleton instance - calling multiple times returns the same player.
 * Player starts hidden and becomes visible when update() is called with non-idle status.
 *
 * @param options.onDismiss - Called when user clicks dismiss button (player hides but playback continues)
 */
export function createFloatingPlayer(options?: FloatingPlayerOptions): {
  update: (state: PlayerUIState) => void;
  destroy: () => void;
  isVisible: () => boolean;
  show: () => void;
  hide: () => void;
} {
  // Return existing instance if already created
  if (playerInstance) {
    return playerInstance;
  }

  // Create host element with fixed positioning
  const host = document.createElement('div');
  host.id = 'besttts-floating-player';
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647', // Max z-index
    pointerEvents: 'none' // Inner container has pointer-events: auto
  });

  // Attach shadow with closed mode for security
  const shadow = host.attachShadow({ mode: 'closed' });

  // Create player DOM
  const {
    container,
    prevBtn,
    playPauseBtn,
    nextBtn,
    stopBtn,
    speedDisplay,
    progressDisplay,
    dismissBtn
  } = createPlayerDOM(shadow);

  // Track visibility and dismissed state
  let isVisible = false;
  let isHidden = false; // true when user explicitly dismissed
  let previousAnnouncedStatus: PlayerUIState['status'] | null = null;

  /**
   * Show the player (if not idle).
   * Called when user wants to restore a dismissed player.
   */
  function showPlayer(): void {
    if (currentState.status !== 'idle') {
      container.classList.remove('hidden');
      isHidden = false;
      isVisible = true;
    }
  }

  /**
   * Hide the player without stopping playback.
   * Called when user dismisses the player.
   */
  function hidePlayer(): void {
    container.classList.add('hidden');
    isHidden = true;
    isVisible = false;
  }

  // Update function - renders state to UI and updates currentState
  function update(state: PlayerUIState): void {
    // Update cached state for button handlers
    currentState = { ...state };

    // Auto-hide when idle (always hide on idle, and reset dismissed state)
    if (state.status === 'idle') {
      container.classList.add('hidden');
      isVisible = false;
      // Reset isHidden so next playback will auto-show the player
      isHidden = false;
    } else if (!isHidden) {
      // Show only if not explicitly dismissed by user
      container.classList.remove('hidden');
      isVisible = true;
    }
    // If isHidden is true and status != idle, player stays hidden (dismissed state)

    // Update play/pause button icon and label
    if (state.status === 'playing') {
      playPauseBtn.setAttribute('aria-label', 'Pause');
      playPauseBtn.textContent = '\u23F8'; // Pause symbol
    } else {
      playPauseBtn.setAttribute('aria-label', 'Play');
      playPauseBtn.textContent = '\u25B6'; // Play symbol
    }

    // Disable play/pause when idle or generating
    playPauseBtn.disabled = state.status === 'idle' || state.status === 'generating';

    // Disable prev when at first chunk
    prevBtn.disabled = state.currentChunk === 0;

    // Disable next when at last chunk
    nextBtn.disabled = state.currentChunk >= state.totalChunks - 1;

    // Update progress display ("X / Y" format)
    progressDisplay.textContent = `${state.currentChunk + 1} / ${state.totalChunks}`;

    // Update speed display ("X.Xx" format)
    speedDisplay.textContent = `${state.playbackSpeed.toFixed(2)}x`;

    // Announce state transitions to screen readers (avoid redundant announcements)
    if (state.status !== previousAnnouncedStatus) {
      if (state.status === 'playing') {
        announce(`Playing sentence ${state.currentChunk + 1} of ${state.totalChunks}`);
      } else if (state.status === 'paused') {
        announce('Paused');
      }
      previousAnnouncedStatus = state.status;
    }
  }

  // Play/Pause button handler
  playPauseBtn.onclick = () => {
    if (currentState.status === 'playing') {
      sendPlaybackCommand(MessageType.PAUSE_AUDIO);
    } else if (currentState.status === 'paused') {
      sendPlaybackCommand(MessageType.RESUME_AUDIO);
    }
    // Don't handle idle/generating - button should be disabled
  };

  // Stop button handler
  stopBtn.onclick = () => {
    sendPlaybackCommand(MessageType.STOP_PLAYBACK);
  };

  // Skip previous button handler
  prevBtn.onclick = () => {
    const targetIndex = Math.max(0, currentState.currentChunk - 1);
    if (targetIndex !== currentState.currentChunk) {
      sendPlaybackCommand(MessageType.SKIP_TO_CHUNK, { chunkIndex: targetIndex });
    }
  };

  // Skip next button handler
  nextBtn.onclick = () => {
    const targetIndex = Math.min(currentState.totalChunks - 1, currentState.currentChunk + 1);
    if (targetIndex !== currentState.currentChunk) {
      sendPlaybackCommand(MessageType.SKIP_TO_CHUNK, { chunkIndex: targetIndex });
    }
  };

  // Speed control handler - cycles through presets
  speedDisplay.style.cursor = 'pointer';
  speedDisplay.onclick = () => {
    const currentIdx = SPEED_PRESETS.findIndex(s => Math.abs(s - currentState.playbackSpeed) < 0.01);
    const nextIdx = (currentIdx + 1) % SPEED_PRESETS.length;
    const nextSpeed = SPEED_PRESETS[nextIdx];
    sendPlaybackCommand(MessageType.SET_SPEED, { speed: nextSpeed });
  };

  // Dismiss handler - hides player without stopping playback
  // Per CONTEXT.md decision [7]: full dismiss with popup restore affordance
  dismissBtn.onclick = () => {
    hidePlayer();
    options?.onDismiss?.();
  };

  // Add ARIA live region for screen reader announcements
  const announcer = document.createElement('span');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  Object.assign(announcer.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0'
  });
  container.appendChild(announcer);

  // Helper to announce state changes to screen readers
  function announce(message: string): void {
    announcer.textContent = message;
  }

  // Focus-scoped keyboard handler (per CONTEXT.md decision [12])
  // Only handles keys when player container has focus
  container.addEventListener('keydown', (e) => {
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        // Toggle play/pause
        if (currentState.status === 'playing') {
          sendPlaybackCommand(MessageType.PAUSE_AUDIO);
          announce('Paused');
        } else if (currentState.status === 'paused') {
          sendPlaybackCommand(MessageType.RESUME_AUDIO);
          announce(`Playing sentence ${currentState.currentChunk + 1} of ${currentState.totalChunks}`);
        }
        break;

      case 'Escape':
        e.preventDefault();
        // Dismiss player (hide without stopping playback)
        hidePlayer();
        options?.onDismiss?.();
        announce('Player dismissed');
        break;

      case 'ArrowLeft':
        e.preventDefault();
        // Skip previous
        if (currentState.currentChunk > 0) {
          const prevIndex = currentState.currentChunk - 1;
          sendPlaybackCommand(MessageType.SKIP_TO_CHUNK, { chunkIndex: prevIndex });
          announce(`Sentence ${prevIndex + 1} of ${currentState.totalChunks}`);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        // Skip next
        if (currentState.currentChunk < currentState.totalChunks - 1) {
          const nextIndex = currentState.currentChunk + 1;
          sendPlaybackCommand(MessageType.SKIP_TO_CHUNK, { chunkIndex: nextIndex });
          announce(`Sentence ${nextIndex + 1} of ${currentState.totalChunks}`);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        // Increase speed
        {
          const fasterIdx = SPEED_PRESETS.findIndex(s => s > currentState.playbackSpeed);
          if (fasterIdx !== -1) {
            const newSpeed = SPEED_PRESETS[fasterIdx];
            sendPlaybackCommand(MessageType.SET_SPEED, { speed: newSpeed });
            announce(`Speed ${newSpeed.toFixed(2)}x`);
          }
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        // Decrease speed
        {
          const speeds = [...SPEED_PRESETS].reverse();
          const slowerIdx = speeds.findIndex(s => s < currentState.playbackSpeed);
          if (slowerIdx !== -1) {
            const newSpeed = speeds[slowerIdx];
            sendPlaybackCommand(MessageType.SET_SPEED, { speed: newSpeed });
            announce(`Speed ${newSpeed.toFixed(2)}x`);
          }
        }
        break;
    }
  });

  // Add host to document
  document.body.appendChild(host);
  hostElement = host;

  // Create instance
  playerInstance = {
    update,
    destroy: () => {
      host.remove();
      hostElement = null;
      playerInstance = null;
    },
    isVisible: () => isVisible,
    show: showPlayer,
    hide: hidePlayer
  };

  return playerInstance;
}

/**
 * Destroy the floating player and clean up.
 */
export function destroyFloatingPlayer(): void {
  if (playerInstance) {
    playerInstance.destroy();
  }
}
