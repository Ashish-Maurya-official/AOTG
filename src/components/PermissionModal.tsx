import React, { memo, useMemo } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import DriveIcon from '../static/images/SVG/DriveIcon';

interface PermissionModalProps {
    visible: boolean;
    title?: string;
    description?: string;
    badgeLabel?: string;
    isPermanentlyDenied?: boolean;
    icon?: React.ReactNode;
    onGrant: () => void;
    onCancel: () => void;
}

const PermissionModal: React.FC<PermissionModalProps> = ({
    visible,
    title = 'Storage Permission Required',
    description = 'We need access to your device storage to import models or save downloaded files securely.',
    badgeLabel = 'ZERO-CLOUD • ON-DEVICE ONLY',
    isPermanentlyDenied = false,
    icon,
    onGrant,
    onCancel,
}) => {
    const { mode, colors } = useTheme();
    const { width } = useWindowDimensions();
    const isTablet = (width || Dimensions.get('window').width) >= 768;
    const isDark = mode === 'dark';

    const dynamicStyles = useMemo(
        () =>
            StyleSheet.create({
                scrim: {
                    backgroundColor: isDark ? 'rgba(9, 10, 15, 0.80)' : 'rgba(15, 23, 42, 0.52)',
                },
                card: {
                    backgroundColor: isDark ? '#1A1D27' : colors.background,
                    borderColor: isDark ? 'rgba(60, 221, 199, 0.28)' : colors.border,
                    maxWidth: isTablet ? 440 : 372,
                },
                medallionHalo: {
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.16)' : 'rgba(16, 163, 127, 0.12)',
                },
                medallionCore: {
                    backgroundColor: isDark ? '#0D0E15' : colors.card,
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.40)' : 'rgba(16, 163, 127, 0.30)',
                },
                badgePill: {
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.14)' : 'rgba(16, 163, 127, 0.10)',
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.28)' : 'rgba(16, 163, 127, 0.24)',
                },
                badgeText: {
                    color: isDark ? '#4EDEA3' : colors.primary,
                },
                titleText: {
                    color: colors.text,
                },
                descriptionText: {
                    color: colors.secondaryText,
                },
                cancelButton: {
                    backgroundColor: isDark ? '#292931' : colors.card,
                    borderColor: isDark ? 'rgba(134, 148, 138, 0.24)' : colors.border,
                },
                cancelText: {
                    color: isDark ? '#BBCABF' : colors.text,
                },
                grantButton: {
                    backgroundColor: isDark ? '#10B981' : colors.primary,
                },
                grantText: {
                    color: isDark ? '#002113' : '#FFFFFF',
                },
            }),
        [colors.background, colors.border, colors.card, colors.primary, colors.secondaryText, colors.text, isDark, isTablet]
    );

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <View style={[styles.overlay, dynamicStyles.scrim]}>
                <View style={[styles.dialog, dynamicStyles.card]}>
                    <View style={styles.medallionWrap}>
                        <View style={[styles.medallionHalo, dynamicStyles.medallionHalo]} />
                        <View style={[styles.medallionCore, dynamicStyles.medallionCore]}>
                            {icon ?? <DriveIcon color={isDark ? '#4EDEA3' : colors.primary} size={32} />}
                        </View>
                    </View>

                    <View style={[styles.badgePill, dynamicStyles.badgePill]}>
                        <View style={styles.badgeDot} />
                        <Text style={[styles.badgeText, dynamicStyles.badgeText]}>{badgeLabel}</Text>
                    </View>

                    <Text style={[styles.title, dynamicStyles.titleText]}>{title}</Text>
                    <Text style={[styles.description, dynamicStyles.descriptionText]}>
                        {isPermanentlyDenied
                            ? 'Permission was permanently denied. Open Android device settings to enable microphone access manually.'
                            : description}
                    </Text>

                    <View style={styles.buttonRow}>
                        <Pressable
                            style={[styles.button, styles.cancelButton, dynamicStyles.cancelButton]}
                            accessibilityRole="button"
                            accessibilityLabel="Dismiss permission request"
                            onPress={onCancel}>
                            <Text style={[styles.buttonText, dynamicStyles.cancelText]}>Not Now</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.button, styles.grantButton, dynamicStyles.grantButton]}
                            accessibilityRole="button"
                            accessibilityLabel={isPermanentlyDenied ? 'Open Settings' : 'Allow Access'}
                            onPress={onGrant}>
                            <Text style={[styles.buttonText, styles.grantButtonText, dynamicStyles.grantText]}>
                                {isPermanentlyDenied ? 'Open Settings' : 'Allow Access'}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    dialog: {
        width: '100%',
        borderRadius: 24,
        paddingHorizontal: 24,
        paddingVertical: 26,
        borderWidth: 1,
        alignItems: 'center',
        elevation: 16,
    },
    medallionWrap: {
        width: 96,
        height: 96,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    medallionHalo: {
        position: 'absolute',
        width: 96,
        height: 96,
        borderRadius: 48,
    },
    medallionCore: {
        width: 76,
        height: 76,
        borderRadius: 38,
        borderWidth: 1.5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        marginBottom: 14,
    },
    badgeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10B981',
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.9,
    },
    title: {
        fontSize: 19,
        fontWeight: '700',
        marginBottom: 10,
        textAlign: 'center',
        letterSpacing: -0.2,
    },
    description: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        marginBottom: 24,
        paddingHorizontal: 4,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    button: {
        flex: 1,
        paddingVertical: 13,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        borderWidth: 1,
    },
    grantButton: {
        elevation: 4,
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    grantButtonText: {
        fontWeight: '700',
    },
});

export default memo(PermissionModal);
