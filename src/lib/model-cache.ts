const CACHE_STATUS_KEY = 'tts-model-cache-status';
const DOWNLOAD_PROGRESS_KEY = 'downloadProgress';

export interface CacheStatus {
  initialized: boolean;
  lastUpdated: number;
  modelId: string;
  sizeBytes?: number;
}

/**
 * Get model cache status
 */
export async function getCacheStatus(): Promise<CacheStatus | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_STATUS_KEY);
    return (result[CACHE_STATUS_KEY] as CacheStatus | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Set model cache status
 */
export async function setCacheStatus(status: CacheStatus): Promise<void> {
  await chrome.storage.local.set({ [CACHE_STATUS_KEY]: status });
}

/**
 * Clear model cache (for debugging/reset)
 */
export async function clearModelCache(): Promise<void> {
  // Note: This clears our status tracking
  // The actual model cache is managed by transformers.js
  await chrome.storage.local.remove([CACHE_STATUS_KEY, DOWNLOAD_PROGRESS_KEY]);
}

/**
 * Get download progress from storage
 */
export interface DownloadProgress {
  file: string;
  loaded: number;
  total: number;
  percent: number;
}

export async function getDownloadProgress(): Promise<DownloadProgress | null> {
  const result = await chrome.storage.local.get(DOWNLOAD_PROGRESS_KEY);
  const progress = result[DOWNLOAD_PROGRESS_KEY] as DownloadProgress | undefined;
  return progress ?? null;
}

/**
 * Set download progress in storage
 */
export async function setDownloadProgress(progress: DownloadProgress): Promise<void> {
  await chrome.storage.local.set({ [DOWNLOAD_PROGRESS_KEY]: progress });
}

/**
 * Clear download progress
 */
export async function clearDownloadProgress(): Promise<void> {
  await chrome.storage.local.remove(DOWNLOAD_PROGRESS_KEY);
}

/**
 * Estimate storage usage
 */
export async function getStorageUsage(): Promise<{
  used: number;
  quota: number;
  percent: number;
}> {
  const estimate = await navigator.storage.estimate();
  const used = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const percent = quota > 0 ? Math.round((used / quota) * 100) : 0;
  return { used, quota, percent };
}
