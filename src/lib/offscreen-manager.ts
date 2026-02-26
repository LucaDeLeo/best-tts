const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Track document creation to prevent race conditions
let creating: Promise<void> | null = null;

/**
 * Ensures an offscreen document exists for TTS operations.
 * Uses AUDIO_PLAYBACK and WORKERS reasons to prevent premature closure.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  // Check if document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return; // Document exists
  }

  // Prevent race condition if multiple callers try to create simultaneously
  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
      chrome.offscreen.Reason.WORKERS
    ],
    justification: 'TTS inference via WASM and audio playback'
  });

  try {
    await creating;
  } finally {
    // Always clear so future callers can retry after failures.
    creating = null;
  }
}

/**
 * Closes the offscreen document if it exists.
 * Call when extension is disabled or no longer needs TTS.
 */
export async function closeOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

/**
 * Checks if offscreen document is currently active.
 */
export async function isOffscreenDocumentActive(): Promise<boolean> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return existingContexts.length > 0;
}
