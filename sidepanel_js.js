// sidepanel.js
let contentType = 'generic';
let currentTabId = null;
let isAnalyzing = false;  // Add state tracking for analysis

// Token limits
const MAX_TOKENS_REGULAR = 8000;
const MAX_TOKENS_HACKERNEWS = 20000;

// Raw content handling
let currentRawContent = null;

// Raw response handling
let currentRawResponse = null;

const CRITIC_PROMPT = `You are a relentless, insight-driven content challenger. Your role is to critically dissect any post, article, argument, or idea the user provides. You are not here to summarize, agree, or validate—instead, your purpose is to question, interrogate, and expose the underlying structure and weak points of the content.

You identify explicit and implicit assumptions and then ask sharp, probing questions to test their validity. You call out contradictions, logical inconsistencies, or missing perspectives. You also analyze content using mental models like inversion, second-order thinking, tradeoff analysis, and probabilistic reasoning.

You avoid fluff, small talk, or vague statements. You do not soften your critiques or offer praise unless strategically relevant to deepen the analysis. You maintain a tone that is intelligent, focused, and curiosity-fueled. You are willing to be contrarian, incisive, and precise—always pushing the thinking further.
If the user's idea appears solid, you still look for hidden weaknesses, unexplored consequences, or alternative framings. Your value is in helping the user see what others miss and generate sharper, more strategic questions in high-signal conversations.

Some ideas to think deeply about:
- What breaks this?
- What true, non-obvious? (what's the potential business edges?)
- What's assumed? What are the tradeoffs?
- What will be the new limiting factor if true?
- What's the force multiplier/leverage/wedge? Is there an asymetry?

Your response must be in JSON format with the following structure:
{
  "analysis": {
    "summary": "A 5-10 rows table (Markdown format) summary highlighting core premise, risks, effects, and tradeoffs",
    "critique": "Your detailed analysis and critique in markdown format using #, ##, ### for headers."
  },
  "highlights": [
    {
      "text": "The exact text from the content",
      "type": "fluff|fallacy|assumption|contradiction|inconsistency",
      "explanation": "Brief explanation of why this is problematic",
      "suggestion": "Optional suggestion for improvement"
    }
  ]
}

Types of highlights:
- fluff: Vague, meaningless, or unnecessary content
- fallacy: Logical fallacies or flawed reasoning
- assumption: Unstated or questionable assumptions
- contradiction: Contradictory statements or positions
- inconsistency: Inconsistent arguments or claims

Please analyze and critique the following content:`;

const HACKERNEWS_PROMPT = `Please provide a synthesis of the most important, opinionated, and surprising feedback from the HackerNews comments below. Additionally, you should highlight visionary ideas, mentions of competitors, identified opportunities, and raised challenges from the comments. 

Your response should be detailed, structured, and actionable, including concrete examples from the comments to provide valuable context.

Structure your analysis as follows:
- **Key Opinions & Surprising Takes**: Most thought-provoking viewpoints
- **Visionary Ideas**: Forward-thinking concepts and predictions  
- **Competitive Landscape**: Mentions of competitors, alternatives, comparisons
- **Opportunities**: Business, technical, or strategic opportunities identified
- **Challenges & Concerns**: Major issues, risks, and obstacles raised
- **Actionable Insights**: Concrete takeaways and next steps

Don't add comments before and after your analysis.
Answer using the markdown format only, using #, ##, ### for headers.

Here are the HackerNews comments to analyze:`;

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

// Helper function to make API calls
async function makeApiCall(apiKey, prompt, isHackerNews) {
  let apiResponse;
  let analysisResult;
  let highlights = [];

  if (apiKey.startsWith('sk-ant-')) {
    // Claude API
    const requestBody = {
      model: 'claude-3-sonnet-20240229',
      max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
      messages: [{
        role: 'user',
        content: prompt
      }]
    };
    console.log('Claude API request:', requestBody);
    
    apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await apiResponse.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Store the raw response
    const rawResponse = data.content[0].text;
    
    if (isHackerNews) {
      analysisResult = rawResponse;
    } else {
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          analysisResult = result.analysis;
          highlights = result.highlights;
        } else {
          analysisResult = rawResponse;
        }
      } catch (e) {
        console.error('Failed to parse JSON response:', e);
        analysisResult = rawResponse;
      }
    }
    
    return { analysisResult, highlights, rawResponse };
    
  } else if (apiKey.startsWith('sk-')) {
    // OpenAI API
    const requestBody = {
      model: 'gpt-4.1',
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR
    };
    console.log('OpenAI API request:', requestBody);
    
    apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await apiResponse.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Store the raw response
    const rawResponse = data.choices[0].message.content;
    
    if (isHackerNews) {
      analysisResult = rawResponse;
    } else {
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          analysisResult = result.analysis;
          highlights = result.highlights;
        } else {
          analysisResult = rawResponse;
        }
      } catch (e) {
        console.error('Failed to parse JSON response:', e);
        analysisResult = rawResponse;
      }
    }
    
    return { analysisResult, highlights, rawResponse };
  }
  
  throw new Error('Invalid API key format');
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

async function analyzeContent() {
  // Get API key from storage first, then fallback to input
  const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
  const inputApiKey = document.getElementById('apiKey').value;
  const apiKey = storedApiKey || inputApiKey;
  
  if (!apiKey) {
    displayError('Please enter your API key');
    return;
  }
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    displayError('Unable to find active tab');
    return;
  }

  const urlKey = getUrlKey(tab.url);
  currentTabId = tab.id;
  isAnalyzing = true;
  
  // Save the API key if it's from input
  if (inputApiKey && inputApiKey !== storedApiKey) {
    saveApiKey();
  }
  
  setLoadingState(true);
  await updateAnalyzingState(urlKey, true, tab.id);
  
  try {
    // Get page content
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: Unable to get page content'));
      }, 5000);

      chrome.tabs.sendMessage(tab.id, { action: "getContent" }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error('Content script not ready. Please refresh the page.'));
          return;
        }
        resolve(response);
      });
    });

    if (!response || !response.content) {
      throw new Error('Unable to get page content');
    }

    // Filter out our own highlights from the content
    const cleanContent = filterHighlights(response.content);
    currentRawContent = cleanContent;
    
    // Update token info
    const tokenInfo = computeTokenInfo(cleanContent);
    document.getElementById('rawContentTokenInfo').textContent = tokenInfo.displayText;

    // Determine if we're on HackerNews
    const isHackerNews = tab.url.includes('news.ycombinator.com');
    
    // Choose prompt based on the URL
    const prompt = isHackerNews ? 
      HACKERNEWS_PROMPT + '\n\n' + cleanContent :
      CRITIC_PROMPT + '\n\n' + cleanContent;
    
    console.log('Using prompt for:', isHackerNews ? 'HackerNews' : 'Generic content');
    console.log('Token limits:', {
      isHackerNews,
      maxTokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
      contentLength: cleanContent.length,
      promptLength: prompt.length,
      estimatedTokens: Math.ceil(prompt.length / 4)
    });

    // Make API call
    const { analysisResult, highlights, rawResponse } = await makeApiCall(apiKey, prompt, isHackerNews);
    currentRawResponse = rawResponse;

    // Store results
    await storeAnalysisResults(urlKey, {
      content: cleanContent,
      title: response.title,
      url: response.url,
      analysis: analysisResult,
      rawResponse,
      highlights: isHackerNews ? [] : highlights,
      type: isHackerNews ? 'hackernews' : 'generic',
      tabId: tab.id
    });

    // Send highlights to content script only for non-HN content
    if (!isHackerNews && highlights.length > 0) {
      chrome.tabs.sendMessage(tab.id, {
        action: "highlightContent",
        highlights: highlights
      });
    }

    // Check if we're still on the same tab before displaying
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab.id === tab.id) {
      displayResult(analysisResult, response.title);
    }
    
  } catch (error) {
    await updateAnalyzingState(urlKey, false, tab.id);
    
    // Only display error if we're still on the same tab
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab.id === tab.id) {
      displayError('Error: ' + error.message);
    }
  } finally {
    // Only update UI state if we're still on the same tab
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab.id === tab.id) {
      isAnalyzing = false;
      setLoadingState(false);
    }
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

    // Handle both string and object responses
    if (typeof text === 'string') {
      // Pre-process markdown tables to ensure they're not split
      displayText = text.replace(/\|\n\|/g, '|\n|'); // Fix split table rows
      displayText = displayText.replace(/\n\s*\n\s*\|/g, '\n|'); // Remove extra newlines before table rows
      displayText = displayText.replace(/\|\s*\n\s*\n/g, '|\n'); // Remove extra newlines after table rows
    } else if (text && typeof text === 'object') {
      // Format the analysis object without the section titles
      let summary = text.summary || '';
      let critique = text.critique || '';
      
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

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // API Key Modal handling
  document.getElementById('apiKeyBtn').addEventListener('click', () => {
    const modal = document.getElementById('apiKeyModal');
    modal.classList.add('visible');
    // Load current API key if exists
    chrome.storage.local.get(['apiKey'], (result) => {
      if (result.apiKey) {
        document.getElementById('apiKey').value = result.apiKey;
        updateApiKeyStatus(result.apiKey);
      }
    });
  });

  document.getElementById('closeApiKeyBtn').addEventListener('click', () => {
    document.getElementById('apiKeyModal').classList.remove('visible');
  });

  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    saveApiKey();
    document.getElementById('apiKeyModal').classList.remove('visible');
  });

  // Raw Content Modal handling
  document.getElementById('rawContentBtn').addEventListener('click', () => {
    const modal = document.getElementById('rawContentModal');
    const textDiv = document.getElementById('rawContentText');
    const editDiv = document.getElementById('rawContentEdit');
    
    // Make sure we have content to show
    if (currentRawContent) {
      // Update token info
      const tokenInfo = document.getElementById('rawContentTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      
      // Set content and show text div
      textDiv.textContent = currentRawContent;
      textDiv.style.display = 'block';
      editDiv.style.display = 'none';
      
      // Show/hide appropriate buttons
      document.getElementById('saveContentBtn').style.display = 'none';
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('copyContentBtn').style.display = 'block';
    } else {
      textDiv.textContent = 'No content available';
      document.getElementById('copyContentBtn').style.display = 'none';
    }
    
    modal.classList.add('visible');
  });

  document.getElementById('closeRawContentBtn').addEventListener('click', () => {
    document.getElementById('rawContentModal').classList.remove('visible');
  });

  // Raw Response Modal handling
  document.getElementById('rawResponseBtn').addEventListener('click', () => {
    const modal = document.getElementById('rawResponseModal');
    const textDiv = document.getElementById('rawResponseText');
    
    if (currentRawResponse) {
      textDiv.textContent = currentRawResponse;
      const tokenInfo = document.getElementById('rawResponseTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawResponse).displayText;
    } else {
      textDiv.textContent = 'No raw response available. Please run an analysis first.';
    }
    
    modal.classList.add('visible');
  });

  document.getElementById('closeRawResponseBtn').addEventListener('click', () => {
    document.getElementById('rawResponseModal').classList.remove('visible');
  });

  // Analyze button
  document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);

  // API Key input handling
  document.getElementById('apiKey').addEventListener('input', (e) => {
    updateApiKeyStatus(e.target.value);
  });

  // Raw content edit handling
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

  // Save content handling
  document.getElementById('saveContentBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('rawContentTextarea');
    const newContent = textarea.value.trim();
    
    if (newContent) {
      currentRawContent = newContent;
      document.getElementById('rawContentText').textContent = newContent;
      document.getElementById('rawContentEdit').style.display = 'none';
      document.getElementById('rawContentText').style.display = 'block';
      document.getElementById('saveContentBtn').style.display = 'none';
      document.getElementById('cancelEditBtn').style.display = 'none';
      
      setLoadingState(true);
      
      try {
        const apiKey = document.getElementById('apiKey').value;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const urlKey = getUrlKey(tab.url);
        
        if (!tab) {
          throw new Error('No active tab found');
        }
        
        await updateAnalyzingState(urlKey, true, tab.id);
        
        // Choose prompt based on the URL
        const isHackerNews = tab.url.includes('news.ycombinator.com');
        const prompt = isHackerNews ? 
          HACKERNEWS_PROMPT + '\n\n' + newContent :
          CRITIC_PROMPT + '\n\n' + newContent;
        
        // Make API call
        const { analysisResult, highlights, rawResponse } = await makeApiCall(apiKey, prompt, isHackerNews);
        currentRawResponse = rawResponse;

        // Store results
        await storeAnalysisResults(urlKey, {
          content: newContent,
          title: tab.title,
          url: tab.url,
          analysis: analysisResult,
          rawResponse,
          highlights: isHackerNews ? [] : highlights,
          type: isHackerNews ? 'hackernews' : 'generic',
          tabId: tab.id
        });
        
        // Check if we're still on the same tab before displaying
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab.id === tab.id) {
          displayResult(analysisResult, tab.title);
        }
        
      } catch (error) {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab) {
          await updateAnalyzingState(getUrlKey(currentTab.url), false, currentTab.id);
          if (currentTab.id === tab.id) {
            displayError('Error reanalyzing: ' + error.message);
          }
        }
      } finally {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && currentTab.id === tab.id) {
          setLoadingState(false);
        }
      }
    }
  });

  // Cancel edit handling
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('rawContentEdit').style.display = 'none';
    document.getElementById('rawContentText').style.display = 'block';
    document.getElementById('saveContentBtn').style.display = 'none';
    document.getElementById('cancelEditBtn').style.display = 'none';
    document.getElementById('copyContentBtn').style.display = 'block';
  });

  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    const apiKeyModal = document.getElementById('apiKeyModal');
    const rawContentModal = document.getElementById('rawContentModal');
    const rawResponseModal = document.getElementById('rawResponseModal');
    
    if (e.target === apiKeyModal) {
      apiKeyModal.classList.remove('visible');
    }
    if (e.target === rawContentModal) {
      rawContentModal.classList.remove('visible');
    }
    if (e.target === rawResponseModal) {
      rawResponseModal.classList.remove('visible');
    }
  });

  // Reset tab button
  document.getElementById('resetTabBtn').addEventListener('click', resetTabState);

  // Initialize the extension
  initializeExtension();
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
      isAnalyzing: tabData?.isAnalyzing
    });
    
    // Sync UI state with the tab's analysis status
    await syncUIWithTabState(urlKey);
    
    // Only show stored analysis if we have analysis data
    if (tabData?.analysis) {
      console.log('Displaying stored analysis for URL:', tab.url);
      displayResult(tabData.analysis, tabData.title);
      // Store the raw content and response
      if (tabData.content) {
        currentRawContent = filterHighlights(tabData.content);
        const tokenInfo = document.getElementById('rawContentTokenInfo');
        tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      }
      if (tabData.rawResponse) {
        currentRawResponse = tabData.rawResponse;
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

// Initialize the extension and set up initial state
async function initializeExtension() {
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
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Replace the separate initialization calls with our new function
initializeExtension();

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

// Copy content button handling
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