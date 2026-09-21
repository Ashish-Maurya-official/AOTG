import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeProvider';

interface CodeBlockProps {
    content: string;
    language?: string;
}

// Only abbreviations and names that need special formatting (symbols, casing, etc.)
// Any language NOT in this map is auto-capitalized from its raw identifier.
const LANGUAGE_LABELS: Record<string, string> = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    py: 'Python',
    python: 'Python',
    kt: 'Kotlin',
    rb: 'Ruby',
    rs: 'Rust',
    cpp: 'C++',
    'c++': 'C++',
    cs: 'C#',
    csharp: 'C#',
    objc: 'Objective-C',
    objective_c: 'Objective-C',
    yml: 'YAML',
    md: 'Markdown',
    gql: 'GraphQL',
    graphql: 'GraphQL',
    hs: 'Haskell',
    ex: 'Elixir',
    clj: 'Clojure',
    txt: 'Plain Text',
    plaintext: 'Plain Text',
    text: 'Plain Text',
};

// Auto-capitalize: "kotlin" → "Kotlin", "dockerfile" → "Dockerfile"
const getLanguageLabel = (lang: string): string => {
    if (!lang) return 'Code';
    const mapped = LANGUAGE_LABELS[lang];
    if (mapped) return mapped;
    // Uppercase languages (acronyms): 2-4 letter all-alpha → uppercase (e.g. sql→SQL, css→CSS, html→HTML, xml→XML, jsx→JSX, tsx→TSX, php→PHP, ini→INI)
    if (/^[a-z]{1,4}$/.test(lang) && ['sql', 'css', 'html', 'xml', 'jsx', 'tsx', 'php', 'ini', 'toml', 'yaml', 'json', 'scss', 'less', 'sass', 'wasm', 'cuda', 'glsl', 'hlsl', 'csv', 'svg', 'asm', 'nasm', 'vhdl'].includes(lang)) {
        return lang.toUpperCase();
    }
    // Default: capitalize first letter
    return lang.charAt(0).toUpperCase() + lang.slice(1);
};

const CodeBlock: React.FC<CodeBlockProps> = ({ content, language }) => {
    const { colors } = useTheme();
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        Clipboard.setString(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const displayLabel = getLanguageLabel(language || '');

    return (
        <View style={[styles.container, { backgroundColor: '#1E1E1E', borderColor: colors.border }]}>
            <View style={[styles.header, { backgroundColor: '#2D2D2D' }]}>
                <Text style={styles.languageText}>{displayLabel}</Text>
                <Pressable onPress={handleCopy} hitSlop={10} style={styles.copyBtn}>
                    <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy'}</Text>
                </Pressable>
            </View>
            <View style={styles.contentContainer}>
                <Text selectable style={styles.codeText}>{content}</Text>
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
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
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
        color: '#D4D4D4',
        fontSize: 13,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
});

export default CodeBlock;
