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

    // Convert ordered lists
    text = text.replace(/^\s*\d+\.\s+(.*$)/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, (match) => {
        // Only wrap in ol if it's a sequence of list items
        if (match.split('</li><li>').length > 1) {
            return `<ol>${match}</ol>`;
        }
        return match;
    });

    // Convert unordered lists
    text = text.replace(/^\s*[-*]\s+(.*$)/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, (match) => {
        // Only wrap in ul if it's a sequence of list items
        if (match.split('</li><li>').length > 1) {
            return `<ul>${match}</ul>`;
        }
        return match;
    });

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