/**
 * ElPicker - Your friendly, versatile context pal.
 * 
 * Features:
 * - Click or rectangle drag to select elements
 * - Live highlight preview
 * - Navigate parent/child/sibling chains with arrow keys
 * - Copy context as XPath, full HTML, or outer HTML
 * - Semantic class suggestions (xx-- functional, oo-- semantic)
 */

(function() {
  'use strict';

  // State management
  const state = {
    isActive: false,
    isSelecting: false,
    isDragging: false,
    dragStart: null,
    selectedElement: null,
    hoveredElement: null,
    childIndex: 0,
    showCode: true,
    outputFormat: 'shortSelector' // 'shortSelector', 'shortXpath', 'selector', 'xpath', 'outerhtml', 'innerhtml'
  };

  // DOM references
  let rectEl = null;
  let overlayEl = null;

  // ===== Utility Functions =====

  function qs(parent, sel) { return parent.querySelector(sel); }
  function qsa(parent, sel) { return parent.querySelectorAll(sel); }
  function elClick(parent, sel, fn) { qs(parent, sel).addEventListener('click', fn); }
  function elOn(parent, sel, evt, fn) { qs(parent, sel).addEventListener(evt, fn); }

  function getXPath(element) {
    if (!element) return '';
    if (element.id && isIdAllowed(element.id)) return `//*[@id="${element.id}"]`;
    if (element === document.body) return '/html/body';

    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentPath = getXPath(element.parentNode);
        const tagName = element.tagName.toLowerCase();
        return `${parentPath}/${tagName}[${ix + 1}]`;
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    return '';
  }

  // Selector preference configuration (mutable, loaded from storage)
  let selectorConfig = {
    avoidIdPatterns: [/^radix-/],
    preferClassPatterns: [/^xx--/, /^oo--/],
    avoidClassPatterns: [/^elpicker-/]
  };

  // Load config from storage
  async function loadSelectorConfig() {
    try {
      const result = await chrome.storage.sync.get('selectorConfig');
      if (result.selectorConfig) {
        applySelectorConfig(result.selectorConfig);
      }
    } catch (e) {
      console.log('ElPicker: Could not load config', e);
    }
  }

  function applySelectorConfig(config) {
    selectorConfig = {
      avoidIdPatterns: (config.avoidedIdPatterns || []).map(p => new RegExp(p)),
      preferClassPatterns: (config.preferredPatterns || []).map(p => new RegExp(p)),
      avoidClassPatterns: [/^elpicker-/, ...(config.avoidedPatterns || []).map(p => new RegExp(p))]
    };
  }

  // Editor configuration (loaded from storage)
  let editorConfig = { editor: 'cursor', projectRoot: '' };

  async function loadEditorConfig() {
    try {
      const result = await chrome.storage.sync.get('editorConfig');
      if (result.editorConfig) {
        editorConfig = { ...editorConfig, ...result.editorConfig };
      }
    } catch (e) {
      console.log('ElPicker: Could not load editor config', e);
    }
  }

  // Behavior configuration (loaded from storage)
  let behaviorConfig = { stayOpen: false };

  async function loadBehaviorConfig() {
    try {
      const result = await chrome.storage.sync.get('behaviorConfig');
      if (result.behaviorConfig) {
        behaviorConfig = { ...behaviorConfig, ...result.behaviorConfig };
      }
    } catch (e) {
      console.log('ElPicker: Could not load behavior config', e);
    }
  }

  function closeAfterAction() {
    if (!behaviorConfig.stayOpen) {
      deactivate();
    }
  }

  async function loadFormatPreference() {
    try {
      const result = await chrome.storage.sync.get('formatPreference');
      if (result.formatPreference && FORMAT_ORDER.includes(result.formatPreference)) {
        state.outputFormat = result.formatPreference;
      }
    } catch (e) {
      console.log('ElPicker: Could not load format preference', e);
    }
  }

  function saveFormatPreference(format) {
    try { chrome.storage.sync.set({ formatPreference: format }); }
    catch (e) { /* ignore */ }
  }

  // Load config on script initialization
  loadSelectorConfig();
  loadEditorConfig();
  loadBehaviorConfig();
  loadFormatPreference();

  function isIdAllowed(id) {
    if (!id) return false;
    return !selectorConfig.avoidIdPatterns.some(pattern => pattern.test(id));
  }

  function sortClassesByPreference(classes) {
    const preferred = [];
    const normal = [];

    for (const cls of classes) {
      if (selectorConfig.avoidClassPatterns.some(p => p.test(cls))) {
        continue; // Skip avoided classes
      }
      if (selectorConfig.preferClassPatterns.some(p => p.test(cls))) {
        preferred.push(cls);
      } else {
        normal.push(cls);
      }
    }

    // Return preferred classes first, then normal classes
    return [...preferred, ...normal];
  }

  function getCssSelector(element) {
    if (!element) return '';

    // Use ID only if allowed
    if (element.id && isIdAllowed(element.id)) {
      return `#${element.id}`;
    }

    const parts = [];
    let el = element;

    while (el && el.nodeType === 1 && el !== document.body) {
      let selector = el.tagName.toLowerCase();

      // Check for allowed ID
      if (el.id && isIdAllowed(el.id)) {
        selector = `#${el.id}`;
        parts.unshift(selector);
        break;
      }

      // Process classes with preference sorting
      if (el.className && typeof el.className === 'string') {
        const rawClasses = el.className.trim().split(/\s+/).filter(Boolean);
        const sortedClasses = sortClassesByPreference(rawClasses);

        if (sortedClasses.length > 0) {
          // Use up to 2 classes, preferring xx--/oo-- prefixed ones
          selector += '.' + sortedClasses.slice(0, 2).join('.');
        }
      }

      const parent = el.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(selector);
      el = el.parentNode;
    }

    return parts.join(' > ');
  }

  // ===== Short Selector Helpers =====

  function classScore(cls) {
    if (selectorConfig.avoidClassPatterns.some(p => p.test(cls))) return -1;
    if (selectorConfig.preferClassPatterns.some(p => p.test(cls))) return 100;
    if (/^[A-Z]/.test(cls)) return 40;
    if (/__/.test(cls)) return 30;
    if (/^[a-z]+--.+/.test(cls)) return 25;
    if (/^(js-|qa-|test-|e2e-|hook-)/.test(cls)) return 20;
    return 0;
  }

  function getMeaningfulClasses(el) {
    if (!el.className || typeof el.className !== 'string') return [];
    const raw = el.className.trim().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const cls of raw) {
      const s = classScore(cls);
      if (s > 0) scored.push({ cls, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.cls);
  }

  function isSelectorUnique(selector, expected) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === expected;
    } catch { return false; }
  }

  function isXPathUnique(xpath, expected) {
    try {
      const result = document.evaluate(
        xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );
      return result.snapshotLength === 1 && result.snapshotItem(0) === expected;
    } catch { return false; }
  }

  function getShortCssSelector(element) {
    if (!element || element === document.body || element === document.documentElement) return '';

    if (element.id && isIdAllowed(element.id)) {
      return '#' + CSS.escape(element.id);
    }

    const tag = element.tagName.toLowerCase();

    for (const attr of ['data-testid', 'data-cy']) {
      const val = element.getAttribute(attr);
      if (val) {
        const sel = tag + '[' + attr + '="' + CSS.escape(val) + '"]';
        if (isSelectorUnique(sel, element)) return sel;
      }
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length < 50) {
      const sel = tag + '[aria-label="' + CSS.escape(ariaLabel) + '"]';
      if (isSelectorUnique(sel, element)) return sel;
    }

    const selfClasses = getMeaningfulClasses(element);

    for (const cls of selfClasses.slice(0, 3)) {
      const dotCls = '.' + CSS.escape(cls);
      if (isSelectorUnique(dotCls, element)) return dotCls;
      if (isSelectorUnique(tag + dotCls, element)) return tag + dotCls;
    }

    if (selfClasses.length >= 2) {
      const sel = tag + '.' + CSS.escape(selfClasses[0]) + '.' + CSS.escape(selfClasses[1]);
      if (isSelectorUnique(sel, element)) return sel;
    }

    const selfBest = selfClasses.length > 0
      ? tag + '.' + CSS.escape(selfClasses[0])
      : tag;

    let ancestor = element.parentElement;
    let depth = 0;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement && depth < 8) {
      if (ancestor.id && isIdAllowed(ancestor.id)) {
        const anchor = '#' + CSS.escape(ancestor.id);
        if (isSelectorUnique(anchor + ' ' + selfBest, element)) return anchor + ' ' + selfBest;
      }
      const ancestorClasses = getMeaningfulClasses(ancestor);
      const aTag = ancestor.tagName.toLowerCase();
      for (const cls of ancestorClasses.slice(0, 2)) {
        const anchor = aTag + '.' + CSS.escape(cls);
        if (isSelectorUnique(anchor + ' ' + selfBest, element)) return anchor + ' ' + selfBest;
      }
      ancestor = ancestor.parentElement;
      depth++;
    }

    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(element) + 1;
        const nthSelf = selfBest + ':nth-of-type(' + idx + ')';
        const parentClasses = getMeaningfulClasses(parent);
        if (parentClasses.length > 0) {
          const sel = parent.tagName.toLowerCase() + '.' + CSS.escape(parentClasses[0]) + ' > ' + nthSelf;
          if (isSelectorUnique(sel, element)) return sel;
        }
        let anc = parent.parentElement;
        let d = 0;
        while (anc && anc !== document.body && d < 5) {
          if (anc.id && isIdAllowed(anc.id)) {
            const sel = '#' + CSS.escape(anc.id) + ' ' + nthSelf;
            if (isSelectorUnique(sel, element)) return sel;
          }
          const ancClasses = getMeaningfulClasses(anc);
          if (ancClasses.length > 0) {
            const sel = anc.tagName.toLowerCase() + '.' + CSS.escape(ancClasses[0]) + ' ' + nthSelf;
            if (isSelectorUnique(sel, element)) return sel;
          }
          anc = anc.parentElement;
          d++;
        }
      }
    }

    return getCssSelector(element);
  }

  function getShortXPath(element) {
    if (!element || element === document.body) return '';

    if (element.id && isIdAllowed(element.id)) {
      return '//*[@id="' + element.id + '"]';
    }

    const tag = element.tagName.toLowerCase();

    for (const attr of ['data-testid', 'data-cy']) {
      const val = element.getAttribute(attr);
      if (val) {
        const xp = '//' + tag + '[@' + attr + '="' + val + '"]';
        if (isXPathUnique(xp, element)) return xp;
      }
    }

    const selfClasses = getMeaningfulClasses(element);
    for (const cls of selfClasses.slice(0, 3)) {
      const xp = '//' + tag + '[contains(@class, "' + cls + '")]';
      if (isXPathUnique(xp, element)) return xp;
    }

    if (['button', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const text = (element.textContent || '').trim();
      if (text && text.length < 40 && !text.includes('\n') && !text.includes('"')) {
        const xp = '//' + tag + '[normalize-space()="' + text + '"]';
        if (isXPathUnique(xp, element)) return xp;
      }
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && !ariaLabel.includes('"')) {
      const xp = '//' + tag + '[@aria-label="' + ariaLabel + '"]';
      if (isXPathUnique(xp, element)) return xp;
    }

    if (selfClasses.length >= 2) {
      const xp = '//' + tag + '[contains(@class, "' + selfClasses[0] + '") and contains(@class, "' + selfClasses[1] + '")]';
      if (isXPathUnique(xp, element)) return xp;
    }

    const selfXp = selfClasses.length > 0
      ? tag + '[contains(@class, "' + selfClasses[0] + '")]'
      : tag;

    let ancestor = element.parentElement;
    let depth = 0;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement && depth < 8) {
      if (ancestor.id && isIdAllowed(ancestor.id)) {
        const xp = '//*[@id="' + ancestor.id + '"]//' + selfXp;
        if (isXPathUnique(xp, element)) return xp;
      }
      const ancestorClasses = getMeaningfulClasses(ancestor);
      const aTag = ancestor.tagName.toLowerCase();
      for (const cls of ancestorClasses.slice(0, 2)) {
        const xp = '//' + aTag + '[contains(@class, "' + cls + '")]//' + selfXp;
        if (isXPathUnique(xp, element)) return xp;
      }
      ancestor = ancestor.parentElement;
      depth++;
    }

    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(element) + 1;
        const nthSelf = selfXp + '[' + idx + ']';
        const parentClasses = getMeaningfulClasses(parent);
        if (parentClasses.length > 0) {
          const xp = '//' + parent.tagName.toLowerCase() + '[contains(@class, "' + parentClasses[0] + '")]/' + nthSelf;
          if (isXPathUnique(xp, element)) return xp;
        }
        let anc = parent.parentElement;
        let d = 0;
        while (anc && anc !== document.body && d < 5) {
          if (anc.id && isIdAllowed(anc.id)) {
            const xp = '//*[@id="' + anc.id + '"]//' + nthSelf;
            if (isXPathUnique(xp, element)) return xp;
          }
          const ancClasses = getMeaningfulClasses(anc);
          if (ancClasses.length > 0) {
            const xp = '//' + anc.tagName.toLowerCase() + '[contains(@class, "' + ancClasses[0] + '")]//' + nthSelf;
            if (isXPathUnique(xp, element)) return xp;
          }
          anc = anc.parentElement;
          d++;
        }
      }
    }

    return getXPath(element);
  }

  function getBreadcrumb(element) {
    const parts = [];
    let el = element;
    let depth = 0;
    const maxDepth = 5;

    while (el && el.nodeType === 1 && depth < maxDepth) {
      let part = el.tagName.toLowerCase();

      // Use ID only if allowed
      if (el.id && isIdAllowed(el.id)) {
        part += `#${el.id}`;
      } else if (el.className && typeof el.className === 'string') {
        const rawClasses = el.className.trim().split(/\s+/).filter(Boolean);
        const sortedClasses = sortClassesByPreference(rawClasses);
        if (sortedClasses.length > 0) {
          part += `.${sortedClasses[0]}`;
        }
      }
      parts.unshift(part);
      el = el.parentElement;
      depth++;
    }

    if (el && el.parentElement) {
      parts.unshift('...');
    }

    return parts.join(' > ');
  }

  function getElementContext(element) {
    switch (state.outputFormat) {
      case 'shortSelector':
        return getShortCssSelector(element);
      case 'shortXpath':
        return getShortXPath(element);
      case 'selector':
        return getCssSelector(element);
      case 'xpath':
        return getXPath(element);
      case 'outerhtml':
        return element.outerHTML;
      case 'innerhtml':
        return element.innerHTML;
      default:
        return getShortCssSelector(element);
    }
  }

  function suggestSemanticClasses(element) {
    const suggestions = { xx: [], oo: [] };
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || '').toLowerCase().trim().slice(0, 50);
    const role = element.getAttribute('role');
    const type = element.getAttribute('type');
    
    // Functional classes (xx--)
    const functionalMap = {
      'button': 'button',
      'input': type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'input',
      'select': 'select',
      'textarea': 'textarea',
      'a': 'link',
      'nav': 'nav',
      'header': 'header',
      'footer': 'footer',
      'aside': 'sidebar',
      'main': 'main',
      'section': 'section',
      'article': 'card',
      'form': 'form',
      'ul': 'list',
      'ol': 'list',
      'li': 'item',
      'table': 'table',
      'img': 'image',
      'video': 'video',
      'dialog': 'modal'
    };
    
    if (functionalMap[tag]) {
      suggestions.xx.push(functionalMap[tag]);
    }
    if (role) {
      suggestions.xx.push(role);
    }
    
    // Container detection
    const children = element.children.length;
    if (children > 3 && (tag === 'div' || tag === 'section')) {
      suggestions.xx.push('container');
    }
    if (qs(element, 'img') && qs(element, 'h1, h2, h3, h4, h5, h6, p')) {
      suggestions.xx.push('card');
    }
    
    // Semantic classes (oo--) based on content/purpose
    const semanticPatterns = [
      { patterns: ['search', 'find', 'lookup'], name: 'search' },
      { patterns: ['submit', 'send', 'post'], name: 'submit' },
      { patterns: ['delete', 'remove', 'trash'], name: 'delete' },
      { patterns: ['edit', 'modify', 'update'], name: 'edit' },
      { patterns: ['save', 'store'], name: 'save' },
      { patterns: ['cancel', 'close', 'dismiss'], name: 'cancel' },
      { patterns: ['upload', 'attach', 'file'], name: 'upload' },
      { patterns: ['download', 'export'], name: 'download' },
      { patterns: ['login', 'sign in', 'signin'], name: 'login' },
      { patterns: ['logout', 'sign out', 'signout'], name: 'logout' },
      { patterns: ['register', 'sign up', 'signup'], name: 'register' },
      { patterns: ['profile', 'account', 'user'], name: 'profile' },
      { patterns: ['settings', 'preferences', 'config'], name: 'settings' },
      { patterns: ['help', 'support', 'faq'], name: 'help' },
      { patterns: ['cart', 'basket', 'bag'], name: 'cart' },
      { patterns: ['checkout', 'pay', 'purchase'], name: 'checkout' },
      { patterns: ['filter', 'sort', 'refine'], name: 'filter' },
      { patterns: ['share', 'social'], name: 'share' },
      { patterns: ['comment', 'reply', 'feedback'], name: 'comment' },
      { patterns: ['like', 'favorite', 'heart'], name: 'like' },
      { patterns: ['notification', 'alert', 'bell'], name: 'notification' },
      { patterns: ['menu', 'hamburger', 'navigation'], name: 'menu' },
      { patterns: ['back', 'previous', 'return'], name: 'back' },
      { patterns: ['next', 'forward', 'continue'], name: 'next' },
      { patterns: ['add', 'create', 'new', 'plus'], name: 'add' }
    ];
    
    for (const { patterns, name } of semanticPatterns) {
      if (patterns.some(p => text.includes(p))) {
        suggestions.oo.push(name);
      }
    }
    
    // Dedupe
    suggestions.xx = [...new Set(suggestions.xx)].slice(0, 3);
    suggestions.oo = [...new Set(suggestions.oo)].slice(0, 3);
    
    return suggestions;
  }

  // ===== Source-to-Editor =====

  const FORMAT_ORDER = ['shortSelector', 'shortXpath', 'selector', 'xpath', 'outerhtml', 'innerhtml'];

  const FORMAT_LABELS = {
    shortSelector: 'Short CSS',
    shortXpath: 'Short XPath',
    selector: 'Full CSS',
    xpath: 'Full XPath',
    outerhtml: 'Outer HTML',
    innerhtml: 'Inner HTML'
  };

  function findDataSource(element) {
    const match = element.closest('[data-source]');
    return match ? match.dataset.source : null;
  }

  function parseDataSource(raw) {
    if (!raw) return null;
    const lastColon = raw.lastIndexOf(':');
    if (lastColon <= 0) return null;
    return { file: raw.substring(0, lastColon), line: raw.substring(lastColon + 1) };
  }

  function formatSourceDisplay(raw) {
    const parsed = parseDataSource(raw);
    if (!parsed) return raw;
    const short = parsed.file.replace(/^.*?\/src\//, 'src/');
    return `${short}:${parsed.line}`;
  }

  function openInEditor() {
    if (!state.selectedElement) return;
    const raw = findDataSource(state.selectedElement);
    if (!raw) {
      showToast('No data-source found on this element or ancestors');
      return;
    }
    const parsed = parseDataSource(raw);
    if (!parsed) return;

    let filePath = parsed.file;
    if (!filePath.startsWith('/') && editorConfig.projectRoot) {
      filePath = editorConfig.projectRoot.replace(/\/$/, '') + '/' + filePath;
    }

    let url;
    if (editorConfig.editor === 'custom' && editorConfig.customTemplate) {
      url = editorConfig.customTemplate
        .replace(/\{file\}/g, filePath)
        .replace(/\{line\}/g, parsed.line);
    } else {
      const protocol = editorConfig.editor === 'vscode' ? 'vscode' : 'cursor';
      url = `${protocol}://file/${filePath}:${parsed.line}`;
    }

    window.location.href = url;
    const label = editorConfig.editor === 'custom' ? 'editor'
      : editorConfig.editor === 'vscode' ? 'VS Code' : 'Cursor';
    showToast(`Opening in ${label}...`);
    closeAfterAction();
  }

  function cycleFormat(direction) {
    const idx = FORMAT_ORDER.indexOf(state.outputFormat);
    const next = (idx + direction + FORMAT_ORDER.length) % FORMAT_ORDER.length;
    state.outputFormat = FORMAT_ORDER[next];
    saveFormatPreference(state.outputFormat);
    if (overlayEl) {
      const select = qs(overlayEl, '#elpicker-format');
      if (select) select.value = state.outputFormat;
      updateCodePreview();
    }
    showToast(`Format: ${FORMAT_LABELS[state.outputFormat] || state.outputFormat}`);
  }

  function getOptimalOverlayPosition(element) {
    const rect = element.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const overlayW = 400;
    const overlayH = 350;
    const padding = 20;
    
    // Determine which quadrant has most space away from element
    const spaceRight = viewportW - rect.right;
    const spaceLeft = rect.left;
    const spaceBottom = viewportH - rect.bottom;
    const spaceTop = rect.top;
    
    let left, top;
    
    // Prefer opposite side from element
    if (spaceRight >= overlayW + padding) {
      left = rect.right + padding;
    } else if (spaceLeft >= overlayW + padding) {
      left = rect.left - overlayW - padding;
    } else {
      left = Math.max(padding, Math.min(viewportW - overlayW - padding, (viewportW - overlayW) / 2));
    }
    
    if (spaceBottom >= overlayH + padding) {
      top = rect.bottom + padding;
    } else if (spaceTop >= overlayH + padding) {
      top = rect.top - overlayH - padding;
    } else {
      top = Math.max(padding, Math.min(viewportH - overlayH - padding, (viewportH - overlayH) / 2));
    }
    
    return { left, top };
  }

  // ===== UI Creation =====

  function createRectElement() {
    if (rectEl) return rectEl;
    rectEl = document.createElement('div');
    rectEl.className = 'elpicker-rect';
    document.body.appendChild(rectEl);
    return rectEl;
  }

  function updateRect(x1, y1, x2, y2) {
    if (!rectEl) createRectElement();
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    
    rectEl.style.left = `${left}px`;
    rectEl.style.top = `${top}px`;
    rectEl.style.width = `${width}px`;
    rectEl.style.height = `${height}px`;
    rectEl.style.display = 'block';
  }

  function hideRect() {
    if (rectEl) {
      rectEl.style.display = 'none';
    }
  }

  function getNavInfo(element) {
    const elFilter = el => !el.classList.contains('elpicker-overlay') && !el.classList.contains('elpicker-rect');
    const parent = element.parentElement;
    const hasParent = parent && parent !== document.body && parent !== document.documentElement;
    const childCount = Array.from(element.children).filter(elFilter).length;
    let prevCount = 0, nextCount = 0;
    if (parent) {
      const siblings = Array.from(parent.children).filter(elFilter);
      const idx = siblings.indexOf(element);
      prevCount = Math.max(0, idx);
      nextCount = Math.max(0, siblings.length - 1 - idx);
    }
    return { hasParent, childCount, prevCount, nextCount };
  }

  function buildNavCompass(nav, scale) {
    const s = scale;
    const dot = (count, cls) => {
      const max = 5;
      const n = Math.min(count, max);
      let dots = '';
      for (let i = 0; i < n; i++) dots += `<span class="elpicker-nav-dot"></span>`;
      if (count > max) dots += `<span class="elpicker-nav-dot elpicker-nav-dot-plus"></span>`;
      return `<span class="elpicker-nav-dots ${cls}">${dots}</span>`;
    };
    const upCls = nav.hasParent ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const downCls = nav.childCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const leftCls = nav.prevCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const rightCls = nav.nextCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    return `<div class="elpicker-nav-compass" style="transform:scale(${s})">` +
      `<div class="elpicker-nav-row">`+
        `<span class="elpicker-nav-arrow ${upCls}" data-nav="up">^</span>`+
      `</div>`+
      `<div class="elpicker-nav-row">`+
        `<span class="elpicker-nav-arrow ${leftCls}" data-nav="left">&lt;</span>`+
        `<span class="elpicker-nav-arrow ${downCls}" data-nav="down">v</span>`+
        `<span class="elpicker-nav-arrow ${rightCls}" data-nav="right">&gt;</span>`+
      `</div>`+
      `<div class="elpicker-nav-row elpicker-nav-dots-row">`+
        `${dot(nav.prevCount, 'elpicker-nav-dots-left')}`+
        `${dot(nav.childCount, 'elpicker-nav-dots-center')}`+
        `${dot(nav.nextCount, 'elpicker-nav-dots-right')}`+
      `</div>`+
    `</div>`;
  }

  function createOverlay(element) {
    removeOverlay();

    const suggestions = suggestSemanticClasses(element);
    const pos = getOptimalOverlayPosition(element);

    overlayEl = document.createElement('div');
    overlayEl.className = 'elpicker-overlay';
    overlayEl.style.left = `${pos.left}px`;
    overlayEl.style.top = `${pos.top}px`;

    const tagName = element.tagName.toLowerCase();
    const id = element.id && isIdAllowed(element.id) ? `#${element.id}` : '';
    const rawClasses = element.className && typeof element.className === 'string'
      ? element.className.split(/\s+/).filter(Boolean)
      : [];
    const classes = sortClassesByPreference(rawClasses).join(' ');

    const nav = getNavInfo(element);

    overlayEl.innerHTML = `
      <div class="elpicker-header">
        <div class="elpicker-title">
          <img class="elpicker-title-icon" src="${chrome.runtime.getURL('icons/icon128.png')}" alt="ElPicker" width="18" height="18">
          ElPicker
        </div>
        ${buildNavCompass(nav, 1)}
        <button class="elpicker-close" title="Close (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      
      <div class="elpicker-breadcrumb">${getBreadcrumb(element)}</div>
      
      <div class="elpicker-nav-hint">
        <kbd>Up</kbd>/<kbd>Down</kbd> parent/child
        <kbd>Left</kbd>/<kbd>Right</kbd> siblings
        <kbd>Esc</kbd> back
      </div>
      
      <div class="elpicker-preview">
        <div class="elpicker-preview-element">
          <div class="elpicker-preview-label">Element</div>
          <div class="elpicker-preview-tag">&lt;${tagName}&gt;</div>
          ${id ? `<div class="elpicker-preview-id">id: ${id}</div>` : ''}
          ${classes ? `<div class="elpicker-preview-classes">class: ${classes}</div>` : ''}
        </div>
      </div>
      
      ${(suggestions.xx.length > 0 || suggestions.oo.length > 0) ? `
        <div class="elpicker-suggest-panel">
          <div class="elpicker-suggest-title">Suggested Classes</div>
          <div class="elpicker-suggest-chips">
            ${suggestions.xx.map(s => `<span class="elpicker-suggest-chip elpicker-suggest-chip-xx">xx--${s}</span>`).join('')}
            ${suggestions.oo.map(s => `<span class="elpicker-suggest-chip elpicker-suggest-chip-oo">oo--${s}</span>`).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="elpicker-code-section">
        <label class="elpicker-code-toggle">
          <input type="checkbox" id="elpicker-show-code" ${state.showCode ? 'checked' : ''}>
          Show Code
        </label>
        <div class="elpicker-code" style="display: ${state.showCode ? 'block' : 'none'}">
          ${escapeHtml(getElementContext(element))}
        </div>
      </div>
      
      ${(() => {
        const src = findDataSource(element);
        return src ? `
          <div class="elpicker-source-panel">
            <div class="elpicker-source-label">Source</div>
            <div class="elpicker-source-file">${escapeHtml(formatSourceDisplay(src))}</div>
          </div>
        ` : '';
      })()}

      <div class="elpicker-actions">
        <select class="elpicker-format-select" id="elpicker-format">
          ${FORMAT_ORDER.map(f =>
            `<option value="${f}" ${state.outputFormat === f ? 'selected' : ''}>${FORMAT_LABELS[f]}</option>`
          ).join('')}
        </select>
        <button class="elpicker-btn elpicker-btn-primary" id="elpicker-copy">Copy</button>
        <button class="elpicker-btn elpicker-btn-open ${findDataSource(element) ? '' : 'elpicker-btn-disabled'}" id="elpicker-open" title="Open in editor (Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Open
        </button>
        <button class="elpicker-btn elpicker-btn-ghost" id="elpicker-reselect">Reselect</button>
      </div>
    `;
    
    document.body.appendChild(overlayEl);
    
    // Event handlers
    elClick(overlayEl, '.elpicker-close', deactivate);
    elClick(overlayEl, '#elpicker-copy', copyContext);
    elClick(overlayEl, '#elpicker-open', openInEditor);
    elClick(overlayEl, '#elpicker-reselect', startReselect);
    elOn(overlayEl, '#elpicker-format', 'change', (e) => {
      state.outputFormat = e.target.value;
      saveFormatPreference(state.outputFormat);
      updateCodePreview();
    });
    elOn(overlayEl, '#elpicker-show-code', 'change', (e) => {
      state.showCode = e.target.checked;
      const codeEl = qs(overlayEl, '.elpicker-code');
      codeEl.style.display = state.showCode ? 'block' : 'none';
    });

    qsa(overlayEl, '.elpicker-nav-arrow[data-nav]').forEach(arrow => {
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        const dir = arrow.dataset.nav;
        if (dir === 'up') navigateParent();
        else if (dir === 'down') navigateChild();
        else if (dir === 'left') navigateSiblingPrev();
        else if (dir === 'right') navigateSiblingNext();
      });
    });

    qsa(overlayEl, '.elpicker-suggest-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        navigator.clipboard.writeText(chip.textContent);
        showToast(`Copied: ${chip.textContent}`);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function updateCodePreview() {
    if (!overlayEl || !state.selectedElement) return;
    const codeEl = qs(overlayEl, '.elpicker-code');
    if (codeEl) {
      codeEl.textContent = getElementContext(state.selectedElement);
    }
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'elpicker-copied-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // ===== Selection Logic =====

  function highlightElement(element) {
    clearHighlight();
    if (element && element !== document.body && element !== document.documentElement) {
      element.classList.add('elpicker-highlight');
      state.hoveredElement = element;
    }
  }

  function clearHighlight() {
    if (state.hoveredElement) {
      state.hoveredElement.classList.remove('elpicker-highlight');
      state.hoveredElement = null;
    }
  }

  function selectElement(element) {
    clearSelection();
    clearHighlight();
    
    if (element && element !== document.body && element !== document.documentElement) {
      element.classList.add('elpicker-selected');
      state.selectedElement = element;
      state.childIndex = 0;
      createOverlay(element);
    }
  }

  function clearSelection() {
    if (state.selectedElement) {
      state.selectedElement.classList.remove('elpicker-selected');
    }
  }

  function getElementsInRect(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    
    const elements = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
    
    // Filter to elements that are mostly within the rect
    return elements.filter(el => {
      if (el.classList.contains('elpicker-rect') || 
          el.classList.contains('elpicker-overlay') ||
          el === document.body ||
          el === document.documentElement) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.left >= left - 5 && rect.right <= right + 5 &&
             rect.top >= top - 5 && rect.bottom <= bottom + 5;
    });
  }

  function findBestMatchInRect(x1, y1, x2, y2) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const elements = document.elementsFromPoint(centerX, centerY);
    
    // Find the smallest element that fits well within the selection
    let best = null;
    let bestArea = Infinity;
    
    for (const el of elements) {
      if (el.classList.contains('elpicker-rect') || 
          el.classList.contains('elpicker-overlay') ||
          el === document.body ||
          el === document.documentElement) {
        continue;
      }
      
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      
      if (area < bestArea && area > 0) {
        best = el;
        bestArea = area;
      }
    }
    
    return best;
  }

  // ===== Navigation =====

  function navigateParent() {
    if (!state.selectedElement) return;
    const parent = state.selectedElement.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      selectElement(parent);
    }
  }

  function navigateChild() {
    if (!state.selectedElement) return;
    const children = Array.from(state.selectedElement.children).filter(
      el => !el.classList.contains('elpicker-overlay') && !el.classList.contains('elpicker-rect')
    );
    if (children.length > 0) {
      state.childIndex = 0;
      selectElement(children[0]);
    }
  }

  function navigateSiblingPrev() {
    if (!state.selectedElement) return;
    const parent = state.selectedElement.parentElement;
    if (!parent) return;
    
    const siblings = Array.from(parent.children).filter(
      el => !el.classList.contains('elpicker-overlay') && !el.classList.contains('elpicker-rect')
    );
    const currentIndex = siblings.indexOf(state.selectedElement);
    if (currentIndex > 0) {
      selectElement(siblings[currentIndex - 1]);
    }
  }

  function navigateSiblingNext() {
    if (!state.selectedElement) return;
    const parent = state.selectedElement.parentElement;
    if (!parent) return;
    
    const siblings = Array.from(parent.children).filter(
      el => !el.classList.contains('elpicker-overlay') && !el.classList.contains('elpicker-rect')
    );
    const currentIndex = siblings.indexOf(state.selectedElement);
    if (currentIndex < siblings.length - 1) {
      selectElement(siblings[currentIndex + 1]);
    }
  }

  // ===== Actions =====

  function copyContext() {
    if (!state.selectedElement) return;
    const context = getElementContext(state.selectedElement);
    navigator.clipboard.writeText(context).then(() => {
      showToast('Copied to clipboard!');
      closeAfterAction();
    });
  }

  function startReselect() {
    clearSelection();
    removeOverlay();
    state.selectedElement = null;
    state.isSelecting = true;
  }

  // ===== Event Handlers =====

  function onMouseMove(e) {
    if (!state.isActive) return;
    
    if (state.isDragging && state.dragStart) {
      updateRect(state.dragStart.x, state.dragStart.y, e.clientX, e.clientY);
      
      // Highlight potential selection
      const best = findBestMatchInRect(
        state.dragStart.x, state.dragStart.y,
        e.clientX, e.clientY
      );
      highlightElement(best);
    } else if (state.isSelecting) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && !el.closest('.elpicker-overlay') && !el.classList.contains('elpicker-rect')) {
        highlightElement(el);
      }
    }
  }

  function onMouseDown(e) {
    if (!state.isActive || !state.isSelecting) return;
    if (e.target.closest('.elpicker-overlay')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    state.isDragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY };
    createRectElement();
  }

  function onMouseUp(e) {
    if (!state.isActive) return;
    if (e.target.closest('.elpicker-overlay')) return;
    
    if (state.isDragging && state.dragStart) {
      e.preventDefault();
      e.stopPropagation();
      
      const dist = Math.sqrt(
        Math.pow(e.clientX - state.dragStart.x, 2) +
        Math.pow(e.clientY - state.dragStart.y, 2)
      );
      
      if (dist < 5) {
        // Click - select element under cursor
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !el.classList.contains('elpicker-rect')) {
          selectElement(el);
          state.isSelecting = false;
        }
      } else {
        // Drag - select best match in rectangle
        const best = findBestMatchInRect(
          state.dragStart.x, state.dragStart.y,
          e.clientX, e.clientY
        );
        if (best) {
          selectElement(best);
          state.isSelecting = false;
        }
      }
      
      state.isDragging = false;
      state.dragStart = null;
      hideRect();
      clearHighlight();
    }
  }

  function onKeyDown(e) {
    if (!state.isActive) return;
    
    // Don't capture if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (state.isDragging) {
          // Cancel current drag
          state.isDragging = false;
          state.dragStart = null;
          hideRect();
          clearHighlight();
        } else if (state.selectedElement && !state.isSelecting) {
          // Go back to selecting mode
          clearSelection();
          removeOverlay();
          state.selectedElement = null;
          state.isSelecting = true;
        } else {
          // Exit picker entirely
          deactivate();
        }
        break;
        
      case 'ArrowUp':
        if (state.selectedElement) {
          e.preventDefault();
          navigateParent();
        }
        break;
        
      case 'ArrowDown':
        if (state.selectedElement) {
          e.preventDefault();
          navigateChild();
        }
        break;
        
      case 'ArrowLeft':
        if (state.selectedElement) {
          e.preventDefault();
          navigateSiblingPrev();
        }
        break;
        
      case 'ArrowRight':
        if (state.selectedElement) {
          e.preventDefault();
          navigateSiblingNext();
        }
        break;
        
      case 'Enter':
        if (state.selectedElement) {
          e.preventDefault();
          e.stopPropagation();
          openInEditor();
        }
        break;

      case ',':
        if (state.selectedElement) {
          e.preventDefault();
          e.stopPropagation();
          cycleFormat(-1);
        }
        break;

      case '.':
        if (state.selectedElement) {
          e.preventDefault();
          e.stopPropagation();
          cycleFormat(1);
        }
        break;

      case 'c':
        if ((e.metaKey || e.ctrlKey) && state.selectedElement) {
          e.preventDefault();
          e.stopPropagation();
          copyContext();
        }
        break;
    }
  }

  // ===== Activation / Deactivation =====

  function activate() {
    if (state.isActive) return;
    
    state.isActive = true;
    state.isSelecting = true;
    document.body.classList.add('elpicker-active');
    
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    
    showToast('ElPicker activated! Click or drag to select.');
    showTopBanner('ElPicker activated! Click or drag to select.');
  }

  function showTopBanner(message) {
    const banner = document.createElement('div');
    banner.className = 'elpicker-top-banner';
    banner.textContent = message;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2000);
  }

  function deactivate() {
    state.isActive = false;
    state.isSelecting = false;
    state.isDragging = false;
    state.dragStart = null;
    
    document.body.classList.remove('elpicker-active');
    clearHighlight();
    clearSelection();
    hideRect();
    removeOverlay();
    
    if (rectEl) {
      rectEl.remove();
      rectEl = null;
    }
    
    state.selectedElement = null;
    
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // ===== Message Handling =====

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'activate') {
      if (state.isActive) {
        deactivate();
      } else {
        activate();
      }
      sendResponse({ active: state.isActive });
    } else if (request.action === 'getState') {
      sendResponse({ active: state.isActive });
    } else if (request.action === 'configUpdated') {
      applySelectorConfig(request.config);
      if (state.selectedElement && overlayEl) {
        createOverlay(state.selectedElement);
      }
      sendResponse({ success: true });
    } else if (request.action === 'editorConfigUpdated') {
      editorConfig = { ...editorConfig, ...request.config };
      sendResponse({ success: true });
    } else if (request.action === 'behaviorConfigUpdated') {
      behaviorConfig = { ...behaviorConfig, ...request.config };
      sendResponse({ success: true });
    }
    return true;
  });

})();
