---
name: Source-to-editor links
overview: Intercept SWC's jsxDEV source param via a thin runtime wrapper to inject data-source attributes in dev mode, then add "Open in Editor" to el-picker using those attributes.
todos:
  - id: jsx-wrapper
    content: Create src/lib/source-tags/jsx-dev-runtime.ts -- thin wrapper that injects data-source from jsxDEV source param
    status: in_progress
  - id: next-config
    content: Update next.config.ts with resolve aliases for both Turbopack and Webpack (dev-only gate)
    status: pending
  - id: verify-turbopack
    content: Test that data-source attributes appear in dev mode DOM with Turbopack; fall back to --webpack if needed
    status: pending
  - id: elpicker-source-logic
    content: Add findDataSource() and openInEditor() functions to content.js
    status: pending
  - id: elpicker-open-button
    content: Add Open button to overlay action bar, Enter key handler, and source display in overlay
    status: pending
  - id: elpicker-settings
    content: Add Editor Settings (editor preference + project root) to popup.html and popup.js
    status: pending
  - id: elpicker-styles
    content: Add CSS for Open button, source display, and disabled states in content.css
    status: pending
  - id: elpicker-build-test
    content: Run build-extension.sh and verify the extension works end-to-end
    status: pending
isProject: false
---

# Source-to-Editor Links

## Context

React 19 removed `_debugSource` from fibers, but SWC's dev JSX transform still calls `jsxDEV(type, props, key, isStaticChildren, source, self)` with full source info (`fileName`, `lineNumber`). React just discards it. We intercept it before that happens.

## Part 1: v5 -- Inject `data-source` via JSX Dev Runtime Wrapper

### Approach

Alias `react/jsx-dev-runtime` to a thin wrapper that captures the `source` param and adds `data-source="file:line"` as a prop on intrinsic HTML elements (div, span, button, etc.). The prop flows through React as a standard `data-*` attribute. Dev-only -- production uses `react/jsx-runtime` which never receives source info.

### Files to create

`**[src/lib/source-tags/jsx-dev-runtime.ts](src/lib/source-tags/jsx-dev-runtime.ts)**` -- The wrapper:

- Import the real `jsxDEV` and `Fragment` from a secondary alias (`__original_jsx_dev_runtime`) that points to the actual `react/jsx-dev-runtime` module
- Export a wrapped `jsxDEV` that, for string element types (intrinsic HTML), spreads `data-source` into props from `source.fileName` and `source.lineNumber`
- Re-export `Fragment` unchanged

```typescript
export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  if (typeof type === 'string' && source?.fileName) {
    props = { ...props, 'data-source': `${source.fileName}:${source.lineNumber}` }
  }
  return _jsxDEV(type, props, key, isStaticChildren, source, self)
}
```

### Files to modify

`**[next.config.ts](next.config.ts)**` -- Add resolve aliases (dev-only):

- For **Turbopack** (dev): use `turbo.resolveAlias` (or `experimental.turbo.resolveAlias` depending on Next.js 16 API)
- For **Webpack** (prod build, or if dev falls back to webpack): use the `webpack` callback with `config.resolve.alias`
- Both alias `react/jsx-dev-runtime` to our wrapper, and `__original_jsx_dev_runtime` to the real module (breaking circular import)
- Gate on `process.env.NODE_ENV === 'development' || process.env.ADD_SOURCE_FILE_TAGS === 'true'`

### Fallback

If Turbopack's `resolveAlias` doesn't support this cleanly (circular dep issues or API differences), change the dev script in `package.json` from `next dev` to `next dev --webpack` as a known-working fallback. Slightly slower HMR but zero risk.

### What NOT to change

- No Babel config added
- No new dependencies
- No changes to CI/Cloudflare deploy (production JSX runtime is unaffected)
- No `data-source` in production HTML

---

## Part 2: el-picker -- "Open in Editor" Feature

### Changes to `[content.js](../el-picker/content.js)`

1. **Add `findDataSource(element)`** -- walks up from the selected element via `element.closest('[data-source]')` to find the nearest `data-source` attribute
2. **Add `openInEditor(source)`** -- parses `file:line` from the attribute value, reads editor preference from storage, constructs `cursor://file/path:line` or `vscode://file/path:line`, and opens it via `window.location.href`
3. **Add "Open" button** to the overlay action bar (line ~435, next to the Copy button) -- styled as `elpicker-btn-primary` with an external-link icon. Disabled/hidden when no `data-source` found on the element or ancestors
4. **Add `data-source` display** in the overlay preview section -- when source info is found, show the file path and line number (monospace, truncated to relative path)
5. **Add Enter key handler** in `onKeyDown` (line ~719) -- when an element is selected and `data-source` is found, Enter opens in editor. Show toast if no source info found
6. **Load/save editor config** from `chrome.storage.sync` alongside existing `selectorConfig`

### Changes to `[content.css](../el-picker/content.css)`

- Style for the "Open" button (accent color to distinguish from Copy)
- Style for the source file display in the overlay
- Style for disabled state when no `data-source` available

### Changes to `[popup.html](../el-picker/popup.html)` and `[popup.js](../el-picker/popup.js)`

Add an "Editor Settings" section to the popup (below existing Selector Settings):

- **Editor** dropdown: Cursor / VS Code (default: Cursor)
- **Project root** text input: optional override for when `data-source` paths are relative (auto-detected from absolute paths when possible)
- Save/load from `chrome.storage.sync` under key `editorConfig` 
- When "picked" panel is open Pressing key "Enter" Opens code editor (like the open button) Pressing Cmd-C (or Ctl-C on PC) copies the current selector. Pressing "," and "." flips through the choices of the kind of copy the selection will be of (i.e. CSS selector, Outer html,...). Key is propagation stopped.

### Changes to `[manifest.json](../el-picker/manifest.json)`

- No permission changes needed (`activeTab` + `storage` are sufficient)

### Keyboard shortcut summary update in popup

- Add a row: `Enter` -- "Open in Editor"
- Add a row: `,` or `<` -- "Prior selector type"
- Add a row: `.` or `>` -- "Next selector type"
- Add a row: `Cmd-C` or `Ctl-C` -- "Copy selector"

