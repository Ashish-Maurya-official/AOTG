export type BlockType = 'text' | 'code' | 'terminal' | 'table';

export interface MessageBlock {
    id: string;
    type: BlockType;
    content: string;
    language?: string;
}

export const parseMessage = (text: string): MessageBlock[] => {
    const blocks: MessageBlock[] = [];
    if (!text) return blocks;

    // Split by code blocks. Captures the entire code block including backticks.
    // Handles incomplete code blocks (e.g. streaming) by matching until end of string if closing backticks are missing.
    const codeBlockRegex = /(```[\s\S]*?(?:```|$))/g;
    const parts = text.split(codeBlockRegex);

    let blockCounter = 0;

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
                    id: `block-${blockCounter++}`,
                    type: isTerminal ? 'terminal' : 'code',
                    content: codeContent.replace(/\n$/, ''), // Remove single trailing newline
                    language: lang,
                });
            } else {
                blocks.push({
                    id: `block-${blockCounter++}`,
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
                        id: `block-${blockCounter++}`,
                        type: 'table',
                        content: trimmed,
                    });
                } else {
                    blocks.push({
                        id: `block-${blockCounter++}`,
                        type: 'text',
                        content: subPart,
                    });
                }
            });
        }
    });

    return blocks;
};
