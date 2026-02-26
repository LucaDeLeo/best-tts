I've created the final CONTEXT.md file incorporating the Codex feedback.

**Summary of changes:**

1. **[AGREE] items (1-7, 9-10):** Kept as-is with source attribution "Both agreed"

2. **[QUESTION] item (8 - Download Progress):** Refined the approach:
   - Original: Simple popup-only progress
   - Codex concern: Popups close easily during long downloads
   - Resolution: Track download state in IndexedDB so popup can show current status when reopened. This balances simplicity with reasonable UX.

3. **[UNCERTAIN] items:** Added to "Flagged for Human Review" section:
   - Phase 1 UI scope (popup vs dedicated page)
   - Initial voice set (count and selection)
   - Browser support floor (Chrome version)
   - Offline requirement clarity

4. **Codex Gaps:** Added as "Technical Requirements" section with specific action items:
   - MV3 CSP/WASM configuration
   - Cross-origin isolation decisions
   - Model fetch permissions and error handling
   - Offscreen document lifecycle management

The document is now ready for planning phase.

---

## Auto-Discuss Metadata

- **Rounds:** 3
- **Codex Available:** yes
- **Uncertainties Resolution:** none
- **Timestamp:** 2026-01-27T03:39:48Z

<details>
<summary>Codex Review (Round 2)</summary>

**Decisions 1–5**
- [AGREE] (1) Vite + CRXJS + TS + MV3: best-known MV3 stack; low risk.
- [AGREE] (2) `kokoro-js` over raw ORT: good abstraction; verify MV3 CSP/ESM compatibility early.
- [AGREE] (3) default `model_q8.onnx`: strong quality/size tradeoff for browser memory limits.
- [AGREE] (4) inference in offscreen document: correct for WASM + persistence vs SW timeouts.
- [AGREE] (5) IndexedDB + lazy HF download: right for size; ensure permissions/CORS.

**Decisions 6–10**
- [AGREE] (6) audio playback in offscreen document: avoids buffer shuttling; WebAudio works there.
- [AGREE] (7) voice selection in `chrome.storage.local`: simple and persistent.
- [QUESTION] (8) progress only in popup: popups close easily; consider a persistent status in SW/offscreen with popup as a view.
- [AGREE] (9) SW as message hub: fine for orchestration; keep payloads small.
- [AGREE] (10) WASM default backend: safest compatibility; WebGPU later is sensible.

**Uncertainties**
- [UNCERTAIN] Phase‑1 UI scope: popup vs dedicated extension page for testing UX.
- [UNCERTAIN] Initial voice set: 3 vs broader, and which voices define the “default” brand sound.
- [UNCERTAIN] Browser support floor (Chrome version) given offscreen doc + WASM constraints.
- [UNCERTAIN] Offline requirement: must TTS work after first download with no network?

**Gaps to Address**
- MV3 CSP/wasm: `wasm-unsafe-eval` plus correct `.wasm` asset hosting/paths for `onnxruntime-web`.
- Cross‑origin isolation: decide on COOP/COEP for threaded WASM or force single‑thread.
- Model fetch: confirm HF CORS + `host_permissions`; plan fallback CDN or clear error UX.
- Lifecycle: create/keep/close offscreen document intentionally and handle audio start without user gesture.

</details>
