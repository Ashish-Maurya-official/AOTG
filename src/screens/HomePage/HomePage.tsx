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
    Alert,
    Animated,
    Dimensions,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
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
import MicIcon from '../../static/images/SVG/MicIcon';
import LiveIcon from '../../static/images/SVG/LiveIcon';
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
import documentService from '../../services/documentService';
import MessageRenderer from '../../components/MessageBlocks/MessageRenderer';
import DrawerMenu from '../../components/DrawerMenu';
import LinearGradient from 'react-native-linear-gradient';
import { pick, types as DocumentPickerTypes, isErrorWithCode, errorCodes, keepLocalCopy } from '@react-native-documents/picker';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Zoom from 'react-native-zoom-reanimated';
import Reanimated, { ZoomIn, ZoomOut, FadeIn, FadeOut } from 'react-native-reanimated';
import SendIcon from '../../static/images/SVG/SendIcon';
import ImageIcon from '../../static/images/SVG/ImageIcon';
import DocumentIcon from '../../static/images/SVG/DocumentIcon';
import CopyIcon from '../../static/images/SVG/CopyIcon';
import ReloadIcon from '../../static/images/SVG/ReloadIcon';
import ShareIcon from '../../static/images/SVG/ShareIcon';
import EditIcon from '../../static/images/SVG/EditIcon';
import Clipboard from '@react-native-clipboard/clipboard';
import KeyEvent from 'react-native-keyevent';
const { width, height: windowHeight } = Dimensions.get('window');

const ChatImage = memo(({ uri, onPress }: { uri: string; onPress: () => void }) => {
    const [aspectRatio, setAspectRatio] = useState<number>(1);

    useEffect(() => {
        Image.getSize(uri, (w, h) => {
            if (w && h) {
                setAspectRatio(w / h);
            }
        }, () => { });
    }, [uri]);

    return (
        <Pressable onPress={onPress}>
            <Image
                source={{ uri }}
                style={[styles.chatImagePreview, { aspectRatio }]}
                resizeMode="contain"
            />
        </Pressable>
    );
});

// --- Static Constants ---
const EXPANDED_WIDTH = width * 0.9;
const COLLAPSED_WIDTH = width * 0.75;
const ANIMATION_DURATION = 500;

// --- Attachment Types & Constants ---
const INPUT_HEIGHT_NORMAL = 40.5;
const INPUT_HEIGHT_WITH_PREVIEW = 130;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg'];
const SUPPORTED_DOC_TYPES = [
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
    'application/json',
    'message/rfc822',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const ALL_SUPPORTED_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOC_TYPES];
const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/x-wav', 'audio/mp4'];

interface Attachment {
    uri: string;
    name: string;
    type: string;
    size?: number;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    attachment?: Attachment;
}

// --- Memoized Chat Message Item ---
// Extracted so completed messages don't re-render during streaming.
interface ChatMessageItemProps {
    msg: ChatMessage;
    modelName: string;
    colors: any;
    copiedMessageId: string | null;
    isGenerating: boolean;
    onCopy: (id: string, text: string) => void;
    onShare: (text: string) => void;
    onRegenerate: (id: string) => void;
    onEdit: (id: string, text: string) => void;
    onImagePress: (uri: string) => void;
}

const ChatMessageItem = memo(({
    msg,
    modelName,
    colors,
    copiedMessageId,
    isGenerating,
    onCopy,
    onShare,
    onRegenerate,
    onEdit,
    onImagePress,
}: ChatMessageItemProps) => {
    const isCopied = copiedMessageId === msg.id;

    return (
        <View>
            <View
                style={[
                    styles.messageBubble,
                    msg.role === 'user'
                        ? [styles.userBubble, { backgroundColor: colors.card }]
                        : [styles.assistantBubble],
                ]}>
                {msg.role === 'assistant' && (
                    <View style={styles.assistantHeader}>
                        <View style={[styles.activeDot, { backgroundColor: colors.text }]} />
                        <Text style={[styles.assistantModelTag, { color: colors.text }]}>
                            {modelName} (On-Device)
                        </Text>
                    </View>
                )}
                {msg.role === 'assistant' ? (
                    <MessageRenderer content={msg.text} />
                ) : (
                    <View>
                        {msg.attachment && (
                            SUPPORTED_IMAGE_TYPES.includes(msg.attachment.type.toLowerCase()) ? (
                                <ChatImage
                                    uri={msg.attachment.uri}
                                    onPress={() => onImagePress(msg.attachment!.uri)}
                                />
                            ) : (
                                <View style={[styles.chatFileCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                    <FileIcon color={colors.primary} />
                                    <View style={styles.chatFileInfo}>
                                        <Text style={[styles.chatFileName, { color: colors.text }]} numberOfLines={1}>
                                            {msg.attachment.name}
                                        </Text>
                                        {msg.attachment.size != null && (
                                            <Text style={[styles.chatFileSize, { color: colors.secondaryText }]}>
                                                {(msg.attachment.size / 1024).toFixed(0)} KB
                                            </Text>
                                        )}
                                    </View>
                                </View>
                            )
                        )}
                        {msg.text.length > 0 && (
                            <Text
                                selectable
                                style={[
                                    styles.messageText,
                                    { color: colors.text },
                                    msg.attachment ? { marginTop: 8 } : undefined,
                                ]}>
                                {msg.text}
                            </Text>
                        )}
                    </View>
                )}
            </View>

            {/* Action Buttons */}
            <View style={[
                styles.actionBar,
                msg.role === 'user' ? styles.actionBarUser : styles.actionBarAssistant,
            ]}>
                <Pressable onPress={() => onCopy(msg.id, msg.text)} hitSlop={8} style={styles.actionBtn}>
                    <CopyIcon size={15} color={colors.secondaryText} />
                    {isCopied && (
                        <Text style={[styles.actionLabel, { color: colors.secondaryText }]}>Copied</Text>
                    )}
                </Pressable>
                <Pressable onPress={() => onShare(msg.text)} hitSlop={8} style={styles.actionBtn}>
                    <ShareIcon size={15} color={colors.secondaryText} />
                </Pressable>
                {msg.role === 'assistant' && (
                    <Pressable
                        onPress={() => onRegenerate(msg.id)}
                        hitSlop={8}
                        style={styles.actionBtn}
                        disabled={isGenerating}>
                        <ReloadIcon size={15} color={isGenerating ? colors.border : colors.secondaryText} />
                    </Pressable>
                )}
                {msg.role === 'user' && (
                    <Pressable onPress={() => onEdit(msg.id, msg.text)} hitSlop={8} style={styles.actionBtn}>
                        <EditIcon size={15} color={colors.secondaryText} />
                    </Pressable>
                )}
            </View>
        </View>
    );
});

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

const PlusIcon = memo(({ color }: { color: any }) => (
    <View style={styles.plusIconContainer}>
        <Animated.View style={[styles.plusLineH, { backgroundColor: color }]} />
        <Animated.View style={[styles.plusLineV, { backgroundColor: color }]} />
    </View>
));

const StopIcon = memo(({ color }: { color: string }) => (
    <View style={styles.stopIconContainer}>
        <View style={[styles.stopSquare, { backgroundColor: color }]} />
    </View>
));


const UploadIcon = memo(({ color }: { color: string }) => (
    <View style={styles.uploadIconContainer}>
        {/* Arrow up */}
        <View style={[styles.uploadArrowStem, { backgroundColor: color }]} />
        <View style={[styles.uploadArrowLeft, { backgroundColor: color }]} />
        <View style={[styles.uploadArrowRight, { backgroundColor: color }]} />
        {/* Tray */}
        <View style={[styles.uploadTray, { borderColor: color }]} />
    </View>
));

const CloseIcon = memo(({ color, size = 16 }: { color: string; size?: number }) => (
    <View style={[styles.closeIconContainer, { width: size, height: size }]}>
        <View style={[styles.closeLine1, { backgroundColor: color, width: size * 0.7 }]} />
        <View style={[styles.closeLine2, { backgroundColor: color, width: size * 0.7 }]} />
    </View>
));

const FileIcon = memo(({ color }: { color: string }) => (
    <View style={styles.fileIconContainer}>
        <View style={[styles.fileBody, { borderColor: color }]} />
        <View style={[styles.fileFold, { borderColor: color, backgroundColor: color + '20' }]} />
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
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
    const [isPlusMenuVisible, setIsPlusMenuVisible] = useState(false);
    const [showStopButton, setShowStopButton] = useState(false);
    const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
    const [isMultiline, setIsMultiline] = useState(false);
    const [isProcessingDocument, setIsProcessingDocument] = useState(false);
    const [documentProgressMessage, setDocumentProgressMessage] = useState<string>('');
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

    // Re-entrancy guard: prevents two rapid messages from both triggering
    // auto-load concurrently (the native side rejects with ERR_BUSY but the
    // user would see a confusing "load error" message without this).
    const isAutoLoadingRef = useRef(false);
    const inputRef = useRef<TextInput>(null);
    const editingMessageIdRef = useRef<string | null>(null);
    const wrapLengthRef = useRef(0);
    const initialHeightRef = useRef(0);

    // Modifier key tracking for hardware keyboard shortcuts
    const shiftHeldRef = useRef(false);
    const ctrlHeldRef = useRef(false);

    // Native LLM Hook
    const {
        isGenerating,
        streamedText,
        generate,
        generateWithVision,
        generateWithAudio,
        stopGeneration,
        loadModel,
    } = useLLM();

    const selectedModel = useMemo(
        () =>
            AVAILABLE_MODELS.find((m) => m.id === selectedModelId) ||
            AVAILABLE_MODELS[0],
        [selectedModelId]
    );

    // Stable refs for handlers used inside the key listener so the
    // effect never needs to re-register when these callbacks change.
    // Initialized as null because the callbacks are defined below (after this line).
    const handleSendRef = useRef<(() => void) | null>(null);
    handleSendRef.current = handleSend;
    const handleNewChatRef = useRef<(() => void) | null>(null);
    handleNewChatRef.current = handleNewChat;
    const openModelSelectorRef = useRef<(() => void) | null>(null);
    openModelSelectorRef.current = openModelSelector;

    // Global Hardware Key Listener
    // Android keyCodes: F1=131, F2=132, Search=84, Enter=66, Escape=111,
    //   ShiftL=59, ShiftR=60, CtrlL=113, CtrlR=114, N=42, M=41
    useEffect(() => {
        KeyEvent.onKeyDownListener((keyEvent: any) => {
            const { keyCode } = keyEvent;

            // ── Track modifier keys ──
            if (keyCode === 59 || keyCode === 60) { shiftHeldRef.current = true; return; }
            if (keyCode === 113 || keyCode === 114) { ctrlHeldRef.current = true; return; }

            // ── F1 (131) or Search (84) → Focus input ──
            if (keyCode === 131 || keyCode === 84) {
                inputRef.current?.focus();
                return;
            }

            // ── Enter (66) without Shift → Send message ──
            // (Shift+Enter passes through natively to insert a newline)
            if (keyCode === 66 && !shiftHeldRef.current) {
                handleSendRef.current?.();
                return;
            }

            // ── Ctrl+N (42) → New Chat ──
            if (keyCode === 42 && ctrlHeldRef.current) {
                handleNewChatRef.current?.();
                return;
            }

            // ── Ctrl+M (41) or F2 (132) → Open Model Selector ──
            if ((keyCode === 41 && ctrlHeldRef.current) || keyCode === 132) {
                openModelSelectorRef.current?.();
                return;
            }

            // ── Escape (111) → Dismiss keyboard ──
            if (keyCode === 111) {
                Keyboard.dismiss();
                return;
            }
        });

        KeyEvent.onKeyUpListener((keyEvent: any) => {
            const { keyCode } = keyEvent;
            if (keyCode === 59 || keyCode === 60) shiftHeldRef.current = false;
            if (keyCode === 113 || keyCode === 114) ctrlHeldRef.current = false;
        });

        return () => {
            KeyEvent.removeKeyDownListener();
            KeyEvent.removeKeyUpListener();
        };
    }, []);

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
    const inputHeightAnim = useRef(new Animated.Value(INPUT_HEIGHT_NORMAL)).current;
    const borderRadiusAnim = useRef(new Animated.Value(70)).current;
    const plusRotationAnim = useRef(new Animated.Value(0)).current;
    const sendBtnBgAnim = useRef(new Animated.Value(0)).current;

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
            (scrollViewRef.current as any)?.scrollToEnd({ animated: true });
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
            await stopGeneration().catch(() => { });
        }
        setMessages([]);
        setInputText('');
        setIsMultiline(false);
        setPendingAttachment(null);
        inputHeightAnim.setValue(INPUT_HEIGHT_NORMAL);
        if (currentStatus === 'loaded') {
            await LLMService.resetConversation();
        }
    }, [isGenerating, stopGeneration, currentStatus, inputHeightAnim]);

    // --- Attachment Handlers ---
    const animateInputHeight = useCallback((toValue: number) => {
        Animated.timing(inputHeightAnim, {
            toValue,
            duration: 250,
            useNativeDriver: false,
        }).start();
    }, [inputHeightAnim]);

    useEffect(() => {
        Animated.timing(borderRadiusAnim, {
            toValue: (isMultiline || pendingAttachment) ? 12 : 50,
            duration: 250,
            useNativeDriver: false,
        }).start();
    }, [isMultiline, pendingAttachment, borderRadiusAnim]);

    useEffect(() => {
        Animated.timing(plusRotationAnim, {
            toValue: isPlusMenuVisible ? 1 : 0,
            duration: 250,
            useNativeDriver: true,
        }).start();
    }, [isPlusMenuVisible, plusRotationAnim]);

    const isSendActive = (inputText.trim().length > 0 || !!pendingAttachment) && !isProcessingDocument && !isGenerating;

    useEffect(() => {
        Animated.timing(sendBtnBgAnim, {
            toValue: isSendActive ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [isSendActive, sendBtnBgAnim]);

    const plusRotationStyle = {
        transform: [
            {
                rotate: plusRotationAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '-45deg'],
                }),
            },
        ],
    };

    const handleOpenPlusMenu = useCallback(() => {
        ReactNativeHapticFeedback.trigger('impactLight', {
            enableVibrateFallback: true,
            ignoreAndroidSystemSettings: false,
        });
        setIsPlusMenuVisible(true);
    }, []);

    const handleClosePlusMenu = useCallback(() => {
        setIsPlusMenuVisible(false);
    }, []);

    const handlePickImage = useCallback(async () => {
        setIsPlusMenuVisible(false);
        try {
            const result = await pick({
                mode: 'import',
                type: [
                    DocumentPickerTypes.images,
                ],
            });

            const file = result[0];
            if (!file) return;

            const fileType = file.type || '';
            const fileSize = file.size || 0;

            // Validate file type
            if (!SUPPORTED_IMAGE_TYPES.includes(fileType.toLowerCase())) {
                Alert.alert(
                    'Unsupported File',
                    `"${file.name}" is not a supported image type. Supported: JPEG, PNG, WebP, GIF.`,
                    [{ text: 'OK' }]
                );
                return;
            }

            // Validate file size
            if (fileSize > MAX_FILE_SIZE_BYTES) {
                Alert.alert(
                    'File Too Large',
                    `"${file.name}" is ${(fileSize / (1024 * 1024)).toFixed(1)} MB. Maximum allowed is 10 MB.`,
                    [{ text: 'OK' }]
                );
                return;
            }

            // Cache a local copy of the file for native modules
            let fileUri = file.uri;
            try {
                const copyResult = await keepLocalCopy({
                    files: [{ uri: file.uri, fileName: file.name || 'file' }],
                    destination: 'cachesDirectory',
                });
                if (copyResult[0].status === 'success') {
                    fileUri = copyResult[0].localUri;
                }
            } catch (copyErr) {
                console.warn('[HomePage] Failed to create local copy:', copyErr);
            }

            setPendingAttachment({
                uri: fileUri,
                name: file.name || 'file',
                type: fileType,
                size: fileSize,
            });
            animateInputHeight(INPUT_HEIGHT_WITH_PREVIEW);
        } catch (err: any) {
            if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
                // User cancelled — no state change
                return;
            }
            console.error('[HomePage] Image pick error:', err);
            Alert.alert('Error', 'Could not pick image. Please try again.', [{ text: 'OK' }]);
        }
    }, [animateInputHeight]);

    const handlePickDocument = useCallback(async () => {
        setIsPlusMenuVisible(false);
        try {
            const result = await pick({
                mode: 'import',
                type: [
                    DocumentPickerTypes.pdf,
                    DocumentPickerTypes.plainText,
                    DocumentPickerTypes.csv,
                    DocumentPickerTypes.doc,
                    DocumentPickerTypes.docx,
                    DocumentPickerTypes.xls,
                    DocumentPickerTypes.xlsx,
                    DocumentPickerTypes.audio,
                ],
            });

            const file = result[0];
            if (!file) return;

            const fileType = file.type || '';
            const fileSize = file.size || 0;

            // Validate file size
            if (fileSize > MAX_FILE_SIZE_BYTES) {
                Alert.alert(
                    'File Too Large',
                    `"${file.name}" is ${(fileSize / (1024 * 1024)).toFixed(1)} MB. Maximum allowed is 10 MB.`,
                    [{ text: 'OK' }]
                );
                return;
            }

            // Cache a local copy of the file for native modules
            let fileUri = file.uri;
            try {
                const copyResult = await keepLocalCopy({
                    files: [{ uri: file.uri, fileName: file.name || 'file' }],
                    destination: 'cachesDirectory',
                });
                if (copyResult[0].status === 'success') {
                    fileUri = copyResult[0].localUri;
                }
            } catch (copyErr) {
                console.warn('[HomePage] Failed to create local copy:', copyErr);
            }

            setPendingAttachment({
                uri: fileUri,
                name: file.name || 'file',
                type: fileType,
                size: fileSize,
            });
            animateInputHeight(INPUT_HEIGHT_WITH_PREVIEW);
        } catch (err: any) {
            if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
                // User cancelled — no state change
                return;
            }
            console.error('[HomePage] Document pick error:', err);
            Alert.alert('Error', 'Could not pick file. Please try again.', [{ text: 'OK' }]);
        }
    }, [animateInputHeight]);

    const handleRemoveAttachment = useCallback(() => {
        setPendingAttachment(null);
        animateInputHeight(INPUT_HEIGHT_NORMAL);
    }, [animateInputHeight]);

    // Send Message / Generate Output
    const handleSend = useCallback(async () => {
        const query = inputText.trim();
        const attachment = pendingAttachment;

        // Need at least text or an attachment
        if ((!query && !attachment) || isGenerating) return;

        // Clear input state immediately
        setInputText('');
        setIsMultiline(false);
        setPendingAttachment(null);
        animateInputHeight(INPUT_HEIGHT_NORMAL);

        // If editing a previous message, truncate from that point
        const editId = editingMessageIdRef.current;
        if (editId) {
            setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === editId);
                if (idx >= 0) return prev.slice(0, idx);
                return prev;
            });
            editingMessageIdRef.current = null;
        }

        const userMsgId = Date.now().toString();
        const assistantMsgId = (Date.now() + 1).toString();

        // Build the single combined user message
        const userMessage: ChatMessage = {
            id: userMsgId,
            role: 'user',
            text: query,
            attachment: attachment || undefined,
        };

        setMessages((prev) => [...prev, userMessage]);

        // Check attachment type
        const isImageAttachment = attachment && SUPPORTED_IMAGE_TYPES.includes(attachment.type.toLowerCase());
        const isAudioAttachment = attachment && SUPPORTED_AUDIO_TYPES.includes(attachment.type.toLowerCase());
        const modelSupportsVision = !!selectedModel.supportsVision;
        const modelSupportsAudio = !!selectedModel.supportsAudio;

        if (isImageAttachment && !modelSupportsVision) {
            setMessages((prev) => [
                ...prev,
                {
                    id: assistantMsgId,
                    role: 'assistant',
                    text: `"${selectedModel.name}" doesn't support image input. Please select a vision-capable model to process images, or send a text-only message.`,
                },
            ]);
            return;
        }

        if (isAudioAttachment && !modelSupportsAudio) {
            setMessages((prev) => [
                ...prev,
                {
                    id: assistantMsgId,
                    role: 'assistant',
                    text: `"${selectedModel.name}" doesn't support audio input. Please select an audio-capable model (e.g. Gemma 4) to process audio files, or send a text-only message.`,
                },
            ]);
            return;
        }

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
            // Keep the conversation inside the model's context window.
            const promptText = query || (attachment ? `[Image: ${attachment.name}]` : '');
            const wasReset = await LLMService.ensureContextBudget(estimateTokens(promptText));
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

            let response: string;

            if (isImageAttachment && modelSupportsVision && attachment) {
                // Vision path: send image + text together
                const imagePath = attachment.uri.replace('file://', '');
                response = await generateWithVision(query || 'Describe this image.', imagePath);
            } else if (isAudioAttachment && modelSupportsAudio && attachment) {
                // Audio path: send audio + text together
                const audioPath = attachment.uri.replace('file://', '');
                response = await generateWithAudio(query || 'Describe this audio.', audioPath);
            } else if (attachment && !isImageAttachment && !isAudioAttachment) {
                // Document processing path
                setIsProcessingDocument(true);
                setDocumentProgressMessage('Processing document...');

                const unsubscribe = documentService.onProgress((event) => {
                    setDocumentProgressMessage(event.message);
                });

                try {
                    const filePath = attachment.uri.replace('file://', '');
                    const docResult = await documentService.processDocument(filePath);
                    unsubscribe();

                    if (docResult.warnings && docResult.warnings.length > 0) {
                        setMessages((prev) => [
                            ...prev,
                            { id: `${assistantMsgId}-warn`, role: 'assistant', text: `_Note: ${docResult.warnings.join(', ')}_` }
                        ]);
                    }

                    const maxTokens = 2000; // Leave room for response
                    const relevantContext = documentService.getRelevantContext(query, docResult.text, maxTokens);

                    let finalPrompt = query;
                    if (relevantContext) {
                        finalPrompt = `[Document Context from ${attachment.name}]\n${relevantContext}\n\nUser Question: ${query || 'Summarize the document.'}`;
                    } else {
                        finalPrompt = query || `[Attached file: ${attachment.name} - could not extract text]`;
                    }

                    response = await generate(finalPrompt);
                } catch (docErr: any) {
                    unsubscribe();
                    throw new Error(`Failed to process document: ${docErr.message}`);
                } finally {
                    setIsProcessingDocument(false);
                    setDocumentProgressMessage('');
                }
            } else {
                // Text-only path (existing flow)
                response = await generate(query);
            }

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
        pendingAttachment,
        isGenerating,
        currentStatus,
        loadModel,
        selectedModel.fileName,
        selectedModel.id,
        selectedModel.name,
        selectedModel.supportsVision,
        selectedModel.supportsAudio,
        generate,
        generateWithVision,
        generateWithAudio,
        streamedText,
        dispatch,
        preferredBackend,
        animateInputHeight,
    ]);

    // --- Message Action Handlers ---

    const handleCopyMessage = useCallback((msgId: string, text: string) => {
        Clipboard.setString(text);
        setCopiedMessageId(msgId);
        setTimeout(() => setCopiedMessageId(null), 2000);
    }, []);

    const handleShareMessage = useCallback(async (text: string) => {
        try {
            await Share.share({ message: text });
        } catch (err: any) {
            console.error('[HomePage] Share error:', err);
        }
    }, []);

    const handleRegenerateMessage = useCallback(async (msgId: string) => {
        if (isGenerating) return;

        // Find the user message that triggered this assistant response
        const msgIndex = messages.findIndex((m) => m.id === msgId);
        if (msgIndex < 0) return;

        // Find the preceding user message
        let userMsg: ChatMessage | undefined;
        for (let i = msgIndex - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                userMsg = messages[i];
                break;
            }
        }
        if (!userMsg) return;

        // Remove this assistant message and everything after it
        setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === msgId);
            if (idx < 0) return prev;
            return prev.slice(0, idx);
        });

        // Re-generate using the original user query
        const newAssistantId = Date.now().toString();
        try {
            const response = await generate(userMsg.text);
            setMessages((prev) => [
                ...prev,
                { id: newAssistantId, role: 'assistant', text: response },
            ]);
        } catch (err: any) {
            console.error('[HomePage] Regenerate error:', err);
            setMessages((prev) => [
                ...prev,
                {
                    id: newAssistantId,
                    role: 'assistant',
                    text: streamedText || 'Error: Could not regenerate the response. Please try again.',
                },
            ]);
        }
    }, [isGenerating, messages, generate, streamedText]);

    const handleEditMessage = useCallback((msgId: string, text: string) => {
        // Store the message ID — truncation happens on Send
        editingMessageIdRef.current = msgId;
        setInputText(text);
        inputRef.current?.focus();
    }, []);

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
    const headphoneBgColor = colors.headphoneBg || '#FFF';
    const headphoneIconColor = colors.headphoneIcon || '#000000';
    const secondaryTextColor = colors.secondaryText || '#9E9EA8';

    const isDark = theme.mode === 'dark';
    const glassBgColor = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.6)';
    const popupBgColor = isDark ? 'rgba(34,36,43,0.85)' : 'rgba(255,255,255,0.85)';
    const inactiveIconColor = isDark ? secondaryTextColor : colors.text;

    const dotColor =
        currentStatus === 'loaded'
            ? '#10A37F'
            : colors.text;

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
                            onPress={openModelSelector}
                            style={[
                                styles.modelSelectorButton,
                                {
                                    backgroundColor: colors.card,
                                    borderColor: colors.border,
                                },
                            ]}>
                            <View style={{ marginRight: 4 }}>
                                <LiveIcon color={dotColor} size={14} isAnimated={isGenerating} />
                            </View>
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
                                ref={scrollViewRef as any}
                                onScroll={handleScroll}
                                scrollEventThrottle={16}
                                onContentSizeChange={handleContentSizeChange}
                                style={styles.chatScroll}
                                contentContainerStyle={[styles.chatScrollContent, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 80 }]}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled">
                                {messages.map((msg) => (
                                    <ChatMessageItem
                                        key={msg.id}
                                        msg={msg}
                                        modelName={selectedModel.name}
                                        colors={colors}
                                        copiedMessageId={copiedMessageId}
                                        isGenerating={isGenerating}
                                        onCopy={handleCopyMessage}
                                        onShare={handleShareMessage}
                                        onRegenerate={handleRegenerateMessage}
                                        onEdit={handleEditMessage}
                                        onImagePress={setFullscreenImage}
                                    />
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
                                                color={colors.text}
                                            />
                                            <Text
                                                style={[
                                                    styles.assistantModelTag,
                                                    { color: colors.text },
                                                ]}>
                                                Generating with {selectedModel.name}...
                                            </Text>
                                        </View>
                                        <MessageRenderer content={streamedText || 'Thinking...'} />
                                        <Text style={{ color: colors.text, fontSize: 15, marginTop: 4 }}> ▋</Text>
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
                                minHeight: inputHeightAnim,
                                borderRadius: borderRadiusAnim,
                                backgroundColor: colors.card,
                                borderColor: colors.border,
                                bottom: insets.bottom,
                                alignSelf: 'center',
                            },
                        ]}>
                        {/* Attachment Preview (above input row) */}
                        {pendingAttachment && (
                            <View style={styles.attachmentPreviewRow}>
                                {SUPPORTED_IMAGE_TYPES.includes(pendingAttachment.type.toLowerCase()) ? (
                                    <Image
                                        source={{ uri: pendingAttachment.uri }}
                                        style={styles.previewThumbnail}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <View style={[styles.previewFileCard, { backgroundColor: colors.background }]}>
                                        <FileIcon color={colors.primary} />
                                        <Text style={[styles.previewFileName, { color: colors.text }]} numberOfLines={1}>
                                            {pendingAttachment.name}
                                        </Text>
                                    </View>
                                )}
                                <Pressable
                                    onPress={handleRemoveAttachment}
                                    style={[styles.previewCloseBtn, { backgroundColor: colors.background }]}>
                                    <CloseIcon color={colors.text} size={12} />
                                </Pressable>
                            </View>
                        )}

                        {/* Input Row */}
                        <View style={[styles.inputRow, isMultiline && { flexDirection: 'column', alignItems: 'stretch' }]}>
                            {/* TextInput */}
                            <TextInput
                                ref={inputRef}
                                style={[
                                    styles.input,
                                    { color: colors.text, maxHeight: 120 },
                                    isMultiline ? { paddingLeft: 4, paddingRight: 4, minHeight: 40 } : { paddingLeft: 42, paddingRight: 42 }
                                ]}
                                placeholder="Message AI..."
                                placeholderTextColor={secondaryTextColor}
                                value={inputText}
                                onChangeText={(text) => {
                                    setInputText(text);
                                    if (isMultiline && text.length <= Math.max(1, wrapLengthRef.current)) {
                                        setIsMultiline(false);
                                    }
                                }}
                                onContentSizeChange={(e) => {
                                    const currentHeight = e.nativeEvent.contentSize.height;

                                    // Dynamically track the shortest height seen as the "1-line" height
                                    if (initialHeightRef.current === 0 || (currentHeight < initialHeightRef.current && currentHeight > 0)) {
                                        initialHeightRef.current = currentHeight;
                                    }

                                    // If current height exceeds the 1-line baseline by >10px, it has wrapped
                                    if (!isMultiline && initialHeightRef.current > 0 && currentHeight > initialHeightRef.current + 10) {
                                        wrapLengthRef.current = inputText.length;
                                        setIsMultiline(true);
                                    }
                                }}
                                multiline={true}
                                submitBehavior="blurAndSubmit"
                                returnKeyType="default"
                                onKeyPress={({ nativeEvent }) => {
                                    if (nativeEvent.key === 'Enter' && !shiftHeldRef.current) {
                                        handleSend();
                                        // Android inserts '\n' into the TextInput *after* onKeyPress fires.
                                        // Clear it on the next tick so the field is truly empty after sending.
                                        setTimeout(() => { setInputText(''); setIsMultiline(false); }, 0);
                                    }
                                }}
                                onFocus={expand}
                                onBlur={collapse}

                            />

                            {/* Actions Container */}
                            <View
                                style={isMultiline
                                    ? { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 6 }
                                    : { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }
                                }
                                pointerEvents="box-none"
                            >
                                {/* Plus button inside pill */}
                                <View style={{ width: 34, height: 34, backgroundColor: glassBgColor, borderRadius: 17, justifyContent: 'center', alignItems: 'center' }} pointerEvents="auto">
                                    <Pressable
                                        onPress={handleOpenPlusMenu}
                                        style={styles.iconButton}>
                                        <Animated.View style={plusRotationStyle}>
                                            <PlusIcon color={plusRotationAnim.interpolate({ inputRange: [0, 1], outputRange: [inactiveIconColor, colors.text] })} />
                                        </Animated.View>
                                    </Pressable>
                                </View>

                                {/* Action Icon: Send / Stop / Mic / Progress */}
                                <View style={{ width: 34, height: 34, backgroundColor: glassBgColor, borderRadius: 17 }} pointerEvents="auto">
                                    {isProcessingDocument ? (
                                        <Reanimated.View key="process" entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(200)} style={{ position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                            <ActivityIndicator size="small" color="#2DD4BF" />
                                        </Reanimated.View>
                                    ) : isGenerating ? (
                                        <Reanimated.View key="stop" entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(200)} style={{ position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                            <Pressable
                                                onPress={stopGeneration}
                                                style={styles.iconButton}>
                                                <StopIcon color="#FF453A" />
                                            </Pressable>
                                        </Reanimated.View>
                                    ) : (inputText.trim().length > 0 || pendingAttachment) ? (
                                        <Reanimated.View key="send" entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(200)} style={{ position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                            <Pressable
                                                onPress={handleSend}
                                                style={styles.iconButton}>
                                                <SendIcon size={18} color={sendBtnBgAnim.interpolate({ inputRange: [0, 1], outputRange: [inactiveIconColor, colors.text] })} />
                                            </Pressable>
                                        </Reanimated.View>
                                    ) : (
                                        <Reanimated.View key="mic" entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(200)} style={{ position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                            <Pressable style={styles.iconButton}>
                                                <MicIcon color={inactiveIconColor} size={18} />
                                            </Pressable>
                                        </Reanimated.View>
                                    )}
                                </View>
                            </View>
                        </View>
                    </Animated.View>

                    {/* Plus Menu Popup */}
                    {isPlusMenuVisible && (
                        <Reanimated.View
                            entering={FadeIn.duration(250)}
                            exiting={FadeOut.duration(150)}
                            style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
                            <Pressable style={[styles.plusMenuBackdrop, { backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)' }]} onPress={handleClosePlusMenu} />
                            <Animated.View
                                style={[
                                    styles.plusMenuContainer,
                                    {
                                        position: 'absolute',
                                        backgroundColor: popupBgColor,
                                        borderColor: colors.border,
                                        bottom: Animated.add(inputHeightAnim, insets.bottom + 10),
                                        marginLeft: 0,
                                        left: widthAnim.interpolate({
                                            inputRange: [COLLAPSED_WIDTH, EXPANDED_WIDTH],
                                            outputRange: [(width - COLLAPSED_WIDTH) / 2 + 8, (width - EXPANDED_WIDTH) / 2 + 8],
                                        }),
                                    },
                                ]}>
                                <Reanimated.View entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(150)}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.plusMenuItem,
                                            {
                                                backgroundColor: pressed ? colors.border : (isDark ? colors.background : '#FFF'),
                                                transform: [{ scale: pressed ? 0.96 : 1 }]
                                            }
                                        ]}
                                        onPress={handlePickImage}>
                                        <ImageIcon size={24} color={colors.text} />
                                        <Text style={[styles.plusMenuItemText, { color: colors.text }]}>
                                            Upload Image
                                        </Text>
                                    </Pressable>
                                </Reanimated.View>

                                <Reanimated.View entering={FadeIn.delay(50).duration(200)} exiting={FadeOut.duration(150)}>
                                    <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
                                </Reanimated.View>

                                <Reanimated.View entering={ZoomIn.delay(100).duration(200)} exiting={ZoomOut.duration(150)}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.plusMenuItem,
                                            {
                                                backgroundColor: pressed ? colors.border : (isDark ? colors.background : '#FFF'),
                                                transform: [{ scale: pressed ? 0.96 : 1 }]
                                            }
                                        ]}
                                        onPress={handlePickDocument}>
                                        <DocumentIcon size={24} color={colors.text} />
                                        <Text style={[styles.plusMenuItemText, { color: colors.text }]}>
                                            Upload Files
                                        </Text>
                                    </Pressable>
                                </Reanimated.View>
                            </Animated.View>
                        </Reanimated.View>
                    )}
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

            {/* Fullscreen Image Preview Modal */}
            <Modal visible={!!fullscreenImage} transparent={true} animationType="fade">
                <View style={styles.fullscreenModalContainer}>
                    <Pressable
                        style={[styles.fullscreenCloseButton, { top: insets.top + 10 }]}
                        onPress={() => setFullscreenImage(null)}
                    >
                        <View style={{ transform: [{ rotate: '45deg' }] }}>
                            <PlusIcon color="#FFF" />
                        </View>
                    </Pressable>

                    {fullscreenImage && (
                        <Zoom
                            minScale={1}
                            maxScale={5}
                            doubleTapConfig={{ defaultScale: 2, minZoomScale: 1, maxZoomScale: 5 }}
                            style={{ flex: 1, width: width, position: 'relative' }}
                        >
                            <Image
                                source={{ uri: fullscreenImage }}
                                style={styles.fullscreenImage}
                                resizeMode="contain"
                            />
                        </Zoom>
                    )}
                </View>
            </Modal>
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
    },
    messageText: {
        fontSize: 15,
        lineHeight: 22,
    },
    // --- Message Action Bar ---
    actionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 4,
        paddingTop: 6,
        paddingBottom: 2,
    },
    actionBarAssistant: {
        justifyContent: 'flex-start',
    },
    actionBarUser: {
        justifyContent: 'flex-end',
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 4,
    },
    actionLabel: {
        fontSize: 11,
        fontWeight: '500',
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
        flexDirection: 'column',
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 2,
        position: 'absolute',
        zIndex: 1000,
        overflow: 'hidden',
        justifyContent: 'center',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: INPUT_HEIGHT_NORMAL,
        justifyContent: 'center'
    },
    input: {
        flex: 1,
        minHeight: INPUT_HEIGHT_NORMAL,
        paddingVertical: 10,
        paddingLeft: '3.5%',
        paddingRight: 4,
        fontSize: 15,
        includeFontPadding: false,

    },
    iconButton: {
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
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
    // --- Attachment Preview (inside input pill) ---
    attachmentPreviewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 8,
    },
    previewThumbnail: {
        width: 64,
        height: 64,
        borderRadius: 10,
    },
    previewFileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        gap: 8,
        flex: 1,
    },
    previewFileName: {
        fontSize: 12,
        fontWeight: '500',
        flexShrink: 1,
    },
    previewCloseBtn: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 22,
        height: 22,
        borderRadius: 11,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 2,
    },
    // --- Plus Menu Popup ---
    plusMenuBackdrop: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        bottom: 5,
    },
    plusMenuContainer: {
        marginLeft: 24,
        borderRadius: 10,
        borderWidth: 1,
        minWidth: 180,
        padding: 10,
    },
    plusMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 8,
        borderRadius: 8,
    },
    plusMenuItemText: {
        fontSize: 15,
        fontWeight: '500',
    },
    // --- Chat Attachment Rendering ---
    chatImagePreview: {
        width: width * 0.6,
        borderRadius: 12,
        alignSelf: 'flex-start',
    },
    chatFileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        gap: 10,
    },
    chatFileInfo: {
        flex: 1,
    },
    chatFileName: {
        fontSize: 13,
        fontWeight: '600',
    },
    chatFileSize: {
        fontSize: 11,
        marginTop: 2,
    },
    // --- Upload Icon ---
    uploadIconContainer: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    uploadArrowStem: {
        width: 2,
        height: 9,
        borderRadius: 1,
        position: 'absolute',
        top: 1,
    },
    uploadArrowLeft: {
        position: 'absolute',
        width: 2,
        height: 5.5,
        borderRadius: 1,
        top: 1,
        left: 5.5,
        transform: [{ rotate: '45deg' }],
    },
    uploadArrowRight: {
        position: 'absolute',
        width: 2,
        height: 5.5,
        borderRadius: 1,
        top: 1,
        right: 5.5,
        transform: [{ rotate: '-45deg' }],
    },
    uploadTray: {
        position: 'absolute',
        bottom: 1,
        width: 16,
        height: 6,
        borderBottomLeftRadius: 3,
        borderBottomRightRadius: 3,
        borderWidth: 1.5,
        borderTopWidth: 0,
    },
    // --- Close Icon ---
    closeIconContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeLine1: {
        position: 'absolute',
        height: 1.8,
        borderRadius: 1,
        transform: [{ rotate: '45deg' }],
    },
    closeLine2: {
        position: 'absolute',
        height: 1.8,
        borderRadius: 1,
        transform: [{ rotate: '-45deg' }],
    },
    // --- File Icon ---
    fileIconContainer: {
        width: 20,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fileBody: {
        width: 16,
        height: 20,
        borderRadius: 2,
        borderWidth: 1.5,
    },
    fileFold: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 7,
        height: 7,
        borderBottomLeftRadius: 2,
        borderLeftWidth: 1.5,
        borderBottomWidth: 1.5,
    },
    // --- Fullscreen Modal ---
    fullscreenModalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
    },
    fullscreenZoomContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullscreenImage: {
        width: width,
        height: windowHeight,
    },
    fullscreenCloseButton: {
        position: 'absolute',
        right: width * 0.035,
        zIndex: 100,
        elevation: 10,
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(20, 20, 0, 20.1)',
        borderRadius: 18,
    },
    fullscreenCloseText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
});

export default memo(HomePage);
