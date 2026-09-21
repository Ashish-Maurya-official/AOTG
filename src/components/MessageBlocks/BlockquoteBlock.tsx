import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import TextBlock from './TextBlock';

interface BlockquoteBlockProps {
    content: string;
}

const BlockquoteBlock: React.FC<BlockquoteBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.container, { borderLeftColor: colors.primary || '#10A37F' }]}>
            <TextBlock content={content} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        borderLeftWidth: 3,
        paddingLeft: 12,
        marginVertical: 4,
        opacity: 0.9,
    },
});

export default BlockquoteBlock;
