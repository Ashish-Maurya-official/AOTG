import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Reanimated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

export interface PopoverMenuItem {
    key: string;
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
    color?: string;
}

interface PopoverMenuProps {
    visible: boolean;
    onClose: () => void;
    items: PopoverMenuItem[];
    anchorStyle: ViewStyle;
    colors: any;
    isDark: boolean;
}

const PopoverMenu: React.FC<PopoverMenuProps> = ({
    visible,
    onClose,
    items,
    anchorStyle,
    colors,
    isDark,
}) => {
    const popupBgColor = isDark ? 'rgba(34,36,43,0.85)' : 'rgba(255,255,255,0.85)';

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    if (!visible) return null;

    return (
        <Reanimated.View
            entering={FadeIn.duration(250)}
            exiting={FadeOut.duration(150)}
            style={[StyleSheet.absoluteFill, styles.wrapper]}>
            <Pressable
                style={[styles.backdrop, { backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)' }]}
                onPress={handleClose}
            />
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: popupBgColor,
                        borderColor: colors.border,
                    },
                    anchorStyle,
                ]}>
                {items.map((item, index) => (
                    <React.Fragment key={item.key}>
                        {index > 0 && (
                            <Reanimated.View entering={FadeIn.delay(index * 50).duration(200)} exiting={FadeOut.duration(150)}>
                                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                            </Reanimated.View>
                        )}
                        <Reanimated.View entering={ZoomIn.delay(index * 75).duration(200)} exiting={ZoomOut.duration(150)}>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.menuItem,
                                    {
                                        backgroundColor: pressed ? colors.border : (isDark ? colors.background : '#FFF'),
                                        transform: [{ scale: pressed ? 0.96 : 1 }],
                                    },
                                ]}
                                onPress={item.onPress}>
                                {item.icon}
                                <Text style={[styles.menuItemText, { color: item.color || colors.text }]}>
                                    {item.label}
                                </Text>
                            </Pressable>
                        </Reanimated.View>
                    </React.Fragment>
                ))}
            </View>
        </Reanimated.View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        zIndex: 1000,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    container: {
        position: 'absolute',
        borderRadius: 16,
        borderWidth: 1,
        padding: 6,
        minWidth: 180,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
    },
    separator: {
        height: 1,
        marginVertical: 4,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
    },
    menuItemText: {
        fontSize: 14,
        fontWeight: '600',
    },
});

export default memo(PopoverMenu);
