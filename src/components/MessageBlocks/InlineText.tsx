import React, { useCallback } from 'react';
import { Text, StyleSheet, Linking, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const formatMathText = (content: string): string => {
    return content
        .replace(/\\rightarrow/g, '→')
        .replace(/\\leftarrow/g, '←')
        .replace(/\\le(q)?\b/g, '≤')
        .replace(/\\ge(q)?\b/g, '≥')
        .replace(/\\ne(q)?\b/g, '≠')
        .replace(/\\approx/g, '≈')
        .replace(/\\times/g, '×')
        .replace(/\\cdot/g, '·')
        .replace(/\\pm/g, '±')
        .replace(/\\infty/g, '∞')
        .replace(/\\sqrt/g, '√')
        .replace(/\\(log|ln|max|min|sin|cos|tan)\b/g, '$1');
};

export const InlineText = ({ text }: { text: string }) => {
    const { colors, mode } = useTheme();

    // Warm yellowish / amber color for formulas, identical to GPT / Gemini math highlighting
    const formulaColor = mode === 'dark' ? '#FBBF24' : '#D97706';
    const linkColor = mode === 'dark' ? '#58A6FF' : '#0969DA';

    const handleOpenUrl = useCallback((rawUrl: string) => {
        let url = rawUrl.trim();
        // Ensure scheme is present so Android can resolve browser activity
        if (!/^https?:\/\//i.test(url) && !/^(mailto|tel):/i.test(url)) {
            url = `https://${url}`;
        }
        Linking.openURL(url).catch((err) => {
            console.warn('[InlineText] Failed to open URL:', url, err);
        });
    }, []);

    // Order matters: strikethrough, bold, italic, code, math, markdown link, bare URL
    const parts = text.split(/(~~.*?~~|\*\*.*?\*\*|\*[^\*]+\*|`.*?`|\$[\s\S]*?\$|\[.*?\]\(.*?\)|https?:\/\/\S+|www\.\S+)/g);

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
                // Bold **text** (handles nested math like **$O(\log N)$**)
                if (part.startsWith('**') && part.endsWith('**')) {
                    const inner = part.slice(2, -2);
                    if (inner.startsWith('$') && inner.endsWith('$') && inner.length > 2) {
                        const mathContent = formatMathText(inner.slice(1, -1));
                        return (
                            <Text
                                key={index}
                                style={[styles.formula, { color: formulaColor, fontWeight: 'bold' }]}>
                                {mathContent}
                            </Text>
                        );
                    }
                    return (
                        <Text key={index} style={{ fontWeight: 'bold' }}>
                            {inner}
                        </Text>
                    );
                }
                // Italic *text* (handles nested math like *$O(N)$*)
                if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                    const inner = part.slice(1, -1);
                    if (inner.startsWith('$') && inner.endsWith('$') && inner.length > 2) {
                        const mathContent = formatMathText(inner.slice(1, -1));
                        return (
                            <Text
                                key={index}
                                style={[styles.formula, { color: formulaColor }]}>
                                {mathContent}
                            </Text>
                        );
                    }
                    return (
                        <Text key={index} style={{ fontStyle: 'italic' }}>
                            {inner}
                        </Text>
                    );
                }
                // Inline code `text`
                if (part.startsWith('`') && part.endsWith('`')) {
                    return (
                        <Text key={index} style={[styles.inlineCode, { backgroundColor: colors.border, color: colors.text }]}>
                            {part.slice(1, -1)}
                        </Text>
                    );
                }
                // Inline math / formula $text$
                if (part.startsWith('$') && part.endsWith('$')) {
                    const mathContent = formatMathText(part.slice(1, -1));
                    return (
                        <Text
                            key={index}
                            style={[styles.formula, { color: formulaColor }]}>
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
                            onPress={() => handleOpenUrl(linkMatch[2])}
                            suppressHighlighting={false}
                            style={[styles.link, { color: linkColor }]}>
                            {linkMatch[1]}
                        </Text>
                    );
                }
                // Bare URL https://... or www....
                if (/^(https?:\/\/|www\.)\S+$/i.test(part)) {
                    const url = part.replace(/[.,;:!?)]+$/, '');
                    return (
                        <Text
                            key={index}
                            onPress={() => handleOpenUrl(url)}
                            suppressHighlighting={false}
                            style={[styles.link, { color: linkColor }]}>
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
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13,
        paddingHorizontal: 4,
        borderRadius: 4,
        overflow: 'hidden',
    },
    formula: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontStyle: 'italic',
        fontWeight: '500',
        letterSpacing: 0.2,
    },
    link: {
        textDecorationLine: 'underline',
        fontWeight: '500',
    },
});
