import React, { useEffect, useRef, memo } from 'react';
import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import {
    View,
    Text,
    Animated,
    Dimensions,
    ScrollView,
    Modal,
    StyleSheet,
    Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

// --- Icons ---
const PlusIcon = memo(({ color }: { color: string }) => (
    <View style={iconStyles.plusIconContainer}>
        <View style={[iconStyles.plusLineH, { backgroundColor: color }]} />
        <View style={[iconStyles.plusLineV, { backgroundColor: color }]} />
    </View>
));

const ChatIcon = memo(({ color }: { color: string }) => (
    <View style={[iconStyles.chatIconContainer, { borderColor: color }]}>
        <View style={[iconStyles.chatLine1, { backgroundColor: color }]} />
        <View style={[iconStyles.chatLine2, { backgroundColor: color }]} />
    </View>
));

const SettingsIcon = memo(({ color }: { color: string }) => (
    <View style={iconStyles.settingsIconContainer}>
        <View style={[iconStyles.settingsGear, { borderColor: color }]} />
        <View style={[iconStyles.settingsDot, { backgroundColor: color }]} />
    </View>
));

const AgentIcon = memo(({ color }: { color: string }) => (
    <View style={iconStyles.agentIconContainer}>
        <View style={[iconStyles.agentCircle, { borderColor: color }]} />
        <View style={[iconStyles.agentDotLeft, { backgroundColor: color }]} />
        <View style={[iconStyles.agentDotRight, { backgroundColor: color }]} />
    </View>
));

const { width, height } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.75;

interface DrawerMenuProps {
    isVisible: boolean;
    onClose: () => void;
    onOpenAgent?: () => void;
    onNewChat?: () => void;
}

const MOCK_CHATS = [
    { id: '1', title: 'Discussing React Native' },
    { id: '2', title: 'Debug Android Build' },
    { id: '3', title: 'Write a Python Script' },
    { id: '4', title: 'Explain Quantum Physics' },
];

const DrawerMenu: React.FC<DrawerMenuProps> = ({ isVisible, onClose, onOpenAgent, onNewChat }) => {
    console.log('DrawerMenu rendered, isVisible:', isVisible);
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isVisible) {
            ReactNativeHapticFeedback.trigger("impactLight", {
                enableVibrateFallback: true,
                ignoreAndroidSystemSettings: false
            });
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 50,
                    friction: 8,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 250,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: -DRAWER_WIDTH,
                    duration: 250,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 250,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [isVisible, slideAnim, fadeAnim]);

    return (
        <Modal 
            visible={isVisible} 
            transparent 
            animationType="none" 
            statusBarTranslucent={true}
            onRequestClose={onClose}>
            <View style={styles.overlay}>
                {/* Backdrop */}
                <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                </Animated.View>

                {/* Drawer */}
                <Animated.View
                    style={[
                        styles.drawer,
                        {
                            backgroundColor: colors.card,
                            transform: [{ translateX: slideAnim }],
                            paddingTop: insets.top,
                            paddingBottom: insets.bottom,
                            borderRightWidth: 1,
                            borderRightColor: colors.border,
                        },
                    ]}>
                {/* Header / New Chat */}
                <View style={styles.header}>
                    <Pressable
                        style={[styles.newChatBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                        onPress={() => { onClose(); onNewChat?.(); }}>
                        <PlusIcon color={colors.text} />
                        <Text style={[styles.newChatText, { color: colors.text }]}>
                            New Chat
                        </Text>
                    </Pressable>
                </View>

                {/* Chat History */}
                <ScrollView
                    style={styles.historyList}
                    showsVerticalScrollIndicator={false}>
                    <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                        Recent Chats
                    </Text>
                    {MOCK_CHATS.map((chat) => (
                        <Pressable key={chat.id} style={styles.chatItem} onPress={onClose}>
                            <ChatIcon color={colors.secondaryText} />
                            <Text
                                style={[styles.chatTitle, { color: colors.text }]}
                                numberOfLines={1}>
                                {chat.title}
                            </Text>
                        </Pressable>
                    ))}
                </ScrollView>

                {/* Footer */}
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                    <Pressable style={styles.footerItem} onPress={() => { onClose(); onOpenAgent?.(); }}>
                        <AgentIcon color={colors.primary} />
                        <Text style={[styles.footerText, { color: colors.primary }]}>Agent Mode</Text>
                    </Pressable>
                    <Pressable style={styles.footerItem} onPress={onClose}>
                        <SettingsIcon color={colors.text} />
                        <Text style={[styles.footerText, { color: colors.text }]}>Settings</Text>
                    </Pressable>
                </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFill,
        zIndex: 1000,
        elevation: 100,
    },
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    drawer: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: DRAWER_WIDTH,
        elevation: 24,
        shadowColor: '#000',
        shadowOffset: { width: 5, height: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 24,
    },
    newChatBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderRadius: 12,
        gap: 12,
    },
    newChatText: {
        fontSize: 16,
        fontWeight: '600',
    },
    historyList: {
        flex: 1,
        paddingHorizontal: 16,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 12,
        marginTop: 8,
        letterSpacing: 0.5,
    },
    chatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 14,
    },
    chatTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
    },
    footer: {
        padding: 20,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    footerItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 8,
    },
    footerText: {
        fontSize: 16,
        fontWeight: '600',
    },
});

const iconStyles = StyleSheet.create({
    plusIconContainer: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    plusLineH: {
        position: 'absolute',
        width: 14,
        height: 2,
        borderRadius: 1,
    },
    plusLineV: {
        position: 'absolute',
        width: 2,
        height: 14,
        borderRadius: 1,
    },
    chatIconContainer: {
        width: 18,
        height: 18,
        borderWidth: 1.5,
        borderRadius: 4,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 3,
    },
    chatLine1: {
        width: 8,
        height: 1.5,
        borderRadius: 1,
        alignSelf: 'flex-start',
        marginLeft: 3,
    },
    chatLine2: {
        width: 6,
        height: 1.5,
        borderRadius: 1,
        alignSelf: 'flex-start',
        marginLeft: 3,
    },
    settingsIconContainer: {
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    settingsGear: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
    },
    settingsDot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    agentIconContainer: {
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    agentCircle: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
    },
    agentDotLeft: {
        position: 'absolute',
        width: 4,
        height: 4,
        borderRadius: 2,
        left: 5,
        top: 7,
    },
    agentDotRight: {
        position: 'absolute',
        width: 4,
        height: 4,
        borderRadius: 2,
        right: 5,
        top: 7,
    },
});

export default memo(DrawerMenu);
