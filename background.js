/**
 * ElPicker Background Service Worker
 * Handles keyboard shortcuts and cross-tab communication
 */

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
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'activate' });
          sendResponse(response);
        } catch (error) {
          sendResponse({ error: 'Could not activate on this page' });
        }
      }
    });
    return true; // Keep channel open for async response
  }
});

// Track picker state per tab
const tabStates = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
