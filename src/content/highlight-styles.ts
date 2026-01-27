/**
 * CSS injection module for highlight styling.
 *
 * Per CONTEXT.md:
 * - Uses data-attribute selector for isolation from page CSS
 * - Includes dark mode support via media query
 * - Safe to call multiple times (idempotent)
 */

const STYLE_ID = 'besttts-highlight-styles';

/**
 * CSS for highlight styling.
 * Uses data-attribute selector for isolation from page CSS.
 * Includes dark mode support via media query.
 */
const HIGHLIGHT_CSS = `
[data-besttts-sentence].besttts-highlight-active {
  background-color: rgba(255, 230, 0, 0.4) !important;
  border-radius: 2px !important;
  box-decoration-break: clone !important;
}

@media (prefers-color-scheme: dark) {
  [data-besttts-sentence].besttts-highlight-active {
    background-color: rgba(255, 200, 0, 0.3) !important;
  }
}
`;

/**
 * Inject highlight styles into the page head.
 * Safe to call multiple times - will not duplicate.
 */
export function injectHighlightStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  document.head.appendChild(style);
}

/**
 * Remove highlight styles from the page.
 */
export function removeHighlightStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}
