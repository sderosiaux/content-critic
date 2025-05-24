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
    
    // Function to normalize text (remove extra spaces and HTML tags)
    function normalizeText(str) {
      return str.replace(/<[^>]*>/g, '') // Remove HTML tags
                .replace(/\s+/g, ' ')     // Normalize spaces
                .trim();                  // Trim whitespace
    }
    
    // Get all text nodes in the page
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Skip if parent is a script/style
          if (node.parentElement.closest('script') ||
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
      textNodes.push(node);
    }
    
    // Find blocks that contain our text
    const searchText = normalizeText(text);
    console.log('Searching for text to highlight:', {
      text,
      normalized: searchText
    });
    
    // Group text nodes by their block parent
    const blocks = new Map();
    for (const node of textNodes) {
      const block = node.parentElement.closest('p, div, article, section, main, aside, nav, header, footer, li, td, th, h1, h2, h3, h4, h5, h6');
      if (!block) continue;
      
      // Skip blocks that are already fully highlighted
      if (block.textContent === text) continue;
      
      const blockText = normalizeText(block.textContent);
      if (blockText.includes(searchText)) {
        console.log('Found matching block:', {
          text: blockText,
          contains: true
        });
      }
      
      if (!blocks.has(block)) {
        blocks.set(block, []);
      }
      blocks.get(block).push(node);
    }
    
    // Process each block
    for (const [block, nodes] of blocks) {
      // Get the full text of the block
      const blockText = normalizeText(block.textContent);
      if (!blockText.includes(searchText)) continue;
      
      // Find the nodes that contain our text
      let startNode = null;
      let endNode = null;
      let currentText = '';
      
      // First pass: collect all text nodes and their text
      const nodeTexts = nodes.map(node => ({
        node,
        text: normalizeText(node.textContent)
      }));
      
      // Second pass: find start and end nodes
      for (let i = 0; i < nodeTexts.length; i++) {
        currentText += nodeTexts[i].text + ' ';
        const normalizedCurrent = normalizeText(currentText);
        
        // Find start node
        if (!startNode && normalizedCurrent.includes(searchText)) {
          startNode = nodeTexts[i].node;
        }
        
        // Find end node
        if (startNode && !endNode) {
          // If we've found the start, look for where the text ends
          const startPos = normalizedCurrent.indexOf(searchText);
          if (startPos !== -1) {
            // Find the node that contains the end of our search text
            let accumulatedLength = 0;
            for (let j = 0; j <= i; j++) {
              accumulatedLength += nodeTexts[j].text.length + 1; // +1 for the space we added
              if (accumulatedLength >= startPos + searchText.length) {
                endNode = nodeTexts[j].node;
                break;
              }
            }
          }
        }
        
        if (startNode && endNode) break;
      }
      
      if (!startNode || !endNode) continue;
      
      // Create highlight spans
      const fragment = document.createDocumentFragment();
      let isHighlighting = false;
      
      for (const node of nodes) {
        // Skip if node is already highlighted
        if (node.parentElement.classList.contains('content-critic-highlight')) {
          fragment.appendChild(node.parentElement.cloneNode(true));
          continue;
        }
        
        if (node === startNode) {
          isHighlighting = true;
          const span = document.createElement('span');
          span.className = `content-critic-highlight ${type}`;
          span.textContent = node.textContent;
          
          // Add tooltip behavior
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
        } else if (node === endNode) {
          const span = document.createElement('span');
          span.className = `content-critic-highlight ${type}`;
          span.textContent = node.textContent;
          
          // Add tooltip behavior
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
          isHighlighting = false;
        } else if (isHighlighting) {
          const span = document.createElement('span');
          span.className = `content-critic-highlight ${type}`;
          span.textContent = node.textContent;
          
          // Add tooltip behavior
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
        } else {
          fragment.appendChild(document.createTextNode(node.textContent));
        }
      }
      
      // Replace block content with our fragment
      block.innerHTML = '';
      block.appendChild(fragment);
    }
    
    console.log(`Highlighting complete:`, {
      text: text.substring(0, 50) + '...',
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

  // Translation state
  let translatedNodes = new Map(); // Map of ID -> {node, originalText, parentElement}

  // Add message handlers for translation
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content Critic: Message reçu:', request);
    
    if (request.action === 'ping') {
      // Simple ping to check if content script is ready
      sendResponse({ status: 'ready' });
      return true;
    } else if (request.action === 'getContent') {
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
    } else if (request.action === 'collectTextNodes') {
      // Collect visible text nodes
      const nodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            // Skip if parent matches skipSelectors or is not valid
            if (!node.parentElement || 
                node.parentElement.closest(request.options.skipSelectors) ||
                !isNodeVisible(node)) {
              return NodeFilter.FILTER_REJECT;
            }
            
            // Don't trim here to preserve whitespace
            const text = node.textContent;
            if (text && text.length >= request.options.minLength) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        },
        false
      );
      
      let node;
      let nodeId = 0;
      while (node = walker.nextNode()) {
        const text = node.textContent;
        // Skip nodes that are only whitespace
        if (!text || /^\s*$/.test(text)) continue;
        
        // Use shorter ID format: t0, t1, t2, etc.
        const id = `t${nodeId++}`;
        nodes.push({
          id,
          t: text // Store the text with original whitespace
        });
        
        // Store reference to node and its parent
        translatedNodes.set(id, {
          node,
          originalText: text, // Store original text with whitespace
          parentElement: node.parentElement
        });
      }
      
      console.log('Collected nodes for translation:', {
        count: nodes.length,
        sample: nodes.slice(0, 3).map(n => ({
          id: n.id,
          text: n.t.replace(/\n/g, '\\n').replace(/\s/g, '·') // Visualize whitespace
        }))
      });
      
      sendResponse({ nodes });
      
    } else if (request.action === 'applyTranslations') {
      // Sort translations by numeric key to ensure order (t0, t1, t2, etc.)
      const sortedTranslations = request.translations.sort((a, b) => {
        const numA = parseInt(a.id.substring(1));
        const numB = parseInt(b.id.substring(1));
        return numA - numB;
      });

      // Apply translations in order
      sortedTranslations.forEach(({ id, t }) => {
        const nodeData = translatedNodes.get(id);
        if (nodeData && nodeData.node && nodeData.parentElement) {
          try {
            // Simply replace the text content
            nodeData.node.textContent = t;
            nodeData.parentElement.classList.add('content-critic-translated');
            
            console.log('Translated node:', {
              id,
              originalText: nodeData.originalText,
              newText: t
            });
          } catch (error) {
            console.error('Error translating node:', {
              id,
              error: error.message
            });
          }
        } else {
          console.warn('Node not found for translation:', id);
        }
      });
      sendResponse({ success: true });
      
    } else if (request.action === 'revertTranslations') {
      // Revert all translations
      translatedNodes.forEach(({ node, originalText, parentElement }) => {
        if (node && parentElement) {
          node.textContent = originalText; // Restore original text with whitespace
          parentElement.classList.remove('content-critic-translated');
        }
      });
      translatedNodes.clear();
      sendResponse({ success: true });
    }
    
    return true; // Keep the message channel open for async responses
  });

  // Helper function to check if a node is visible
  function isNodeVisible(node) {
    const style = window.getComputedStyle(node.parentElement);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           node.parentElement.offsetParent !== null;
  }

  // Initialize content script
  function initialize() {
    console.log('Content Critic: Content script initialized');
  }

  // Start initialization
  initialize();
})();