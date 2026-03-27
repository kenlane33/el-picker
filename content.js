/**
 * ElPicker - Your friendly, versatile context pal.
 * 
 * Features:
 * - Click to select elements with live highlight preview
 * - Navigate parent/child/sibling chains with arrow keys or WASD
 * - Copy context as CSS selector, XPath, or HTML
 * - Semantic class suggestions (xx-- functional, oo-- semantic)
 */

(function() {
  'use strict';

  // State management
  const state = {
    isActive: false,
    isSelecting: false,
    selectedElement: null,
    hoveredElement: null,
    childIndex: 0,
    activeTab: 'smart' // 'smart', 'shortSelector', 'shortXpath', 'selector', 'xpath', 'outerhtml', 'innerhtml'
  };

  // DOM references
  let overlayEl = null;

  // Panel drag state
  let panelDragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0
  };

  // Cache icon URL at load time (before extension context could be invalidated)
  let iconUrl = '';
  try { iconUrl = chrome.runtime.getURL('icons/icon128.png'); } catch (e) { /* ignore */ }

  // ===== Utility Functions =====

  function qs(parent, sel) { return parent.querySelector(sel); }
  function qsa(parent, sel) { return parent.querySelectorAll(sel); }
  function elClick(parent, sel, fn) { qs(parent, sel).addEventListener('click', fn); }
  function elOn(parent, sel, evt, fn) { qs(parent, sel).addEventListener(evt, fn); }

  const isMac = (() => {
    const ua = navigator.userAgent || '';
    const plat = navigator.platform || navigator.userAgentData?.platform || '';
    return /mac/i.test(plat) || /macintosh/i.test(ua);
  })();

  function kbd(label) {
    return `<span class="elpicker-kbd">${label}</span>`;
  }

  function makeEl(haml, content, parent) {
    const [tag, ...classes] = haml.split('.');
    const el = document.createElement(tag || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (typeof content === 'string') el.textContent = content;
    else if (content instanceof Element) el.appendChild(content);
    if (parent !== null) (parent || document.body).appendChild(el);
    return el;
  }

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
    preferClassPatterns: [/^C--/, /^oo--/, /^xx--/],
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

  // Shortcut configuration (loaded from storage)
  let shortcutConfig = {
    key: 'e',
    ctrl: !isMac,
    shift: true,
    alt: false,
    meta: isMac
  };

  async function loadShortcutConfig() {
    try {
      const result = await chrome.storage.sync.get('shortcutConfig');
      if (result.shortcutConfig) {
        shortcutConfig = { ...shortcutConfig, ...result.shortcutConfig };
      }
    } catch (e) {
      console.log('ElPicker: Could not load shortcut config', e);
    }
  }

  function matchesShortcut(e) {
    if (!shortcutConfig.key || !e.key) return false;
    return e.key.toLowerCase() === shortcutConfig.key.toLowerCase()
      && e.ctrlKey === !!shortcutConfig.ctrl
      && e.shiftKey === !!shortcutConfig.shift
      && e.altKey === !!shortcutConfig.alt
      && e.metaKey === !!shortcutConfig.meta;
  }

  function onGlobalKeyDown(e) {
    if (matchesShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (state.isActive) {
        deactivate();
      } else {
        activate();
      }
    }
  }

  document.addEventListener('keydown', onGlobalKeyDown, true);

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

  async function loadTabPreference() {
    try {
      const result = await chrome.storage.sync.get('tabPreference');
      if (result.tabPreference && TAB_ORDER.includes(result.tabPreference)) {
        state.activeTab = result.tabPreference;
      }
    } catch (e) {
      console.log('ElPicker: Could not load tab preference', e);
    }
  }

  function saveTabPreference(tab) {
    try { chrome.storage.sync.set({ tabPreference: tab }); }
    catch (e) { /* ignore */ }
  }

  // Load config on script initialization
  loadSelectorConfig();
  loadEditorConfig();
  loadBehaviorConfig();
  loadShortcutConfig();
  loadTabPreference();

  function isIdAllowed(id) {
    if (!id) return false;
    return !selectorConfig.avoidIdPatterns.some(pattern => pattern.test(id));
  }

  function sortClassesByPreference(classes) {
    const preferred = [];
    const normal = [];

    for (const cls of classes) {
      if (selectorConfig.avoidClassPatterns.some(p => p.test(cls))) continue;
      const idx = selectorConfig.preferClassPatterns.findIndex(p => p.test(cls));
      if (idx !== -1) {
        preferred.push({ cls, idx });
      } else {
        normal.push(cls);
      }
    }

    preferred.sort((a, b) => a.idx - b.idx);
    return [...preferred.map(p => p.cls), ...normal];
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
          // Use up to 2 classes, preferring oo--/xx-- prefixed ones
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
    const prefIdx = selectorConfig.preferClassPatterns.findIndex(p => p.test(cls));
    if (prefIdx !== -1) return 200 - prefIdx;
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
    const fmt = state.activeTab === 'smart' ? 'shortSelector' : state.activeTab;
    switch (fmt) {
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

  const TAB_ORDER = ['smart', 'shortSelector', 'shortXpath', 'selector', 'xpath', 'outerhtml', 'innerhtml'];
  const TAB_LABELS = {
    smart: 'Smart',
    shortSelector: 'S.CSS',
    shortXpath: 'S.XPath',
    selector: 'CSS',
    xpath: 'XPath',
    outerhtml: 'Outer',
    innerhtml: 'Inner'
  };

  // Prime-based hue rotation for rainbow class coloring
  function primeHue(i) {
    return (i * 137 + 30) % 360;
  }

  function hueColor(i) {
    return `hsl(${primeHue(i)},65%,62%)`;
  }

  function renderColoredClasses(classes) {
    return classes.map((cls, i) =>
      `<span style="color:${hueColor(i)}">${escapeHtml(cls)}</span>`
    ).join(' ');
  }

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

  function cycleTab(direction) {
    const idx = TAB_ORDER.indexOf(state.activeTab);
    const next = (idx + direction + TAB_ORDER.length) % TAB_ORDER.length;
    switchTab(TAB_ORDER[next]);
  }

  function switchTab(tab) {
    state.activeTab = tab;
    saveTabPreference(tab);
    if (overlayEl) {
      qsa(overlayEl, '.elpicker-tab').forEach(t => {
        t.classList.toggle('elpicker-tab-active', t.dataset.tab === tab);
      });
      updateTabContent();
    }
  }

  function updateTabContent() {
    if (!overlayEl || !state.selectedElement) return;
    const area = qs(overlayEl, '.elpicker-tree-area');
    if (!area) return;
    if (state.activeTab === 'smart') {
      area.innerHTML = buildSmartTreeHTML(state.selectedElement);
      area.scrollTop = area.scrollHeight;
      bindTreeEvents(area);
    } else {
      const text = getElementContext(state.selectedElement);
      area.innerHTML = `<div class="elpicker-code-view">${escapeHtml(text)}</div>`;
    }
  }

  function getOptimalOverlayPosition(element) {
    const rect = element.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const overlayW = 380;
    const overlayH = 260;
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

  function getNavInfo(element) {
    const elFilter = el => !el.classList.contains('elpicker-overlay');
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
    const tri = (dir, cls) => {
      const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
      return `<span class="elpicker-nav-arrow ${cls}" data-nav="${dir}">` +
        `<svg width="6" height="5" viewBox="0 0 6 5" style="transform:rotate(${rot}deg)">` +
        `<polygon points="3,0 6,5 0,5" fill="currentColor"/>` +
        `</svg></span>`;
    };
    const dots = (count, cls) => {
      const max = 5;
      const n = Math.min(count, max);
      let d = '';
      for (let i = 0; i < n; i++) d += '<span class="elpicker-nav-dot"></span>';
      if (count > max) d += '<span class="elpicker-nav-dot elpicker-nav-dot-plus"></span>';
      return `<span class="elpicker-nav-dots ${cls}">${d}</span>`;
    };
    const upCls = nav.hasParent ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const downCls = nav.childCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const leftCls = nav.prevCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    const rightCls = nav.nextCount > 0 ? 'elpicker-nav-active' : 'elpicker-nav-dim';
    return `<div class="elpicker-nav-compass" style="transform:scale(${scale})">` +
      `<div class="elpicker-nc-up">${tri('up', upCls)}</div>` +
      `<div class="elpicker-nc-left-dots">${dots(nav.prevCount, 'elpicker-nav-dots-left')}</div>` +
      `<div class="elpicker-nc-left">${tri('left', leftCls)}</div>` +
      `<div class="elpicker-nc-down">${tri('down', downCls)}</div>` +
      `<div class="elpicker-nc-right">${tri('right', rightCls)}</div>` +
      `<div class="elpicker-nc-right-dots">${dots(nav.nextCount, 'elpicker-nav-dots-right')}</div>` +
      `<div class="elpicker-nc-bottom-dots">${dots(nav.childCount, 'elpicker-nav-dots-center')}</div>` +
    `</div>`;
  }

  // ===== Smart Tree Functions =====

  let currentChain = [];
  let tooltipEl = null;

  function getAncestorChain(element, maxDepth) {
    maxDepth = maxDepth || 20;
    const chain = [];
    let el = element;
    while (el && el.nodeType === 1 && el !== document.documentElement && chain.length < maxDepth) {
      if (!el.classList.contains('elpicker-overlay') && !el.classList.contains('elpicker-copied-toast') && !el.classList.contains('elpicker-colored-toast')) {
        chain.unshift(el);
      }
      el = el.parentElement;
    }
    return chain;
  }

  function classifyClasses(el) {
    const raw = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const semantic = [];
    const rest = [];
    for (const cls of raw) {
      if (selectorConfig.avoidClassPatterns.some(p => p.test(cls))) continue;
      if (selectorConfig.preferClassPatterns.some(p => p.test(cls))) {
        semantic.push(cls);
      } else {
        rest.push(cls);
      }
    }
    return { semantic, rest, all: [...semantic, ...rest] };
  }

  function buildSmartTreeHTML(selectedElement) {
    currentChain = getAncestorChain(selectedElement);
    let html = '';
    for (let i = 0; i < currentChain.length; i++) {
      const el = currentChain[i];
      const tag = el.tagName.toLowerCase();
      const isSelected = el === selectedElement;
      const { semantic, rest, all } = classifyClasses(el);
      const id = el.id && isIdAllowed(el.id) ? el.id : '';
      const selectedCls = isSelected ? ' elpicker-tree-selected' : '';

      let row = `<div class="elpicker-tree-row${selectedCls}" data-chain-idx="${i}">`;
      row += `<span class="elpicker-tree-tag">${escapeHtml(tag)}</span>`;
      if (id) {
        row += `<span class="elpicker-tree-id">#${escapeHtml(id)}</span>`;
      }
      for (const cls of semantic) {
        row += `<span class="elpicker-tree-semantic" data-copy="${escapeHtml(cls)}">${escapeHtml(cls)}</span>`;
      }
      if (rest.length > 0) {
        const allClassStr = all.join(' ');
        row += `<span class="elpicker-tree-classes" data-copy-classes="${escapeHtml(allClassStr)}" data-tooltip-tag="${escapeHtml(tag)}" data-tooltip-semantic="${escapeHtml(semantic.join(' '))}" data-tooltip-rest="${escapeHtml(rest.join(' '))}">${renderColoredClasses(rest)}</span>`;
      }
      row += '</div>';
      html += row;
    }
    return html;
  }

  function buildHamlSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id && isIdAllowed(el.id) ? '#' + el.id : '';
    const { all } = classifyClasses(el);
    const dotClasses = all.length ? '.' + all.join('.') : '';
    return tag + id + dotClasses;
  }

  function bindTreeEvents(area) {
    area.addEventListener('click', onTreeClick);
    area.addEventListener('mouseover', onTreeMouseOver);
    area.addEventListener('mouseout', onTreeMouseOut);
  }

  function onTreeClick(e) {
    const semantic = e.target.closest('.elpicker-tree-semantic');
    if (semantic) {
      e.stopPropagation();
      const cls = semantic.dataset.copy;
      copyAndToast(cls);
      return;
    }
    const classes = e.target.closest('.elpicker-tree-classes');
    if (classes) {
      e.stopPropagation();
      const all = classes.dataset.copyClasses;
      copyAndColorToast(all);
      return;
    }
    const row = e.target.closest('.elpicker-tree-row');
    if (row) {
      const idx = parseInt(row.dataset.chainIdx);
      const el = currentChain[idx];
      if (el) {
        const sel = buildHamlSelector(el);
        copyAndToast(sel);
      }
    }
  }

  function onTreeMouseOver(e) {
    const classes = e.target.closest('.elpicker-tree-classes');
    if (!classes) return;
    const tag = classes.dataset.tooltipTag || '';
    const semStr = classes.dataset.tooltipSemantic || '';
    const restStr = classes.dataset.tooltipRest || '';
    const semParts = semStr ? semStr.split(' ') : [];
    const restParts = restStr ? restStr.split(' ') : [];

    let html = `<span class="elpicker-tooltip-tag">${escapeHtml(tag)}</span>`;
    for (const s of semParts) {
      html += ` <span class="elpicker-tooltip-semantic">${escapeHtml(s)}</span>`;
    }
    for (let i = 0; i < restParts.length; i++) {
      html += ` <span style="color:${hueColor(i)}">${escapeHtml(restParts[i])}</span>`;
    }

    showElTooltip(e, html);
  }

  function onTreeMouseOut(e) {
    const classes = e.target.closest('.elpicker-tree-classes');
    if (!classes) hideElTooltip();
  }

  function showElTooltip(e, html) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'elpicker-tooltip';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
    const rect = e.target.getBoundingClientRect();
    tooltipEl.style.left = Math.min(rect.left, window.innerWidth - 360) + 'px';
    tooltipEl.style.top = (rect.top - tooltipEl.offsetHeight - 6) + 'px';
    if (parseInt(tooltipEl.style.top) < 4) {
      tooltipEl.style.top = (rect.bottom + 6) + 'px';
    }
  }

  function hideElTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function copyAndToast(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied: ${text}`);
    });
  }

  function copyAndColorToast(classStr) {
    navigator.clipboard.writeText(classStr).then(() => {
      const parts = classStr.split(/\s+/).filter(Boolean);
      showColoredToast('Copied:', parts);
    });
  }

  function showColoredToast(prefix, parts) {
    const toast = document.createElement('div');
    toast.className = 'elpicker-colored-toast';
    let html = `<span class="elpicker-toast-prefix">${escapeHtml(prefix)}</span> `;
    html += parts.map((p, i) => `<span style="color:${hueColor(i)}">${escapeHtml(p)}</span>`).join(' ');
    toast.innerHTML = html;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  function createOverlay(element) {
    removeOverlay();

    const pos = getOptimalOverlayPosition(element);

    overlayEl = document.createElement('div');
    overlayEl.className = 'elpicker-overlay';
    overlayEl.style.left = `${pos.left}px`;
    overlayEl.style.top = `${pos.top}px`;

    const nav = getNavInfo(element);

    const tabsHTML = TAB_ORDER.map(t =>
      `<button class="elpicker-tab${state.activeTab === t ? ' elpicker-tab-active' : ''}" data-tab="${t}">${TAB_LABELS[t]}</button>`
    ).join('');

    const treeContent = state.activeTab === 'smart'
      ? buildSmartTreeHTML(element)
      : `<div class="elpicker-code-view">${escapeHtml(getElementContext(element))}</div>`;

    const src = findDataSource(element);

    overlayEl.innerHTML = `
      <div class="elpicker-header">
        <div class="elpicker-title">
          ${iconUrl ? `<img class="elpicker-title-icon" src="${iconUrl}" alt="" width="14" height="14">` : ''}
          ElPicker
        </div>
        ${buildNavCompass(nav, 1)}
        <button class="elpicker-close" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="elpicker-tabs">${tabsHTML}</div>

      <div class="elpicker-tree-area">${treeContent}</div>

      ${src ? `
        <div class="elpicker-source-panel">
          <span class="elpicker-source-label">Src</span>
          <span class="elpicker-source-file">${escapeHtml(formatSourceDisplay(src))}</span>
        </div>
      ` : ''}

      <div class="elpicker-actions">
        <button class="elpicker-btn elpicker-btn-primary" id="elpicker-copy">Copy${kbd(isMac ? '\u2318C' : 'Ctrl-C')}</button>
        <button class="elpicker-btn elpicker-btn-open ${src ? '' : 'elpicker-btn-disabled'}" id="elpicker-open" title="Open in editor (Enter)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Open${kbd('Enter')}
        </button>
        <button class="elpicker-btn elpicker-btn-ghost" id="elpicker-reselect">Re${kbd('Esc')}</button>
      </div>
    `;

    document.body.appendChild(overlayEl);

    // Scroll smart tree to bottom (selected item)
    if (state.activeTab === 'smart') {
      const area = qs(overlayEl, '.elpicker-tree-area');
      if (area) {
        area.scrollTop = area.scrollHeight;
        bindTreeEvents(area);
      }
    }

    // Tab click handlers
    qsa(overlayEl, '.elpicker-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Button handlers
    elClick(overlayEl, '.elpicker-close', deactivate);
    elClick(overlayEl, '#elpicker-copy', copyContext);
    elClick(overlayEl, '#elpicker-open', openInEditor);
    elClick(overlayEl, '#elpicker-reselect', startReselect);

    // Nav arrows
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

    // Panel drag on header
    const header = qs(overlayEl, '.elpicker-header');
    header.addEventListener('mousedown', onPanelDragStart);
  }

  function onPanelDragStart(e) {
    if (e.target.closest('.elpicker-close') || e.target.closest('.elpicker-nav-arrow')) return;
    e.preventDefault();
    panelDragState.isDragging = true;
    panelDragState.startX = e.clientX;
    panelDragState.startY = e.clientY;
    panelDragState.startLeft = overlayEl.offsetLeft;
    panelDragState.startTop = overlayEl.offsetTop;
    overlayEl.classList.add('elpicker-dragging');
    document.addEventListener('mousemove', onPanelDragMove);
    document.addEventListener('mouseup', onPanelDragEnd);
  }

  function onPanelDragMove(e) {
    if (!panelDragState.isDragging) return;
    const dx = e.clientX - panelDragState.startX;
    const dy = e.clientY - panelDragState.startY;
    const newLeft = panelDragState.startLeft + dx;
    const newTop = panelDragState.startTop + dy;
    overlayEl.style.left = `${newLeft}px`;
    overlayEl.style.top = `${newTop}px`;
  }

  function onPanelDragEnd() {
    panelDragState.isDragging = false;
    if (overlayEl) overlayEl.classList.remove('elpicker-dragging');
    document.removeEventListener('mousemove', onPanelDragMove);
    document.removeEventListener('mouseup', onPanelDragEnd);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function removeOverlay() {
    hideElTooltip();
    if (panelDragState.isDragging) {
      document.removeEventListener('mousemove', onPanelDragMove);
      document.removeEventListener('mouseup', onPanelDragEnd);
      panelDragState.isDragging = false;
    }
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function showToast(message) {
    const toast = makeEl('div.elpicker-copied-toast', message);
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

  let edgeDotsEl = null;

  function buildEdgeDots(count, cls) {
    const max = 7;
    const n = Math.min(count, max);
    let html = '';
    for (let i = 0; i < n; i++) html += '<span class="elpicker-edge-dot"></span>';
    if (count > max) html += '<span class="elpicker-edge-dot elpicker-edge-dot-plus"></span>';
    return `<span class="elpicker-edge-dots ${cls}">${html}</span>`;
  }

  function updateEdgeDots(element) {
    removeEdgeDots();
    if (!element) return;
    const nav = getNavInfo(element);
    const rect = element.getBoundingClientRect();

    edgeDotsEl = document.createElement('div');
    edgeDotsEl.className = 'elpicker-edge-frame';
    edgeDotsEl.style.left = `${rect.left + window.scrollX - 5}px`;
    edgeDotsEl.style.top = `${rect.top + window.scrollY - 5}px`;
    edgeDotsEl.style.width = `${rect.width + 10}px`;
    edgeDotsEl.style.height = `${rect.height + 10}px`;

    let html = '';
    if (nav.hasParent) html += buildEdgeDots(1, 'elpicker-edge-top');
    if (nav.childCount > 0) html += buildEdgeDots(nav.childCount, 'elpicker-edge-bottom');
    if (nav.prevCount > 0) html += buildEdgeDots(nav.prevCount, 'elpicker-edge-left');
    if (nav.nextCount > 0) html += buildEdgeDots(nav.nextCount, 'elpicker-edge-right');

    edgeDotsEl.innerHTML = html;
    document.body.appendChild(edgeDotsEl);
  }

  function removeEdgeDots() {
    if (edgeDotsEl) {
      edgeDotsEl.remove();
      edgeDotsEl = null;
    }
  }

  function selectElement(element) {
    clearSelection();
    clearHighlight();

    if (element && element !== document.body && element !== document.documentElement) {
      element.classList.add('elpicker-selected');
      state.selectedElement = element;
      state.childIndex = 0;
      updateEdgeDots(element);
      createOverlay(element);
    }
  }

  function clearSelection() {
    if (state.selectedElement) {
      state.selectedElement.classList.remove('elpicker-selected');
    }
    removeEdgeDots();
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
      el => !el.classList.contains('elpicker-overlay')
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
      el => !el.classList.contains('elpicker-overlay')
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
      el => !el.classList.contains('elpicker-overlay')
    );
    const currentIndex = siblings.indexOf(state.selectedElement);
    if (currentIndex < siblings.length - 1) {
      selectElement(siblings[currentIndex + 1]);
    }
  }

  // ===== Actions =====

  function getSearchableContext(element) {
    const { semantic, all } = classifyClasses(element);
    if (semantic.length > 0) return semantic[0];
    if (element.id && isIdAllowed(element.id)) return element.id;
    if (all.length > 0) return all[0];
    return element.tagName.toLowerCase();
  }

  function copyContext() {
    if (!state.selectedElement) return;
    const context = state.activeTab === 'smart'
      ? getSearchableContext(state.selectedElement)
      : getElementContext(state.selectedElement);
    navigator.clipboard.writeText(context).then(() => {
      showToast(`Copied: ${context}`);
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

  function isPassthroughModifier(e) {
    return isMac ? e.metaKey : e.ctrlKey;
  }

  function onMouseMove(e) {
    if (!state.isActive || !state.isSelecting) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && !el.closest('.elpicker-overlay')) {
      highlightElement(el);
    }
  }

  function onMouseDown(e) {
    if (!state.isActive || !state.isSelecting) return;
    if (e.target.closest('.elpicker-overlay')) return;
    if (isPassthroughModifier(e)) return;

    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      selectElement(el);
      state.isSelecting = false;
      clearHighlight();
    }
  }

  function onMouseUp(e) {
    if (!state.isActive || !state.isSelecting) return;
    if (e.target.closest('.elpicker-overlay')) return;
    if (isPassthroughModifier(e)) return;

    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    if (!state.isActive || !state.isSelecting) return;
    if (e.target.closest('.elpicker-overlay')) return;
    if (isPassthroughModifier(e)) return;

    e.preventDefault();
    e.stopPropagation();
  }

  function onPassthroughKeyChange(e) {
    if (!state.isActive || !state.isSelecting) return;
    const key = isMac ? 'Meta' : 'Control';
    if (e.key !== key) return;
    const held = e.type === 'keydown';
    document.body.classList.toggle('elpicker-passthrough', held);
  }

  function onKeyDown(e) {
    if (!state.isActive) return;
    
    // Don't capture if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (state.selectedElement && !state.isSelecting) {
          clearSelection();
          removeOverlay();
          state.selectedElement = null;
          state.isSelecting = true;
          const escMod = isMac ? '\u2318' : 'Ctrl';
          showToast(`Click to pick. Hold ${escMod} to click through.`);
          showTopBanner(`Click to pick. Hold ${escMod} to click through.`);
        } else {
          deactivate();
        }
        break;
        
      case 'ArrowUp':
      case 'w':
      case 'W':
        if (state.selectedElement) {
          e.preventDefault();
          navigateParent();
        }
        break;

      case 'ArrowDown':
      case 's':
      case 'S':
        if (state.selectedElement) {
          e.preventDefault();
          navigateChild();
        }
        break;

      case 'ArrowLeft':
      case 'a':
      case 'A':
        if (state.selectedElement) {
          e.preventDefault();
          navigateSiblingPrev();
        }
        break;

      case 'ArrowRight':
      case 'd':
      case 'D':
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
          cycleTab(-1);
        }
        break;

      case '.':
        if (state.selectedElement) {
          e.preventDefault();
          e.stopPropagation();
          cycleTab(1);
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
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onPassthroughKeyChange, true);
    document.addEventListener('keyup', onPassthroughKeyChange, true);

    const mod = isMac ? '\u2318' : 'Ctrl';
    showToast(`ElPicker activated! Click to pick. Hold ${mod} to click through.`);
    showTopBanner(`ElPicker activated! Click to pick. Hold ${mod} to click through.`);
  }

  function showTopBanner(message) {
    const banner = makeEl('div.elpicker-top-banner', message);
    setTimeout(() => banner.remove(), 2000);
  }

  function deactivate() {
    state.isActive = false;
    state.isSelecting = false;

    document.body.classList.remove('elpicker-active');
    document.body.classList.remove('elpicker-passthrough');
    clearHighlight();
    clearSelection();
    removeOverlay();
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }

    state.selectedElement = null;
    currentChain = [];

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keydown', onPassthroughKeyChange, true);
    document.removeEventListener('keyup', onPassthroughKeyChange, true);
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
    } else if (request.action === 'shortcutConfigUpdated') {
      shortcutConfig = { ...shortcutConfig, ...request.config };
      sendResponse({ success: true });
    }
    return true;
  });

})();
