/**
 * ElPicker Background Service Worker
 * Handles keyboard shortcuts, popup window, and cross-tab communication
 */

const POPUP_DEFAULTS = { width: 360, height: 580 };
let popupWindowId = null;

async function openOrFocusPopup() {
  if (popupWindowId != null) {
    try {
      const existing = await chrome.windows.get(popupWindowId);
      if (existing) {
        await chrome.windows.update(popupWindowId, { focused: true });
        return;
      }
    } catch (_) {
      popupWindowId = null;
    }
  }

  const saved = (await chrome.storage.local.get('popupBounds')).popupBounds;
  const bounds = saved || {};

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: bounds.width || POPUP_DEFAULTS.width,
    height: bounds.height || POPUP_DEFAULTS.height,
    ...(bounds.left != null && { left: bounds.left }),
    ...(bounds.top != null && { top: bounds.top }),
  });
  popupWindowId = win.id;
}

function savePopupBounds(windowId) {
  if (windowId !== popupWindowId) return;
  chrome.windows.get(windowId, (win) => {
    if (chrome.runtime.lastError || !win) return;
    chrome.storage.local.set({
      popupBounds: {
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      },
    });
  });
}

chrome.windows.onBoundsChanged.addListener((win) => {
  savePopupBounds(win.id);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    savePopupBounds(windowId);
    popupWindowId = null;
  }
});

chrome.action.onClicked.addListener(() => {
  openOrFocusPopup();
});

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'activate-picker') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'activate' });
      } catch (error) {
        console.log('ElPicker: Could not activate on this page');
      }
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'activateFromPopup') {
    (async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find(t => t.url?.startsWith('http'));
      if (tab?.id) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'activate' });
          sendResponse(response);
        } catch (error) {
          sendResponse({ error: 'Could not activate on this page' });
        }
      } else {
        sendResponse({ error: 'No browser tab found' });
      }
    })();
    return true;
  }
});

// Track picker state per tab
const tabStates = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
