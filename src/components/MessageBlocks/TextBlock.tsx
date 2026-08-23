import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

interface TextBlockProps {
    content: string;
}

const TextBlock: React.FC<TextBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    // A simple inline markdown renderer for bold, italic, code, and math
    const renderInlineText = (text: string) => {
        // Match **bold**, *italic*, `code`, and $math$
        const parts = text.split(/(\*\*.*?\*\*|\*[^\*]+\*|`.*?`|\$[\s\S]*?\$)/g);

        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return (
                    <Text key={index} style={{ fontWeight: 'bold' }}>
                        {part.slice(2, -2)}
                    </Text>
                );
            }
            if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                return (
                    <Text key={index} style={{ fontStyle: 'italic' }}>
                        {part.slice(1, -1)}
                    </Text>
                );
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return (
                    <Text key={index} style={[styles.inlineCode, { backgroundColor: colors.border }]}>
                        {part.slice(1, -1)}
                    </Text>
                );
            }
            if (part.startsWith('$') && part.endsWith('$')) {
                // Inline math (LaTeX) formatting
                let mathContent = part.slice(1, -1);
                // Quick replacements for common latex symbols
                mathContent = mathContent.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←').replace(/\\log/g, 'log');
                return (
                    <Text key={index} style={{ fontStyle: 'italic', color: '#10A37F', fontWeight: '500' }}>
                        {mathContent}
                    </Text>
                );
            }
            
            // Clean up loose escaped latex in normal text
            let cleaned = part.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←');
            return <Text key={index}>{cleaned}</Text>;
        });
    };

    const renderBlocks = (text: string) => {
        const lines = text.split('\n');
        
        return lines.map((line, idx) => {
            if (line.trim() === '') {
                return <Text key={`empty-${idx}`} style={{ height: 6 }} />;
            }
            
            // Headings (e.g. ### 3. Time Complexity)
            const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                let fontSize = 20;
                if (level === 1) fontSize = 24;
                if (level === 2) fontSize = 22;
                if (level === 3) fontSize = 18;
                if (level >= 4) fontSize = 16;
                
                return (
                    <Text key={`h-${idx}`} style={[styles.heading, { fontSize, color: colors.text, marginTop: level < 3 ? 12 : 6 }]}>
                        {renderInlineText(headingMatch[2])}
                    </Text>
                );
            }
            
            // Bullets (* or -)
            const bulletMatch = line.match(/^(\s*)([\*\-])\s+(.*)/);
            if (bulletMatch) {
                const spaces = bulletMatch[1].length;
                return (
                    <View key={`b-${idx}`} style={[styles.listItem, { marginLeft: spaces * 4 }]}>
                        <Text style={[styles.bullet, { color: colors.text }]}>•</Text>
                        <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
                            {renderInlineText(bulletMatch[3])}
                        </Text>
                    </View>
                );
            }
            
            // Numbered list (e.g. 1. Repeat)
            const numMatch = line.match(/^(\s*)(\d+\.)\s+(.*)/);
            if (numMatch) {
                const spaces = numMatch[1].length;
                return (
                    <View key={`n-${idx}`} style={[styles.listItem, { marginLeft: spaces * 4 }]}>
                        <Text style={[styles.bullet, { color: colors.text, width: 22 }]}>{numMatch[2]}</Text>
                        <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
                            {renderInlineText(numMatch[3])}
                        </Text>
                    </View>
                );
            }
            
            // Normal text block
            return (
                <Text key={`t-${idx}`} style={[styles.text, { color: colors.text }]}>
                    {renderInlineText(line)}
                </Text>
            );
        });
    };

    return (
        <View style={styles.container}>
            {renderBlocks(content)}
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
        marginBottom: 4,
    },
    heading: {
        fontWeight: 'bold',
        marginBottom: 8,
        letterSpacing: 0.2,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    bullet: {
        fontSize: 15,
        lineHeight: 22,
        marginRight: 6,
        fontWeight: 'bold',
    },
    inlineCode: {
        fontFamily: 'monospace',
        fontSize: 13,
        paddingHorizontal: 4,
        borderRadius: 4,
        overflow: 'hidden',
    },
});

export default TextBlock;
