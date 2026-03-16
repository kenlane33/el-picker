/**
 * ElPicker Popup Script
 * Handles popup UI interactions
 */

document.addEventListener('DOMContentLoaded', async () => {
  const activateBtn = document.getElementById('activateBtn');
  const btnText = document.getElementById('btnText');
  const status = document.getElementById('status');
  
  // Check current state
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' });
      updateUI(response?.active || false);
    }
  } catch (error) {
    // Content script not loaded yet, that's okay
  }
  
  activateBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab?.id) {
        showError('No active tab found');
        return;
      }
      
      // Check if this is a restricted page
      if (tab.url?.startsWith('chrome://') || 
          tab.url?.startsWith('chrome-extension://') ||
          tab.url?.startsWith('edge://') ||
          tab.url?.startsWith('about:')) {
        showError('Cannot run on browser pages');
        return;
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'activate' });
      updateUI(response?.active || false);
      
      // Close popup after activation
      if (response?.active) {
        setTimeout(() => window.close(), 300);
      }
    } catch (error) {
      showError('Refresh the page and try again');
    }
  });
  
  function updateUI(isActive) {
    if (isActive) {
      activateBtn.classList.add('active');
      btnText.textContent = 'Picker Active';
    } else {
      activateBtn.classList.remove('active');
      btnText.textContent = 'Activate Picker';
    }
    status.textContent = '';
    status.classList.remove('error');
  }
  
  function showError(message) {
    status.textContent = message;
    status.classList.add('error');
  }
});
