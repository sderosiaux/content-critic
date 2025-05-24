// sidepanel.js
let contentType = 'generic';
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

const CRITIC_PROMPT = `You are a sharp, relentless content critic.
Your job is to break down any post, article, or idea I give you.

You do not summarize. You do not agree. You challenge.

You focus on:
- Uncovering assumptions (stated or hidden)
- Spotting contradictions or weak logic
- Testing ideas with second-order thinking, inversion, tradeoffs, and leverage analysis
- Surfacing what others miss: blind spots, sharper framings, edge opportunities

Ask hard questions like:
- What breaks this?
- What's assumed? What are the tradeoffs?
- What’s a better wedge or leverage?
- If this is true, what becomes the next constraint?

Tone:
- No fluff. No praise unless it serves the analysis. Stay curious, sharp, and bold. Push thinking further.

Output rules: return ONLY a valid JSON object like this:
{
  "analysis": {
    "summary": "A 5-10 rows table (Markdown format) summary highlighting core premise, risks, effects, and tradeoffs",
    "critique": "Your detailed analysis and critique in markdown format using #, ##, ### for headers."
  },
  "highlights": [
    {
      "text": "EXACT QUOTE FROM THE CONTENT - Copy and paste the exact text you want to highlight, word for word",
      "type": "fluff|fallacy|assumption|contradiction|inconsistency",
      "explanation": "Your analysis of why this text is problematic",
      "suggestion": "Optional suggestion for improvement"
    }
  ]
}

CRITICAL RULES:
1. Return ONLY the JSON object, with no other text
2. Do not include any markdown formatting outside of the JSON
3. Do not include any explanations or notes outside of the JSON
4. The JSON must be valid and complete
5. Each highlight's "text" field must be an exact quote from the content
6. Do not put your analysis in the "text" field - use the "explanation" field instead
7. Please generate minimum 5 and maximum 15 highlights. The more the better.
8. DO NOT wrap markdown tables or headers in \`\`\`markdown\`\`\` or any other code block markers
9. DO NOT USE ANY OTHER TYPE for HIGHLIGHTS. Only fluff|fallacy|assumption|contradiction|inconsistency are valid.

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
Each opinion should be a subtitle followed by some explanation.

Here are the HackerNews comments to analyze:`;

const TRANSLATION_PROMPT = `You are a translator. Return a JSON object of French translations.

FORMAT: {"t0":"translation0","t1":"translation1",...}

CRITICAL RULES:
1. Return ONLY a valid JSON object
2. Keep tech terms in English
3. Keep numbers/units unchanged
4. Remove unnecessary words only if that does not change the order of the translations
5. IMPORTANT: Each input key (t0, t1, etc.) MUST have exactly one translation
6. IMPORTANT: NEVER split a single input text into multiple translations
7. IMPORTANT: NEVER merge multiple input texts into one translation
8. IMPORTANT: Maintain the exact order of translations (t0, t1, t2, etc.)
9. IMPORTANT: Do not add or remove any keys
10. IMPORTANT: Each translation must be a complete, standalone translation of its input text
11. IMPORTANT: If an input text contains multiple sentences, keep them together in one translation

Example of CORRECT behavior:
Input: {"t0":"Hello world","t1":"API endpoint","t2":"Your enterprise data architecture is sprawling"}
Output: {"t0":"Bonjour le monde","t1":"API endpoint","t2":"Votre architecture de données d'entreprise est étendue"}

Example of INCORRECT behavior (DO NOT DO THIS):
Input: {"t0":"Your enterprise data architecture is sprawling"}
Output: {"t0":"Votre architecture de données","t1":"d'entreprise est étendue"}  // WRONG: split into two translations

Texts: `;

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

// Helper function to validate CRITIC response structure
function validateCriticResponse(result) {
  console.log('Validating CRITIC response:', result);
  
  // Check if result is an object
  if (!result || typeof result !== 'object') {
    throw new Error('Response must be a JSON object');
  }
  
  // Check if analysis exists and is an object
  if (!result.analysis || typeof result.analysis !== 'object') {
    throw new Error('Response must have an "analysis" object');
  }
  
  // Check if analysis has both summary and critique
  if (!result.analysis.summary || typeof result.analysis.summary !== 'string') {
    throw new Error('Analysis must have a "summary" string');
  }
  if (!result.analysis.critique || typeof result.analysis.critique !== 'string') {
    throw new Error('Analysis must have a "critique" string');
  }
  
  // Check if highlights exists and is an array
  if (!Array.isArray(result.highlights)) {
    throw new Error('Response must have a "highlights" array');
  }
  
  // Validate each highlight
  result.highlights.forEach((highlight, index) => {
    if (!highlight || typeof highlight !== 'object') {
      throw new Error(`Highlight at index ${index} must be an object`);
    }
    
    // Check required fields
    if (!highlight.text || typeof highlight.text !== 'string') {
      throw new Error(`Highlight at index ${index} must have a "text" string`);
    }
    if (!highlight.type || typeof highlight.type !== 'string') {
      throw new Error(`Highlight at index ${index} must have a "type" string`);
    }
    if (!highlight.explanation || typeof highlight.explanation !== 'string') {
      throw new Error(`Highlight at index ${index} must have an "explanation" string`);
    }
    
    // Validate type
    const validTypes = ['fluff', 'fallacy', 'assumption', 'contradiction', 'inconsistency'];
    if (!validTypes.includes(highlight.type)) {
      throw new Error(`Highlight at index ${index} has invalid type "${highlight.type}". Must be one of: ${validTypes.join(', ')}`);
    }
    
    // Validate suggestion (optional)
    if (highlight.suggestion !== undefined && typeof highlight.suggestion !== 'string') {
      throw new Error(`Highlight at index ${index} must have a "suggestion" string if provided`);
    }
  });
  
  // Validate highlight count
  if (result.highlights.length < 5) {
    throw new Error('Response must have at least 5 highlights');
  }
  if (result.highlights.length > 15) {
    throw new Error('Response must have at most 15 highlights');
  }
  
  console.log('CRITIC response validation passed');
  return true;
}

// Helper function to make API calls
async function makeApiCall(apiKey, prompt, isHackerNews) {
  let apiResponse;
  let analysisResult;
  let highlights = [];

  if (apiKey.startsWith('sk-ant-')) {
    // Claude API for analysis
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
          // Validate CRITIC response structure
          validateCriticResponse(result);
          // Store the complete result structure
          analysisResult = result;
          highlights = result.highlights;
        } else {
          throw new Error('No valid JSON object found in response');
        }
      } catch (e) {
        console.error('Failed to parse or validate JSON response:', e);
        throw new Error(`Invalid response format: ${e.message}`);
      }
    }
    
    return { analysisResult, highlights, rawResponse };
  } else if (apiKey.startsWith('sk-')) {
    // Determine which model to use based on the task
    const isTranslation = prompt.startsWith(TRANSLATION_PROMPT);
    console.log('Task detection:', { 
      isTranslation, 
      promptStart: prompt.substring(0, 50),
      translationPromptStart: TRANSLATION_PROMPT.substring(0, 50)
    });
    
    // DO NOT CHANGE THE MODELS USED HERE
    const model = isTranslation ? 'gpt-4.1-mini' : 'o4-mini'; // 'gpt-4o';
    const maxTokens = isTranslation ? MAX_TOKENS_TRANSLATION : (isHackerNews ? MAX_TOKENS_HACKERNEWS : MAX_TOKENS_REGULAR);
    
    // Prepare messages array
    const messages = isTranslation ? [
      {
        role: 'system',
        content: 'You are a translator. You MUST return a valid JSON object of translations. Do not include any other text in your response.'
      },
      {
        role: 'user',
        content: prompt
      }
    ] : [
      {
        role: 'user',
        content: prompt
      }
    ];
    
    const requestBody = {
      model: model,
      messages: messages,
      //max_tokens: maxTokens,
      //temperature: isTranslation ? 0.1 : 0.7,
      response_format: isTranslation ? { type: "json_object" } : undefined
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
    } else if (isTranslation) {
      // For translations, we expect a JSON object
      try {
        // Just parse the response directly
        const translations = JSON.parse(rawResponse);
        
        // Basic validation
        if (typeof translations !== 'object' || Array.isArray(translations)) {
          throw new Error('Response is not a JSON object');
        }
        
        // Filter out invalid translations
        const validTranslations = Object.entries(translations)
          .filter(([key, value]) => 
            key.startsWith('t') && 
            typeof value === 'string'
          )
          .map(([key, value]) => ({ [key]: value }));
        
        if (validTranslations.length === 0) {
          throw new Error('No valid translations found');
        }
        
        return { rawResponse: JSON.stringify(validTranslations) };
        
      } catch (e) {
        console.error('Failed to parse translation response:', e, 'Raw response:', rawResponse);
        throw new Error('Invalid translation response format - ' + e.message);
      }
    } else {
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          // Validate CRITIC response structure
          validateCriticResponse(result);
          // Store the complete result structure
          analysisResult = result;
          highlights = result.highlights;
        } else {
          throw new Error('No valid JSON object found in response');
        }
      } catch (e) {
        console.error('Failed to parse or validate JSON response:', e);
        throw new Error(`Invalid response format: ${e.message}`);
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the extension
  initializeExtension();

  // Add all event listeners
  document.getElementById('resetTabBtn').addEventListener('click', resetTabState);
  document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);
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

  document.getElementById('rawContentBtn').addEventListener('click', () => {
    const modal = document.getElementById('rawContentModal');
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
    
    modal.classList.add('visible');
  });

  document.getElementById('closeRawContentBtn').addEventListener('click', () => {
    document.getElementById('rawContentModal').classList.remove('visible');
  });

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
        
        const isHackerNews = tab.url.includes('news.ycombinator.com');
        const prompt = isHackerNews ? 
          HACKERNEWS_PROMPT + '\n\n' + newContent :
          CRITIC_PROMPT + '\n\n' + newContent;
        
        const { analysisResult, highlights, rawResponse } = await makeApiCall(apiKey, prompt, isHackerNews);
        currentRawResponse = rawResponse;

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

      // Restore highlights if we have them
      if (tabData.highlights && tabData.highlights.length > 0) {
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
    
    // Use the prompt from the constant
    const prompt = TRANSLATION_PROMPT + JSON.stringify(textNodes);

    console.log('Translation prompt:', {
      nodeCount: Object.keys(textNodes).length,
      sampleNodes: Object.values(textNodes).slice(0, 3),
      promptLength: prompt.length
    });
    
    try {
      const { rawResponse } = await makeApiCall(apiKey, prompt, false);
      
      console.log('Raw translation response:', rawResponse);
      
      // Parse the response with strict validation
      const parsed = JSON.parse(rawResponse);
      console.log('Parsed response:', parsed);
      
      // Handle both array of objects and direct object formats
      let translations = {};
      if (Array.isArray(parsed)) {
        // Convert array of objects to single object
        parsed.forEach(item => {
          const key = Object.keys(item)[0];
          if (key && key.startsWith('t')) {
            translations[key] = item[key];
          }
        });
      } else if (typeof parsed === 'object') {
        translations = parsed;
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
    addTranslationButton();
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