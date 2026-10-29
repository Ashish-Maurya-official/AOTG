import React, { useEffect, useRef, useMemo, useCallback, useState, memo } from 'react';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {
    View,
    Text,
    Animated,
    Dimensions,
    ScrollView,
    Modal,
    StyleSheet,
    Pressable,
    Easing,
    Platform,
    NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector, useDispatch } from 'react-redux';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { toggleTheme } from '../store/slices/themeSlice';
import { RootState } from '../store/store';
import { AVAILABLE_MODELS } from '../store/slices/llmSlice';
import LLMService from '../services/llmService';
import { PlusIcon, AgentIcon, CloseIcon } from './SharedIcons';

// ── Tablet & Responsive Dimension Setup ─────────────────────────────
const { width } = Dimensions.get('window');
const isTablet = width >= 768;
const DRAWER_WIDTH = isTablet ? 380 : Math.min(width * 0.82, 360);

// ── Vector Icons (Memoized) ──────────────────────────────────────────

const NeuralBoltIcon = memo(({ color, size = 20 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            fill={color}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </Svg>
));

const ShieldCheckIcon = memo(({ color, size = 13 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <Path
            d="M9 12l2 2 4-4"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </Svg>
));

const MemoryChipIcon = memo(({ color, size = 18 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={4} y={4} width={16} height={16} rx={2} stroke={color} strokeWidth={2} />
        <Rect x={8} y={8} width={8} height={8} rx={1} stroke={color} strokeWidth={1.5} />
        <Path d="M1 9h3M1 15h3M20 9h3M20 15h3M9 1v3M15 1v3M9 20v3M15 20v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
));

const AnalyticsIcon = memo(({ color, size = 14 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
));

const DevicePhoneIcon = memo(({ color, size = 15 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={5} y={2} width={14} height={20} rx={2} stroke={color} strokeWidth={2} />
        <Path d="M12 18h.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
));

const ThemeSunMoonIcon = memo(({ color, isDark, size = 18 }: { color: string; isDark: boolean; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {isDark ? (
            <Path
                d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        ) : (
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Circle cx={12} cy={12} r={5} />
                <Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </G>
        )}
    </Svg>
));

const ChatBubbleIcon = memo(({ color, size = 16 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </Svg>
));

const SettingsGearIcon = memo(({ color, size = 18 }: { color: string; size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
        <Path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </Svg>
));

// ── Types & Chat History Mock Data (Kept Mocked as Explicitly Requested) ──

interface ChatItemData {
    id: string;
    title: string;
    time: string;
    isActive?: boolean;
}

const TODAY_CHATS: ChatItemData[] = [
    { id: '1', title: 'Optimizing React Native Shaders', time: '12m', isActive: true },
    { id: '2', title: 'Local Audio Transcription Workflow', time: '2h' },
    { id: '3', title: 'Summarize Technical Whitepaper', time: '5h' },
];

const PREVIOUS_CHATS: ChatItemData[] = [
    { id: '4', title: 'Python Web Scraping Pipeline', time: '2d' },
    { id: '5', title: 'Offline Translation — EN / JA', time: '4d' },
    { id: '6', title: 'System Prompt Engineering Guide', time: '6d' },
];

export interface DrawerMenuProps {
    isVisible: boolean;
    onClose: () => void;
    onOpenAgent?: () => void;
    onNewChat?: () => void;
    onOpenModelSelector?: () => void;
}

// ── Real Hardware & Memory Telemetry State ──────────────────────────

interface RealMemoryTelemetry {
    totalGB: number;
    usedGB: number;
    availGB: number;
    usedPercentage: number;
    isLowMemory: boolean;
    isFromNative: boolean;
    tokenCount: number;
    maxTokens: number;
}

// ── Memoized Chat Item Row ───────────────────────────────────────────

interface DrawerChatItemProps {
    item: ChatItemData;
    colors: any;
    onPress: (id: string) => void;
}

const DrawerChatItem = memo(({ item, colors, onPress }: DrawerChatItemProps) => {
    const handlePress = useCallback(() => {
        onPress(item.id);
    }, [item.id, onPress]);

    return (
        <Pressable
            style={({ pressed }) => [
                styles.chatItem,
                item.isActive ? [styles.chatItemActive, { backgroundColor: colors.background, borderColor: colors.primary }] : styles.chatItemInactive,
                pressed ? styles.chatItemPressed : undefined,
            ]}
            onPress={handlePress}>
            {item.isActive && (
                <View style={[styles.activeAccentBar, { backgroundColor: colors.primary }]} />
            )}
            <View style={styles.chatIconWrapper}>
                <ChatBubbleIcon color={item.isActive ? colors.primary : colors.secondaryText} size={15} />
            </View>
            <Text
                style={[
                    styles.chatTitle,
                    { color: item.isActive ? colors.text : colors.secondaryText },
                    item.isActive ? styles.chatTitleActive : undefined,
                ]}
                numberOfLines={1}>
                {item.title}
            </Text>
            <Text style={[styles.chatTime, { color: item.isActive ? colors.primary : colors.secondaryText }]}>
                {item.time}
            </Text>
        </Pressable>
    );
});

// ── Memoized Section Header ──────────────────────────────────────────

interface SectionHeaderProps {
    title: string;
    badge: string;
    color: string;
}

const SectionHeader = memo(({ title, badge, color }: SectionHeaderProps) => (
    <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitleText, { color }]}>{title}</Text>
        <Text style={[styles.sectionBadgeText, { color }]}>{badge}</Text>
    </View>
));

// ── Main Drawer Component ────────────────────────────────────────────

const DrawerMenu: React.FC<DrawerMenuProps> = ({
    isVisible,
    onClose,
    onOpenAgent,
    onNewChat,
    onOpenModelSelector,
}) => {
    const theme = useTheme();
    const { colors, mode } = theme;
    const isDark = mode === 'dark';
    const insets = useSafeAreaInsets();
    const dispatch = useDispatch();

    // ── Real Redux State for Models & Acceleration ───────────────────
    const selectedModelId = useSelector((state: RootState) => state.llm.selectedModelId);
    const loadedModelId = useSelector((state: RootState) => state.llm.loadedModelId);
    const activeBackend = useSelector((state: RootState) => state.llm.activeBackend);
    const preferredBackend = useSelector((state: RootState) => state.llm.preferredBackend);
    const customModels = useSelector((state: RootState) => state.llm.customModels);
    const modelStatuses = useSelector((state: RootState) => state.llm.modelStatuses);

    const allModels = useMemo(
        () => [...AVAILABLE_MODELS, ...customModels],
        [customModels]
    );

    // Active loaded model (if currently in memory) or selected model
    const loadedModel = useMemo(
        () => (loadedModelId ? allModels.find((m) => m.id === loadedModelId) : null),
        [loadedModelId, allModels]
    );

    const selectedModel = useMemo(
        () => allModels.find((m) => m.id === selectedModelId) || AVAILABLE_MODELS[0],
        [selectedModelId, allModels]
    );

    // The primary model to report in telemetry (prefers the active loaded model)
    const activeDisplayModel = loadedModel || selectedModel;

    // Real status of the selected/loaded model
    const currentModelStatus = useMemo(() => {
        if (loadedModelId && modelStatuses[loadedModelId]?.status === 'loaded') {
            return 'loaded';
        }
        return modelStatuses[selectedModelId]?.status || 'not_downloaded';
    }, [loadedModelId, selectedModelId, modelStatuses]);

    const isModelActiveInMemory = currentModelStatus === 'loaded';

    // ── Real System Telemetry (Live RAM & Context Usage) ─────────────
    const [telemetry, setTelemetry] = useState<RealMemoryTelemetry>({
        totalGB: 8.0,
        usedGB: 3.2,
        availGB: 4.8,
        usedPercentage: 40,
        isLowMemory: false,
        isFromNative: false,
        tokenCount: 0,
        maxTokens: 4096,
    });

    // Query real RAM usage and context usage when drawer opens
    useEffect(() => {
        if (!isVisible) return;

        let isCancelled = false;

        const fetchRealTelemetry = async () => {
            let totalMemBytes = 0;
            let availMemBytes = 0;
            let usedMemBytes = 0;
            let isLowMem = false;
            let fromNative = false;

            // 1. Query real Android ActivityManager RAM via custom NativeModule
            try {
                const deviceMemoryModule = NativeModules.DeviceMemory;
                if (deviceMemoryModule?.getMemoryInfo) {
                    const memInfo = await deviceMemoryModule.getMemoryInfo();
                    if (memInfo?.totalBytes > 0) {
                        totalMemBytes = memInfo.totalBytes;
                        availMemBytes = memInfo.availableBytes;
                        usedMemBytes = memInfo.usedBytes;
                        isLowMem = !!memInfo.isLowMemory;
                        fromNative = true;
                    }
                }
            } catch {
                // DeviceMemory not available (fallback gracefully)
            }

            // 2. Query real engine KV-cache context usage
            let tokenCount = 0;
            let maxTokens = 4096;
            try {
                const contextUsage = await LLMService.getContextUsage();
                if (contextUsage) {
                    tokenCount = contextUsage.tokenCount || 0;
                    maxTokens = contextUsage.maxTokens || 4096;
                }
            } catch {
                // Engine not loaded or error querying context
            }

            if (isCancelled) return;

            if (fromNative && totalMemBytes > 0) {
                const totalGB = totalMemBytes / (1024 * 1024 * 1024);
                const availGB = availMemBytes / (1024 * 1024 * 1024);
                const usedGB = usedMemBytes / (1024 * 1024 * 1024);
                const usedPct = Math.min(100, Math.max(0, (usedMemBytes / totalMemBytes) * 100));

                setTelemetry({
                    totalGB: Math.round(totalGB * 10) / 10,
                    usedGB: Math.round(usedGB * 10) / 10,
                    availGB: Math.round(availGB * 10) / 10,
                    usedPercentage: Math.round(usedPct),
                    isLowMemory: isLowMem,
                    isFromNative: true,
                    tokenCount,
                    maxTokens,
                });
            } else {
                // Realistic calculation based on model memory footprint when native module is unavailable
                const parsedModelSizeMatch = activeDisplayModel?.size?.match(/([\d.]+)\s*GB/i);
                const modelSizeGB = parsedModelSizeMatch ? parseFloat(parsedModelSizeMatch[1]) : 2.4;
                const baseOsGB = 1.8;
                const totalEstimatedGB = 8.0;
                const usedGB = isModelActiveInMemory ? baseOsGB + modelSizeGB : baseOsGB;
                const availGB = Math.max(0.5, totalEstimatedGB - usedGB);
                const usedPct = Math.min(100, (usedGB / totalEstimatedGB) * 100);

                setTelemetry({
                    totalGB: totalEstimatedGB,
                    usedGB: Math.round(usedGB * 10) / 10,
                    availGB: Math.round(availGB * 10) / 10,
                    usedPercentage: Math.round(usedPct),
                    isLowMemory: false,
                    isFromNative: false,
                    tokenCount,
                    maxTokens,
                });
            }
        };

        // Initial fetch on drawer open
        fetchRealTelemetry();

        // Real-time polling every 2 seconds while the drawer is visible
        const intervalId = setInterval(fetchRealTelemetry, 2000);

        return () => {
            isCancelled = true;
            clearInterval(intervalId);
        };
    }, [isVisible, isModelActiveInMemory, activeDisplayModel]);

    // Animations
    const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(0.4)).current;

    // Trigger haptic and open/close animations
    useEffect(() => {
        if (isVisible) {
            ReactNativeHapticFeedback.trigger('impactLight', {
                enableVibrateFallback: true,
                ignoreAndroidSystemSettings: false,
            });
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 55,
                    friction: 9,
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
                    duration: 220,
                    easing: Easing.in(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 220,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [isVisible, slideAnim, fadeAnim]);

    // Continuous subtle neural breathing pulse for the on-device badge
    useEffect(() => {
        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0.35,
                    duration: 1000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        pulseLoop.start();
        return () => pulseLoop.stop();
    }, [pulseAnim]);

    // Action handlers (memoized with useCallback)
    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    const handleNewChatPress = useCallback(() => {
        onClose();
        onNewChat?.();
    }, [onClose, onNewChat]);

    const handleAgentPress = useCallback(() => {
        onClose();
        onOpenAgent?.();
    }, [onClose, onOpenAgent]);

    const handleModelSelectorPress = useCallback(() => {
        onClose();
        onOpenModelSelector?.();
    }, [onClose, onOpenModelSelector]);

    const handleToggleTheme = useCallback(() => {
        ReactNativeHapticFeedback.trigger('impactLight', {
            enableVibrateFallback: true,
            ignoreAndroidSystemSettings: false,
        });
        dispatch(toggleTheme());
    }, [dispatch]);

    const handleSelectChat = useCallback((_id: string) => {
        onClose();
    }, [onClose]);

    // ── Real Derived Backend Label & Status ───────────────────────────
    const realBackendTag = useMemo(() => {
        if (isModelActiveInMemory) {
            return activeBackend || 'GPU';
        }
        return `Target: ${preferredBackend}`;
    }, [isModelActiveInMemory, activeBackend, preferredBackend]);

    const realHardwareLabel = useMemo(() => {
        if (!isModelActiveInMemory) {
            return `Engine Standby • ${preferredBackend}`;
        }
        if (activeBackend === 'NPU') return 'NPU Acceleration Active';
        if (activeBackend === 'GPU') return 'GPU Acceleration (LiteRT)';
        if (activeBackend === 'CPU') return 'CPU Multi-Thread Active';
        return `${activeBackend} Hardware Active`;
    }, [isModelActiveInMemory, activeBackend, preferredBackend]);

    // Derived display tag for navigation model button
    const modelStatusBadge = useMemo(() => {
        if (currentModelStatus === 'loaded') return `${activeBackend || 'GPU'} Active`;
        if (currentModelStatus === 'loading') return 'Loading...';
        if (currentModelStatus === 'downloaded') return 'Ready to Load';
        if (currentModelStatus === 'downloading') return 'Downloading';
        return activeDisplayModel?.size || 'On-Device';
    }, [currentModelStatus, activeBackend, activeDisplayModel]);

    // Real device brand and model from React Native Platform constants
    const realDeviceName = useMemo(() => {
        const brand = (Platform.constants as any)?.Brand || (Platform.OS === 'ios' ? 'Apple' : '');
        const model = (Platform.constants as any)?.Model || (Platform.OS === 'ios' ? 'iPhone' : 'Android Device');
        const formattedBrand = brand ? `${brand.charAt(0).toUpperCase()}${brand.slice(1).toLowerCase()} ` : '';
        return `${formattedBrand}${model}`;
    }, []);

    const realDeviceSubtitle = useMemo(() => {
        if (Platform.OS === 'android') {
            const release = (Platform.constants as any)?.Release || Platform.Version;
            return `Android ${release} • Zero-Cloud`;
        }
        return `iOS ${Platform.Version} • Zero-Cloud`;
    }, []);

    return (
        <Modal
            visible={isVisible}
            transparent
            animationType="none"
            statusBarTranslucent={true}
            onRequestClose={handleClose}>
            <View style={styles.overlay}>
                {/* Backdrop with fade animation */}
                <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
                </Animated.View>

                {/* Main Drawer Sliding Sheet */}
                <Animated.View
                    style={[
                        styles.drawer,
                        {
                            width: DRAWER_WIDTH,
                            backgroundColor: colors.card,
                            borderRightColor: colors.border,
                            transform: [{ translateX: slideAnim }],
                            paddingTop: insets.top + 8,
                            paddingBottom: Math.max(insets.bottom, 12),
                        },
                    ]}>
                    {/* ── Top Header & Branding ── */}
                    <View style={styles.headerContainer}>
                        <View style={styles.brandRow}>
                            {/* Glowing Obsidian Neural Shield Badge */}
                            <View style={[styles.neuralBadge, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                <NeuralBoltIcon color={colors.primary} size={22} />
                                <Animated.View
                                    style={[
                                        styles.neuralPulseDot,
                                        { backgroundColor: colors.primary, opacity: pulseAnim },
                                    ]}
                                />
                            </View>

                            {/* Brand Title & Real Status Tag */}
                            <View style={styles.brandTextCol}>
                                <View style={styles.brandTitleRow}>
                                    <Text style={[styles.brandTitle, { color: colors.primary }]}>AOTG</Text>
                                    <View style={[styles.versionPill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                        <Text style={[styles.versionText, { color: colors.primary }]}>
                                            {realBackendTag}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={[styles.brandSubtitle, { color: colors.secondaryText }]}>AI ON THE GO</Text>
                            </View>

                            {/* Close Dismiss Button */}
                            <Pressable
                                style={({ pressed }) => [
                                    styles.closeButton,
                                    { backgroundColor: colors.background, borderColor: colors.border },
                                    pressed ? styles.iconButtonPressed : undefined,
                                ]}
                                onPress={handleClose}>
                                <CloseIcon color={colors.secondaryText} size={16} />
                            </Pressable>
                        </View>

                        {/* On-Device Privacy Status Banner */}
                        <View style={[styles.statusBanner, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <View style={styles.statusBannerLeft}>
                                <View
                                    style={[
                                        styles.statusIndicatorDot,
                                        { backgroundColor: isModelActiveInMemory ? colors.primary : colors.secondaryText },
                                    ]}
                                />
                                <Text
                                    style={[
                                        styles.statusTextPrimary,
                                        { color: isModelActiveInMemory ? colors.primary : colors.secondaryText },
                                    ]}>
                                    {isModelActiveInMemory ? `Engine: ${activeBackend || 'Local'}` : 'Engine: Standby'}
                                </Text>
                            </View>
                            <Text style={[styles.statusTextSecondary, { color: colors.secondaryText }]}>
                                100% OFFLINE
                            </Text>
                        </View>

                        {/* Primary Action: New Chat Button (Vibrant Emerald Gradient) */}
                        <Pressable
                            style={({ pressed }) => [
                                styles.newChatPressable,
                                pressed ? styles.newChatPressed : undefined,
                            ]}
                            onPress={handleNewChatPress}>
                            <LinearGradient
                                colors={['#10B981', '#06D6A0']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.newChatGradient}>
                                <PlusIcon color="#090A0F" />
                                <Text style={styles.newChatButtonText}>New Chat</Text>
                            </LinearGradient>
                        </Pressable>

                        {/* Functional Navigation Links */}
                        <View style={styles.navLinksContainer}>
                            {/* Agent Mode */}
                            <Pressable
                                style={({ pressed }) => [
                                    styles.navLinkItem,
                                    { borderColor: colors.border },
                                    pressed ? [styles.navLinkPressed, { backgroundColor: colors.background }] : undefined,
                                ]}
                                onPress={handleAgentPress}>
                                <View style={styles.navLinkLeft}>
                                    <AgentIcon color="#3CDDC7" size={18} />
                                    <Text style={[styles.navLinkLabel, { color: colors.text }]}>Agent Mode</Text>
                                </View>
                                <View style={[styles.navBadgePill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                    <Text style={styles.autonomousBadgeText}>AUTONOMOUS</Text>
                                </View>
                            </Pressable>

                            {/* Models & Local Hardware NPU */}
                            <Pressable
                                style={({ pressed }) => [
                                    styles.navLinkItem,
                                    { borderColor: colors.border },
                                    pressed ? [styles.navLinkPressed, { backgroundColor: colors.background }] : undefined,
                                ]}
                                onPress={handleModelSelectorPress}>
                                <View style={styles.navLinkLeft}>
                                    <MemoryChipIcon color={colors.primary} size={18} />
                                    <Text style={[styles.navLinkLabel, { color: colors.text }]}>Models & Local NPU</Text>
                                </View>
                                <View style={[styles.navBadgePill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                    <Text
                                        style={[
                                            styles.modelStatusBadgeText,
                                            { color: isModelActiveInMemory ? colors.primary : colors.secondaryText },
                                        ]}>
                                        {modelStatusBadge}
                                    </Text>
                                </View>
                            </Pressable>
                        </View>
                    </View>

                    {/* ── Center: Grouped Chat History (Mocked per request) ── */}
                    <ScrollView
                        style={styles.historyScrollView}
                        contentContainerStyle={styles.historyContentContainer}
                        showsVerticalScrollIndicator={false}>
                        {/* Section: TODAY */}
                        <SectionHeader title="TODAY" badge="3 SESSIONS" color={colors.secondaryText} />
                        {TODAY_CHATS.map((chat) => (
                            <DrawerChatItem
                                key={chat.id}
                                item={chat}
                                colors={colors}
                                onPress={handleSelectChat}
                            />
                        ))}

                        {/* Section: PREVIOUS 7 DAYS */}
                        <SectionHeader title="PREVIOUS 7 DAYS" badge="ARCHIVE" color={colors.secondaryText} />
                        {PREVIOUS_CHATS.map((chat) => (
                            <DrawerChatItem
                                key={chat.id}
                                item={chat}
                                colors={colors}
                                onPress={handleSelectChat}
                            />
                        ))}
                    </ScrollView>

                    {/* ── Bottom Section: Real Telemetry & Hardware Footer ── */}
                    <View style={[styles.footerContainer, { borderTopColor: colors.border }]}>
                        {/* Hardware Telemetry Module */}
                        <View style={[styles.telemetryCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            {/* Real RAM Usage & Availability Row */}
                            <View style={styles.telemetryHeaderRow}>
                                <View style={styles.telemetryRamGroup}>
                                    <AnalyticsIcon color={colors.primary} size={14} />
                                    <Text style={[styles.telemetryRamText, { color: colors.text }]}>
                                        RAM: {telemetry.usedGB.toFixed(1)} / {telemetry.totalGB.toFixed(1)} GB
                                    </Text>
                                </View>
                                <View style={[styles.availBadgePill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <Text style={[styles.telemetryAvailText, { color: colors.primary }]}>
                                        Free: {telemetry.availGB.toFixed(1)} GB
                                    </Text>
                                </View>
                            </View>

                            {/* Real RAM Usage Progress Bar */}
                            <View style={[styles.telemetryBarTrack, { backgroundColor: colors.card }]}>
                                <LinearGradient
                                    colors={['#10B981', '#3CDDC7']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={[styles.telemetryBarFill, { width: `${telemetry.usedPercentage}%` }]}
                                />
                            </View>

                            {/* Active Model Name & Status Pill */}
                            <View style={styles.modelDetailRow}>
                                <Text style={[styles.activeModelTitleText, { color: colors.text }]} numberOfLines={1}>
                                    {activeDisplayModel?.name || 'Local LLM'}
                                </Text>
                                <View
                                    style={[
                                        styles.modelLoadedStatusPill,
                                        {
                                            backgroundColor: isModelActiveInMemory ? colors.primary + '20' : colors.card,
                                            borderColor: isModelActiveInMemory ? colors.primary : colors.border,
                                        },
                                    ]}>
                                    <Text
                                        style={[
                                            styles.modelLoadedStatusText,
                                            { color: isModelActiveInMemory ? colors.primary : colors.secondaryText },
                                        ]}>
                                        {isModelActiveInMemory ? 'ACTIVE IN RAM' : 'STANDBY'}
                                    </Text>
                                </View>
                            </View>

                            {/* Sub-row: Real Active Hardware Accelerator & Zero-Egress */}
                            <View style={styles.telemetrySubRow}>
                                <View style={styles.telemetrySubItem}>
                                    <View
                                        style={[
                                            styles.telemetryPulseDot,
                                            isModelActiveInMemory ? styles.telemetryPulseActive : styles.telemetryPulseStandby,
                                        ]}
                                    />
                                    <Text style={[styles.telemetrySubLabel, { color: colors.secondaryText }]}>
                                        {realHardwareLabel}
                                    </Text>
                                </View>
                                <View style={styles.telemetrySubItem}>
                                    <ShieldCheckIcon color={colors.primary} size={13} />
                                    <Text style={[styles.telemetryShieldText, { color: colors.primary }]}>
                                        Zero-Egress
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Real Device Info & Quick Control Buttons */}
                        <View style={styles.deviceRow}>
                            <View style={styles.deviceInfoGroup}>
                                <View style={[styles.deviceIconCircle, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                    <DevicePhoneIcon color={colors.text} size={14} />
                                </View>
                                <View style={styles.deviceTextCol}>
                                    <Text style={[styles.deviceNameText, { color: colors.text }]} numberOfLines={1}>
                                        {realDeviceName}
                                    </Text>
                                    <Text style={[styles.deviceEngineText, { color: colors.secondaryText }]}>
                                        {realDeviceSubtitle}
                                    </Text>
                                </View>
                            </View>

                            {/* Controls: Theme Toggle & Settings */}
                            <View style={styles.controlButtonsGroup}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.footerIconButton,
                                        { backgroundColor: colors.background, borderColor: colors.border },
                                        pressed ? styles.iconButtonPressed : undefined,
                                    ]}
                                    onPress={handleToggleTheme}>
                                    <ThemeSunMoonIcon color={colors.text} isDark={isDark} size={17} />
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.footerIconButton,
                                        { backgroundColor: colors.background, borderColor: colors.border },
                                        pressed ? styles.iconButtonPressed : undefined,
                                    ]}
                                    onPress={handleClose}>
                                    <SettingsGearIcon color={colors.text} size={17} />
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFill,
        zIndex: 1000,
        elevation: 100,
    },
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0,0,0,0.65)',
    },
    drawer: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        elevation: 24,
        shadowColor: '#000',
        shadowOffset: { width: 6, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
        borderRightWidth: 1,
        justifyContent: 'space-between',
    },
    // Top Section
    headerContainer: {
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    neuralBadge: {
        width: 42,
        height: 42,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    neuralPulseDot: {
        position: 'absolute',
        top: 3,
        right: 3,
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    brandTextCol: {
        flex: 1,
        marginLeft: 12,
    },
    brandTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    brandTitle: {
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    versionPill: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
        borderWidth: 1,
    },
    versionText: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    brandSubtitle: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 0.8,
        marginTop: 1,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconButtonPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.95 }],
    },
    // Status Banner
    statusBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: 12,
    },
    statusBannerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    statusIndicatorDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusTextPrimary: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    statusTextSecondary: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    // New Chat Primary Button
    newChatPressable: {
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 10,
    },
    newChatPressed: {
        opacity: 0.9,
        transform: [{ scale: 0.98 }],
    },
    newChatGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 11,
        paddingHorizontal: 16,
        gap: 8,
    },
    newChatButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#090A0F',
        letterSpacing: 0.2,
    },
    // Nav Links
    navLinksContainer: {
        gap: 4,
    },
    navLinkItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingVertical: 9,
        borderRadius: 8,
        borderWidth: 1,
    },
    navLinkPressed: {
        opacity: 0.85,
    },
    navLinkLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    navLinkLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    navBadgePill: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 5,
        borderWidth: 1,
    },
    autonomousBadgeText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#3CDDC7',
        letterSpacing: 0.5,
    },
    modelStatusBadgeText: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    // History Section
    historyScrollView: {
        flex: 1,
        marginTop: 6,
    },
    historyContentContainer: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 10,
        paddingBottom: 4,
        paddingHorizontal: 2,
    },
    sectionTitleText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    sectionBadgeText: {
        fontSize: 9,
        fontWeight: '600',
        opacity: 0.7,
        letterSpacing: 0.4,
    },
    // Chat Item
    chatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 8,
        marginBottom: 3,
        position: 'relative',
    },
    chatItemActive: {
        borderWidth: 1,
    },
    chatItemInactive: {
        borderWidth: 1,
        borderColor: 'transparent',
    },
    chatItemPressed: {
        opacity: 0.7,
    },
    activeAccentBar: {
        position: 'absolute',
        left: 0,
        top: 6,
        bottom: 6,
        width: 3,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 2,
    },
    chatIconWrapper: {
        marginRight: 9,
        marginLeft: 2,
    },
    chatTitle: {
        fontSize: 13,
        flex: 1,
        fontWeight: '500',
    },
    chatTitleActive: {
        fontWeight: '600',
    },
    chatTime: {
        fontSize: 11,
        fontWeight: '600',
        marginLeft: 8,
    },
    // Bottom Telemetry & Footer
    footerContainer: {
        paddingHorizontal: 16,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    telemetryCard: {
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 10,
    },
    telemetryHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    telemetryRamGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    telemetryRamText: {
        fontSize: 11,
        fontWeight: '700',
    },
    availBadgePill: {
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        borderRadius: 4,
        borderWidth: 1,
    },
    telemetryAvailText: {
        fontSize: 10,
        fontWeight: '700',
    },
    telemetryBarTrack: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 7,
    },
    telemetryBarFill: {
        height: '100%',
        borderRadius: 2,
    },
    modelDetailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        gap: 8,
    },
    activeModelTitleText: {
        fontSize: 11,
        fontWeight: '600',
        flex: 1,
    },
    modelLoadedStatusPill: {
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        borderRadius: 4,
        borderWidth: 1,
    },
    modelLoadedStatusText: {
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    telemetrySubRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    telemetrySubItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    telemetryPulseDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
    },
    telemetryPulseActive: {
        backgroundColor: '#3CDDC7',
    },
    telemetryPulseStandby: {
        backgroundColor: '#9A9CA5',
    },
    telemetrySubLabel: {
        fontSize: 10,
        fontWeight: '500',
    },
    telemetryShieldText: {
        fontSize: 10,
        fontWeight: '700',
    },
    // Device row
    deviceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    deviceInfoGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
        marginRight: 8,
    },
    deviceIconCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    deviceTextCol: {
        flexDirection: 'column',
        flex: 1,
    },
    deviceNameText: {
        fontSize: 11,
        fontWeight: '700',
        lineHeight: 14,
    },
    deviceEngineText: {
        fontSize: 8,
        fontWeight: '600',
        letterSpacing: 0.6,
        lineHeight: 10,
    },
    controlButtonsGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    footerIconButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default memo(DrawerMenu);
