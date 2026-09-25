import React from 'react';
import { Text, StyleSheet, Linking } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export const InlineText = ({ text }: { text: string }) => {
    const { colors } = useTheme();

    // Order matters: strikethrough, bold, italic, code, math, markdown link, bare URL
    const parts = text.split(/(~~.*?~~|\*\*.*?\*\*|\*[^\*]+\*|`.*?`|\$[\s\S]*?\$|\[.*?\]\(.*?\)|https?:\/\/\S+)/g);

    return (
        <>
            {parts.map((part, index) => {
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
            })}
        </>
    );
};

const styles = StyleSheet.create({
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
