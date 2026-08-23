import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeProvider';

interface CodeBlockProps {
    content: string;
    language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ content, language }) => {
    const { colors } = useTheme();
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        Clipboard.setString(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={[styles.container, { backgroundColor: '#1E1E1E', borderColor: colors.border }]}>
            <View style={[styles.header, { backgroundColor: '#2D2D2D' }]}>
                <Text style={styles.languageText}>{language || 'code'}</Text>
                <Pressable onPress={handleCopy} hitSlop={10} style={styles.copyBtn}>
                    <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy'}</Text>
                </Pressable>
            </View>
            <View style={styles.contentContainer}>
                <Text style={styles.codeText}>{content}</Text>
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
