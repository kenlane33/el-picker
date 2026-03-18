# Adopting ElPicker in a Next.js / React Project

How to make your project a good citizen for [ElPicker](../manifest.json) — the Chrome extension that picks DOM elements, generates CSS selectors, suggests semantic classes, and (optionally) opens the source file in your editor.

There are three independent layers of adoption. Each is useful on its own; together they're powerful.

---

## Layer 1: Semantic Class Markers

**What:** Add `xx--` and `oo--` prefixed CSS classes to interactive and structural HTML elements. ElPicker recognizes these, prioritizes them in generated selectors, and suggests new ones.

**Why:** Auto-generated selectors like `div.flex.items-center:nth-of-type(3) > button` are fragile and opaque. A selector like `button.xx--button.oo--submit` tells you what the element *is* and what it *does*.

### Convention

| Prefix | Purpose | Examples |
|--------|---------|----------|
| `xx--<name>` | Structural / functional role | `xx--sidebar`, `xx--card`, `xx--button`, `xx--input`, `xx--table` |
| `oo--<name>` | Specific / unique identity | `oo--site-sidebar`, `oo--home-hero`, `oo--map-legend`, `oo--submit` |

### How to Apply

Add markers to components where they matter for testing, scraping, or debugging. Not every `<div>` needs one — aim for a balanced count on interactive and landmark elements.

```jsx
// A button component
export function SubmitButton({ className, ...props }) {
  return (
    <button
      className={cn('xx--button oo--submit', className)}
      {...props}
    />
  )
}
```

```jsx
// A page landmark
<aside className="xx--sidebar oo--site-sidebar">
  {/* ... */}
</aside>
```

```jsx
// A card in a list
<article className="xx--card oo--parcel-card">
  {/* ... */}
</article>
```

### Effort

Low. Sprinkle classes as you build. Retrofit existing components gradually — start with navigation, buttons, forms, and page landmarks. No build changes, no dependencies.

---

## Layer 2: ElPicker Selector Settings

**What:** Configure ElPicker's popup settings to match your project's class/ID conventions. This tells the extension which patterns to prefer (promoted to the front of generated selectors) and which to avoid (auto-generated noise excluded entirely).

### Default Configuration

ElPicker ships with sensible defaults. Open the extension popup, expand **Selector Settings**, and you'll see:

| Setting | Default | Purpose |
|---------|---------|---------|
| Preferred Class Patterns | `^xx--`, `^oo--` | Regex patterns for classes to prioritize |
| Avoided Class Patterns | `^elpicker-` | Regex patterns for classes to exclude |
| Avoided ID Patterns | `^radix-` | Regex patterns for auto-generated IDs to skip |

### Per-Project Customization

If your project uses additional conventions, add them:

**Preferred patterns** (one regex per line):
```
^xx--
^oo--
^data-testid
```

**Avoided class patterns** — things that pollute selectors without adding meaning:
```
^elpicker-
^_next
^__
```

**Avoided ID patterns** — auto-generated IDs from UI libraries:
```
^radix-
^headlessui-
^react-aria-
^:r
```

Settings are saved to `chrome.storage.sync` and apply across all tabs. The content script picks them up immediately — no reload needed.

### Effort

Minimal. One-time setup per machine. Takes 30 seconds.

---

## Layer 3: Source-to-Editor Links (`data-source`)

**What:** Inject `data-source="path/to/file.tsx:42"` attributes into every intrinsic HTML element during development. ElPicker reads these and can open the source file directly in Cursor or VS Code.

**Why:** React 19 removed `_debugSource` from fibers. But SWC's dev JSX transform still passes full source info (`fileName`, `lineNumber`) to `jsxDEV()` — React just discards it. We intercept it before that happens.

### How It Works

1. A thin wrapper re-exports `react/jsx-dev-runtime`, capturing the `source` param and injecting it as a `data-source` prop on string element types (`div`, `span`, `button`, etc.)
2. `next.config.ts` aliases `react/jsx-dev-runtime` to the wrapper (dev-only)
3. ElPicker walks up from any selected element via `element.closest('[data-source]')` to find the nearest source attribution

### Files to Create

**`src/lib/source-tags/jsx-dev-runtime.ts`** — the wrapper:

```typescript
import {
  jsxDEV as _jsxDEV,
  Fragment,
} from '__original_jsx_dev_runtime'

export { Fragment }

export function jsxDEV(
  type: any,
  props: any,
  key: any,
  isStaticChildren: boolean,
  source: { fileName: string; lineNumber: number; columnNumber: number } | undefined,
  self: any,
) {
  if (typeof type === 'string' && source?.fileName) {
    props = {
      ...props,
      'data-source': `${source.fileName}:${source.lineNumber}`,
    }
  }
  return _jsxDEV(type, props, key, isStaticChildren, source, self)
}
```

### Files to Modify

**`next.config.ts`** — add resolve aliases (dev-only):

```typescript
import type { NextConfig } from 'next'
import path from 'node:path'

const addSourceTags =
  process.env.NODE_ENV === 'development' ||
  process.env.ADD_SOURCE_FILE_TAGS === 'true'

const nextConfig: NextConfig = {
  // ... existing config ...

  // Turbopack (used by `next dev`)
  ...(addSourceTags && {
    turbo: {
      resolveAlias: {
        'react/jsx-dev-runtime': path.resolve(
          __dirname,
          'src/lib/source-tags/jsx-dev-runtime.ts',
        ),
        __original_jsx_dev_runtime: 'react/jsx-dev-runtime',
      },
    },
  }),

  // Webpack fallback (used by `next build` or `next dev --webpack`)
  webpack(config, { dev }) {
    if (dev && addSourceTags) {
      config.resolve = config.resolve || {}
      config.resolve.alias = config.resolve.alias || {}
      config.resolve.alias['react/jsx-dev-runtime'] = path.resolve(
        __dirname,
        'src/lib/source-tags/jsx-dev-runtime.ts',
      )
      config.resolve.alias['__original_jsx_dev_runtime'] = require.resolve(
        'react/jsx-dev-runtime',
      )
    }
    return config
  },
}

export default nextConfig
```

### Turbopack Caveat

If Turbopack's `resolveAlias` doesn't handle the circular alias cleanly (or your Next.js version doesn't support it yet), fall back to Webpack for dev:

```json
{
  "scripts": {
    "dev": "next dev --webpack"
  }
}
```

Slightly slower HMR, but zero risk. Try Turbopack first.

### What It Doesn't Touch

- No Babel config needed
- No new npm dependencies
- No changes to production builds (`jsx-runtime` is used in prod, not `jsx-dev-runtime`)
- No `data-source` attributes in production HTML
- No impact on CI/CD or deployment

### Effort

Medium. One wrapper file, one config change. Verify with DevTools that `data-source` attributes appear on elements during `next dev`.

---

## Layer 3b: ElPicker Editor Settings (Extension Side)

Once `data-source` attributes are present in the DOM, configure the extension to open files:

1. Open the ElPicker popup
2. Expand **Editor Settings** (future feature — see [source-to-editor plan](./source-to-editor_links_f3788677.plan.md))
3. Choose **Cursor** or **VS Code**
4. Optionally set the **Project root** if `data-source` paths are relative

The extension constructs URIs like `cursor://file/absolute/path:42` or `vscode://file/absolute/path:42` and opens them via the browser.

---

## Non-Next.js React Projects

The same three layers apply. The only difference is how you wire up the JSX alias in Layer 3.

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: mode === 'development'
      ? {
          'react/jsx-dev-runtime': path.resolve(
            __dirname,
            'src/lib/source-tags/jsx-dev-runtime.ts',
          ),
          __original_jsx_dev_runtime: 'react/jsx-dev-runtime',
        }
      : {},
  },
}))
```

### Create React App (Webpack)

Eject or use `craco` / `react-app-rewired` to add the same `resolve.alias` entries shown in the Webpack section above.

### Remix

Similar to Next.js — Remix uses Vite under the hood in v2+, so follow the Vite approach.

---

## Quick Reference: What to Do When

| Scenario | Layers | Time |
|----------|--------|------|
| Just want better selectors from ElPicker | 1 + 2 | Minutes |
| Building a new project, want full support | 1 + 2 + 3 | ~30 min |
| Retrofitting an existing large codebase | 1 (gradual) + 2 | Ongoing |
| Want "Open in Editor" from the browser | 3 + 3b | ~30 min |

---

## Verifying It Works

### Layer 1 — Semantic markers
Activate ElPicker on your page. Pick an element with `xx--` or `oo--` classes. The generated CSS selector should use those classes instead of generic Tailwind utilities.

### Layer 2 — Selector config
Pick an element inside a Radix UI component (dialog, popover, etc.). The selector should *not* contain `#radix-:r1a:` or similar. If it does, check your Avoided ID Patterns.

### Layer 3 — Source attributes
Open DevTools, inspect any element. You should see `data-source="src/components/MyComponent.tsx:27"` (or similar). In ElPicker, the overlay should show the source path, and the Open button should launch your editor to that line.
