import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, LayoutAnimation } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { ThinkingIcon, ChevronDownIcon } from '../SharedIcons';

interface ThinkBlockProps {
    content: string;
}

const ThinkBlock: React.FC<ThinkBlockProps> = ({ content }) => {
    const { colors } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setIsExpanded(!isExpanded);
    };

    return (
        <View style={[styles.container, { borderColor: colors.border, backgroundColor: colors.background + '80' }]}>
            <Pressable style={styles.header} onPress={toggleExpand}>
                <View style={styles.headerLeft}>
                    <ThinkingIcon color={colors.secondaryText} size={16} />
                    <Text style={[styles.headerText, { color: colors.secondaryText }]}>
                        Thought process
                    </Text>
                </View>
                <View style={[styles.chevron, { transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }]}>
                    <ChevronDownIcon color={colors.secondaryText} />
                </View>
            </Pressable>
            {isExpanded && (
                <View style={[styles.contentContainer, { borderTopColor: colors.border }]}>
                    <Text style={[styles.contentText, { color: colors.secondaryText }]}>
                        {content}
                    </Text>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 8,
        marginVertical: 8,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '500',
    },
    chevron: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    contentContainer: {
        borderTopWidth: 1,
        padding: 12,
    },
    contentText: {
        fontSize: 14,
        lineHeight: 20,
    },
});

export default ThinkBlock;
