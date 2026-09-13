import React, {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useTheme } from '../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootState } from '../../store/store';
import {
    AVAILABLE_MODELS,
    setSelectedModel,
    startLoadingModel,
    setLoadedModel,
    setModelLoadFailed,
    syncModelStatus,
} from '../../store/slices/llmSlice';
import ModelSelectorModal from '../../components/ModelSelectorModal';
import useLLM from '../../hooks/useLLM';
import LLMService, { estimateTokens } from '../../services/llmService';
import MessageRenderer from '../../components/MessageBlocks/MessageRenderer';
import DrawerMenu from '../../components/DrawerMenu';
import LinearGradient from 'react-native-linear-gradient';

const { width } = Dimensions.get('window');

// --- Static Constants ---
const EXPANDED_WIDTH = width * 0.85;
const COLLAPSED_WIDTH = width * 0.75;
const ANIMATION_DURATION = 500;

const HIT_SLOP_8 = { top: 8, bottom: 8, left: 8, right: 8 };
const HIT_SLOP_10 = { top: 10, bottom: 10, left: 10, right: 10 };
const HIT_SLOP_12 = { top: 12, bottom: 12, left: 12, right: 12 };

// --- Memoized Custom Vector Icons ---
const MenuIcon = memo(({ color }: { color: string }) => (
    <View style={styles.menuIconContainer}>
        <View style={[styles.menuLine, { backgroundColor: color }]} />
        <View style={[styles.menuLine, { backgroundColor: color }]} />
        <View style={[styles.menuLine, { backgroundColor: color }]} />
    </View>
));

const ChevronDownIcon = memo(({ color }: { color: string }) => (
    <View style={styles.chevronContainer}>
        <View style={[styles.chevronLeft, { backgroundColor: color }]} />
        <View style={[styles.chevronRight, { backgroundColor: color }]} />
    </View>
));

const RobotIcon = memo(({ color, bgColor }: { color: string; bgColor: string }) => (
    <View style={styles.robotContainer}>
        {/* Antenna */}
        <View style={styles.robotAntennaContainer}>
            <View style={[styles.robotAntennaKnob, { backgroundColor: color }]} />
            <View style={[styles.robotAntennaStem, { backgroundColor: color }]} />
        </View>

        {/* Head and Ears row */}
        <View style={styles.robotHeadRow}>
            {/* Left Ear */}
            <View style={[styles.robotEar, { backgroundColor: color }]} />

            {/* Face */}
            <View style={[styles.robotFace, { backgroundColor: color }]}>
                {/* Eyes */}
                <View style={styles.robotEyesRow}>
                    <View style={[styles.robotEye, { backgroundColor: bgColor }]} />
                    <View style={[styles.robotEye, { backgroundColor: bgColor }]} />
                </View>
                {/* Mouth */}
                <View style={[styles.robotMouth, { backgroundColor: bgColor }]} />
            </View>

            {/* Right Ear */}
            <View style={[styles.robotEar, { backgroundColor: color }]} />
        </View>
    </View>
));

const PlusIcon = memo(({ color }: { color: string }) => (
    <View style={styles.plusIconContainer}>
        <View style={[styles.plusLineH, { backgroundColor: color }]} />
        <View style={[styles.plusLineV, { backgroundColor: color }]} />
    </View>
));

const MicIcon = memo(({ color }: { color: string }) => (
    <View style={styles.micIconContainer}>
        <View style={[styles.micCapsule, { backgroundColor: color }]} />
        <View style={[styles.micCradle, { borderColor: color }]} />
        <View style={[styles.micStem, { backgroundColor: color }]} />
        <View style={[styles.micBase, { backgroundColor: color }]} />
    </View>
));

const StopIcon = memo(({ color }: { color: string }) => (
    <View style={styles.stopIconContainer}>
        <View style={[styles.stopSquare, { backgroundColor: color }]} />
    </View>
));

const SendIcon = memo(({ color }: { color: string }) => (
    <View style={styles.sendIconContainer}>
        <View style={[styles.sendStem, { backgroundColor: color }]} />
        <View style={[styles.sendArrowLeft, { backgroundColor: color }]} />
        <View style={[styles.sendArrowRight, { backgroundColor: color }]} />
    </View>
));

const HeadphoneIcon = memo(({ color }: { color: string }) => (
    <View style={styles.headphoneIconContainer}>
        <View style={[styles.headphoneArch, { borderColor: color }]} />
        <View style={[styles.headphoneEarLeft, { backgroundColor: color }]} />
        <View style={[styles.headphoneEarRight, { backgroundColor: color }]} />
    </View>
));

const HomePage = ({ onOpenAgent }: { onOpenAgent?: () => void }) => {
    const theme = useTheme();
    const { colors } = theme;
    const insets = useSafeAreaInsets();
    const dispatch = useDispatch();

    // Redux LLM Model State
    const selectedModelId = useSelector(
        (state: RootState) => state.llm.selectedModelId
    );
    const modelStatuses = useSelector(
        (state: RootState) => state.llm.modelStatuses
    );
    const preferredBackend = useSelector(
        (state: RootState) => state.llm.preferredBackend
    );
    const currentStatus =
        modelStatuses[selectedModelId]?.status || 'not_downloaded';

    const [isModelModalVisible, setIsModelModalVisible] = useState(false);
    const [isDrawerVisible, setIsDrawerVisible] = useState(false);
    const [inputText, setInputText] = useState('');
    const [messages, setMessages] = useState<
        { id: string; role: 'user' | 'assistant'; text: string }[]
    >([]);

    // Re-entrancy guard: prevents two rapid messages from both triggering
    // auto-load concurrently (the native side rejects with ERR_BUSY but the
    // user would see a confusing "load error" message without this).
    const isAutoLoadingRef = useRef(false);

    // Native LLM Hook
    const {
        isGenerating,
        streamedText,
        generate,
        stopGeneration,
        loadModel,
    } = useLLM();

    const selectedModel = useMemo(
        () =>
            AVAILABLE_MODELS.find((m) => m.id === selectedModelId) ||
            AVAILABLE_MODELS[0],
        [selectedModelId]
    );

    // Sync on-disk model state on mount so already-downloaded models are
    // recognized after an app restart (the status dot + auto-load depend on it).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const model of AVAILABLE_MODELS) {
                try {
                    const check = await LLMService.checkModelStatus(model.fileName);
                    if (cancelled) return;
                    dispatch(
                        syncModelStatus({
                            modelId: model.id,
                            isDownloaded: check.isDownloaded,
                            localPath: check.localPath,
                        })
                    );
                } catch (_) {
                    // Non-fatal — the model selector re-syncs when opened.
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [dispatch]);

    // Preserved animation definition
    const widthAnim = useRef(new Animated.Value(COLLAPSED_WIDTH)).current;

    const scrollViewRef = useRef<ScrollView>(null);
    const isAutoScrollEnabled = useRef(true);

    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const paddingToBottom = 50;
        const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
        isAutoScrollEnabled.current = isNearBottom;
    }, []);

    const handleContentSizeChange = useCallback(() => {
        if (isAutoScrollEnabled.current) {
            scrollViewRef.current?.scrollToEnd({ animated: true });
        }
    }, []);

    const expand = useCallback(() => {
        Animated.timing(widthAnim, {
            toValue: EXPANDED_WIDTH,
            duration: ANIMATION_DURATION,
            useNativeDriver: false,
        }).start();
    }, [widthAnim]);

    const collapse = useCallback(() => {
        Animated.timing(widthAnim, {
            toValue: COLLAPSED_WIDTH,
            duration: ANIMATION_DURATION,
            useNativeDriver: false,
        }).start();
    }, [widthAnim]);

    const dismissKeyboard = useCallback(() => {
        Keyboard.dismiss();
    }, []);

    const openModelSelector = useCallback(() => {
        dismissKeyboard();
        setIsModelModalVisible(true);
    }, [dismissKeyboard]);

    const closeModelSelector = useCallback(() => {
        setIsModelModalVisible(false);
    }, []);

    const handleSelectModel = useCallback(
        (modelId: string) => {
            dispatch(setSelectedModel(modelId));
        },
        [dispatch]
    );

    // New Chat: stop any in-flight answer, clear the transcript and give the
    // model a fresh context window (drops the KV cache on the same engine).
    const handleNewChat = useCallback(async () => {
        if (isGenerating) {
            await stopGeneration().catch(() => {});
        }
        setMessages([]);
        setInputText('');
        if (currentStatus === 'loaded') {
            await LLMService.resetConversation();
        }
    }, [isGenerating, stopGeneration, currentStatus]);

    // Send Message / Generate Output
    const handleSend = useCallback(async () => {
        const query = inputText.trim();
        if (!query || isGenerating) return;

        setInputText('');
        const userMsgId = Date.now().toString();
        const assistantMsgId = (Date.now() + 1).toString();

        setMessages((prev) => [
            ...prev,
            { id: userMsgId, role: 'user', text: query },
        ]);

        // If the selected model isn't loaded, load it first — but only when it
        // has actually been downloaded. Otherwise guide the user to the picker
        // instead of trying (and failing) to initialize a missing file.
        if (currentStatus !== 'loaded') {
            if (currentStatus === 'loading' || isAutoLoadingRef.current) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: assistantMsgId,
                        role: 'assistant',
                        text: `"${selectedModel.name}" is still loading. Please wait a moment and send your message again.`,
                    },
                ]);
                return;
            }
            if (currentStatus !== 'downloaded') {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: assistantMsgId,
                        role: 'assistant',
                        text: `"${selectedModel.name}" isn't downloaded yet. Open the model selector (top-right) to download and load it before chatting.`,
                    },
                ]);
                setIsModelModalVisible(true);
                return;
            }

            isAutoLoadingRef.current = true;
            dispatch(startLoadingModel(selectedModel.id));
            try {
                const result = await loadModel(selectedModel.fileName, preferredBackend);
                dispatch(
                    setLoadedModel({
                        modelId: selectedModel.id,
                        backend: result.actualBackend,
                    })
                );
            } catch (loadErr: any) {
                console.error('[HomePage] Model load error:', loadErr);
                // Revert the status so it doesn't get stuck on "loading" forever.
                dispatch(
                    setModelLoadFailed({
                        modelId: selectedModel.id,
                        error: loadErr?.message || 'Failed to load model',
                    })
                );
                setMessages((prev) => [
                    ...prev,
                    {
                        id: assistantMsgId,
                        role: 'assistant',
                        text: `Could not load ${selectedModel.name}: ${loadErr?.message || 'initialization failed'}. Try a different acceleration backend, or re-download the model from the selector.`,
                    },
                ]);
                return;
            } finally {
                isAutoLoadingRef.current = false;
            }
        }

        try {
            // Keep the conversation inside the model's context window. When the
            // accumulated history leaves no room for this message, the KV cache
            // is reset and the user is told the model lost earlier context.
            const wasReset = await LLMService.ensureContextBudget(estimateTokens(query));
            if (wasReset) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `${assistantMsgId}-ctx`,
                        role: 'assistant',
                        text: '_Context window was full — earlier messages are no longer visible to the model._',
                    },
                ]);
            }

            const response = await generate(query);
            setMessages((prev) => [
                ...prev,
                { id: assistantMsgId, role: 'assistant', text: response },
            ]);
        } catch (err: any) {
            console.error('[HomePage] Generation error:', err);
            setMessages((prev) => [
                ...prev,
                {
                    id: assistantMsgId,
                    role: 'assistant',
                    text:
                        streamedText ||
                        'Error: Could not generate a response on device. Please try again.',
                },
            ]);
        }
    }, [
        inputText,
        isGenerating,
        currentStatus,
        loadModel,
        selectedModel.fileName,
        selectedModel.id,
        selectedModel.name,
        generate,
        streamedText,
        dispatch,
        preferredBackend,
    ]);

    // Memoized dynamic styles
    const headerStyle = useMemo(
        () => [styles.header, { paddingTop: Math.max(insets.top + 8, 16) }],
        [insets.top]
    );

    const bottomBarStyle = useMemo(
        () => [styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }],
        [insets.bottom]
    );

    const robotBgColor = colors.robotBg || '#262831';
    const robotIconColor = colors.robotIcon || '#2DD4BF';
    const headphoneBgColor = colors.headphoneBg || '#FFFFFF';
    const headphoneIconColor = colors.headphoneIcon || '#000000';
    const secondaryTextColor = colors.secondaryText || '#9E9EA8';

    const dotColor =
        currentStatus === 'loaded'
            ? '#10A37F'
            : currentStatus === 'downloaded'
                ? '#3B82F6'
                : currentStatus === 'downloading'
                    ? '#F59E0B'
                    : secondaryTextColor;

    const hasMessages = messages.length > 0 || isGenerating;

    return (
        <View style={{ flex: 1 }}>
            <KeyboardAvoidingView
                style={[styles.screen, { backgroundColor: colors.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={headerStyle}>
                        <View style={styles.headerLeft}>
                            <Pressable
                                hitSlop={HIT_SLOP_12}
                                style={styles.headerButton}
                                onPress={() => {
                                    console.log('Hamburger Menu Pressed!');
                                    dismissKeyboard();
                                    setIsDrawerVisible(true);
                                }}>
                                <MenuIcon color={colors.text} />
                            </Pressable>
                            <Text style={[styles.headerTitle, { color: colors.text }]}>
                                Chat
                            </Text>
                        </View>

                        {/* LLM Model Selector Button */}
                        <Pressable
                            hitSlop={HIT_SLOP_12}
                            onPress={openModelSelector}
                            style={[
                                styles.modelSelectorButton,
                                {
                                    backgroundColor: colors.card,
                                    borderColor: colors.border,
                                },
                            ]}>
                            <View
                                style={[styles.modelDot, { backgroundColor: dotColor }]}
                            />
                            <Text
                                numberOfLines={1}
                                style={[
                                    styles.modelSelectorText,
                                    { color: colors.text },
                                ]}>
                                {selectedModel.name}
                            </Text>
                            <ChevronDownIcon color={secondaryTextColor} />
                        </Pressable>
                    </View>

                    {/* Main Body: Empty State or Active Conversation */}
                    {!hasMessages ? (
                        <View style={[styles.centerContent, { flex: 1 }]}>
                            {/* Robot Avatar Badge */}
                            <View
                                style={[
                                    styles.avatarCircle,
                                    { backgroundColor: robotBgColor },
                                ]}>
                                <RobotIcon
                                    color={robotIconColor}
                                    bgColor={robotBgColor}
                                />
                            </View>

                            {/* Title & Subtitle */}
                            <Text style={[styles.title, { color: colors.text }]}>
                                Ready to chat
                            </Text>
                            <Text
                                style={[
                                    styles.subtitle,
                                    { color: secondaryTextColor },
                                ]}>
                                Type a message or tap the mic to start a{'\n'}
                                conversation with on-device AI.
                            </Text>
                        </View>
                    ) : (
                        <View style={{ flex: 1 }}>
                            <LinearGradient
                                colors={[
                                    colors.background,
                                    colors.background + 'F2', // 95%
                                    colors.background + 'CC', // 80%
                                    colors.background + '80', // 50%
                                    colors.background + '26', // 15%
                                    colors.background + '00', // 0%
                                ]}
                                style={[styles.topGradient, { height: insets.top + 100 }]}
                                pointerEvents="none"
                            />
                            <ScrollView
                                ref={scrollViewRef}
                                onScroll={handleScroll}
                                scrollEventThrottle={16}
                                onContentSizeChange={handleContentSizeChange}
                                style={styles.chatScroll}
                                contentContainerStyle={[styles.chatScrollContent, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 80 }]}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled">
                                {messages.map((msg) => (
                                    <View
                                        key={msg.id}
                                        style={[
                                            styles.messageBubble,
                                            msg.role === 'user'
                                                ? [
                                                    styles.userBubble,
                                                    { backgroundColor: colors.card },
                                                ]
                                                : [styles.assistantBubble],
                                        ]}>
                                        {msg.role === 'assistant' && (
                                            <View style={styles.assistantHeader}>
                                                <View style={styles.activeDot} />
                                                <Text
                                                    style={[
                                                        styles.assistantModelTag,
                                                        { color: '#10A37F' },
                                                    ]}>
                                                    {selectedModel.name} (On-Device)
                                                </Text>
                                            </View>
                                        )}
                                        {msg.role === 'assistant' ? (
                                            <MessageRenderer content={msg.text} />
                                        ) : (
                                            <Text
                                                style={[
                                                    styles.messageText,
                                                    { color: colors.text },
                                                ]}>
                                                {msg.text}
                                            </Text>
                                        )}
                                    </View>
                                ))}

                                {/* Live Streaming Token Preview */}
                                {isGenerating && (
                                    <View
                                        style={[
                                            styles.messageBubble,
                                            styles.assistantBubble,
                                        ]}>
                                        <View style={styles.assistantHeader}>
                                            <ActivityIndicator
                                                size="small"
                                                color="#10A37F"
                                            />
                                            <Text
                                                style={[
                                                    styles.assistantModelTag,
                                                    { color: '#10A37F' },
                                                ]}>
                                                Generating with {selectedModel.name}...
                                            </Text>
                                        </View>
                                        <MessageRenderer content={streamedText || 'Thinking...'} />
                                        <Text style={{ color: '#10A37F', fontSize: 15, marginTop: 4 }}> ▋</Text>
                                    </View>
                                )}
                            </ScrollView>
                            <LinearGradient
                                colors={[
                                    colors.background + '00', // 0%
                                    colors.background + '26', // 15%
                                    colors.background + '80', // 50%
                                    colors.background + 'CC', // 80%
                                    colors.background + 'F2', // 95%
                                    colors.background,
                                ]}
                                style={[styles.bottomGradient, { height: insets.bottom + 70 }]}
                                pointerEvents="none"
                            />
                        </View>
                    )}

                    <Animated.View
                        style={[
                            styles.inputContainer,
                            {
                                width: widthAnim,
                                backgroundColor: colors.card,
                                borderColor: colors.border,
                                bottom: insets.bottom,
                                alignSelf: 'center',
                            },
                        ]}>
                        {/* Plus button inside pill */}
                        <Pressable
                            hitSlop={HIT_SLOP_10}
                            style={styles.iconButton}>
                            <PlusIcon color={secondaryTextColor} />
                        </Pressable>

                        {/* TextInput */}
                        <TextInput
                            style={[styles.input, { color: colors.text }]}
                            placeholder="Message AI..."
                            placeholderTextColor={secondaryTextColor}
                            value={inputText}
                            onChangeText={setInputText}
                            onSubmitEditing={handleSend}
                            returnKeyType="send"
                            onFocus={expand}
                            onBlur={collapse}
                        />

                        {/* Action Icon: Send / Stop / Mic */}
                        {isGenerating ? (
                            <Pressable
                                hitSlop={HIT_SLOP_10}
                                onPress={stopGeneration}
                                style={styles.iconButton}>
                                <StopIcon color="#FF453A" />
                            </Pressable>
                        ) : inputText.trim().length > 0 ? (
                            <Pressable
                                hitSlop={HIT_SLOP_10}
                                onPress={handleSend}
                                style={styles.iconButton}>
                                <SendIcon color="#10A37F" />
                            </Pressable>
                        ) : (
                            <Pressable
                                hitSlop={HIT_SLOP_10}
                                style={styles.iconButton}>
                                <MicIcon color={secondaryTextColor} />
                            </Pressable>
                        )}

                        {/* Headphone Audio Button */}
                        <Pressable
                            hitSlop={HIT_SLOP_8}
                            style={[
                                styles.headphoneButton,
                                { backgroundColor: headphoneBgColor },
                            ]}>
                            <HeadphoneIcon color={headphoneIconColor} />
                        </Pressable>
                    </Animated.View>
                </View>


                {/* LLM Model Selector Modal */}
                <ModelSelectorModal
                    visible={isModelModalVisible}
                    onClose={closeModelSelector}
                    selectedModelId={selectedModelId}
                    onSelectModel={handleSelectModel}
                />
            </KeyboardAvoidingView>

            {/* Drawer Menu */}
            <DrawerMenu
                isVisible={isDrawerVisible}
                onClose={() => setIsDrawerVisible(false)}
                onOpenAgent={onOpenAgent}
                onNewChat={handleNewChat}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    container: {
        flex: 1,
        justifyContent: 'space-between',

    },
    // Header Styles
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 10,
        position: 'absolute',
        width: '100%',
        zIndex: 10000,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    headerButton: {
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modelSelectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        gap: 6,
        maxWidth: width * 0.48,
    },
    modelDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#10A37F',
    },
    modelSelectorText: {
        fontSize: 13,
        fontWeight: '600',
        flexShrink: 1,
    },
    chevronContainer: {
        width: 10,
        height: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    chevronLeft: {
        position: 'absolute',
        left: 0.5,
        width: 5.5,
        height: 1.6,
        borderRadius: 0.8,
        transform: [{ rotate: '45deg' }],
    },
    chevronRight: {
        position: 'absolute',
        right: 0.5,
        width: 5.5,
        height: 1.6,
        borderRadius: 0.8,
        transform: [{ rotate: '-45deg' }],
    },
    // Center Content Styles
    centerContent: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    avatarCircle: {
        width: 88,
        height: 88,
        borderRadius: 44,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 26,
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        letterSpacing: 0.3,
        marginBottom: 10,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        fontWeight: '400',
    },
    // Chat Scroll Styles
    topGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    bottomGradient: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    chatScroll: {
        flex: 1,
        paddingHorizontal: '3.5%',
    },
    chatScrollContent: {
        // paddingVertical: 16,
        gap: 12,
    },
    messageBubble: {
        paddingVertical: 14,
        paddingHorizontal: '3.5%',
        borderRadius: 18,
    },
    userBubble: {
        alignSelf: 'flex-end',
        borderBottomRightRadius: 4,
        maxWidth: '88%',
    },
    assistantBubble: {
        alignSelf: 'center',
        borderBottomLeftRadius: 4,
        width: '100%',
    },
    assistantHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    assistantModelTag: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    activeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10A37F',
    },
    messageText: {
        fontSize: 15,
        lineHeight: 22,
    },
    // Bottom Bar Styles
    bottomBar: {
        paddingHorizontal: '3.5%',
        paddingTop: 8,
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputContainer: {
        height: 40.5,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 20.25,
        borderWidth: 1,
        paddingLeft: 12,
        paddingRight: 4,
        position: 'absolute',
        zIndex: 1000
    },
    input: {
        flex: 1,
        height: '100%',
        paddingVertical: 0,
        paddingHorizontal: 8,
        fontSize: 15,
        includeFontPadding: false,

    },
    iconButton: {
        width: 26,
        height: 26,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headphoneButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 2,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    // Menu Icon
    menuIconContainer: {
        width: 22,
        height: 16,
        justifyContent: 'space-between',
    },
    menuLine: {
        width: 22,
        height: 2.2,
        borderRadius: 1.5,
    },
    // Robot Icon
    robotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    robotAntennaContainer: {
        alignItems: 'center',
        marginBottom: 1,
    },
    robotAntennaKnob: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    robotAntennaStem: {
        width: 3,
        height: 5,
        borderRadius: 1,
    },
    robotHeadRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    robotEar: {
        width: 4,
        height: 10,
        borderRadius: 2,
    },
    robotFace: {
        width: 36,
        height: 28,
        borderRadius: 8,
        marginHorizontal: 3,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 4,
    },
    robotEyesRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 4,
    },
    robotEye: {
        width: 6,
        height: 6,
        borderRadius: 1.5,
    },
    robotMouth: {
        width: 14,
        height: 3,
        borderRadius: 1.5,
    },
    // Plus Icon
    plusIconContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    plusLineH: {
        width: 14,
        height: 2.2,
        borderRadius: 1.1,
    },
    plusLineV: {
        width: 2.2,
        height: 14,
        borderRadius: 1.1,
        position: 'absolute',
    },
    // Mic Icon
    micIconContainer: {
        width: 18,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    micCapsule: {
        width: 6.5,
        height: 11,
        borderRadius: 3.25,
    },
    micCradle: {
        position: 'absolute',
        top: 3.5,
        width: 13,
        height: 9,
        borderBottomLeftRadius: 6.5,
        borderBottomRightRadius: 6.5,
        borderWidth: 1.8,
        borderTopWidth: 0,
    },
    micStem: {
        width: 1.8,
        height: 3.5,
        marginTop: 1,
    },
    micBase: {
        width: 7,
        height: 1.8,
        borderRadius: 1,
    },
    // Stop Icon
    stopIconContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stopSquare: {
        width: 10,
        height: 10,
        borderRadius: 2,
    },
    // Send Icon
    sendIconContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendStem: {
        width: 2,
        height: 12,
        borderRadius: 1,
        position: 'absolute',
        bottom: 2,
    },
    sendArrowLeft: {
        position: 'absolute',
        width: 2,
        height: 7,
        borderRadius: 1,
        top: 3,
        left: 5,
        transform: [{ rotate: '45deg' }],
    },
    sendArrowRight: {
        position: 'absolute',
        width: 2,
        height: 7,
        borderRadius: 1,
        top: 3,
        right: 5,
        transform: [{ rotate: '-45deg' }],
    },
    // Headphone Icon
    headphoneIconContainer: {
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headphoneArch: {
        width: 14,
        height: 11,
        borderTopLeftRadius: 7,
        borderTopRightRadius: 7,
        borderWidth: 2,
        borderBottomWidth: 0,
    },
    headphoneEarLeft: {
        position: 'absolute',
        left: 0.5,
        bottom: 1.5,
        width: 3.8,
        height: 7,
        borderRadius: 1.9,
    },
    headphoneEarRight: {
        position: 'absolute',
        right: 0.5,
        bottom: 1.5,
        width: 3.8,
        height: 7,
        borderRadius: 1.9,
    },
});

export default memo(HomePage);
