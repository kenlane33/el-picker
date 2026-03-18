/**
 * ElPicker Popup Script
 * Handles popup UI interactions and settings
 */

// Default configuration
const DEFAULT_CONFIG = {
  preferredPatterns: ['^xx--', '^oo--', '^C--'],
  avoidedPatterns: ['^elpicker-'],
  avoidedIdPatterns: ['^radix-']
};

function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inCode = false;
  let inList = false;
  let inTable = false;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmt(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else {
        if (inList) { html += '</ul>'; inList = false; }
        if (inTable) { html += '</table>'; inTable = false; }
        html += '<pre><code>';
        inCode = true;
      }
      continue;
    }
    if (inCode) { html += esc(line) + '\n'; continue; }
    if (inList && !line.startsWith('- ')) { html += '</ul>'; inList = false; }
    if (!line.trim()) {
      if (inTable) { html += '</table>'; inTable = false; }
      continue;
    }
    if (line.startsWith('### ')) html += '<h3>' + fmt(line.slice(4)) + '</h3>';
    else if (line.startsWith('## ')) html += '<h2>' + fmt(line.slice(3)) + '</h2>';
    else if (line.startsWith('# ')) html += '<h1>' + fmt(line.slice(2)) + '</h1>';
    else if (line.startsWith('---')) html += '<hr>';
    else if (line.startsWith('|')) {
      if (/^\|[\s\-:|]+\|$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(c => '<td>' + fmt(c.trim()) + '</td>');
      if (!inTable) { html += '<table>'; inTable = true; }
      html += '<tr>' + cells.join('') + '</tr>';
    } else if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + fmt(line.slice(2)) + '</li>';
    } else {
      html += '<p>' + fmt(line) + '</p>';
    }
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  if (inTable) html += '</table>';
  return html;
}

document.addEventListener('DOMContentLoaded', async () => {
  const activateBtn = document.getElementById('activateBtn');
  const btnText = document.getElementById('btnText');
  const status = document.getElementById('status');

  // Settings elements
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const preferredPatternsInput = document.getElementById('preferredPatterns');
  const avoidedPatternsInput = document.getElementById('avoidedPatterns');
  const avoidedIdPatternsInput = document.getElementById('avoidedIdPatterns');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const resetSettingsBtn = document.getElementById('resetSettings');

  // Editor settings elements
  const editorSettingsToggle = document.getElementById('editorSettingsToggle');
  const editorSettingsPanel = document.getElementById('editorSettingsPanel');
  const editorChoiceSelect = document.getElementById('editorChoice');
  const customTemplateGroup = document.getElementById('customTemplateGroup');
  const customTemplateInput = document.getElementById('customTemplate');
  const projectRootInput = document.getElementById('projectRoot');
  const saveEditorSettingsBtn = document.getElementById('saveEditorSettings');

  // Behavior elements
  const stayOpenToggle = document.getElementById('stayOpenToggle');

  // ===== Helper Functions =====

  function populateSettings(config) {
    preferredPatternsInput.value = (config.preferredPatterns || []).join('\n');
    avoidedPatternsInput.value = (config.avoidedPatterns || []).join('\n');
    avoidedIdPatternsInput.value = (config.avoidedIdPatterns || []).join('\n');
  }

  function parsePatterns(text) {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  function validatePatterns(config) {
    const allPatterns = [
      ...config.preferredPatterns,
      ...config.avoidedPatterns,
      ...config.avoidedIdPatterns
    ];
    for (const pattern of allPatterns) {
      try {
        new RegExp(pattern);
      } catch (e) {
        return pattern;
      }
    }
    return null;
  }

  function updateUI(isActive) {
    if (isActive) {
      activateBtn.classList.add('active');
      btnText.textContent = 'Picker Active';
    } else {
      activateBtn.classList.remove('active');
      btnText.textContent = 'Activate Picker';
    }
    status.textContent = '';
    status.classList.remove('error', 'success');
  }

  function showError(message) {
    status.textContent = message;
    status.classList.remove('success');
    status.classList.add('error');
  }

  function showSuccess(message) {
    status.textContent = message;
    status.classList.remove('error');
    status.classList.add('success');
    setTimeout(() => {
      status.textContent = '';
      status.classList.remove('success');
    }, 2000);
  }

  // ===== Load Functions =====

  async function loadSettings() {
    const result = await chrome.storage.sync.get('selectorConfig');
    const config = result.selectorConfig || DEFAULT_CONFIG;
    populateSettings(config);
  }

  function updateCustomTemplateVisibility() {
    customTemplateGroup.style.display = editorChoiceSelect.value === 'custom' ? 'block' : 'none';
  }

  async function loadEditorSettings() {
    const result = await chrome.storage.sync.get('editorConfig');
    const config = result.editorConfig || { editor: 'cursor', projectRoot: '' };
    editorChoiceSelect.value = config.editor || 'cursor';
    customTemplateInput.value = config.customTemplate || '';
    projectRootInput.value = config.projectRoot || '';
    updateCustomTemplateVisibility();
  }

  async function loadBehaviorSettings() {
    try {
      const result = await chrome.storage.sync.get('behaviorConfig');
      const config = result.behaviorConfig || { stayOpen: false };
      if (stayOpenToggle) {
        stayOpenToggle.checked = config.stayOpen || false;
      }
    } catch (e) {
      console.log('ElPicker: Could not load behavior settings', e);
    }
  }

  // ===== Initialization =====

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' });
      updateUI(response?.active || false);
    }
  } catch (error) {
    // Content script not loaded yet, that's okay
  }

  await loadSettings();
  await loadEditorSettings();
  await loadBehaviorSettings();

  // ===== Event Listeners =====

  activateBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        showError('No active tab found');
        return;
      }

      if (tab.url?.startsWith('chrome://') ||
          tab.url?.startsWith('chrome-extension://') ||
          tab.url?.startsWith('edge://') ||
          tab.url?.startsWith('about:')) {
        showError('Cannot run on browser pages');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'activate' });
      updateUI(response?.active || false);

      if (response?.active) {
        setTimeout(() => window.close(), 300);
      }
    } catch (error) {
      showError('Refresh the page and try again');
    }
  });

  settingsToggle.addEventListener('click', () => {
    settingsToggle.classList.toggle('open');
    settingsPanel.classList.toggle('open');
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const config = {
      preferredPatterns: parsePatterns(preferredPatternsInput.value),
      avoidedPatterns: parsePatterns(avoidedPatternsInput.value),
      avoidedIdPatterns: parsePatterns(avoidedIdPatternsInput.value)
    };

    const invalidPattern = validatePatterns(config);
    if (invalidPattern) {
      showError(`Invalid regex: ${invalidPattern}`);
      return;
    }

    await chrome.storage.sync.set({ selectorConfig: config });
    showSuccess('Settings saved!');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'configUpdated', config });
      }
    } catch (e) {
      // Tab might not have content script loaded
    }
  });

  resetSettingsBtn.addEventListener('click', async () => {
    await chrome.storage.sync.set({ selectorConfig: DEFAULT_CONFIG });
    populateSettings(DEFAULT_CONFIG);
    showSuccess('Settings reset to defaults');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'configUpdated', config: DEFAULT_CONFIG });
      }
    } catch (e) {
      // Tab might not have content script loaded
    }
  });

  editorSettingsToggle.addEventListener('click', () => {
    editorSettingsToggle.classList.toggle('open');
    editorSettingsPanel.classList.toggle('open');
  });

  editorChoiceSelect.addEventListener('change', updateCustomTemplateVisibility);

  saveEditorSettingsBtn.addEventListener('click', async () => {
    const config = {
      editor: editorChoiceSelect.value,
      customTemplate: customTemplateInput.value.trim(),
      projectRoot: projectRootInput.value.trim()
    };
    await chrome.storage.sync.set({ editorConfig: config });
    showSuccess('Editor settings saved!');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'editorConfigUpdated', config });
      }
    } catch (e) {
      // Tab might not have content script loaded
    }
  });

  if (stayOpenToggle) {
    stayOpenToggle.addEventListener('change', async () => {
      const config = { stayOpen: stayOpenToggle.checked };
      await chrome.storage.sync.set({ behaviorConfig: config });
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, { action: 'behaviorConfigUpdated', config });
        }
      } catch (e) {
        // Tab might not have content script loaded
      }
    });
  }

  // Guide section
  const guideToggle = document.getElementById('guideToggle');
  const guidePanel = document.getElementById('guidePanel');
  const guideContent = document.getElementById('guideContent');
  const guideCopyBtn = document.getElementById('guideCopyBtn');
  const guideMdEl = document.getElementById('guideMarkdown');

  if (guideMdEl && guideContent) {
    guideContent.innerHTML = renderMarkdown(guideMdEl.textContent.trim());
  }

  if (guideToggle) {
    guideToggle.addEventListener('click', () => {
      guideToggle.classList.toggle('open');
      guidePanel.classList.toggle('open');
    });
  }

  if (guideCopyBtn && guideMdEl) {
    guideCopyBtn.addEventListener('click', () => {
      const raw = guideMdEl.textContent.trim();
      navigator.clipboard.writeText(raw).then(() => {
        const origHTML = guideCopyBtn.innerHTML;
        guideCopyBtn.textContent = 'Copied!';
        setTimeout(() => { guideCopyBtn.innerHTML = origHTML; }, 1500);
      });
    });
  }
});
