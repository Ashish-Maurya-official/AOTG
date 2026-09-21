import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

interface TextBlockProps {
    content: string;
}

const TextBlock: React.FC<TextBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    // Inline markdown renderer: bold, italic, strikethrough, code, math, links, URLs
    const renderInlineText = (text: string): React.ReactNode[] => {
        // Order matters: strikethrough, bold, italic, code, math, markdown link, bare URL
        const parts = text.split(/(~~.*?~~|\*\*.*?\*\*|\*[^\*]+\*|`.*?`|\$[\s\S]*?\$|\[.*?\]\(.*?\)|https?:\/\/\S+)/g);

        return parts.map((part, index) => {
            // Strikethrough ~~text~~
            if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
                return (
                    <Text key={index} style={{ textDecorationLine: 'line-through' }}>
                        {part.slice(2, -2)}
                    </Text>
                );
            }
            // Bold **text**
            if (part.startsWith('**') && part.endsWith('**')) {
                return (
                    <Text key={index} style={{ fontWeight: 'bold' }}>
                        {part.slice(2, -2)}
                    </Text>
                );
            }
            // Italic *text*
            if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                return (
                    <Text key={index} style={{ fontStyle: 'italic' }}>
                        {part.slice(1, -1)}
                    </Text>
                );
            }
            // Inline code `text`
            if (part.startsWith('`') && part.endsWith('`')) {
                return (
                    <Text key={index} style={[styles.inlineCode, { backgroundColor: colors.border }]}>
                        {part.slice(1, -1)}
                    </Text>
                );
            }
            // Inline math $text$
            if (part.startsWith('$') && part.endsWith('$')) {
                let mathContent = part.slice(1, -1);
                mathContent = mathContent.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←').replace(/\\log/g, 'log');
                return (
                    <Text key={index} style={{ fontStyle: 'italic', color: '#10A37F', fontWeight: '500' }}>
                        {mathContent}
                    </Text>
                );
            }
            // Markdown link [text](url)
            const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
            if (linkMatch) {
                return (
                    <Text
                        key={index}
                        onPress={() => Linking.openURL(linkMatch[2]).catch(() => {})}
                        style={styles.link}>
                        {linkMatch[1]}
                    </Text>
                );
            }
            // Bare URL https://...
            if (/^https?:\/\/\S+$/.test(part)) {
                const url = part.replace(/[.,;:!?)]+$/, '');
                return (
                    <Text
                        key={index}
                        onPress={() => Linking.openURL(url).catch(() => {})}
                        style={styles.link}>
                        {url}
                    </Text>
                );
            }

            // Clean up loose escaped latex in normal text
            let cleaned = part.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←');
            return <Text key={index}>{cleaned}</Text>;
        });
    };

    // Render a single line as nested <Text> (no <View> wrappers)
    const renderLine = (line: string, idx: number, totalLines: number): React.ReactNode => {
        const isLast = idx === totalLines - 1;
        const lineBreak = isLast ? '' : '\n';

        if (line.trim() === '') {
            return <Text key={`empty-${idx}`}>{'\n'}</Text>;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            let fontSize = 20;
            if (level === 1) fontSize = 24;
            if (level === 2) fontSize = 22;
            if (level === 3) fontSize = 18;
            if (level >= 4) fontSize = 16;

            return (
                <Text key={`h-${idx}`} style={{ fontSize, fontWeight: 'bold', letterSpacing: 0.2 }}>
                    {renderInlineText(headingMatch[2])}{lineBreak}
                </Text>
            );
        }

        // Bullets (* or -)
        const bulletMatch = line.match(/^(\s*)([\*\-])\s+(.*)/);
        if (bulletMatch) {
            const indent = '  '.repeat(Math.floor(bulletMatch[1].length / 2));
            return (
                <Text key={`b-${idx}`}>
                    {indent}{'•  '}{renderInlineText(bulletMatch[3])}{lineBreak}
                </Text>
            );
        }

        // Numbered list
        const numMatch = line.match(/^(\s*)(\d+\.)\s+(.*)/);
        if (numMatch) {
            const indent = '  '.repeat(Math.floor(numMatch[1].length / 2));
            return (
                <Text key={`n-${idx}`}>
                    {indent}{numMatch[2]}{'  '}{renderInlineText(numMatch[3])}{lineBreak}
                </Text>
            );
        }

        // Normal text
        return (
            <Text key={`t-${idx}`}>
                {renderInlineText(line)}{lineBreak}
            </Text>
        );
    };

    const lines = content.split('\n');

    return (
        <View style={styles.container}>
            <Text selectable style={[styles.text, { color: colors.text }]}>
                {lines.map((line, idx) => renderLine(line, idx, lines.length))}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    text: {
        fontSize: 15,
        lineHeight: 22,
    },
    inlineCode: {
        fontFamily: 'monospace',
        fontSize: 13,
        paddingHorizontal: 4,
        borderRadius: 4,
        overflow: 'hidden',
    },
    link: {
        color: '#58A6FF',
        textDecorationLine: 'underline',
    },
});

export default TextBlock;
