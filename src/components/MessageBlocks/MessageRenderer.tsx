import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { parseMessage } from '../../utils/MessageParser';
import { useTheme } from '../../theme/ThemeProvider';
import CodeBlock from './CodeBlock';
import TerminalBlock from './TerminalBlock';
import TableBlock from './TableBlock';
import TextBlock from './TextBlock';
import JsonBlock from './JsonBlock';
import BlockquoteBlock from './BlockquoteBlock';

interface MessageRendererProps {
    content: string;
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ content }) => {
    const { colors } = useTheme();
    // Memoize the parsed blocks so we don't re-parse on every render
    // unless the content changes (useful for streaming).
    const blocks = useMemo(() => parseMessage(content), [content]);

    return (
        <View style={styles.container}>
            {blocks.map((block) => {
                switch (block.type) {
                    case 'code':
                        return <CodeBlock key={block.id} content={block.content} language={block.language} />;
                    case 'terminal':
                        return <TerminalBlock key={block.id} content={block.content} />;
                    case 'table':
                        return <TableBlock key={block.id} content={block.content} />;
                    case 'json':
                        return <JsonBlock key={block.id} content={block.content} />;
                    case 'blockquote':
                        return <BlockquoteBlock key={block.id} content={block.content} />;
                    case 'horizontalRule':
                        return (
                            <View
                                key={block.id}
                                style={[styles.horizontalRule, { backgroundColor: colors.border }]}
                            />
                        );
                    case 'text':
                    default:
                        // Only render non-empty text blocks
                        return block.content.trim().length > 0 ? (
                            <TextBlock key={block.id} content={block.content} />
                        ) : null;
                }
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    horizontalRule: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 12,
        opacity: 0.5,
    },
});

export default MessageRenderer;
