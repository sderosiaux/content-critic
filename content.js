// content.js
(function() {
  // Check if we're already initialized
  if (window.contentCriticInitialized) {
    console.log('Content Critic: Already initialized, skipping');
    return;
  }
  window.contentCriticInitialized = true;

  console.log('Content Critic: Content script chargé');

  // Add global styles for highlights
  const style = document.createElement('style');
  style.textContent = `
    .content-critic-highlight {
      position: relative;
      padding: 2px 0;
      border-radius: 2px;
      transition: background-color 0.2s;
      display: inline !important;
      background-color: rgba(255, 193, 7, 0.2) !important;
      text-decoration: underline wavy !important;
      cursor: help !important;
    }
    
    .content-critic-highlight:hover {
      filter: brightness(0.95) !important;
    }
    
    .content-critic-highlight.fluff {
      background-color: rgba(255, 193, 7, 0.2) !important;
      text-decoration-color: #ffc107 !important;
      border-bottom: 2px solid #ffc107 !important;
    }
    
    .content-critic-highlight.fallacy {
      background-color: rgba(220, 53, 69, 0.15) !important;
      text-decoration-color: #dc3545 !important;
      border-bottom: 2px solid #dc3545 !important;
    }
    
    .content-critic-highlight.assumption {
      background-color: rgba(13, 202, 240, 0.15) !important;
      text-decoration-color: #0dcaf0 !important;
      border-bottom: 2px solid #0dcaf0 !important;
    }
    
    .content-critic-highlight.contradiction {
      background-color: rgba(108, 117, 125, 0.15) !important;
      text-decoration-color: #6c757d !important;
      border-bottom: 2px solid #6c757d !important;
    }
    
    .content-critic-highlight.inconsistency {
      background-color: rgba(220, 53, 69, 0.15) !important;
      text-decoration-color: #dc3545 !important;
      border-bottom: 2px solid #dc3545 !important;
    }
    
    .content-critic-tooltip {
      position: fixed;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 2147483647;
      max-width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: none;
      margin: 0;
      transform: none;
    }
    
    .content-critic-tooltip.visible {
      opacity: 1;
    }

    .content-critic-type {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .content-critic-type.fluff {
      background-color: #fff3cd;
      color: #856404;
    }

    .content-critic-type.fallacy {
      background-color: #f8d7da;
      color: #721c24;
    }

    .content-critic-type.assumption {
      background-color: #d1ecf1;
      color: #0c5460;
    }

    .content-critic-type.contradiction {
      background-color: #e2e3e5;
      color: #383d41;
    }

    .content-critic-type.inconsistency {
      background-color: #f8d7da;
      color: #721c24;
    }

    .content-critic-explanation {
      margin-bottom: 12px;
      line-height: 1.5;
    }

    .content-critic-suggestion {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #eee;
    }

    .content-critic-suggestion-label {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .content-critic-suggestion-text {
      color: #666;
      font-style: italic;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);

  // Function to position tooltip
  function positionTooltip(tooltip, highlightRect) {
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Default position (below the highlight)
    let top = highlightRect.bottom + 5;
    let left = highlightRect.left;
    
    // If tooltip would go below viewport, position it above
    if (top + tooltipRect.height > viewportHeight) {
      top = highlightRect.top - tooltipRect.height - 5;
    }
    
    // If tooltip would go beyond right edge, align with right edge of highlight
    if (left + tooltipRect.width > viewportWidth) {
      left = highlightRect.right - tooltipRect.width;
    }
    
    // Ensure tooltip stays within viewport
    top = Math.max(5, Math.min(top, viewportHeight - tooltipRect.height - 5));
    left = Math.max(5, Math.min(left, viewportWidth - tooltipRect.width - 5));
    
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  // Create tooltip element
  function createTooltip(text, type, explanation, suggestion) {
    const tooltip = document.createElement('div');
    tooltip.className = 'content-critic-tooltip';
    
    // Type badge
    const typeBadge = document.createElement('div');
    typeBadge.className = `content-critic-type ${type}`;
    typeBadge.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    
    // Explanation
    const explanationText = document.createElement('div');
    explanationText.className = 'content-critic-explanation';
    explanationText.textContent = explanation;
    
    // Add elements in order
    tooltip.appendChild(typeBadge);
    tooltip.appendChild(explanationText);
    
    // Suggestion (if any)
    if (suggestion) {
      const suggestionContainer = document.createElement('div');
      suggestionContainer.className = 'content-critic-suggestion';
      
      const suggestionLabel = document.createElement('div');
      suggestionLabel.className = 'content-critic-suggestion-label';
      suggestionLabel.textContent = 'Suggestion';
      
      const suggestionText = document.createElement('div');
      suggestionText.className = 'content-critic-suggestion-text';
      suggestionText.textContent = suggestion;
      
      suggestionContainer.appendChild(suggestionLabel);
      suggestionContainer.appendChild(suggestionText);
      tooltip.appendChild(suggestionContainer);
    }
    
    // Add to body and position off-screen initially
    tooltip.style.top = '-9999px';
    tooltip.style.left = '-9999px';
    document.body.appendChild(tooltip);
    
    return tooltip;
  }

  // Highlight text in the page
  function highlightText(text, type, explanation, suggestion) {
    console.log('Highlighting text:', { 
      text: text.substring(0, 50) + '...',
      type,
      explanation,
      suggestion
    });
    
    // Create a single tooltip for this highlight
    const tooltip = createTooltip(text, type, explanation, suggestion);
    let highlightCount = 0;
    let nodesChecked = 0;
    
    // Function to process a text node
    function processTextNode(node) {
      nodesChecked++;
      const nodeText = node.textContent;
      if (!nodeText.includes(text)) return false;
      
      console.log('Found matching text in node:', {
        nodeText: nodeText.substring(0, 50) + '...',
        searchText: text,
        parentTag: node.parentElement.tagName,
        parentClass: node.parentElement.className,
        nodePath: getNodePath(node)
      });
      
      const parts = nodeText.split(text);
      const fragment = document.createDocumentFragment();
      
      parts.forEach((part, i) => {
        if (part) fragment.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) {
          const span = document.createElement('span');
          span.className = `content-critic-highlight ${type}`;
          span.textContent = text;
          
          // Add tooltip behavior with simplified positioning
          span.addEventListener('mouseenter', (e) => {
            const rect = span.getBoundingClientRect();
            positionTooltip(tooltip, rect);
            tooltip.classList.add('visible');
          });
          
          span.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
          });
          
          fragment.appendChild(span);
          highlightCount++;
        }
      });
      
      node.parentNode.replaceChild(fragment, node);
      return true;
    }
    
    // Helper function to get node path for debugging
    function getNodePath(node) {
      const path = [];
      let current = node;
      while (current && current.parentElement) {
        const tag = current.parentElement.tagName.toLowerCase();
        const id = current.parentElement.id ? `#${current.parentElement.id}` : '';
        const classes = Array.from(current.parentElement.classList).map(c => `.${c}`).join('');
        path.unshift(`${tag}${id}${classes}`);
        current = current.parentElement;
      }
      return path.join(' > ');
    }
    
    // Walk through all text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Skip if parent is already highlighted or is a script/style
          if (node.parentElement.closest('.content-critic-highlight') ||
              node.parentElement.closest('script') ||
              node.parentElement.closest('style') ||
              node.parentElement.closest('noscript')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      processTextNode(node);
    }
    
    console.log(`Highlighting complete:`, {
      text: text.substring(0, 50) + '...',
      nodesChecked,
      highlightsAdded: highlightCount,
      highlightType: type
    });
    
    if (highlightCount === 0) {
      console.warn('No highlights were added. This might indicate a problem with text matching or DOM structure.');
    }
  }

  // Remove all highlights
  function removeHighlights() {
    document.querySelectorAll('.content-critic-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
    });
    document.querySelectorAll('.content-critic-tooltip').forEach(el => el.remove());
  }

  // Fonction pour extraire le contenu
  function extractContent() {
    console.log('Content Critic: Début de l\'extraction du contenu');
    
    // Récupère le contenu de la page
    const content = document.body.innerText;
    const title = document.title;
    const url = window.location.href;
    
    console.log('Content Critic: Contenu extrait:', {
      title,
      url,
      contentLength: content.length,
      contentPreview: content.substring(0, 100) + '...'
    });
    
    return { content, title, url };
  }

  // Function to load highlights from tabResults
  async function loadTabHighlights() {
    try {
      const currentUrl = window.location.href;
      console.log('Loading highlights for URL:', currentUrl);
      
      const { tabResults = {} } = await chrome.storage.local.get('tabResults');
      console.log('All tab results:', Object.entries(tabResults).map(([key, data]) => ({
        url: data.url,
        type: data.type,
        hasHighlights: !!data.highlights,
        highlightCount: data.highlights?.length
      })));
      
      // Find matching tab data
      const matchingTab = Object.entries(tabResults).find(([_, data]) => 
        data.url === currentUrl || 
        (data.url && currentUrl.startsWith(data.url))
      );
      
      if (matchingTab) {
        const [tabId, data] = matchingTab;
        console.log('Found stored data for tab:', {
          tabId,
          url: data.url,
          type: data.type,
          hasHighlights: !!data.highlights,
          highlightCount: data.highlights?.length,
          highlights: data.highlights // Log the actual highlights array
        });
        
        // Only process highlights for non-HackerNews content
        if (data.type !== 'hackernews' && data.highlights && data.highlights.length > 0) {
          // Remove any existing highlights first
          removeHighlights();
          console.log('Removed existing highlights');
          
          // Apply the stored highlights
          data.highlights.forEach((h, index) => {
            console.log(`Applying highlight ${index + 1}/${data.highlights.length}:`, {
              text: h.text.substring(0, 50) + '...',
              type: h.type,
              explanation: h.explanation,
              suggestion: h.suggestion
            });
            highlightText(h.text, h.type, h.explanation, h.suggestion);
          });
          console.log(`Applied ${data.highlights.length} highlights from tab ${tabId}`);
        } else {
          console.log('No highlights to apply. Details:', {
            isHackerNews: data.type === 'hackernews',
            hasHighlights: !!data.highlights,
            highlightCount: data.highlights?.length,
            type: data.type
          });
        }
      } else {
        console.log('No matching tab found for URL:', currentUrl);
        console.log('Current URL:', currentUrl);
        console.log('Available URLs:', Object.values(tabResults).map(d => d.url));
      }
    } catch (error) {
      console.error('Error loading tab highlights:', error);
    }
  }

  // Initialize: load highlights from tabResults
  async function initialize() {
    // Wait for the page to be fully loaded
    if (document.readyState === 'complete') {
      await loadTabHighlights();
    } else {
      window.addEventListener('load', loadTabHighlights);
    }
  }

  // Écoute les messages du background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content Critic: Message reçu:', request);
    
    if (request.action === 'getContent') {
      console.log('Content Critic: Récupération du contenu demandée');
      const { content, title, url } = extractContent();
      sendResponse({ content, title, url });
    } else if (request.action === 'highlightContent') {
      console.log('Content Critic: Highlighting content');
      // Remove any existing highlights first
      removeHighlights();
      // Add new highlights
      request.highlights.forEach(h => {
        highlightText(h.text, h.type, h.explanation, h.suggestion);
      });
      sendResponse({ success: true });
    } else if (request.action === 'extractContent') {
      console.log('Content Critic: Début de l\'extraction');
      const data = extractContent();
      chrome.runtime.sendMessage({
        action: 'contentExtracted',
        ...data,
        type: 'generic'
      }, (response) => {
        console.log('Content Critic: Réponse du background script:', response);
      });
      sendResponse({ success: true });
    }
    
    return true; // Important pour garder la connexion ouverte
  });

  // Start initialization
  initialize();
})();