import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeProvider';

interface TerminalBlockProps {
    content: string;
}

const TerminalBlock: React.FC<TerminalBlockProps> = ({ content }) => {
    const { colors } = useTheme();
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        Clipboard.setString(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={[styles.container, { backgroundColor: '#1A1B26', borderColor: colors.border }]}>
            <View style={[styles.header, { backgroundColor: '#24283B' }]}>
                <View style={styles.macButtons}>
                    <View style={[styles.dot, { backgroundColor: '#FF5F56' }]} />
                    <View style={[styles.dot, { backgroundColor: '#FFBD2E' }]} />
                    <View style={[styles.dot, { backgroundColor: '#27C93F' }]} />
                </View>
                <Text style={styles.languageText}>terminal</Text>
                <Pressable onPress={handleCopy} hitSlop={10} style={styles.copyBtn}>
                    <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy'}</Text>
                </Pressable>
            </View>
            <View style={styles.contentContainer}>
                <Text selectable style={styles.codeText}>$ {content}</Text>
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
    macButtons: {
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
        width: 50,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    languageText: {
        color: '#A9B1D6',
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        flex: 1,
        textAlign: 'center',
    },
    copyBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: '#414868',
        borderRadius: 4,
    },
    copyText: {
        color: '#C0CAF5',
        fontSize: 10,
        fontWeight: 'bold',
    },
    contentContainer: {
        padding: 12,
    },
    codeText: {
        color: '#C0CAF5',
        fontSize: 13,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
});

export default TerminalBlock;
