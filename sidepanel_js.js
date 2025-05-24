// sidepanel.js
let contentType = 'generic';
let currentTabId = null;

// Raw content handling
let currentRawContent = null;

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
    "summary": "A 5-10 rows table summary highlighting core premise, risks, effects, and tradeoffs",
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

// Analyse le contenu avec l'API
async function analyzeContent() {
  const apiKey = document.getElementById('apiKey').value;
  const resultDiv = document.getElementById('result');
  const analyzeBtn = document.getElementById('analyzeBtn');
  
  if (!apiKey) {
    resultDiv.innerHTML = '<div class="result error">Veuillez entrer votre clé API</div>';
    return;
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    resultDiv.innerHTML = '<div class="result error">Impossible de trouver l\'onglet actif</div>';
    return;
  }

  currentTabId = tab.id;
  
  // Sauvegarde la clé API
  saveApiKey();
  
  // État de chargement
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyse en cours...';
  resultDiv.innerHTML = '<div class="loading">Analyse du contenu</div>';
  
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
        reject(new Error('Timeout: Impossible de récupérer le contenu de la page'));
      }, 5000);

      chrome.tabs.sendMessage(tab.id, { action: "getContent" }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error('Le content script n\'est pas prêt. Veuillez rafraîchir la page.'));
          return;
        }
        resolve(response);
      });
    });

    if (!response || !response.content) {
      throw new Error('Impossible de récupérer le contenu de la page');
    }

    // Show the raw content
    showRawContent(response.content);

    let apiResponse;
    let analysisResult;
    let highlights = [];
    
    // Determine if we're on HackerNews
    const isHackerNews = tab.url.includes('news.ycombinator.com');
    
    // Choose prompt based on the URL
    const prompt = isHackerNews ? 
      HACKERNEWS_PROMPT + '\n\n' + response.content :
      CRITIC_PROMPT + '\n\n' + response.content;
    
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
          max_tokens: 4000,
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
      
      if (isHackerNews) {
        // For HackerNews, use the raw text response
        analysisResult = data.content[0].text;
      } else {
        // For generic content, try to parse JSON
        try {
          const result = JSON.parse(data.content[0].text);
          analysisResult = result.analysis;
          highlights = result.highlights;
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
          max_tokens: 4000,
        })
      });
      
      const data = await apiResponse.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      if (isHackerNews) {
        // For HackerNews, use the raw text response
        analysisResult = data.choices[0].message.content;
      } else {
        // For generic content, try to parse JSON
        try {
          const result = JSON.parse(data.choices[0].message.content);
          analysisResult = result.analysis;
          highlights = result.highlights;
        } catch (e) {
          console.error('Failed to parse JSON response:', e);
          analysisResult = data.choices[0].message.content; // Fallback to raw text
        }
      }
    }

    // Store the analysis result for this tab
    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    tabResults[tab.id] = {
      content: response.content,
      title: response.title,
      url: response.url,
      analysis: analysisResult,
      highlights: isHackerNews ? [] : highlights, // Only store highlights for non-HN content
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
    displayError('Erreur: ' + error.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

function displayResult(text, title = '') {
  const resultDiv = document.getElementById('result');
  try {
    let displayText;
    let htmlContent;

    // Handle both string and object responses
    if (typeof text === 'string') {
      displayText = text;
    } else if (text && typeof text === 'object') {
      // Format the analysis object
      displayText = `## Summary\n${text.summary}\n\n## Analysis\n${text.critique}`;
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
  } catch (error) {
    console.error('Error parsing markdown:', error);
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
document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);
document.getElementById('apiKey').addEventListener('change', saveApiKey);

// API Key section handling
function updateApiKeyStatus(apiKey) {
  const statusElement = document.getElementById('apiKeyStatus');
  const toggleButton = document.getElementById('apiKeyToggle');
  
  if (apiKey) {
    // Validate API key format
    const isValid = apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant-');
    statusElement.textContent = isValid ? 'Configured' : 'Invalid format';
    statusElement.className = `api-key-status ${isValid ? 'valid' : ''}`;
    
    // Show the toggle button and collapse the content by default
    toggleButton.style.display = 'block';
    document.getElementById('apiKeyContent').classList.add('collapsed');
    toggleButton.textContent = 'Show';
  } else {
    statusElement.textContent = 'Not configured';
    statusElement.className = 'api-key-status';
    toggleButton.style.display = 'none';
    document.getElementById('apiKeyContent').classList.remove('collapsed');
  }
}

// Toggle API key section
document.getElementById('apiKeyHeader').addEventListener('click', (e) => {
  // Don't toggle if clicking the input
  if (e.target.tagName === 'INPUT') return;
  
  const content = document.getElementById('apiKeyContent');
  const toggleButton = document.getElementById('apiKeyToggle');
  
  content.classList.toggle('collapsed');
  toggleButton.textContent = content.classList.contains('collapsed') ? 'Show' : 'Hide';
});

// Update API key status when input changes
document.getElementById('apiKey').addEventListener('input', (e) => {
  updateApiKeyStatus(e.target.value);
});

// Load API key and update status on startup
chrome.storage.local.get(['apiKey'], (result) => {
  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
    updateApiKeyStatus(result.apiKey);
  } else {
    updateApiKeyStatus(null);
  }
});

// Listen for tab changes and update the panel
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('Tab activated:', activeInfo);
  try {
    currentTabId = activeInfo.tabId;
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log('Current tab info:', tab);
    
    if (!tab.url || !tab.url.startsWith('http')) {
      console.log('Not a valid web page, clearing results');
      document.getElementById('result').innerHTML = '';
      return;
    }
    
    await loadStoredAnalysis(activeInfo.tabId);
  } catch (error) {
    console.error('Error handling tab activation:', error);
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
    }
  }
});

// Modify loadStoredAnalysis to handle URL changes
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
    
    // Only show stored analysis if the URL matches
    if (tabData && tabData.analysis && tabData.url === tab.url) {
      console.log('Displaying stored analysis for URL:', tab.url);
      displayResult(tabData.analysis, tabData.title);
      // Show the stored raw content
      if (tabData.content) {
        showRawContent(tabData.content);
      }
    } else {
      console.log('No matching analysis found:', {
        hasTabData: !!tabData,
        hasAnalysis: !!tabData?.analysis,
        urlMatch: tabData?.url === tab.url
      });
      document.getElementById('result').innerHTML = '';
    }
  } catch (error) {
    console.error('Error loading stored analysis:', error);
    document.getElementById('result').innerHTML = '';
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

function showRawContent(content) {
  const section = document.getElementById('rawContentSection');
  const textDiv = document.getElementById('rawContentText');
  const editDiv = document.getElementById('rawContentEdit');
  const toggleBtn = document.getElementById('rawContentToggle');
  
  // Estimate token count (rough approximation)
  const charCount = content.length;
  const wordCount = content.trim().split(/\s+/).length;
  const estimatedTokens = Math.ceil(charCount / 4); // Rough estimate: ~4 chars per token
  
  // Add token info to the header
  const header = document.getElementById('rawContentHeader');
  const tokenInfo = document.createElement('div');
  tokenInfo.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-top: 4px;
    font-family: monospace;
  `;
  tokenInfo.textContent = `≈ ${estimatedTokens.toLocaleString()} tokens (${wordCount.toLocaleString()} words, ${charCount.toLocaleString()} chars)`;
  
  // Remove any existing token info
  const existingInfo = header.querySelector('.token-info');
  if (existingInfo) {
    existingInfo.remove();
  }
  
  tokenInfo.className = 'token-info';
  header.appendChild(tokenInfo);
  
  currentRawContent = content;
  textDiv.textContent = content;
  section.style.display = 'block';
  editDiv.style.display = 'none';
  toggleBtn.textContent = 'Show';
  document.getElementById('rawContentContent').classList.add('collapsed');
}

// Toggle raw content section
document.getElementById('rawContentToggle').addEventListener('click', (e) => {
  e.stopPropagation(); // Prevent event from bubbling up
  const content = document.getElementById('rawContentContent');
  const toggleBtn = e.target;
  
  content.classList.toggle('collapsed');
  toggleBtn.textContent = content.classList.contains('collapsed') ? 'Show' : 'Hide';
});

// Handle header click separately
document.getElementById('rawContentHeader').addEventListener('click', (e) => {
  // Don't toggle if clicking the button (it has its own handler)
  if (e.target.tagName === 'BUTTON') return;
  
  const content = document.getElementById('rawContentContent');
  const toggleBtn = document.getElementById('rawContentToggle');
  
  content.classList.toggle('collapsed');
  toggleBtn.textContent = content.classList.contains('collapsed') ? 'Show' : 'Hide';
});

// Edit raw content
document.getElementById('rawContentText').addEventListener('dblclick', () => {
  const textDiv = document.getElementById('rawContentText');
  const editDiv = document.getElementById('rawContentEdit');
  const textarea = document.getElementById('rawContentTextarea');
  
  textarea.value = currentRawContent;
  textDiv.style.display = 'none';
  editDiv.style.display = 'block';
  textarea.focus();
});

// Save edited content
document.getElementById('saveContentBtn').addEventListener('click', async () => {
  const textarea = document.getElementById('rawContentTextarea');
  const newContent = textarea.value.trim();
  
  if (newContent) {
    currentRawContent = newContent;
    document.getElementById('rawContentText').textContent = newContent;
    document.getElementById('rawContentEdit').style.display = 'none';
    document.getElementById('rawContentText').style.display = 'block';
    
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
            max_tokens: 4000,
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
            max_tokens: 4000,
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

// Cancel editing
document.getElementById('cancelEditBtn').addEventListener('click', () => {
  document.getElementById('rawContentEdit').style.display = 'none';
  document.getElementById('rawContentText').style.display = 'block';
});