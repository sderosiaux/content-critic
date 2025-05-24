// background.js
console.log('Content Critic: Background script chargé');

// Configure le side panel
chrome.runtime.onInstalled.addListener(() => {
  console.log('Content Critic: Configuration du side panel');
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Injecte le content script dans les pages web
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only inject if we have a valid URL and the page is complete
  if (changeInfo.status === 'complete' && tab?.url?.startsWith('http')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(err => console.log('Script injection failed:', err));
  }
});