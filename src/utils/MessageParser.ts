export type BlockType = 'text' | 'code' | 'terminal' | 'table'
                      | 'json' | 'blockquote' | 'horizontalRule';

export interface MessageBlock {
    id: string;
    type: BlockType;
    content: string;
    language?: string;
}

// --- JSON Detection (conservative) ---

const isStandaloneJson = (text: string): boolean => {
    const trimmed = text.trim();
    // Must start/end with matching delimiters
    const isObj = trimmed.startsWith('{') && trimmed.endsWith('}');
    const isArr = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!isObj && !isArr) return false;
    // Reject trivially empty containers
    if (trimmed === '{}' || trimmed === '[]') return false;
    try {
        const parsed = JSON.parse(trimmed);
        // Must be object or array, not a primitive
        return typeof parsed === 'object' && parsed !== null;
    } catch {
        return false;
    }
};

// --- Horizontal-rule detection ---

const isHorizontalRule = (line: string): boolean => {
    const t = line.trim();
    if (t.length < 3) return false;
    return /^[-]{3,}$/.test(t) || /^[*]{3,}$/.test(t) || /^[_]{3,}$/.test(t);
};

// --- Line-level scanner for text segments ---
// Runs AFTER code-block and table extraction.
// Splits a text segment into text / blockquote / horizontalRule / json blocks.

const parseTextSegment = (
    segment: string,
    counter: { value: number },
): MessageBlock[] => {
    const blocks: MessageBlock[] = [];
    const lines = segment.split('\n');

    let currentType: 'text' | 'blockquote' | null = null;
    let currentLines: string[] = [];

    const flush = () => {
        if (currentLines.length === 0) return;

        if (currentType === 'blockquote') {
            // Strip leading > and optional space from each line
            const inner = currentLines
                .map((l) => l.trimStart().replace(/^>\s?/, ''))
                .join('\n');
            if (inner.trim().length > 0) {
                blocks.push({
                    id: `block-${counter.value++}`,
                    type: 'blockquote',
                    content: inner,
                });
            }
        } else {
            const joined = currentLines.join('\n');
            const trimmed = joined.trim();

            if (trimmed.length > 0) {
                // Check if the entire text region is standalone JSON
                if (isStandaloneJson(trimmed)) {
                    blocks.push({
                        id: `block-${counter.value++}`,
                        type: 'json',
                        content: trimmed,
                    });
                } else {
                    blocks.push({
                        id: `block-${counter.value++}`,
                        type: 'text',
                        content: joined,
                    });
                }
            }
        }

        currentLines = [];
        currentType = null;
    };

    for (const line of lines) {
        // --- Horizontal rule ---
        if (isHorizontalRule(line)) {
            flush();
            blocks.push({
                id: `block-${counter.value++}`,
                type: 'horizontalRule',
                content: '',
            });
            continue;
        }

        // --- Blockquote line ---
        if (line.trimStart().startsWith('>')) {
            if (currentType !== 'blockquote') {
                flush();
                currentType = 'blockquote';
            }
            currentLines.push(line);
            continue;
        }

        // --- Normal text line ---
        if (currentType !== 'text') {
            flush();
            currentType = 'text';
        }
        currentLines.push(line);
    }

    flush();
    return blocks;
};

// --- Main parser ---

export const parseMessage = (text: string): MessageBlock[] => {
    const blocks: MessageBlock[] = [];
    if (!text) return blocks;

    // Split by code blocks. Captures the entire code block including backticks.
    // Handles incomplete code blocks (e.g. streaming) by matching until end of string if closing backticks are missing.
    const codeBlockRegex = /(```[\s\S]*?(?:```|$))/g;
    const parts = text.split(codeBlockRegex);

    const counter = { value: 0 };

    parts.forEach((part) => {
        if (!part) return;

        if (part.startsWith('```')) {
            // Extract language and content
            const match = part.match(/^```([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)(?:```|$)/);
            if (match) {
                const lang = match[1]?.trim().toLowerCase() || '';
                const codeContent = match[2] || '';

                const isTerminal = ['bash', 'sh', 'shell', 'cmd', 'zsh', 'powershell'].includes(lang);

                blocks.push({
                    id: `block-${counter.value++}`,
                    type: isTerminal ? 'terminal' : 'code',
                    content: codeContent.replace(/\n$/, ''), // Remove single trailing newline
                    language: lang,
                });
            } else {
                blocks.push({
                    id: `block-${counter.value++}`,
                    type: 'text',
                    content: part,
                });
            }
        } else {
            // Now parse tables within standard text
            // Matches consecutive lines containing pipes, requiring a markdown delimiter row (---)
            const tableRegex = /((?:^[ \t]*[^\n]*\|[^\n]*(?:\n|$))(?:^[ \t]*\|?[ \t]*:?-+[ \t]*\|[-:\s\|]*(?:\n|$))(?:^[ \t]*[^\n]*\|[^\n]*(?:\n|$))*)/m;
            const subParts = part.split(tableRegex);

            subParts.forEach((subPart) => {
                if (!subPart) return;

                const trimmed = subPart.trim();
                // A valid markdown table subPart must contain a delimiter row
                const isTable = /^[ \t]*\|?[ \t]*:?-+[ \t]*\|/m.test(trimmed);
                
                if (isTable && trimmed.includes('\n')) {
                    blocks.push({
                        id: `block-${counter.value++}`,
                        type: 'table',
                        content: trimmed,
                    });
                } else {
                    // Run the line-level scanner for blockquotes, HR, JSON
                    const subBlocks = parseTextSegment(subPart, counter);
                    blocks.push(...subBlocks);
                }
            });
        }
    });

    return blocks;
};
