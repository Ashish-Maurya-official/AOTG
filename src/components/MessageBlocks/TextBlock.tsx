import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

interface TextBlockProps {
    content: string;
}

const TextBlock: React.FC<TextBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    // A very simple inline markdown renderer for bold text
    const renderInlineText = (text: string) => {
        // Match **bold** or `code`
        const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return (
                    <Text key={index} style={{ fontWeight: 'bold' }}>
                        {part.slice(2, -2)}
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
            return <Text key={index}>{part}</Text>;
        });
    };

    return (
        <Text style={[styles.text, { color: colors.text }]}>
            {renderInlineText(content)}
        </Text>
    );
};

const styles = StyleSheet.create({
    text: {
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 4,
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
