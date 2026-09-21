import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeProvider';

interface JsonBlockProps {
    content: string;
}

// --- Simple JSON syntax tokenizer ---
// Splits a pretty-printed JSON string into colored spans.
// Does NOT use a third-party library — just regex over valid JSON output.

type TokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation';

interface JsonToken {
    type: TokenType;
    value: string;
}

const TOKEN_COLORS: Record<TokenType, string> = {
    key: '#9CDCFE',
    string: '#CE9178',
    number: '#B5CEA8',
    boolean: '#569CD6',
    null: '#569CD6',
    punctuation: '#D4D4D4',
};

const tokenizeJson = (json: string): JsonToken[] => {
    const tokens: JsonToken[] = [];
    // Match: "key": | "string" | number | true/false | null | structural chars
    const regex = /("(?:\\.|[^"\\])*"\s*(?=:))|(:\s*)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([\[\]{}.,])|(\s+)/g;

    let match;
    while ((match = regex.exec(json)) !== null) {
        const [full, key, colon, str, num, bool, nul, punct, space] = match;
        if (key) {
            tokens.push({ type: 'key', value: key.replace(/\s*$/, '') });
            // The trailing colon space is part of the key match, add colon separately
        } else if (colon) {
            tokens.push({ type: 'punctuation', value: colon });
        } else if (str) {
            tokens.push({ type: 'string', value: str });
        } else if (num) {
            tokens.push({ type: 'number', value: num });
        } else if (bool) {
            tokens.push({ type: 'boolean', value: bool });
        } else if (nul) {
            tokens.push({ type: 'null', value: nul });
        } else if (punct) {
            tokens.push({ type: 'punctuation', value: punct });
        } else if (space) {
            tokens.push({ type: 'punctuation', value: space });
        }
    }

    return tokens;
};

const JsonBlock: React.FC<JsonBlockProps> = ({ content }) => {
    const { colors } = useTheme();
    const [copied, setCopied] = useState(false);

    // Pretty-print + tokenize (memoized — only re-runs when content changes)
    const { formatted, tokens } = useMemo(() => {
        let pretty: string;
        try {
            pretty = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            pretty = content; // fallback: render raw content
        }
        return { formatted: pretty, tokens: tokenizeJson(pretty) };
    }, [content]);

    const handleCopy = () => {
        Clipboard.setString(formatted);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Derive a dynamic label from the actual parsed content
    const label = useMemo(() => {
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) return 'json array';
            if (typeof parsed === 'object' && parsed !== null) return 'json object';
            return 'json';
        } catch {
            return 'json';
        }
    }, [content]);

    return (
        <View style={[styles.container, { borderColor: colors.border }]}>
            <View style={styles.header}>
                <Text style={styles.languageText}>{label}</Text>
                <Pressable onPress={handleCopy} hitSlop={10} style={styles.copyBtn}>
                    <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy'}</Text>
                </Pressable>
            </View>
            <View style={styles.contentContainer}>
                <Text selectable style={styles.codeText}>
                    {tokens.length > 0 ? (
                        tokens.map((token, i) => (
                            <Text key={i} style={{ color: TOKEN_COLORS[token.type] }}>
                                {token.value}
                            </Text>
                        ))
                    ) : (
                        formatted
                    )}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        overflow: 'hidden',
        backgroundColor: '#1E1E1E',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#2D2D2D',
    },
    languageText: {
        color: '#A0A0A0',
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    copyBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: '#404040',
        borderRadius: 4,
    },
    copyText: {
        color: '#E0E0E0',
        fontSize: 10,
        fontWeight: 'bold',
    },
    contentContainer: {
        padding: 12,
    },
    codeText: {
        fontSize: 13,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        color: '#D4D4D4',
    },
});

export default JsonBlock;
