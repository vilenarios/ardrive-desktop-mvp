/**
 * UX-3 / D-005 — the single IPC response envelope.
 *
 * Every enveloped `ipcMain` handler resolves to this shape:
 *   - success: `{ success: true, data }` where `data` is the handler's payload
 *   - failure: `{ success: false, error }` with a human-readable message
 *
 * The preload methods that invoke such handlers are annotated to return
 * `Promise<IpcResult<T>>`. Because the renderer's `window.electronAPI` type is
 * `typeof api` (see preload.ts), that annotation flows to every call site, so
 * the compiler flags any code that reads a raw property off the wrapper
 * (`.id`, `.find()`, `.length`, …) instead of unwrapping `.data` behind a
 * `.success` guard.
 *
 * Handlers are wrapped with `envelopeHandler` (main.ts), which produces this
 * shape uniformly: it returns `{ success: true, data }` from the inner
 * handler's resolved value and `{ success: false, error }` from any thrown
 * error. Input validation and business errors therefore surface as
 * `success: false` rather than a rejected promise — call sites must branch on
 * `.success`, not rely on try/catch.
 */
export type IpcResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
