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
      font-size: 16px;
    }

    .player-btn:hover {
      background: #3a8eef;
    }

    .player-btn:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }

    .player-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .player-btn.dismiss {
      background: #e5e5e5;
      color: #666;
      width: 28px;
      height: 28px;
      font-size: 12px;
    }

    .player-btn.dismiss:hover {
      background: #d5d5d5;
    }

    .progress-text {
      min-width: 60px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .speed-display {
      min-width: 48px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .hidden {
      display: none !important;
    }

    @media (prefers-color-scheme: dark) {
      .player-container {
        background: #2a2a2a;
        color: #e5e5e5;
      }

      .player-btn.dismiss {
        background: #444;
        color: #ccc;
      }

      .player-btn.dismiss:hover {
        background: #555;
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
 * Create the floating player Shadow DOM component.
 *
 * Returns a singleton instance - calling multiple times returns the same player.
 * Player starts hidden and becomes visible when update() is called with non-idle status.
 */
export function createFloatingPlayer(): {
  update: (state: PlayerUIState) => void;
  destroy: () => void;
  isVisible: () => boolean;
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
    playPauseBtn,
    speedDisplay,
    progressDisplay,
    dismissBtn
  } = createPlayerDOM(shadow);

  // Track visibility
  let isVisible = false;

  // Update function - renders state to UI
  function update(state: PlayerUIState): void {
    // Show/hide based on status
    if (state.status === 'idle') {
      container.classList.add('hidden');
      isVisible = false;
    } else {
      container.classList.remove('hidden');
      isVisible = true;
    }

    // Update play/pause button
    if (state.status === 'playing') {
      playPauseBtn.setAttribute('aria-label', 'Pause');
      playPauseBtn.textContent = '\u23F8'; // Pause symbol
    } else {
      playPauseBtn.setAttribute('aria-label', 'Play');
      playPauseBtn.textContent = '\u25B6'; // Play symbol
    }

    // Update progress
    progressDisplay.textContent = `${state.currentChunk + 1}/${state.totalChunks}`;

    // Update speed display
    speedDisplay.textContent = `${state.playbackSpeed.toFixed(1)}x`;
  }

  // Dismiss handler
  dismissBtn.onclick = () => {
    container.classList.add('hidden');
    isVisible = false;
    // Dispatch event for cleanup coordination
    window.dispatchEvent(new CustomEvent('besttts-player-dismissed'));
  };

  // Focus-scoped keyboard handler (per CONTEXT.md decision [12])
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissBtn.click();
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
    isVisible: () => isVisible
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
