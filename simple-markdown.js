// Simple markdown parser
function simpleMarkdown(text) {
    // Convert headers (including numbered headers)
    text = text.replace(/^#{1,6}\s*(.*?)(?:\s+#+)?$/gm, (match, content) => {
        const level = match.trim().split(/\s+/)[0].length;
        return `<h${level}>${content.trim()}</h${level}>`;
    });

    // Convert bold and italic
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Convert tables
    let inTable = false;
    let tableContent = [];
    
    // Split text into lines and process each line
    const lines = text.split('\n');
    const processedLines = lines.map(line => {
        // Check if this is a table row
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            // Skip separator lines
            if (/^\s*\|[\s-:|]+\|\s*$/.test(line)) {
                inTable = true;
                return ''; // Remove separator line
            }
            
            // Process table row
            const cells = line.split('|')
                .map(cell => cell.trim())
                .filter(cell => cell); // Remove empty cells at start/end
            
            if (cells.length > 0) {
                if (!inTable) {
                    // This is a header row
                    inTable = true;
                    return `<table><tr>${cells.map(cell => `<th>${cell}</th>`).join('')}</tr>`;
                } else {
                    // This is a data row
                    return `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
                }
            }
        } else {
            // Not a table row
            if (inTable) {
                inTable = false;
                return `</table>${line}`;
            }
        }
        return line;
    });

    // Join lines back together
    text = processedLines.join('\n');
    
    // Close any open table
    if (inTable) {
        text += '</table>';
    }

    // Process lists
    function processListItems(text, listType, pattern) {
        if (!text) return '';  // Handle empty text
        
        const lines = text.split('\n');
        let result = [];
        let listStack = []; // Stack to track nested lists
        let currentLine = 0;

        while (currentLine < lines.length) {
            const line = lines[currentLine];
            if (!line) {  // Handle empty lines
                result.push('');
                currentLine++;
                continue;
            }

            const match = line.match(pattern);
            
            if (match && match[1] !== undefined && match[2] !== undefined) {
                const spaces = match[1] || '';  // Ensure spaces is a string
                const content = match[2] || '';  // Ensure content is a string
                const indent = spaces.length;
                const level = Math.floor(indent / 4);

                // Close lists until we reach the right level
                while (listStack.length > level) {
                    if (listStack.length > 0) {  // Extra safety check
                        result.push('</li></' + listStack.pop() + '>');
                    }
                }

                // If we need to start a new list level
                if (listStack.length < level) {
                    // Start a new list at this level
                    if (listStack.length > 0) {
                        // If we have a parent list, close the current list item and start a new list
                        result.push('</li><li><' + listType + '><li>' + content);
                    } else {
                        result.push('<' + listType + '><li>' + content);
                    }
                    listStack.push(listType);
                } else {
                    // Continue at current level
                    if (listStack.length > 0) {
                        result.push('</li><li>' + content);
                    } else {
                        result.push('<' + listType + '><li>' + content);
                        listStack.push(listType);
                    }
                }
            } else {
                // Not a list item
                if (listStack.length > 0) {
                    // Check if next line is a list item at same or deeper level
                    const nextLine = lines[currentLine + 1];
                    if (nextLine) {  // Only process if next line exists
                        const nextMatch = nextLine.match(pattern);
                        const nextIndent = nextMatch && nextMatch[1] ? (nextMatch[1] || '').length : -1;
                        const nextLevel = Math.floor(nextIndent / 4);

                        if (!nextMatch || nextLevel < listStack.length) {
                            // Close all open lists
                            while (listStack.length > 0) {
                                result.push('</li></' + listStack.pop() + '>');
                            }
                        }
                    }
                }
                result.push(line);
            }
            currentLine++;
        }

        // Close any remaining open lists
        while (listStack.length > 0) {
            result.push('</li></' + listStack.pop() + '>');
        }

        return result.join('\n');
    }

    // Process ordered lists
    text = processListItems(text, 'ol', /^(\s*)\d+\.\s+(.+)$/gm);
    
    // Process unordered lists
    text = processListItems(text, 'ul', /^(\s*)[-*]\s+(.+)$/gm);

    // Convert paragraphs (but not if it's already a list item, header, or table)
    text = text.replace(/^(?!<[h|u|o|p|t])(.*$)/gm, (match) => {
        if (match.trim() === '') return '';
        return `<p>${match}</p>`;
    });

    // Clean up empty paragraphs and extra whitespace
    text = text.replace(/<p><\/p>/g, '');
    text = text.replace(/\n\s*\n/g, '\n');
    text = text.replace(/>\s+</g, '><');

    return text;
} 