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
    outputFormat: 'selector' // 'xpath', 'outerhtml', 'innerhtml', 'selector'
  };

  // DOM references
  let rectEl = null;
  let overlayEl = null;

  // ===== Utility Functions =====

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

  // Selector preference configuration
  const selectorConfig = {
    // IDs to avoid (regex patterns)
    avoidIdPatterns: [
      /^radix-/  // Radix UI auto-generated IDs
    ],
    // Classes to prefer (regex patterns) - checked first, in order
    preferClassPatterns: [
      /^xx--/,   // Functional classes
      /^oo--/    // Semantic classes
    ],
    // Classes to avoid (regex patterns)
    avoidClassPatterns: [
      /^elpicker-/  // Our own classes
    ]
  };

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
      case 'xpath':
        return getXPath(element);
      case 'outerhtml':
        return element.outerHTML;
      case 'innerhtml':
        return element.innerHTML;
      case 'selector':
        return getCssSelector(element);
      default:
        return getXPath(element);
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
    if (element.querySelector('img') && element.querySelector('h1, h2, h3, h4, h5, h6, p')) {
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
    
    overlayEl.innerHTML = `
      <div class="elpicker-header">
        <div class="elpicker-title">
          <svg class="elpicker-title-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          ElPicker
        </div>
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
      
      <div class="elpicker-actions">
        <select class="elpicker-format-select" id="elpicker-format">
          <option value="xpath" ${state.outputFormat === 'xpath' ? 'selected' : ''}>XPath</option>
          <option value="selector" ${state.outputFormat === 'selector' ? 'selected' : ''}>CSS Selector</option>
          <option value="outerhtml" ${state.outputFormat === 'outerhtml' ? 'selected' : ''}>Outer HTML</option>
          <option value="innerhtml" ${state.outputFormat === 'innerhtml' ? 'selected' : ''}>Inner HTML</option>
        </select>
        <button class="elpicker-btn elpicker-btn-primary" id="elpicker-copy">Copy</button>
        <button class="elpicker-btn elpicker-btn-ghost" id="elpicker-reselect">Reselect</button>
      </div>
    `;
    
    document.body.appendChild(overlayEl);
    
    // Event handlers
    overlayEl.querySelector('.elpicker-close').addEventListener('click', deactivate);
    overlayEl.querySelector('#elpicker-copy').addEventListener('click', copyContext);
    overlayEl.querySelector('#elpicker-reselect').addEventListener('click', startReselect);
    overlayEl.querySelector('#elpicker-format').addEventListener('change', (e) => {
      state.outputFormat = e.target.value;
      updateCodePreview();
    });
    overlayEl.querySelector('#elpicker-show-code').addEventListener('change', (e) => {
      state.showCode = e.target.checked;
      const codeEl = overlayEl.querySelector('.elpicker-code');
      codeEl.style.display = state.showCode ? 'block' : 'none';
    });
    
    // Copy class suggestion on click
    overlayEl.querySelectorAll('.elpicker-suggest-chip').forEach(chip => {
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
    const codeEl = overlayEl.querySelector('.elpicker-code');
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
        
      case 'c':
        if ((e.metaKey || e.ctrlKey) && state.selectedElement) {
          e.preventDefault();
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
    }
    return true;
  });

})();
