import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import DriveIcon from '../static/images/SVG/DriveIcon';

interface PermissionModalProps {
    visible: boolean;
    title?: string;
    description?: string;
    isPermanentlyDenied?: boolean;
    onGrant: () => void;
    onCancel: () => void;
}

const PermissionModal: React.FC<PermissionModalProps> = ({
    visible,
    title = 'Storage Permission Required',
    description = 'We need access to your device storage to import models or save downloaded files securely.',
    isPermanentlyDenied = false,
    onGrant,
    onCancel,
}) => {
    const { colors } = useTheme();

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.overlay}>
                <View style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(128, 128, 128, 0.15)' }]}>
                        <DriveIcon color={colors.text} size={32} />
                    </View>
                    <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.description, { color: colors.secondaryText }]}>
                        {isPermanentlyDenied
                            ? 'Permission was permanently denied. Please enable it manually in your device settings to continue.'
                            : description}
                    </Text>
                    
                    <View style={styles.buttonRow}>
                        <Pressable style={[styles.button, styles.cancelButton, { borderColor: colors.border }]} onPress={onCancel}>
                            <Text style={[styles.buttonText, { color: colors.text }]}>Not Now</Text>
                        </Pressable>
                        <Pressable style={[styles.button, styles.grantButton, { backgroundColor: colors.text }]} onPress={onGrant}>
                            <Text style={[styles.buttonText, { color: colors.background }]}>
                                {isPermanentlyDenied ? 'Open Settings' : 'Grant Permission'}
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
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    dialog: {
        width: '100%',
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        alignItems: 'center',
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        marginBottom: 12,
        textAlign: 'center',
    },
    description: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        marginBottom: 24,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        borderWidth: 1,
        backgroundColor: 'transparent',
    },
    grantButton: {
        // backgroundColor is dynamic
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
    },
});

export default PermissionModal;
