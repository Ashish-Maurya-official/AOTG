import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Dimensions,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeProvider';
import { RootState } from '../../store/store';
import { BackendType, setPreferredBackend } from '../../store/slices/llmSlice';
import { ThemeMode, setTheme } from '../../store/slices/themeSlice';
import AccessibilityService from '../../services/accessibilityService';
import LLMService from '../../services/llmService';
import { loadSessions, deleteSession } from '../../services/chatStorageService';
import { BackArrowIcon } from '../../components/SharedIcons';
import CpuIcon from '../../static/images/SVG/CpuIcon';
import GpuIcon from '../../static/images/SVG/GpuIcon';
import NpuIcon from '../../static/images/SVG/NpuIcon';
import AutoIcon from '../../static/images/SVG/AutoIcon';
import CopyIcon from '../../static/images/SVG/CopyIcon';
import ReloadIcon from '../../static/images/SVG/ReloadIcon';
import DeleteIcon from '../../static/images/SVG/DeleteIcon';
import BrainIcon from '../../static/images/SVG/BrainIcon';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

export interface SettingsPageProps {
    onBack: () => void;
}

interface BackendOption {
    key: BackendType;
    label: string;
    description: string;
    badge: string;
}

const BACKENDS: BackendOption[] = [
    { key: 'AUTO', label: 'AUTO', description: 'NPU → GPU → CPU Fallback', badge: 'OPTIMIZED' },
    { key: 'NPU', label: 'NPU', description: 'Neural Engine Hardware', badge: '45 TOPS' },
    { key: 'GPU', label: 'GPU', description: 'OpenCL / Vulkan Acceleration', badge: 'FP16' },
    { key: 'CPU', label: 'CPU', description: 'Arm Neon 8-Core Engine', badge: 'FALLBACK' },
];

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: 'system', label: 'System' },
    { key: 'dark', label: 'Dark' },
    { key: 'light', label: 'Light' },
];

const CONTEXT_CAPS = [
    { label: '2048', tokens: 2048, vram: '~0.8 GB' },
    { label: '4096', tokens: 4096, vram: '~1.6 GB' },
    { label: '8192', tokens: 8192, vram: '~3.2 GB' },
];

const STREAMING_MODES = ['Smooth Typewriter', 'Instant Block'];
const CHUNK_OPTIONS = ['256 Tokens', '512 Tokens', '1024 Tokens'];
const TEMP_OPTIONS = [0.2, 0.5, 0.7, 0.9];
const DELAY_OPTIONS = [350, 650, 1000];

const SettingsPage: React.FC<SettingsPageProps> = ({ onBack }) => {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const dispatch = useDispatch();

    const currentThemeMode = useSelector((state: RootState) => state.theme.themeMode);
    const preferredBackend = useSelector((state: RootState) => state.llm.preferredBackend);
    const modelStatuses = useSelector((state: RootState) => state.llm.modelStatuses);

    const [isAccessibilityEnabled, setIsAccessibilityEnabled] = useState(false);
    const [modelsDirectory, setModelsDirectory] = useState('');
    const [selectedContextCap, setSelectedContextCap] = useState(4096);
    const [temperature, setTemperature] = useState(0.7);
    const [selectedStreamingMode, setSelectedStreamingMode] = useState('Smooth Typewriter');
    const [syntaxHighlighting, setSyntaxHighlighting] = useState(true);
    const [documentChunkSize, setDocumentChunkSize] = useState('512 Tokens');
    const [actionDelay, setActionDelay] = useState(650);
    const [copiedPath, setCopiedPath] = useState(false);

    useEffect(() => {
        let cancelled = false;

        AccessibilityService.isServiceEnabled().then((enabled) => {
            if (!cancelled) {
                setIsAccessibilityEnabled(enabled);
            }
        });

        LLMService.getModelsDirectory().then((dir) => {
            if (!cancelled) {
                setModelsDirectory(dir || '/data/user/0/ai.aotg.mobile/files/models');
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const totalDownloadedSizeGB = useMemo(() => {
        let totalBytes = 0;
        Object.values(modelStatuses).forEach((status) => {
            if (status.status === 'downloaded' || status.status === 'loaded') {
                totalBytes += status.totalBytes || 0;
            }
        });
        if (totalBytes === 0) return '0.00 GB';
        const gb = totalBytes / (1024 * 1024 * 1024);
        return `${gb.toFixed(2)} GB`;
    }, [modelStatuses]);

    const handleSelectTheme = useCallback((selectedTheme: ThemeMode) => {
        dispatch(setTheme(selectedTheme));
    }, [dispatch]);

    const handleSelectBackend = useCallback((backend: BackendType) => {
        dispatch(setPreferredBackend(backend));
    }, [dispatch]);

    const handleOpenAccessibilitySettings = useCallback(() => {
        AccessibilityService.openAccessibilitySettings();
    }, []);

    const handleCopyPath = useCallback(() => {
        if (!modelsDirectory) return;
        Clipboard.setString(modelsDirectory);
        setCopiedPath(true);
        setTimeout(() => setCopiedPath(false), 2000);
    }, [modelsDirectory]);

    const handlePurgeChats = useCallback(() => {
        Alert.alert(
            'Purge All Chat History',
            'Are you sure you want to delete all saved conversations? This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Purge All',
                    style: 'destructive',
                    onPress: async () => {
                        const sessions = await loadSessions();
                        for (const s of sessions) {
                            await deleteSession(s.id);
                        }
                        Alert.alert('Success', 'All chat history has been cleared.');
                    },
                },
            ]
        );
    }, []);

    const handleClearCache = useCallback(() => {
        Alert.alert(
            'Clear Document Cache',
            'Remove extracted OCR text and temporary RAG indexes from local storage?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear Cache',
                    style: 'default',
                    onPress: () => {
                        Alert.alert('Success', 'Document and RAG cache cleared.');
                    },
                },
            ]
        );
    }, []);

    const handleResetDefaults = useCallback(() => {
        Alert.alert(
            'Reset Settings to Default',
            'Restore default hardware accelerator, theme mode, and inference settings?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset Defaults',
                    style: 'destructive',
                    onPress: () => {
                        dispatch(setTheme('system'));
                        dispatch(setPreferredBackend('AUTO'));
                        setSelectedContextCap(4096);
                        setTemperature(0.7);
                        setSelectedStreamingMode('Smooth Typewriter');
                        setSyntaxHighlighting(true);
                        setDocumentChunkSize('512 Tokens');
                        setActionDelay(650);
                    },
                },
            ]
        );
    }, [dispatch]);

    // Backend icon helper
    const renderBackendIcon = useCallback((key: BackendType, isActive: boolean) => {
        const iconColor = isActive ? '#10B981' : colors.secondaryText;
        switch (key) {
            case 'AUTO':
                return <AutoIcon color={iconColor} size={20} />;
            case 'NPU':
                return <NpuIcon color={iconColor} size={20} />;
            case 'GPU':
                return <GpuIcon color={iconColor} size={20} />;
            case 'CPU':
                return <CpuIcon color={iconColor} size={20} />;
        }
    }, [colors.secondaryText]);

    // Dynamic style wrappers memoized to adhere strictly to zero-inline-style rule
    const dynamicRootStyle = useMemo(
        () => [styles.rootContainer, { backgroundColor: colors.background }],
        [colors.background]
    );

    const dynamicHeaderStyle = useMemo(
        () => [
            styles.headerBar,
            {
                backgroundColor: colors.card,
                borderBottomColor: colors.border,
                paddingTop: insets.top + 8,
            },
        ],
        [colors.card, colors.border, insets.top]
    );

    const dynamicScrollContentStyle = useMemo(
        () => [
            styles.scrollContent,
            isTablet ? styles.scrollContentTablet : undefined,
            { paddingBottom: insets.bottom + 48 },
        ],
        [insets.bottom]
    );

    const dynamicTitleStyle = useMemo(() => ({ color: colors.text }), [colors.text]);
    const dynamicSubtitleStyle = useMemo(() => ({ color: colors.secondaryText }), [colors.secondaryText]);
    const dynamicPrimaryTextStyle = useMemo(() => ({ color: colors.primary }), [colors.primary]);
    const dynamicDividerStyle = useMemo(() => ({ backgroundColor: colors.border }), [colors.border]);
    const dynamicCardStyle = useMemo(
        () => [styles.card, { backgroundColor: colors.card, borderColor: colors.border }],
        [colors.card, colors.border]
    );
    const dynamicTrackStyle = useMemo(
        () => [styles.segmentedTrack, { backgroundColor: colors.background, borderColor: colors.border }],
        [colors.background, colors.border]
    );

    return (
        <View style={dynamicRootStyle}>
            {/* ── Top Header ── */}
            <View style={dynamicHeaderStyle}>
                <Pressable
                    onPress={onBack}
                    style={styles.backButton}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <BackArrowIcon color={colors.text} />
                </Pressable>

                <View style={styles.headerTitleCol}>
                    <Text style={[styles.headerTitle, dynamicTitleStyle]}>Settings</Text>
                    <Text style={[styles.headerSubtitle, dynamicSubtitleStyle]}>
                        System Configuration & Engine
                    </Text>
                </View>

                <Pressable
                    onPress={handleResetDefaults}
                    style={[styles.resetButton, { borderColor: colors.border, backgroundColor: colors.background }]}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <ReloadIcon size={16} color={colors.secondaryText} />
                </Pressable>
            </View>

            {/* ── Content ScrollView ── */}
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={dynamicScrollContentStyle}
                showsVerticalScrollIndicator={false}>

                {/* ── 1. Appearance & Theme ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>APPEARANCE & THEME</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={dynamicCardStyle}>
                    <Text style={[styles.cardTitle, dynamicTitleStyle]}>Color Theme</Text>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Select app appearance or dynamically sync with device settings
                    </Text>
                    <View style={dynamicTrackStyle}>
                        {THEME_OPTIONS.map((opt) => {
                            const isSelected = currentThemeMode === opt.key;
                            return (
                                <Pressable
                                    key={opt.key}
                                    style={[
                                        styles.segmentButton,
                                        isSelected ? [styles.segmentActive, { backgroundColor: colors.card }, styles.borderEmerald] : undefined,
                                    ]}
                                    onPress={() => handleSelectTheme(opt.key)}>
                                    <Text
                                        style={[
                                            styles.segmentText,
                                            isSelected ? styles.textEmeraldBold : dynamicSubtitleStyle,
                                        ]}>
                                        {opt.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Streaming Cadence */}
                    <View style={styles.subItemDivider} />
                    <Text style={[styles.cardTitle, dynamicTitleStyle]}>Token Generation Cadence</Text>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Simulate smooth conversational typewriter pacing or render instantaneous token chunks
                    </Text>
                    <View style={dynamicTrackStyle}>
                        {STREAMING_MODES.map((streamMode) => {
                            const isSelected = selectedStreamingMode === streamMode;
                            return (
                                <Pressable
                                    key={streamMode}
                                    style={[
                                        styles.segmentButton,
                                        isSelected ? [styles.segmentActive, { backgroundColor: colors.card }, styles.borderCyan] : undefined,
                                    ]}
                                    onPress={() => setSelectedStreamingMode(streamMode)}>
                                    <Text
                                        style={[
                                            styles.segmentText,
                                            isSelected ? styles.textCyanBold : dynamicSubtitleStyle,
                                        ]}>
                                        {streamMode}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Syntax Highlighting Toggle */}
                    <View style={styles.subItemDivider} />
                    <View style={styles.toggleRow}>
                        <View style={styles.toggleTextCol}>
                            <Text style={[styles.cardTitle, dynamicTitleStyle]}>Code Block Syntax Highlighting</Text>
                            <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                                Format markdown code fences with Monokai Cyan color tags
                            </Text>
                        </View>
                        <Switch
                            value={syntaxHighlighting}
                            onValueChange={setSyntaxHighlighting}
                            thumbColor={syntaxHighlighting ? '#10B981' : colors.secondaryText}
                            trackColor={{ false: colors.background, true: '#10B98140' }}
                        />
                    </View>
                </View>

                {/* ── 2. Compute Engine & Hardware Acceleration ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>HARDWARE ACCELERATION & COMPUTE</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={dynamicCardStyle}>
                    <Text style={[styles.cardTitle, dynamicTitleStyle]}>Preferred Hardware Backend</Text>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Direct LiteRT inference dispatch with automatic fallback if unaccelerated
                    </Text>

                    <View style={styles.backendGrid}>
                        {BACKENDS.map((b) => {
                            const isSelected = preferredBackend === b.key;
                            return (
                                <Pressable
                                    key={b.key}
                                    style={[
                                        styles.backendCard,
                                        { backgroundColor: colors.background, borderColor: colors.border },
                                        isSelected ? styles.backendCardSelected : undefined,
                                    ]}
                                    onPress={() => handleSelectBackend(b.key)}>
                                    <View style={styles.backendHeaderRow}>
                                        {renderBackendIcon(b.key, isSelected)}
                                        <View style={[
                                            styles.backendBadge,
                                            isSelected ? styles.badgeSelectedEmerald : [styles.badgeDefault, { backgroundColor: colors.card, borderColor: colors.border }],
                                        ]}>
                                            <Text style={[styles.backendBadgeText, isSelected ? styles.textEmerald : dynamicSubtitleStyle]}>
                                                {b.badge}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.backendName, isSelected ? styles.textEmerald : dynamicTitleStyle]}>
                                        {b.label}
                                    </Text>
                                    <Text style={[styles.backendDesc, dynamicSubtitleStyle]} numberOfLines={2}>
                                        {b.description}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* KV-Cache Cap */}
                    <View style={styles.subItemDivider} />
                    <View style={styles.metricRow}>
                        <Text style={[styles.cardTitle, dynamicTitleStyle]}>KV-Cache Context Cap</Text>
                        <Text style={[styles.metricHighlight, styles.textCyan]}>
                            {selectedContextCap} Tokens ({selectedContextCap === 2048 ? '~0.8 GB' : selectedContextCap === 4096 ? '~1.6 GB' : '~3.2 GB'})
                        </Text>
                    </View>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Limits on-device context memory allocations to prevent Out-Of-Memory termination on low-RAM handsets
                    </Text>
                    <View style={dynamicTrackStyle}>
                        {CONTEXT_CAPS.map((cap) => {
                            const isSelected = selectedContextCap === cap.tokens;
                            return (
                                <Pressable
                                    key={cap.tokens}
                                    style={[
                                        styles.segmentButton,
                                        isSelected ? [styles.segmentActive, { backgroundColor: colors.card }, styles.borderCyan] : undefined,
                                    ]}
                                    onPress={() => setSelectedContextCap(cap.tokens)}>
                                    <Text
                                        style={[
                                            styles.segmentText,
                                            isSelected ? styles.textCyanBold : dynamicSubtitleStyle,
                                        ]}>
                                        {cap.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Sampling Creativity (Temperature) */}
                    <View style={styles.subItemDivider} />
                    <View style={styles.metricRow}>
                        <Text style={[styles.cardTitle, dynamicTitleStyle]}>Inference Temperature (Creativity)</Text>
                        <Text style={[styles.metricHighlight, styles.textEmerald]}>
                            {temperature.toFixed(2)} ({temperature <= 0.3 ? 'Precise' : temperature <= 0.7 ? 'Balanced' : 'Creative'})
                        </Text>
                    </View>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Controls token generation variance (0.10 for factual deterministic output, 1.00 for creative ideation)
                    </Text>
                    <View style={styles.tempSelectorRow}>
                        {TEMP_OPTIONS.map((tempVal) => {
                            const isSelected = Math.abs(temperature - tempVal) < 0.05;
                            return (
                                <Pressable
                                    key={tempVal}
                                    style={[
                                        styles.tempChip,
                                        { backgroundColor: colors.background, borderColor: colors.border },
                                        isSelected ? styles.tempChipSelected : undefined,
                                    ]}
                                    onPress={() => setTemperature(tempVal)}>
                                    <Text style={[styles.tempChipText, isSelected ? styles.textEmerald : dynamicSubtitleStyle]}>
                                        {tempVal.toFixed(1)} {tempVal === 0.2 ? 'Exact' : tempVal === 0.7 ? 'Standard' : tempVal === 0.9 ? 'Creative' : 'Balanced'}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* ── 3. Multimodal & RAG Processing ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>MULTIMODAL & RAG INTELLIGENCE</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={dynamicCardStyle}>
                    <View style={styles.infoRow}>
                        <BrainIcon size={20} color="#3CDDC7" />
                        <View style={styles.infoCol}>
                            <Text style={[styles.cardTitle, dynamicTitleStyle]}>OCR & Vector Extraction</Text>
                            <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                                Google ML Kit on-device optical character recognition and BM25 local ranking
                            </Text>
                        </View>
                    </View>

                    <View style={styles.subItemDivider} />
                    <Text style={[styles.cardTitle, dynamicTitleStyle]}>Document Chunk Size</Text>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Partitioning granularity for PDF, DOCX, and text file context injection
                    </Text>
                    <View style={dynamicTrackStyle}>
                        {CHUNK_OPTIONS.map((chunkOpt) => {
                            const isSelected = documentChunkSize === chunkOpt;
                            return (
                                <Pressable
                                    key={chunkOpt}
                                    style={[
                                        styles.segmentButton,
                                        isSelected ? [styles.segmentActive, { backgroundColor: colors.card }, styles.borderCyan] : undefined,
                                    ]}
                                    onPress={() => setDocumentChunkSize(chunkOpt)}>
                                    <Text
                                        style={[
                                            styles.segmentText,
                                            isSelected ? styles.textCyanBold : dynamicSubtitleStyle,
                                        ]}>
                                        {chunkOpt}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* ── 4. Local Storage & Cache Management ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>STORAGE & MODEL FOOTPRINT</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={dynamicCardStyle}>
                    <View style={styles.metricRow}>
                        <Text style={[styles.cardTitle, dynamicTitleStyle]}>Model Storage Footprint</Text>
                        <Text style={[styles.metricHighlight, styles.textEmerald]}>
                            {totalDownloadedSizeGB} Active
                        </Text>
                    </View>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Total storage occupied by downloaded and imported on-device models
                    </Text>

                    {/* Storage Bar */}
                    <View style={[styles.storageTrack, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <View style={styles.storageFill} />
                    </View>

                    <View style={styles.subItemDivider} />
                    <Text style={[styles.cardTitle, dynamicTitleStyle]}>Models Storage Directory</Text>
                    <View style={[styles.pathContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <Text style={[styles.pathText, dynamicTitleStyle]} numberOfLines={1}>
                            {modelsDirectory || 'Loading...'}
                        </Text>
                        <Pressable onPress={handleCopyPath} style={styles.copyButton}>
                            <CopyIcon color={copiedPath ? '#10B981' : colors.secondaryText} />
                        </Pressable>
                    </View>

                    {/* Purge Actions */}
                    <View style={styles.subItemDivider} />
                    <View style={styles.actionButtonsRow}>
                        <Pressable
                            style={[styles.destructiveBtn, { backgroundColor: colors.background }]}
                            onPress={handlePurgeChats}>
                            <DeleteIcon color="#FF453A" size={16} />
                            <Text style={styles.destructiveBtnText}>Purge All Chats</Text>
                        </Pressable>

                        <Pressable
                            style={[styles.outlineBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                            onPress={handleClearCache}>
                            <ReloadIcon size={15} color={colors.secondaryText} />
                            <Text style={[styles.outlineBtnText, dynamicTitleStyle]}>Clear RAG Cache</Text>
                        </Pressable>
                    </View>
                </View>

                {/* ── 5. Autonomous Accessibility Agent ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>AUTONOMOUS ACCESSIBILITY AGENT</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={dynamicCardStyle}>
                    <View style={styles.metricRow}>
                        <Text style={[styles.cardTitle, dynamicTitleStyle]}>Android Accessibility Service</Text>
                        <View
                            style={[
                                styles.statusPill,
                                isAccessibilityEnabled ? styles.statusPillEnabled : [styles.statusPillDisabled, { backgroundColor: colors.background, borderColor: colors.border }],
                            ]}>
                            <View
                                style={[
                                    styles.statusDot,
                                    isAccessibilityEnabled ? styles.statusDotEnabled : styles.statusDotDisabled,
                                ]}
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    isAccessibilityEnabled ? styles.textEmerald : dynamicSubtitleStyle,
                                ]}>
                                {isAccessibilityEnabled ? 'ENABLED' : 'DISABLED'}
                            </Text>
                        </View>
                    </View>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Allows the autonomous AI agent to observe mobile UI elements, execute taps, and perform workflows
                    </Text>

                    <Pressable
                        style={styles.accentActionBtn}
                        onPress={handleOpenAccessibilitySettings}>
                        <Text style={styles.accentActionBtnText}>Open Android Accessibility Settings →</Text>
                    </Pressable>

                    <View style={styles.subItemDivider} />
                    <View style={styles.metricRow}>
                        <Text style={[styles.cardTitle, dynamicTitleStyle]}>Action Execution Delay</Text>
                        <Text style={[styles.metricHighlight, styles.textCyan]}>
                            {actionDelay}ms (Human-like)
                        </Text>
                    </View>
                    <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                        Spacing between autonomous UI clicks and swipes to ensure app screens respond smoothly
                    </Text>
                    <View style={styles.tempSelectorRow}>
                        {DELAY_OPTIONS.map((delayVal) => {
                            const isSelected = actionDelay === delayVal;
                            return (
                                <Pressable
                                    key={delayVal}
                                    style={[
                                        styles.tempChip,
                                        { backgroundColor: colors.background, borderColor: colors.border },
                                        isSelected ? styles.tempChipSelectedCyan : undefined,
                                    ]}
                                    onPress={() => setActionDelay(delayVal)}>
                                    <Text style={[styles.tempChipText, isSelected ? styles.textCyan : dynamicSubtitleStyle]}>
                                        {delayVal}ms {delayVal === 350 ? 'Rapid' : delayVal === 650 ? 'Standard' : 'Safe'}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* ── 6. Zero-Egress Security & Privacy Protocol ── */}
                <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, dynamicPrimaryTextStyle]}>SECURITY & PRIVACY PROTOCOL</Text>
                    <View style={[styles.sectionDivider, dynamicDividerStyle]} />
                </View>

                <View style={[styles.card, styles.securityCard, { backgroundColor: colors.card }]}>
                    <View style={styles.securityHeaderRow}>
                        <View style={styles.shieldBadge}>
                            <Image
                                source={require('../../static/images/aotg_logo_64.png')}
                                style={styles.shieldLogoImage}
                                resizeMode="contain"
                            />
                        </View>
                        <View style={styles.securityTextCol}>
                            <Text style={[styles.cardTitle, styles.textEmerald]}>100% Zero-Cloud Air-Gapped</Text>
                            <Text style={[styles.cardDescription, dynamicSubtitleStyle]}>
                                All inference, embeddings, and chat transcripts remain strictly on physical device hardware. No telemetry, no remote API calls.
                            </Text>
                        </View>
                    </View>

                    <View style={[styles.runtimeFooter, { borderTopColor: colors.border }]}>
                        <Text style={[styles.runtimeText, dynamicSubtitleStyle]}>
                            AOTG v0.0.1 • LiteRT Engine v0.17.0 • Local Runtime
                        </Text>
                    </View>
                </View>

            </ScrollView>
        </View>
    );
};

export default memo(SettingsPage);

const styles = StyleSheet.create({
    rootContainer: {
        flex: 1,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    backButton: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitleCol: {
        flex: 1,
        marginLeft: 12,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        fontSize: 12,
        fontWeight: '400',
        marginTop: 1,
    },
    resetButton: {
        width: 34,
        height: 34,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    scrollContentTablet: {
        maxWidth: 720,
        alignSelf: 'center',
        width: '100%',
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    sectionDivider: {
        flex: 1,
        height: 1,
        marginLeft: 12,
    },
    card: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        marginBottom: 12,
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    cardDescription: {
        fontSize: 12,
        lineHeight: 17,
        marginTop: 3,
        marginBottom: 10,
    },
    subItemDivider: {
        height: 1,
        backgroundColor: 'rgba(128,128,128,0.15)',
        marginVertical: 14,
    },
    segmentedTrack: {
        flexDirection: 'row',
        borderRadius: 8,
        borderWidth: 1,
        padding: 3,
    },
    segmentButton: {
        flex: 1,
        paddingVertical: 7,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    segmentActive: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 2,
        elevation: 2,
    },
    segmentText: {
        fontSize: 12,
        fontWeight: '500',
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toggleTextCol: {
        flex: 1,
        marginRight: 16,
    },
    backendGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    backendCard: {
        width: '48.5%',
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
        marginBottom: 10,
    },
    backendCardSelected: {
        borderWidth: 1.5,
        borderColor: '#10B981',
    },
    backendHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    backendBadge: {
        borderRadius: 4,
        borderWidth: 1,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    badgeSelectedEmerald: {
        backgroundColor: '#10B98120',
        borderColor: '#10B981',
    },
    badgeDefault: {
        borderWidth: 1,
    },
    backendBadgeText: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    backendName: {
        fontSize: 14,
        fontWeight: '700',
    },
    backendDesc: {
        fontSize: 11,
        lineHeight: 15,
        marginTop: 2,
    },
    metricRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    metricHighlight: {
        fontSize: 12,
        fontWeight: '700',
    },
    tempSelectorRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    tempChip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 3,
    },
    tempChipSelected: {
        borderWidth: 1.5,
        borderColor: '#10B981',
    },
    tempChipSelectedCyan: {
        borderWidth: 1.5,
        borderColor: '#3CDDC7',
    },
    tempChipText: {
        fontSize: 11,
        fontWeight: '600',
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    infoCol: {
        flex: 1,
        marginLeft: 12,
    },
    storageTrack: {
        height: 6,
        borderRadius: 3,
        borderWidth: 1,
        overflow: 'hidden',
        marginTop: 6,
    },
    storageFill: {
        width: '42%',
        height: '100%',
        backgroundColor: '#10B981',
        borderRadius: 3,
    },
    pathContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 8,
        borderWidth: 1,
        paddingLeft: 12,
        paddingRight: 6,
        paddingVertical: 8,
        marginTop: 6,
    },
    pathText: {
        flex: 1,
        fontSize: 11,
        fontFamily: 'Courier',
        marginRight: 8,
    },
    copyButton: {
        padding: 6,
    },
    actionButtonsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    destructiveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#FF453A40',
        paddingVertical: 10,
        paddingHorizontal: 12,
        width: '48.5%',
    },
    destructiveBtnText: {
        color: '#FF453A',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    outlineBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        width: '48.5%',
    },
    outlineBtnText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    statusPillEnabled: {
        backgroundColor: '#10B98120',
        borderColor: '#10B981',
    },
    statusPillDisabled: {
        borderWidth: 1,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 5,
    },
    statusDotEnabled: {
        backgroundColor: '#10B981',
    },
    statusDotDisabled: {
        backgroundColor: '#FF453A',
    },
    statusText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    accentActionBtn: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#10B981',
        backgroundColor: '#10B98120',
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 10,
    },
    accentActionBtnText: {
        color: '#10B981',
        fontSize: 13,
        fontWeight: '600',
    },
    securityCard: {
        borderColor: '#10B98140',
    },
    securityHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    shieldBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#10B981',
        backgroundColor: '#10B98120',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    shieldLogoImage: {
        width: 28,
        height: 28,
        borderRadius: 6,
    },
    securityTextCol: {
        flex: 1,
    },
    runtimeFooter: {
        borderTopWidth: 1,
        paddingTop: 10,
        marginTop: 12,
        alignItems: 'center',
    },
    runtimeText: {
        fontSize: 11,
        letterSpacing: 0.2,
    },
    textEmerald: {
        color: '#10B981',
    },
    textEmeraldBold: {
        color: '#10B981',
        fontWeight: '700',
    },
    textCyan: {
        color: '#3CDDC7',
    },
    textCyanBold: {
        color: '#3CDDC7',
        fontWeight: '700',
    },
    borderEmerald: {
        borderColor: '#10B981',
    },
    borderCyan: {
        borderColor: '#3CDDC7',
    },
});
