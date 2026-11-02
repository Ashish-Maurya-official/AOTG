import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { InlineText } from './InlineText';

interface TextBlockProps {
    content: string;
}

const TextBlock: React.FC<TextBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    // Render a single line as nested <Text>
    const renderLine = (line: string, idx: number, totalLines: number): React.ReactNode => {
        const isLast = idx === totalLines - 1;
        const lineBreak = isLast ? '' : '\n';

        if (line.trim() === '') {
            return (
                <Text key={`empty-${idx}`} style={[styles.text, { color: colors.text }]}>
                    {'\n'}
                </Text>
            );
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
                <Text key={`h-${idx}`} style={[styles.text, { fontSize, fontWeight: 'bold', letterSpacing: 0.2, color: colors.text }]}>
                    <InlineText text={headingMatch[2]} />{lineBreak}
                </Text>
            );
        }

        // Bullets (* or -)
        const bulletMatch = line.match(/^(\s*)([\*\-])\s+(.*)/);
        if (bulletMatch) {
            const indent = '  '.repeat(Math.floor(bulletMatch[1].length / 2));
            return (
                <Text key={`b-${idx}`} style={[styles.text, { color: colors.text }]}>
                    {indent}{'•  '}<InlineText text={bulletMatch[3]} />{lineBreak}
                </Text>
            );
        }

        // Numbered list
        const numMatch = line.match(/^(\s*)(\d+\.)\s+(.*)/);
        if (numMatch) {
            const indent = '  '.repeat(Math.floor(numMatch[1].length / 2));
            return (
                <Text key={`n-${idx}`} style={[styles.text, { color: colors.text }]}>
                    {indent}{numMatch[2]}{'  '}<InlineText text={numMatch[3]} />{lineBreak}
                </Text>
            );
        }

        // Normal text
        return (
            <Text key={`t-${idx}`} style={[styles.text, { color: colors.text }]}>
                <InlineText text={line} />{lineBreak}
            </Text>
        );
    };

    const lines = content.split('\n');

    return (
        <View style={styles.container}>
            {lines.map((line, idx) => renderLine(line, idx, lines.length))}
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
});

export default TextBlock;
