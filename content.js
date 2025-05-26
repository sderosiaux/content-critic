// content.js
(function() {
  // Check if we're already initialized
  if (window.contentCriticInitialized) {
    console.log('Content Critic: Already initialized, skipping');
    return;
  }
  window.contentCriticInitialized = true;

  console.log('Content Critic: Content script chargé');

  // Dynamically link the CSS file
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('content.css');
  document.head.appendChild(link);

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

  // Function to create a highlight box
  function createHighlightBox(rect, type, tooltip) {
    const box = document.createElement('div');
    box.className = `content-critic-highlight-box ${type}`;
    box.style.position = 'absolute';
    box.style.left = `${rect.left + window.scrollX}px`;
    box.style.top = `${rect.top + window.scrollY}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.zIndex = '2147483646';

    // Add hover effect with a small delay to prevent flickering
    let hoverTimeout;
    box.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      const boxRect = box.getBoundingClientRect();
      positionTooltip(tooltip, boxRect);
      tooltip.style.display = 'block'; // Ensure tooltip is visible
      requestAnimationFrame(() => {
        tooltip.classList.add('visible');
      });
    });

    box.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        // Hide tooltip after transition
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    });

    // Also handle tooltip hover
    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      tooltip.classList.add('visible');
    });

    tooltip.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    });

    return box;
  }

  // Function to get text node rectangles
  function getTextNodeRects(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    return rects;
  }

  // Function to update highlight positions
  function updateHighlightPositions() {
    const container = document.getElementById('content-critic-highlights');
    if (!container) return;
    
    const boxes = container.querySelectorAll('.content-critic-highlight-box');
    boxes.forEach(box => {
      // Find the original text node that this highlight corresponds to
      const text = box.getAttribute('data-highlight-text');
      if (!text) return;

      // Find all text nodes that might contain this text
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (!node.parentElement ||
                node.parentElement.closest('script, style, noscript, .content-critic-highlight-box')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );

      let node;
      let found = false;
      while (node = walker.nextNode()) {
        const nodeText = normalizeText(node.textContent);
        if (nodeText.includes(normalizeText(text))) {
          // Create a range for the specific text
          const startIndex = nodeText.indexOf(normalizeText(text));
          const endIndex = startIndex + normalizeText(text).length;
          
          const range = document.createRange();
          range.setStart(node, startIndex);
          range.setEnd(node, endIndex);
          
          // Get the new rectangles for this range
          const rects = Array.from(range.getClientRects());
          if (rects.length > 0) {
            // Update the highlight box position
            const rect = rects[0]; // Use the first rectangle
            box.style.left = `${rect.left + window.scrollX}px`;
            box.style.top = `${rect.top + window.scrollY}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            found = true;
            break;
          }
        }
      }

      // If we couldn't find the text anymore, hide the highlight
      if (!found) {
        box.style.display = 'none';
      } else {
        box.style.display = 'block';
      }
    });
  }

  // Function to normalize text for comparison
  function normalizeText(text) {
    if (!text) return '';
    
    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    // Remove HTML tags but keep their content
    text = text.replace(/<[^>]+>/g, ' ');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  // Function to highlight text using absolute positioned boxes
  function highlightText(text, type, explanation, suggestion) {
    console.log('Highlighting text:', {
      text: text.substring(0, 50) + '...',
      type,
      explanation,
      suggestion
    });

    const tooltip = createTooltip(text, type, explanation, suggestion);
    let highlightCount = 0;
    const normalizedSearchText = normalizeText(text);

    if (!normalizedSearchText) {
      console.warn("Normalized search text is empty, skipping highlighting. Original text:", text);
      return;
    }

    // Create a container for all highlight boxes if it doesn't exist
    let highlightContainer = document.getElementById('content-critic-highlights');
    if (!highlightContainer) {
      highlightContainer = document.createElement('div');
      highlightContainer.id = 'content-critic-highlights';
      highlightContainer.style.position = 'absolute';
      highlightContainer.style.top = '0';
      highlightContainer.style.left = '0';
      highlightContainer.style.width = '100%';
      highlightContainer.style.height = '100%';
      highlightContainer.style.pointerEvents = 'none';
      highlightContainer.style.zIndex = '2147483646';
      document.body.appendChild(highlightContainer);

      // Set up ResizeObserver to watch for content changes
      const resizeObserver = new ResizeObserver(() => {
        updateHighlightPositions();
      });

      // Observe the body and any dynamic content containers
      resizeObserver.observe(document.body);
      document.querySelectorAll('main, article, .content, #content, [role="main"]').forEach(el => {
        resizeObserver.observe(el);
      });

      // Store the observer for cleanup
      highlightContainer._resizeObserver = resizeObserver;
    }

    // Process each text node
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.parentElement ||
              node.parentElement.closest('script, style, noscript, .content-critic-highlight-box')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent || normalizeText(node.textContent).length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent;
      const normalizedNodeText = normalizeText(nodeText);
      
      if (normalizedNodeText.includes(normalizedSearchText)) {
        const startIndex = normalizedNodeText.indexOf(normalizedSearchText);
        const endIndex = startIndex + normalizedSearchText.length;
        
        const range = document.createRange();
        range.setStart(node, startIndex);
        range.setEnd(node, endIndex);
        
        const rects = Array.from(range.getClientRects());
        
        rects.forEach(rect => {
          const box = createHighlightBox(rect, type, tooltip);
          // Store the original text for later repositioning
          box.setAttribute('data-highlight-text', text);
          highlightContainer.appendChild(box);
          highlightCount++;
        });
      }
    }

    // Add scroll listener to update box positions
    window.addEventListener('scroll', updateHighlightPositions);

    console.log(`Highlighting complete:`, {
      text: text.substring(0, 50) + '...',
      highlightsAdded: highlightCount,
      highlightType: type
    });

    if (highlightCount === 0) {
      console.warn('No highlights were added. This might indicate a problem with text matching or DOM structure for:', normalizedSearchText);
    }
  }

  // Function to remove all highlights
  function removeHighlights() {
    const container = document.getElementById('content-critic-highlights');
    if (container) {
      // Clean up ResizeObserver
      if (container._resizeObserver) {
        container._resizeObserver.disconnect();
      }
      container.remove();
    }
    document.querySelectorAll('.content-critic-tooltip').forEach(el => el.remove());
    window.removeEventListener('scroll', updateHighlightPositions);
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
    } else if (request.action === "getSelectedText") {
      // Get the current selection
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      // Send back the selected text
      sendResponse({ selectedText });
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