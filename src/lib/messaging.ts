/**
 * Shared messaging utilities for popup and sidepanel.
 */

/**
 * Send a message to the service worker and wait for a response.
 */
export async function sendToServiceWorker<T>(
  type: string,
  payload?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'service-worker', type, ...payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}
