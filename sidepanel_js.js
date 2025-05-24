// sidepanel.js
let contentType = 'generic';
let currentTabId = null;

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
    "critique": "Your detailed analysis and critique in markdown format"
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
  const highlightPatterns = [
    /(?:Assumption|Fallacy|Contradiction|Inconsistency|Fluff)[\s\S]*?(?=Assumption|Fallacy|Contradiction|Inconsistency|Fluff|$)/gi,
    /SUGGESTION[\s\S]*?(?=Assumption|Fallacy|Contradiction|Inconsistency|Fluff|SUGGESTION|$)/gi
  ];
  
  let cleanContent = content;
  highlightPatterns.forEach(pattern => {
    cleanContent = cleanContent.replace(pattern, '');
  });
  
  // Clean up any extra whitespace created by the removal
  return cleanContent
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/^\s+|\s+$/g, ''); // Trim whitespace
}

// Analyse le contenu avec l'API
async function analyzeContent() {
  // Get API key from storage first, then fallback to input
  const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
  const inputApiKey = document.getElementById('apiKey').value;
  const apiKey = storedApiKey || inputApiKey;
  
  const resultDiv = document.getElementById('result');
  const analyzeBtn = document.getElementById('analyzeBtn');
  
  if (!apiKey) {
    resultDiv.innerHTML = '<div class="result error">Please enter your API key</div>';
    return;
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    resultDiv.innerHTML = '<div class="result error">Unable to find active tab</div>';
    return;
  }

  currentTabId = tab.id;
  
  // Save the API key if it's from input
  if (inputApiKey && inputApiKey !== storedApiKey) {
    saveApiKey();
  }
  
  // État de chargement
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  resultDiv.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>Analyzing content...</div>
    </div>`;
  
  try {
    // Vérifie si le content script est injecté
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (err) {
      // Le script est déjà injecté, on continue
    }

    // Récupère le contenu de la page active
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

    // Store the clean raw content without showing the modal
    currentRawContent = cleanContent;
    const tokenInfo = document.getElementById('rawContentTokenInfo');
    tokenInfo.textContent = computeTokenInfo(cleanContent).displayText;

    let apiResponse;
    let analysisResult;
    let highlights = [];
    
    // Determine if we're on HackerNews
    const isHackerNews = tab.url.includes('news.ycombinator.com');
    
    // Choose prompt based on the URL
    const prompt = isHackerNews ? 
      HACKERNEWS_PROMPT + '\n\n' + cleanContent :
      CRITIC_PROMPT + '\n\n' + cleanContent;
    
    console.log('Using prompt for:', isHackerNews ? 'HackerNews' : 'Generic content');
    
    // Détecte le type d'API basé sur la clé
    if (apiKey.startsWith('sk-ant-')) {
      // Claude API
      apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });
      
      const data = await apiResponse.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      // Store the raw response
      currentRawResponse = data.content[0].text;
      
      if (isHackerNews) {
        // For HackerNews, use the raw text response
        analysisResult = currentRawResponse;
      } else {
        // For generic content, try to parse JSON
        try {
          const responseText = data.content[0].text;
          // Try to find JSON in the response
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            analysisResult = result.analysis;
            highlights = result.highlights;
          } else {
            // If no JSON found, use the raw text
            analysisResult = responseText;
          }
        } catch (e) {
          console.error('Failed to parse JSON response:', e);
          analysisResult = data.content[0].text; // Fallback to raw text
        }
      }
      
    } else if (apiKey.startsWith('sk-')) {
      // OpenAI API
      apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          messages: [{
            role: 'user',
            content: prompt
          }],
          max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
        })
      });
      
      const data = await apiResponse.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      // Store the raw response
      currentRawResponse = data.choices[0].message.content;
      
      if (isHackerNews) {
        // For HackerNews, use the raw text response
        analysisResult = currentRawResponse;
      } else {
        // For generic content, try to parse JSON
        try {
          const responseText = data.choices[0].message.content;
          // Try to find JSON in the response
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            analysisResult = result.analysis;
            highlights = result.highlights;
          } else {
            // If no JSON found, use the raw text
            analysisResult = responseText;
          }
        } catch (e) {
          console.error('Failed to parse JSON response:', e);
          analysisResult = data.choices[0].message.content; // Fallback to raw text
        }
      }
    }

    // Store the analysis result for this tab
    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    tabResults[tab.id] = {
      content: cleanContent,
      title: response.title,
      url: response.url,
      analysis: analysisResult,
      rawResponse: currentRawResponse,
      highlights: isHackerNews ? [] : highlights,
      timestamp: Date.now(),
      type: isHackerNews ? 'hackernews' : 'generic'
    };
    await chrome.storage.local.set({ tabResults });

    // Send highlights to content script only for non-HN content
    if (!isHackerNews && highlights.length > 0) {
      chrome.tabs.sendMessage(tab.id, {
        action: "highlightContent",
        highlights: highlights
      });
    }

    // Display the analysis
    displayResult(analysisResult, response.title);
    
  } catch (error) {
    displayError('Error: ' + error.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
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
      
      // Hide edit buttons
      document.getElementById('saveContentBtn').style.display = 'none';
      document.getElementById('cancelEditBtn').style.display = 'none';
    } else {
      textDiv.textContent = 'No content available';
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
    
    textarea.value = currentRawContent;
    textDiv.style.display = 'none';
    editDiv.style.display = 'block';
    saveBtn.style.display = 'block';
    cancelBtn.style.display = 'block';
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
      
      // Reanalyze with new content
      const analyzeBtn = document.getElementById('analyzeBtn');
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Reanalyzing...';
      
      try {
        const apiKey = document.getElementById('apiKey').value;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
          throw new Error('No active tab found');
        }
        
        // Choose prompt based on the URL
        const isHackerNews = tab.url.includes('news.ycombinator.com');
        const prompt = isHackerNews ? 
          HACKERNEWS_PROMPT + '\n\n' + newContent :
          CRITIC_PROMPT + '\n\n' + newContent;
        
        let analysisResult;
        
        if (apiKey.startsWith('sk-ant-')) {
          // Claude API
          const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: 'claude-3-sonnet-20240229',
              max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
              messages: [{
                role: 'user',
                content: prompt
              }]
            })
          });
          
          const data = await apiResponse.json();
          if (data.error) throw new Error(data.error.message);
          analysisResult = data.content[0].text;
          
        } else if (apiKey.startsWith('sk-')) {
          // OpenAI API
          const apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4.1',
              messages: [{
                role: 'user',
                content: prompt
              }],
              max_tokens: isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR,
            })
          });
          
          const data = await apiResponse.json();
          if (data.error) throw new Error(data.error.message);
          analysisResult = data.choices[0].message.content;
        }
        
        // Store the analysis result
        const { tabResults = {} } = await chrome.storage.local.get('tabResults');
        tabResults[tab.id] = {
          content: newContent,
          title: tab.title,
          url: tab.url,
          analysis: analysisResult,
          rawResponse: currentRawResponse,
          timestamp: Date.now(),
          type: isHackerNews ? 'hackernews' : 'generic'
        };
        await chrome.storage.local.set({ tabResults });
        
        displayResult(analysisResult, tab.title);
        
      } catch (error) {
        displayError('Error reanalyzing: ' + error.message);
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze';
      }
    }
  });

  // Cancel edit handling
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('rawContentEdit').style.display = 'none';
    document.getElementById('rawContentText').style.display = 'block';
    document.getElementById('saveContentBtn').style.display = 'none';
    document.getElementById('cancelEditBtn').style.display = 'none';
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
      return;
    }
    
    // Clear current result and load stored analysis
    document.getElementById('result').innerHTML = '';
    await loadStoredAnalysis(activeInfo.tabId);
  } catch (error) {
    console.error('Error handling tab activation:', error);
    document.getElementById('result').innerHTML = '';
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
        return;
      }
      
      // Clear the current result since we're on a new page
      document.getElementById('result').innerHTML = '';
      // Try to load any existing analysis for this URL
      await loadStoredAnalysis(tabId);
    } catch (error) {
      console.error('Error handling tab update:', error);
      document.getElementById('result').innerHTML = '';
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

// Modify loadStoredAnalysis to use computeTokenInfo
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
      return;
    }

    const storage = await chrome.storage.local.get('tabResults');
    console.log('All stored results:', storage.tabResults);
    
    if (!storage || !storage.tabResults) {
      console.log('No tabResults found in storage');
      document.getElementById('result').innerHTML = '';
      return;
    }

    const tabData = storage.tabResults[tabId];
    console.log('Found tab data:', { 
      tabId, 
      currentUrl: tab.url, 
      storedUrl: tabData?.url,
      hasAnalysis: !!tabData?.analysis 
    });
    
    // Only show stored analysis if the URL matches and we have analysis data
    if (tabData?.analysis && tabData?.url === tab.url) {
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
        hasAnalysis: !!tabData?.analysis,
        urlMatch: tabData?.url === tab.url
      });
      document.getElementById('result').innerHTML = '';
      currentRawContent = null;
    }
  } catch (error) {
    console.error('Error loading stored analysis:', error);
    document.getElementById('result').innerHTML = '';
    currentRawContent = null;
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
    Object.entries(tabResults).forEach(([tabId, data]) => {
      if (data.timestamp && (now - data.timestamp) < ONE_WEEK_MS) {
        cleanedResults[tabId] = data;
      } else {
        cleanedCount++;
      }
    });
    
    // Only update storage if we actually cleaned something
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old tab results`);
      await chrome.storage.local.set({ tabResults: cleanedResults });
    }
  } catch (error) {
    console.error('Error cleaning up old tab results:', error);
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