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

  // Helper function to create a highlight span with tooltip listeners
  function _createHighlightSpan(text, type, tooltip) {
    const span = document.createElement('span');
    span.className = `content-critic-highlight ${type}`;
    span.textContent = text;

    span.addEventListener('mouseenter', () => {
      const rect = span.getBoundingClientRect();
      positionTooltip(tooltip, rect);
      tooltip.classList.add('visible');
    });

    span.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    return span;
  }

  // Function to normalize text (remove extra spaces and HTML tags)
  function normalizeText(str) {
    if (!str) return '';
    return str.replace(/<[^>]*>/g, '') // Remove HTML tags from string if any (though textContent shouldn't have them)
              .replace(/\s+/g, ' ')     // Normalize multiple spaces, newlines, tabs to a single space
              .trim();                  // Remove leading/trailing whitespace
  }

  // Helper to find start and end nodes for a given search text within a list of a block's text nodes.
  // This function attempts to replicate the original logic of finding the start and end Text Nodes
  // that encapsulate the normalizedSearchText within a sequence of sibling Text Nodes.
  function _findMatchingNodesInBlock(blockChildNodes, normalizedSearchText) {
    let startNode = null;
    let endNode = null;

    // Map child nodes to their normalized text content.
    const nodeMetas = blockChildNodes.map(node => ({
      node,
      normText: normalizeText(node.textContent) 
    }));

    // Accumulate normalized text from nodes and check for search text.
    // This mirrors the original logic's approach to determine potential matches.
    let currentTextForSearch = ''; 
    for (let i = 0; i < nodeMetas.length; i++) {
      // Concatenate normalized texts, adding a space in between, then normalize the whole string.
      // This is crucial to match how normalizedSearchText might span across multiple nodes.
      currentTextForSearch += (i > 0 ? " " : "") + nodeMetas[i].normText;
      const normalizedAccumulated = normalizeText(currentTextForSearch);

      // Determine startNode:
      // If startNode is not yet found and the accumulated text contains the search text.
      if (!startNode && normalizedAccumulated.includes(normalizedSearchText)) {
        // The match might start in an earlier node than nodeMetas[i].
        // Iterate backwards from the current node (i) to find the actual first node
        // whose content contributes to the found normalizedSearchText.
        let tempAccumulatedForStartFinding = "";
        for (let j = i; j >= 0; j--) {
          // Prepend node's text to tempAccumulatedForStartFinding
          tempAccumulatedForStartFinding = nodeMetas[j].normText + (tempAccumulatedForStartFinding ? " " : "") + tempAccumulatedForStartFinding;
          if (normalizeText(tempAccumulatedForStartFinding).includes(normalizedSearchText)) {
            startNode = nodeMetas[j].node; // This node is part of the match.
          } else {
            // The text up to nodeMetas[j] (exclusive) no longer forms the match.
            // So, the actual start must have been nodeMetas[j+1].node.
            // Since we set `startNode` in the previous iteration, it will hold the correct starting node.
            break; 
          }
        }
      }

      // Determine endNode:
      // If startNode has been found and endNode is not yet found.
      if (startNode && !endNode) {
        // The original logic used a length-based check on the accumulated string to find the end node.
        // This ensures that the entire `normalizedSearchText` is covered.
        const startIndexInAccumulated = normalizedAccumulated.indexOf(normalizedSearchText);
        if (startIndexInAccumulated !== -1) { 
          const effectiveSearchTextEndIndex = startIndexInAccumulated + normalizedSearchText.length;
          
          // Reconstruct accumulated text again, node by node, checking total length.
          // This is to find which node (nodeMetas[k]) makes the accumulated length
          // meet or exceed `effectiveSearchTextEndIndex`.
          let runningTextForLengthCheck = "";
          for (let k = 0; k < nodeMetas.length; k++) { // Iterate from the beginning of the block's nodes
            runningTextForLengthCheck += (k > 0 ? " " : "") + nodeMetas[k].normText;
            const currentNormalizedLength = normalizeText(runningTextForLengthCheck).length;
            
            if (currentNormalizedLength >= effectiveSearchTextEndIndex) {
              endNode = nodeMetas[k].node;
              break; // Found the end node.
            }
          }
        }
      }
      
      // If both start and end nodes are determined, no need to check further nodes in this block.
      if (startNode && endNode) {
        break;
      }
    }
    return { startNode, endNode };
  }

  // Highlight text in the page
  function highlightText(text, type, explanation, suggestion) {
    console.log('Highlighting text:', {
      text: text.substring(0, 50) + '...', // Original text for logging
      type,
      explanation,
      suggestion
    });

    const tooltip = createTooltip(text, type, explanation, suggestion); // Tooltip uses original text
    let highlightCount = 0;
    const normalizedSearchText = normalizeText(text); // Normalized text for matching

    // If the text to search for becomes empty after normalization (e.g., it was just whitespace or empty tags),
    // then there's nothing to highlight.
    if (!normalizedSearchText) {
      console.warn("Normalized search text is empty, skipping highlighting. Original text:", text);
      return;
    }

    // TreeWalker to find all relevant text nodes in the document body.
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT, // Only interested in text nodes.
      {
        acceptNode: function(node) {
          // Reject nodes if their parent is a script, style, noscript tag, or already a highlight span.
          // This prevents processing content of these elements or re-processing already highlighted text.
          if (!node.parentElement ||
              node.parentElement.closest('script, style, noscript, .content-critic-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          // Reject nodes that are empty or contain only whitespace after normalization.
          if (!node.textContent || normalizeText(node.textContent).length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT; // Accept the node if it passes checks.
        }
      },
      false // Not using entity reference expansion.
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node); // Collect all acceptable text nodes.
    }

    // Group collected text nodes by their closest common block-level ancestor.
    // This helps process the document in logical chunks.
    const blocks = new Map(); // Map where key is block element, value is array of its text node children.
    for (const textNode of textNodes) {
      // Define common block-level elements.
      const blockElement = textNode.parentElement.closest('p, div, article, section, main, aside, nav, header, footer, li, td, th, h1, h2, h3, h4, h5, h6');
      if (blockElement) {
        // Optimization: If the block's entire normalized text content doesn't include the search text,
        // then this block can be skipped early.
        if (!normalizeText(blockElement.textContent).includes(normalizedSearchText)) {
            continue;
        }
        // If this block hasn't been added to the map, initialize it.
        if (!blocks.has(blockElement)) {
          blocks.set(blockElement, []);
        }
        // Add the text node to its corresponding block.
        blocks.get(blockElement).push(textNode);
      }
    }
    
    // Process each block that potentially contains the search text.
    for (const [block, blockChildNodes] of blocks) {
      // Due to the previous optimization, this check might be redundant but serves as a safeguard.
      // It ensures that the combined text of specifically collected child nodes (not blockElement.textContent) contains the search text.
      const blockCombinedTextNormalized = normalizeText(blockChildNodes.map(n => n.textContent).join(" "));
      if (!blockCombinedTextNormalized.includes(normalizedSearchText)) {
          continue;
      }

      // Find the specific start and end nodes within this block that contain the search text.
      const { startNode, endNode } = _findMatchingNodesInBlock(blockChildNodes, normalizedSearchText);

      // If a valid start and end node range is not found, skip this block.
      if (!startNode || !endNode) {
        continue;
      }
      
      const fragment = document.createDocumentFragment();
      let isHighlighting = false;
      for (const currentNode of blockChildNodes) {
        if (currentNode === startNode) {
          isHighlighting = true;
        }
        
        if (isHighlighting) {
          fragment.appendChild(_createHighlightSpan(currentNode.textContent, type, tooltip));
          highlightCount++;
        } else {
          fragment.appendChild(currentNode.cloneNode(true));
        }

        if (currentNode === endNode) {
          isHighlighting = false;
          // If there are more nodes in blockChildNodes after endNode, they will be appended as clones.
        }
      }
      
      block.innerHTML = ''; // Clear original content of the block
      block.appendChild(fragment); // Append the new content with highlights
    }

    console.log(`Highlighting complete:`, {
      text: text.substring(0, 50) + '...',
      highlightsAdded: highlightCount,
      highlightType: type
    });

    if (highlightCount === 0) {
      console.warn('No highlights were added. This might indicate a problem with text matching or DOM structure for:', normalizedSearchText);
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