// sidepanel.js
import { 
  PromptFactory,
  Prompt,
  CriticPrompt,
  CriticalThinkingPrompt,
  HackerNewsPrompt,
  TranslationPrompt,
  SuggestionPrompt
} from './prompts.js';
import { ApiClientFactory } from './api_client.js';

let currentTabId = null;
let isAnalyzing = false;  // Add state tracking for analysis

// Token limits
const MAX_TOKENS_REGULAR = 20000;
const MAX_TOKENS_HACKERNEWS = 20000;
const MAX_TOKENS_TRANSLATION = 20000;

// Raw content handling
let currentRawContent = null;

// Raw response handling
let currentRawResponse = null;

// Sauvegarde la clé API
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.local.set({ apiKey });
}

// Function to filter out our highlights from content
function filterHighlights(content) {
  if (!content) return '';
  
  // Remove any text that matches our highlight patterns
  // These patterns should only match our actual highlight annotations
  const highlightPatterns = [
    // Match our highlight annotations with their explanations
    // Must start with the type in all caps, followed by a colon
    /^(?:ASSUMPTION|FALLACY|CONTRADICTION|INCONSISTENCY|FLUFF):\s*[^\n]*(?:\n(?!\n)[^\n]*)*/gim,
    // Match our suggestion annotations
    // Must start with SUGGESTION in all caps, followed by a colon
    /^SUGGESTION:\s*[^\n]*(?:\n(?!\n)[^\n]*)*/gim
  ];
  
  let cleanContent = content;
  let totalRemoved = 0;
  
  highlightPatterns.forEach((pattern, index) => {
    const beforeLength = cleanContent.length;
    const matches = cleanContent.match(pattern) || [];
    
    if (matches.length > 0) {
      console.log(`Removed ${matches.length} highlight annotations`);
    }
    
    cleanContent = cleanContent.replace(pattern, (match) => {
      totalRemoved += match.length;
      return '';
    });
  });
  
  // Clean up any extra whitespace created by the removal
  cleanContent = cleanContent
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/^\s+|\s+$/g, ''); // Trim whitespace
  
  if (totalRemoved > 0) {
    console.log('Content filtering:', {
      initialLength: content.length,
      finalLength: cleanContent.length,
      removed: totalRemoved
    });
  }
  
  return cleanContent;
}

// Helper function to set loading state
function setLoadingState(isLoading) {
  const resultDiv = document.getElementById('result');
  const analyzeBtn = document.getElementById('analyzeBtn');
  
  if (isLoading) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    resultDiv.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Analyzing content...</div>
      </div>`;
  } else {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

// Helper function to sync UI state with tab's analysis status
async function syncUIWithTabState(urlKey) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  const tabData = tabResults[urlKey];
  
  if (tabData?.isAnalyzing) {
    setLoadingState(true);
  } else {
    setLoadingState(false);
  }
}

// Helper function to get a clean URL key
function getUrlKey(url) {
  try {
    // Remove trailing slash and hash
    return url.replace(/\/$/, '').split('#')[0];
  } catch (e) {
    console.error('Error getting URL key:', e);
    return url;
  }
}

// Main API call orchestrator
async function makeApiCall(promptInstance, content, options = {}) {
  const apiKey = options.apiKey || await getApiKey();
  if (!apiKey) {
    throw new Error('No API key found');
  }

  // Create API client
  const client = ApiClientFactory.createClient(apiKey, {
    model: promptInstance.model
  });

  try {
    // Format the prompt with content
    const formattedPrompt = promptInstance.formatWithContent(content);
    
    // Make API call
    const rawResponse = await client.call(formattedPrompt, options);

    // Use prompt instance to parse and validate response
    const parsedResponse = promptInstance.parseResponse(rawResponse);
    promptInstance.validateResponse(parsedResponse);

    return parsedResponse;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Helper function to store analysis results
async function storeAnalysisResults(urlKey, data) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...data,
    timestamp: Date.now(),
    isAnalyzing: false
  };
  await chrome.storage.local.set({ tabResults });
}

// Helper function to update analyzing state
async function updateAnalyzingState(urlKey, isAnalyzing, tabId) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...tabResults[urlKey],
    isAnalyzing,
    timestamp: Date.now(),
    tabId
  };
  await chrome.storage.local.set({ tabResults });
}

// New consolidated function to execute analysis and update UI
async function _executeAnalysisAndUpdateUI(contentToAnalyze, tabInfo, apiKey) {
  const urlKey = getUrlKey(tabInfo.url);
  currentTabId = tabInfo.id;
  isAnalyzing = true;

  setLoadingState(true);
  await updateAnalyzingState(urlKey, true, tabInfo.id);

  try {
    currentRawContent = contentToAnalyze;
    
    const tokenInfo = computeTokenInfo(contentToAnalyze);
    document.getElementById('rawContentTokenInfo').textContent = tokenInfo.displayText;

    const isHackerNews = tabInfo.url.includes('news.ycombinator.com');
    const promptType = isHackerNews ? 'hackernews' : 'critic';
    const promptInstance = PromptFactory.createPrompt(promptType);

    const response = await makeApiCall(promptInstance, contentToAnalyze, {
      apiKey,
      type: promptType
    });
    currentRawResponse = response;

    // Store results based on prompt type
    const storedData = {
      content: contentToAnalyze,
      title: tabInfo.title,
      url: tabInfo.url,
      type: promptType,
      tabId: tabInfo.id
    };

    // Add prompt-specific data
    switch (promptType) {
      case 'critic':
        storedData.analysis = response.analysis;
        storedData.highlights = response.highlights;
        // Send highlights to content script
        if (response.highlights?.length > 0) {
          chrome.tabs.sendMessage(tabInfo.id, {
            action: "highlightContent",
            highlights: response.highlights
          });
        }
        break;
      case 'hackernews':
      case 'critical-thinking':
        storedData.analysis = response.analysis;
        break;
      case 'translation':
        storedData.translations = response.translations;
        break;
      case 'suggestion':
        storedData.suggestion = response.suggestion;
        break;
    }

    await storeAnalysisResults(urlKey, storedData);

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      // Display appropriate content based on prompt type
      switch (promptType) {
        case 'critic':
        case 'hackernews':
        case 'critical-thinking':
          displayResult(response.analysis, tabInfo.title);
          break;
        case 'translation':
          displayResult(JSON.stringify(response.translations, null, 2), tabInfo.title);
          break;
        case 'suggestion':
          displayResult(response.suggestion, tabInfo.title);
          break;
      }
    }

  } catch (error) {
    await updateAnalyzingState(urlKey, false, tabInfo.id);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      displayError('Error: ' + error.message);
    }
  } finally {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      isAnalyzing = false;
      setLoadingState(false);
    }
  }
}

async function analyzeContent() {
  const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
  const inputApiKey = document.getElementById('apiKey').value;
  const apiKey = storedApiKey || inputApiKey;

  if (!apiKey) {
    displayError('Please enter your API key');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    displayError('Unable to find active tab or tab URL');
    return;
  }
  
  // Save the API key if it's from input and different from stored
  if (inputApiKey && inputApiKey !== storedApiKey) {
    saveApiKey();
  }

  // Show loading state immediately
  setLoadingState(true); 
  const urlKey = getUrlKey(tab.url);
  await updateAnalyzingState(urlKey, true, tab.id);

  try {
    let contentToAnalyze;
    
    // If we have currentRawContent (from selection or previous edit), use it
    if (currentRawContent) {
      contentToAnalyze = currentRawContent;
    } else {
      // Otherwise get content from the page
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Unable to get page content'));
        }, 5000);

        chrome.tabs.sendMessage(tab.id, { action: "getContent" }, (msgResponse) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error('Content script not ready. Please refresh the page.'));
            return;
          }
          resolve(msgResponse);
        });
      });

      if (!response || !response.content) {
        throw new Error('Unable to get page content');
      }

      contentToAnalyze = filterHighlights(response.content);
    }

    // Pass necessary tab info to the analysis function
    await _executeAnalysisAndUpdateUI(contentToAnalyze, { 
      id: tab.id, 
      url: tab.url, 
      title: tab.title 
    }, apiKey);

  } catch (error) {
    await updateAnalyzingState(getUrlKey(tab.url), false, tab.id);
    displayError('Error: ' + error.message);
    setLoadingState(false);
    isAnalyzing = false;
  }
}

function displayResult(text, title = '') {
  const resultDiv = document.getElementById('result');
  if (!resultDiv) {
    console.error('Result div not found');
    return;
  }

  try {
    let displayText;
    let htmlContent;
    console.log('Displaying result:', text);

    // Handle both string and object responses
    if (typeof text === 'string') {
      // Pre-process markdown tables to ensure they're not split
      displayText = text.replace(/\|\n\|/g, '|\n|'); // Fix split table rows
      displayText = displayText.replace(/\n\s*\n\s*\|/g, '\n|'); // Remove extra newlines before table rows
      displayText = displayText.replace(/\|\s*\n\s*\n/g, '|\n'); // Remove extra newlines after table rows
    } else if (text && typeof text === 'object') {
      // Handle both direct analysis object and full result object
      let summary = text.summary || (text.analysis && text.analysis.summary) || '';
      let critique = text.critique || (text.analysis && text.analysis.critique) || '';
      
      // Fix tables in both summary and critique
      summary = summary.replace(/\|\n\|/g, '|\n|')
                      .replace(/\n\s*\n\s*\|/g, '\n|')
                      .replace(/\|\s*\n\s*\n/g, '|\n');
      critique = critique.replace(/\|\n\|/g, '|\n|')
                        .replace(/\n\s*\n\s*\|/g, '\n|')
                        .replace(/\|\s*\n\s*\n/g, '|\n');
      
      // Just combine the content without the section titles
      displayText = `${summary}\n\n${critique}`;
    } else {
      displayText = 'Invalid analysis format';
    }

    // Convert markdown to HTML
    htmlContent = simpleMarkdown(displayText);
    
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';
    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${htmlContent}</div>
      </div>`;
    
    // Scroll to top of result
    resultDiv.scrollTop = 0;
  } catch (error) {
    console.error('Error displaying result:', error);
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';
    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}</div>
      </div>`;
  }
}

function displayError(error) {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `<div class="result error">${error}</div>`;
}

// Update resetTabState to use URL
async function resetTabState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log('No active tab found');
      return;
    }

    const urlKey = getUrlKey(tab.url);
    // Get current tab results
    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    
    // Remove this URL's data
    if (tabResults[urlKey]) {
      delete tabResults[urlKey];
      await chrome.storage.local.set({ tabResults });
      console.log('Reset state for URL:', urlKey);
    }

    // Clear UI state
    document.getElementById('result').innerHTML = '';
    currentRawContent = null;
    currentRawResponse = null;
    setLoadingState(false);
    
    // Clear any highlights in the content script
    chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" });
    
  } catch (error) {
    console.error('Error resetting tab state:', error);
  }
}

// Helper functions to show and hide modals
function showModal(modalElement) {
  if (modalElement) {
    modalElement.classList.add('visible');
  }
}

function hideModal(modalElement) {
  if (modalElement) {
    modalElement.classList.remove('visible');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the extension
  initializeExtension();

  const apiKeyModal = document.getElementById('apiKeyModal');
  const rawContentModal = document.getElementById('rawContentModal');
  const rawResponseModal = document.getElementById('rawResponseModal');

  // Create header buttons container
  const headerButtonsContainer = document.createElement('div');
  headerButtonsContainer.className = 'header-buttons-container';
  headerButtonsContainer.innerHTML = `
    <button id="resetTabBtn" class="header-button icon-only" title="Reset Analysis">
      <span class="button-icon">🔄</span>
    </button>
    <button id="apiKeyBtn" class="header-button icon-only" title="API Settings">
      <span class="button-icon">⚙️</span>
    </button>
    <button id="rawContentBtn" class="header-button icon-only" title="Raw Content">
      <span class="button-icon">📄</span>
    </button>
    <button id="rawResponseBtn" class="header-button icon-only" title="Raw Response">
      <span class="button-icon">📋</span>
    </button>
  `;

  // Replace the old buttons with the new container
  const headerRight = document.querySelector('.header-right');
  const oldButtons = headerRight.querySelectorAll('.header-button');
  oldButtons.forEach(btn => btn.remove());
  headerRight.appendChild(headerButtonsContainer);

  // Create analyze buttons container
  const analyzeButtonsContainer = document.createElement('div');
  analyzeButtonsContainer.className = 'analyze-buttons-container';
  analyzeButtonsContainer.innerHTML = `
    <button id="analyzeBtn" class="header-button">
      <span class="button-icon">🔍</span>
      <span class="button-text">Analyze Page</span>
    </button>
    <button id="analyzeSelectionBtn" class="header-button">
      <span class="button-icon">✂️</span>
      <span class="button-text">Analyze Selection</span>
    </button>
  `;

  // Insert analyze buttons at the top of the content area
  const contentArea = document.querySelector('#result').parentNode;
  contentArea.insertBefore(analyzeButtonsContainer, document.querySelector('#result'));

  // Add click handlers for all buttons
  document.getElementById('resetTabBtn').addEventListener('click', resetTabState);
  document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);
  document.getElementById('analyzeSelectionBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }

      // Request selected text from content script
      const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" });
      
      if (!response || !response.selectedText) {
        throw new Error('No text selected on the page');
      }

      const selectedText = response.selectedText.trim();
      if (selectedText.length === 0) {
        throw new Error('Selected text is empty');
      }

      // Update currentRawContent with the selection
      currentRawContent = selectedText;
      
      // Update token info display
      const tokenInfo = document.getElementById('rawContentTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;

      // Show success message
      const button = document.getElementById('analyzeSelectionBtn');
      const originalText = button.querySelector('.button-text').textContent;
      button.querySelector('.button-text').textContent = 'Selection Captured!';
      button.classList.add('success');
      
      setTimeout(() => {
        button.querySelector('.button-text').textContent = originalText;
        button.classList.remove('success');
      }, 2000);

      // Start analysis immediately
      await analyzeContent();

    } catch (error) {
      console.error('Error analyzing selection:', error);
      displayError('Error: ' + error.message);
    }
  });

  // Hide the translate button
  const translateBtn = document.getElementById('translateBtn');
  if (translateBtn) {
    translateBtn.style.display = 'none';
  }

  document.getElementById('apiKeyBtn').addEventListener('click', () => {
    showModal(apiKeyModal);
    // Load current API key if exists
    chrome.storage.local.get(['apiKey'], (result) => {
      if (result.apiKey) {
        document.getElementById('apiKey').value = result.apiKey;
        updateApiKeyStatus(result.apiKey);
      }
    });
  });

  document.getElementById('closeApiKeyBtn').addEventListener('click', () => {
    hideModal(apiKeyModal);
  });

  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    saveApiKey();
    hideModal(apiKeyModal);
  });

  document.getElementById('rawContentBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawContentText');
    const editDiv = document.getElementById('rawContentEdit');
    
    if (currentRawContent) {
      const tokenInfo = document.getElementById('rawContentTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      
      textDiv.textContent = currentRawContent;
      textDiv.style.display = 'block';
      editDiv.style.display = 'none';
      
      document.getElementById('saveContentBtn').style.display = 'none';
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('copyContentBtn').style.display = 'block';
    } else {
      textDiv.textContent = 'No content available';
      document.getElementById('copyContentBtn').style.display = 'none';
    }
    showModal(rawContentModal);
  });

  document.getElementById('closeRawContentBtn').addEventListener('click', () => {
    hideModal(rawContentModal);
  });

  document.getElementById('rawResponseBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawResponseText');
    
    if (currentRawResponse) {
      try {
        // Try to parse and format the JSON
        const jsonResponse = JSON.parse(currentRawResponse);
        textDiv.textContent = JSON.stringify(jsonResponse, null, 2);
      } catch (e) {
        // If it's not valid JSON, display as is
        textDiv.textContent = currentRawResponse;
      }
      const tokenInfo = document.getElementById('rawResponseTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawResponse).displayText;
    } else {
      textDiv.textContent = 'No raw response available. Please run an analysis first.';
    }
    showModal(rawResponseModal);
  });

  document.getElementById('closeRawResponseBtn').addEventListener('click', () => {
    hideModal(rawResponseModal);
  });

  document.getElementById('apiKey').addEventListener('input', (e) => {
    updateApiKeyStatus(e.target.value);
  });

  document.getElementById('rawContentText').addEventListener('dblclick', () => {
    const textDiv = document.getElementById('rawContentText');
    const editDiv = document.getElementById('rawContentEdit');
    const textarea = document.getElementById('rawContentTextarea');
    const saveBtn = document.getElementById('saveContentBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');
    const copyBtn = document.getElementById('copyContentBtn');
    
    textarea.value = currentRawContent;
    textDiv.style.display = 'none';
    editDiv.style.display = 'block';
    saveBtn.style.display = 'block';
    cancelBtn.style.display = 'block';
    copyBtn.style.display = 'none';
    textarea.focus();
  });

  document.getElementById('saveContentBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('rawContentTextarea');
    const newContent = textarea.value.trim();

    if (newContent) {
      // Hide editing UI first
      document.getElementById('rawContentText').textContent = newContent;
      document.getElementById('rawContentEdit').style.display = 'none';
      document.getElementById('rawContentText').style.display = 'block';
      document.getElementById('saveContentBtn').style.display = 'none';
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('copyContentBtn').style.display = 'block'; // Show copy button again

      // Get API key
      const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
      const inputApiKey = document.getElementById('apiKey').value;
      const apiKey = storedApiKey || inputApiKey;

      if (!apiKey) {
        displayError('Please enter your API key to re-analyze');
        return;
      }
       // Save the API key if it's from input and different
      if (inputApiKey && inputApiKey !== storedApiKey) {
        saveApiKey();
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) { // Ensure tab.url exists
        displayError('Unable to find active tab or tab URL for re-analysis');
        return;
      }
      
      // Call the consolidated function
      // Note: response.title might not be available here directly if we don't re-fetch it.
      // Using tab.title as a fallback or assuming it's current.
      // For content, we use newContent. For title, using tab.title.
      await _executeAnalysisAndUpdateUI(newContent, { id: tab.id, url: tab.url, title: tab.title }, apiKey);
    }
  });

  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('rawContentEdit').style.display = 'none';
    document.getElementById('rawContentText').style.display = 'block';
    document.getElementById('saveContentBtn').style.display = 'none';
    document.getElementById('cancelEditBtn').style.display = 'none';
    document.getElementById('copyContentBtn').style.display = 'block';
  });

  document.getElementById('copyContentBtn').addEventListener('click', async () => {
    if (currentRawContent) {
      try {
        await navigator.clipboard.writeText(currentRawContent);
        const copyBtn = document.getElementById('copyContentBtn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy content:', err);
      }
    }
  });

  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      hideModal(apiKeyModal);
    }
    if (e.target === rawContentModal) {
      hideModal(rawContentModal);
    }
    if (e.target === rawResponseModal) {
      hideModal(rawResponseModal);
    }
  });
});

// API Key section handling
function updateApiKeyStatus(apiKey) {
  const statusElement = document.getElementById('apiKeyStatus');
  
  if (apiKey) {
    // Validate API key format
    const isValid = apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant-');
    statusElement.textContent = isValid ? 'Configured' : 'Invalid format';
    statusElement.className = `api-key-status ${isValid ? 'valid' : ''}`;
  } else {
    statusElement.textContent = 'Not configured';
    statusElement.className = 'api-key-status';
  }
}

// Listen for tab changes and update the panel
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('Tab activated:', activeInfo);
  try {
    // Update current tab ID
    currentTabId = activeInfo.tabId;
    
    // Get the tab info
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log('Current tab info:', tab);
    
    if (!tab.url || !tab.url.startsWith('http')) {
      console.log('Not a valid web page, clearing results');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);  // Reset UI state
      return;
    }
    
    // Sync UI state with the new tab's analysis status
    const urlKey = getUrlKey(tab.url);
    await syncUIWithTabState(urlKey);
    
    // Clear current result and load stored analysis
    document.getElementById('result').innerHTML = '';
    await loadStoredAnalysis(activeInfo.tabId);
  } catch (error) {
    console.error('Error handling tab activation:', error);
    document.getElementById('result').innerHTML = '';
    setLoadingState(false);  // Reset UI state on error
  }
});

// Also listen for tab updates (e.g., when navigating to a new page in the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only proceed if this is the current tab and the URL has changed
  if (tabId === currentTabId && changeInfo.status === 'complete') {
    console.log('Tab updated:', { tabId, changeInfo, tab });
    try {
      if (!tab.url || !tab.url.startsWith('http')) {
        console.log('Not a valid web page, clearing results');
        document.getElementById('result').innerHTML = '';
        setLoadingState(false);  // Reset UI state
        return;
      }
      
      // Sync UI state with the updated tab's analysis status
      const urlKey = getUrlKey(tab.url);
      await syncUIWithTabState(urlKey);
      
      // Clear the current result since we're on a new page
      document.getElementById('result').innerHTML = '';
      // Try to load any existing analysis for this URL
      await loadStoredAnalysis(tabId);
    } catch (error) {
      console.error('Error handling tab update:', error);
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);  // Reset UI state on error
    }
  }
});

// Compute token info for content
function computeTokenInfo(content) {
  const charCount = content.length;
  const wordCount = content.trim().split(/\s+/).length;
  const estimatedTokens = Math.ceil(charCount / 4); // Rough estimate: ~4 chars per token
  return {
    charCount,
    wordCount,
    estimatedTokens,
    displayText: `≈ ${estimatedTokens.toLocaleString()} tokens (${wordCount.toLocaleString()} words, ${charCount.toLocaleString()} chars)`
  };
}

// Update showRawContent function to just store content
function showRawContent(content) {
  // Store content and update token info
  currentRawContent = filterHighlights(content);
  const tokenInfo = document.getElementById('rawContentTokenInfo');
  tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
  
  // Show the modal with content
  const modal = document.getElementById('rawContentModal');
  const textDiv = document.getElementById('rawContentText');
  const editDiv = document.getElementById('rawContentEdit');
  
  textDiv.textContent = currentRawContent;
  textDiv.style.display = 'block';
  editDiv.style.display = 'none';
  
  // Hide edit buttons
  document.getElementById('saveContentBtn').style.display = 'none';
  document.getElementById('cancelEditBtn').style.display = 'none';
  
  modal.classList.add('visible');
}

// Update loadStoredAnalysis to use URL
async function loadStoredAnalysis(tabId) {
  if (!tabId) {
    console.log('No tabId provided to loadStoredAnalysis');
    return;
  }

  try {
    // Get current tab URL to check if it matches stored data
    const tab = await chrome.tabs.get(tabId);
    console.log('Loading analysis for tab:', { tabId, url: tab?.url });
    
    if (!tab || !tab.url) {
      console.log('No valid tab or URL found');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const urlKey = getUrlKey(tab.url);
    const storage = await chrome.storage.local.get('tabResults');
    console.log('All stored results:', storage.tabResults);
    
    if (!storage || !storage.tabResults) {
      console.log('No tabResults found in storage');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const tabData = storage.tabResults[urlKey];
    console.log('Found tab data:', { 
      tabId, 
      urlKey,
      currentUrl: tab.url, 
      storedUrl: tabData?.url,
      hasAnalysis: !!tabData?.analysis,
      isAnalyzing: tabData?.isAnalyzing,
      hasHighlights: !!tabData?.highlights?.length
    });
    
    // Sync UI state with the tab's analysis status
    await syncUIWithTabState(urlKey);
    
    if (tabData) {
      console.log('Displaying stored analysis for URL:', tab.url);
      
      // Display appropriate content based on prompt type
      switch (tabData.type) {
        case 'critic':
        case 'hackernews':
        case 'critical-thinking':
          displayResult(tabData.analysis, tabData.title);
          break;
        case 'translation':
          displayResult(JSON.stringify(tabData.translations, null, 2), tabData.title);
          break;
        case 'suggestion':
          displayResult(tabData.suggestion, tabData.title);
          break;
      }
      
      if (tabData.content) {
        currentRawContent = filterHighlights(tabData.content);
        const tokenInfo = document.getElementById('rawContentTokenInfo');
        tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      }

      // Only restore highlights for critic prompts
      if (tabData.type === 'critic' && tabData.highlights?.length > 0) {
        console.log('Restoring highlights:', tabData.highlights.length);
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: "highlightContent",
            highlights: tabData.highlights
          });
          console.log('Highlights restored successfully');
        } catch (error) {
          console.error('Failed to restore highlights:', error);
        }
      }
    } else {
      console.log('No matching analysis found:', {
        hasTabData: !!tabData,
        hasAnalysis: !!tabData?.analysis
      });
      document.getElementById('result').innerHTML = '';
      currentRawContent = null;
      currentRawResponse = null;
    }
  } catch (error) {
    console.error('Error loading stored analysis:', error);
    document.getElementById('result').innerHTML = '';
    currentRawContent = null;
    currentRawResponse = null;
    setLoadingState(false);
  }
}

// Request content when sidepanel opens
async function requestContentFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log('No active tab found');
      return;
    }

    if (!tab.url || !tab.url.startsWith('http')) {
      console.log('Tab is not a valid web page:', tab.url);
      return;
    }

    console.log('Loading analysis for tab:', tab.id, tab.url);
    currentTabId = tab.id;
    await loadStoredAnalysis(tab.id);
  } catch (error) {
    console.error('Error requesting content:', error);
  }
}

// Request content from active tab when sidepanel opens
requestContentFromActiveTab();

// Écoute les changements de stockage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.pageContent) {
    loadStoredData();
  }
});

// Cleanup old tab results (older than 1 week)
async function cleanupOldTabResults() {
  try {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const now = Date.now();
    
    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    const cleanedResults = {};
    let cleanedCount = 0;
    
    // Filter out old results
    Object.entries(tabResults).forEach(([urlKey, data]) => {
      if (data.timestamp && (now - data.timestamp) < ONE_WEEK_MS) {
        cleanedResults[urlKey] = data;
      } else {
        cleanedCount++;
      }
    });
    
    // Only update storage if we actually cleaned something
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old URL results`);
      await chrome.storage.local.set({ tabResults: cleanedResults });
    }
  } catch (error) {
    console.error('Error cleaning up old URL results:', error);
  }
}

// Translation module
const TranslationModule = (function() {
  let isTranslating = false;
  let originalNodes = new Map(); // Map of ID -> {node, originalText}
  let nextNodeId = 0;
  
  // Add translation button to the panel
  function addTranslationButton() {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'action-buttons';
    buttonContainer.innerHTML = `
      <button id="translateBtn" class="header-button">
        <span class="button-icon">🇫🇷</span>
        <span class="button-text">Traduire</span>
      </button>
    `;
    
    // Insert after the analyze button
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.parentNode.insertBefore(buttonContainer, analyzeBtn.nextSibling);
    
    // Add click handler
    document.getElementById('translateBtn').addEventListener('click', toggleTranslation);
  }
  
  // Check if content script is ready
  async function isContentScriptReady(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return true;
    } catch (error) {
      console.log('Content script not ready:', error);
      return false;
    }
  }
  
  // Ensure content script is ready
  async function ensureContentScriptReady() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Try to inject content script if not ready
    if (!await isContentScriptReady(tab.id)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        // Check again
        if (!await isContentScriptReady(tab.id)) {
          throw new Error('Content script failed to initialize');
        }
      } catch (error) {
        console.error('Failed to inject content script:', error);
        throw new Error('Please refresh the page to enable translation');
      }
    }
  }
  
  // Toggle translation state
  async function toggleTranslation() {
    const button = document.getElementById('translateBtn');
    const buttonText = button.querySelector('.button-text');
    const buttonIcon = button.querySelector('.button-icon');
    
    if (isTranslating) {
      // Revert translation
      try {
        await ensureContentScriptReady();
        await revertTranslation();
        buttonText.textContent = 'Traduire';
        buttonIcon.textContent = '🇫🇷';
        isTranslating = false;
      } catch (error) {
        console.error('Failed to revert translation:', error);
        displayError('Error: ' + error.message);
        buttonText.textContent = 'Traduire';
        buttonIcon.textContent = '🇫🇷';
        isTranslating = false;
      }
    } else {
      // Start translation
      buttonText.textContent = 'Traduction...';
      buttonIcon.textContent = '⏳';
      button.disabled = true;
      isTranslating = true;
      
      try {
        await ensureContentScriptReady();
        await translatePage();
        buttonText.textContent = 'Revenir en Anglais';
        buttonIcon.textContent = '↩️';
        button.disabled = false;
      } catch (error) {
        console.error('Translation failed:', error);
        buttonText.textContent = 'Erreur';
        buttonIcon.textContent = '❌';
        displayError('Error: ' + error.message);
        setTimeout(() => {
          buttonText.textContent = 'Traduire';
          buttonIcon.textContent = '🇫🇷';
          button.disabled = false;
        }, 2000);
        isTranslating = false;
      }
    }
  }
  
  // Collect text nodes from the page
  async function collectTextNodes() {
    const textNodes = {};
    originalNodes.clear();
    nextNodeId = 0;
    
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Send message to content script to collect nodes
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'collectTextNodes',
      options: {
        minLength: 2, // Skip single characters
        skipSelectors: 'script, style, noscript, [style*="display: none"], [style*="visibility: hidden"]'
      }
    });
    
    if (!response || !response.nodes) {
      throw new Error('Failed to collect text nodes');
    }
    
    // Validate and filter nodes
    const validNodes = response.nodes.filter(node => 
      node && 
      typeof node.id === 'string' && 
      typeof node.t === 'string' && 
      node.t.trim().length > 0
    );
    
    if (validNodes.length === 0) {
      throw new Error('No valid text nodes found to translate');
    }
    
    console.log('Collected nodes for translation:', {
      total: response.nodes.length,
      valid: validNodes.length,
      sample: validNodes.slice(0, 3)
    });
    
    // Store nodes and prepare for translation
    validNodes.forEach(node => {
      originalNodes.set(node.id, { id: node.id, text: node.t });
      textNodes[node.id] = node.t; // Use ID as key in object
    });
    
    return textNodes;
  }
  
  // Translate the page
  async function translatePage() {
    const textNodes = await collectTextNodes();
    if (Object.keys(textNodes).length === 0) {
      console.log('No text nodes to translate');
      return;
    }
    
    console.log(`Collected ${Object.keys(textNodes).length} text nodes for translation`);
    
    // Get API key
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (!apiKey) {
      throw new Error('No API key found');
    }
    
    // Create translation prompt instance
    const promptInstance = PromptFactory.createPrompt('translation');
    const content = JSON.stringify(textNodes);

    console.log('Translation prompt:', {
      nodeCount: Object.keys(textNodes).length,
      sampleNodes: Object.values(textNodes).slice(0, 3),
      contentLength: content.length
    });
    
    try {
      const response = await makeApiCall(promptInstance, content, {
        apiKey,
        type: 'translation'
      });
      
      console.log('Translation response:', response);
      
      // Handle both array of objects and direct object formats
      let translations = {};
      if (Array.isArray(response.translations)) {
        // Convert array of objects to single object
        response.translations.forEach(item => {
          const key = Object.keys(item)[0];
          if (key && key.startsWith('t')) {
            translations[key] = item[key];
          }
        });
      } else if (typeof response.translations === 'object') {
        translations = response.translations;
      } else {
        throw new Error('Invalid response format');
      }
      
      console.log('Normalized translations:', translations);
      console.log('Translation keys:', Object.keys(translations));
      
      // Simple validation: check if we have any valid translations
      const validKeys = Object.keys(translations).filter(key => {
        const isValid = key.startsWith('t') && typeof translations[key] === 'string';
        console.log(`Validating key ${key}:`, { 
          startsWithT: key.startsWith('t'),
          isString: typeof translations[key] === 'string',
          value: translations[key],
          isValid 
        });
        return isValid;
      });
      
      console.log('Valid keys found:', validKeys);
      
      if (validKeys.length === 0) {
        console.error('No valid translations found. Full response:', translations);
        throw new Error('No valid translations found in response');
      }
      
      // Convert to format expected by content script
      const formattedTranslations = validKeys.map(id => ({
        id,
        t: translations[id]
      }));
      
      console.log('Formatted translations:', formattedTranslations);
      
      // Send translations to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        action: 'applyTranslations',
        translations: formattedTranslations
      });
      
      console.log(`Applied ${formattedTranslations.length} translations`);
      
    } catch (error) {
      console.error('Translation error:', error);
      throw error;
    }
  }
  
  // Revert all translations
  async function revertTranslation() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'revertTranslations' });
    console.log('Reverted all translations');
  }
  
  // Initialize the translation module
  function initialize() {
    //addTranslationButton();
  }
  
  return {
    initialize
  };
})();

// Add translation module initialization to the main initialize function
async function initializeExtension() {
  // Prevent multiple initializations
  if (window.extensionInitialized) {
    console.log('Extension already initialized, skipping');
    return;
  }
  window.extensionInitialized = true;

  try {
    // Clean up old results when the extension starts
    await cleanupOldTabResults();
    
    // Load API key from storage
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (apiKey) {
      document.getElementById('apiKey').value = apiKey;
      updateApiKeyStatus(apiKey);
    }
    
    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab) {
      console.log('Initial active tab:', tab);
      currentTabId = tab.id;
      if (tab.url && tab.url.startsWith('http')) {
        await loadStoredAnalysis(tab.id);
      }
    }
    
    // Initialize translation module
    TranslationModule.initialize();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Update message listener to remove type parameter
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'makeApiCall') {
    // Get API key from storage
    chrome.storage.local.get(['apiKey'], async (result) => {
      if (!result.apiKey) {
        sendResponse({ error: 'API key not found. Please set your API key in the extension settings.' });
        return;
      }

      try {
        // Détecter si c'est une suggestion
        const isSuggestion = typeof request.data === 'object' && 
                           request.data.analysisType && 
                           request.data.text && 
                           request.data.explanation;

        console.log('makeApiCall message:', { 
          isSuggestion,
          dataType: typeof request.data,
          hasAnalysisType: !!request.data?.analysisType,
          hasText: !!request.data?.text,
          hasExplanation: !!request.data?.explanation
        });

        if (isSuggestion) {
          const promptInstance = new SuggestionPrompt();
          const response = await makeApiCall(promptInstance, request.data, {
            apiKey: result.apiKey,
            type: 'suggestion'
          });
          sendResponse(response);
        } else {
          throw new Error('Invalid request format for non-suggestion requests');
        }
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true; // Keep the message channel open for async response
  }
});