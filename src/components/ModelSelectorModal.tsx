import React, { memo, useCallback, useEffect } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useTheme } from '../theme/ThemeProvider';
import { RootState } from '../store/store';
import DownloadIcon from '../static/images/SVG/DownloadIcon';
import DeleteIcon from '../static/images/SVG/DeleteIcon';
import PlayIcon from '../static/images/SVG/PlayIcon';
import ReloadIcon from '../static/images/SVG/ReloadIcon';
import LiveIcon from '../static/images/SVG/LiveIcon';
import CpuIcon from '../static/images/SVG/CpuIcon';
import GpuIcon from '../static/images/SVG/GpuIcon';
import NpuIcon from '../static/images/SVG/NpuIcon';
import AutoIcon from '../static/images/SVG/AutoIcon';
import LoaderIcon from '../static/images/SVG/LoaderIcon';
import DriveIcon from '../static/images/SVG/DriveIcon';
import useLLM from '../hooks/useLLM';

import {
    AVAILABLE_MODELS,
    BackendType,
    ModelInfo,
    ModelState,
    setPreferredBackend,
    startDownload,
    setDownloadProgress,
    setDownloaded,
    setDownloadError,
    syncModelStatus,
    startLoadingModel,
    setModelLoadFailed,
    setLoadedModel,
    deleteModel,
    unloadModel,
} from '../store/slices/llmSlice';
import LLMService, {
    DownloadProgressEvent,
    DownloadCompleteEvent,
    DownloadErrorEvent,
} from '../services/llmService';

interface ModelSelectorModalProps {
    visible: boolean;
    onClose: () => void;
    selectedModelId: string;
    onSelectModel: (modelId: string) => void;
}

const BACKENDS: { key: BackendType; label: string; desc: string }[] = [
    { key: 'AUTO', label: 'Auto', desc: 'GPU → CPU' },
    { key: 'NPU', label: 'NPU', desc: 'NPU → GPU → CPU' },
    { key: 'GPU', label: 'GPU', desc: 'High Performance' },
    { key: 'CPU', label: 'CPU', desc: 'Universal Fallback' },
];

const BackendIcons: Record<string, React.FC<any>> = {
    AUTO: AutoIcon,
    NPU: NpuIcon,
    GPU: GpuIcon,
    CPU: CpuIcon,
};

/** Human-readable backend fallback chain — mirrors LLMModule.kt */
const backendChainLabel = (backend: string): string => {
    switch (backend) {
        case 'NPU': return 'NPU → GPU → CPU';
        case 'GPU': return 'GPU → CPU';
        case 'CPU': return 'CPU';
        default: return 'GPU → CPU'; // AUTO
    }
};






const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
        return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
};

const ModelItem = memo(
    ({
        model,
        isSelected,
        modelState,
        activeBackend,
        onDownload,
        onCancelDownload,
        onLoad,
        onUnload,
        onDelete,
        onSelect,
        preferredBackend,
        isUnloading,
        colors,
    }: {
        model: ModelInfo;
        isSelected: boolean;
        modelState: ModelState;
        activeBackend: string | null;
        onDownload: () => void;
        onCancelDownload: () => void;
        onLoad: () => void;
        onUnload: () => void;
        onDelete: () => void;
        onSelect: () => void;
        preferredBackend: string;
        isUnloading: boolean;
        colors: any;
    }) => {
        const { status, progress, speedMBs, bytesDownloaded, totalBytes, error } =
            modelState;
        
        const { isGenerating } = useLLM();

        const isLoaded = status === 'loaded';
        const isDownloaded = status === 'downloaded';
        const isDownloading = status === 'downloading';
        const isLoading = status === 'loading';

        const [showError, setShowError] = React.useState(false);
        const errorOpacity = React.useRef(new Animated.Value(0)).current;

        React.useEffect(() => {
            if (error) {
                setShowError(true);
                Animated.timing(errorOpacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();

                const timer = setTimeout(() => {
                    Animated.timing(errorOpacity, {
                        toValue: 0,
                        duration: 300,
                        useNativeDriver: true,
                    }).start(() => setShowError(false));
                }, 3000);

                return () => clearTimeout(timer);
            } else {
                setShowError(false);
                errorOpacity.setValue(0);
            }
        }, [error, status, errorOpacity]);

        return (
            <View
                style={[
                    styles.modelCard,
                    {
                        backgroundColor: isLoaded
                            ? 'rgba(255, 255, 255, 0.08)'
                            : colors.background,
                        borderColor: isLoaded
                            ? 'rgba(255, 255, 255, 0.6)'
                            : colors.border,
                    },
                ]}>
                {/* Header */}
                <View style={styles.modelHeader}>
                    <View style={styles.modelTitleRow}>
                        <Text style={[styles.modelName, { color: colors.text }]}>
                            {model.name}
                        </Text>
                        <View
                            style={[
                                styles.tagBadge,
                                {
                                    backgroundColor: colors.card,
                                    borderColor: colors.border,
                                },
                            ]}>
                            <Text
                                style={[
                                    styles.tagText,
                                    { color: colors.secondaryText },
                                ]}>
                                {model.tag}
                            </Text>
                        </View>
                        {model.badge && (
                            <View style={styles.recommendedBadge}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    {model.badge}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.rightHeaderAction}>
                        {isLoaded && activeBackend && (
                            <View style={[styles.activeBackendChip, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                                <LiveIcon color="#FFFFFF" size={14} isAnimated={isGenerating} />
                                <Text style={styles.activeBackendChipText}>
                                    {activeBackend}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Description */}
                <Text
                    style={[
                        styles.modelDescription,
                        { color: colors.secondaryText },
                    ]}>
                    {model.description}
                </Text>

                {/* File info & Backend Tag */}
                <View style={styles.modelFooter}>
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.fileNameText,
                            { color: colors.secondaryText },
                        ]}>
                        📦 {model.fileName}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <DriveIcon color={colors.secondaryText} size={14} />
                        <Text
                            style={[
                                styles.sizeText,
                                { color: colors.secondaryText },
                            ]}>
                            {model.size}
                        </Text>
                    </View>
                </View>

                {/* Error Banner if download/load failed */}
                {showError && error && (
                    <Animated.Text style={[styles.errorText, { opacity: errorOpacity }]}>
                        {error.toLowerCase().includes('cancelled') 
                            ? 'Download cancelled.' 
                            : error.replace(/^Error:\s*/i, '')}
                    </Animated.Text>
                )}

                {/* Action Controls Section */}
                <View style={styles.actionContainer}>
                    {/* Status 1: Not Downloaded */}
                    {status === 'not_downloaded' && (
                        <Pressable
                            onPress={onDownload}
                            style={[
                                styles.downloadButton,
                                {
                                    backgroundColor: colors.card,
                                    borderColor: colors.border,
                                },
                            ]}>
                            <DownloadIcon color={colors.text} size={18} />
                            <Text
                                style={[
                                    styles.buttonText,
                                    { color: colors.text },
                                ]}>
                                Download from HuggingFace ({model.size})
                            </Text>
                        </Pressable>
                    )}

                    {/* Status 2: Downloading */}
                    {isDownloading && (
                        <View style={styles.progressSection}>
                            <View style={styles.progressHeader}>
                                <View>
                                    <Text
                                        style={[
                                            styles.progressText,
                                            { color: colors.text },
                                        ]}>
                                        Downloading... {Math.round(progress)}%
                                    </Text>
                                    {bytesDownloaded !== undefined &&
                                        totalBytes !== undefined &&
                                        totalBytes > 0 && (
                                            <Text
                                                style={[
                                                    styles.subProgressText,
                                                    { color: colors.secondaryText },
                                                ]}>
                                                {formatBytes(bytesDownloaded)} /{' '}
                                                {formatBytes(totalBytes)}
                                                {speedMBs && speedMBs > 0
                                                    ? ` • ${speedMBs.toFixed(1)} MB/s`
                                                    : ''}
                                            </Text>
                                        )}
                                </View>
                                <Pressable
                                    onPress={onCancelDownload}
                                    style={styles.cancelDownloadButton}>
                                    <Text style={styles.cancelDownloadText}>
                                        Cancel
                                    </Text>
                                </Pressable>
                            </View>
                            <View
                                style={[
                                    styles.progressBarBackground,
                                    { backgroundColor: colors.border },
                                ]}>
                                <View
                                    style={[
                                        styles.progressBarFill,
                                        { width: `${Math.min(progress, 100)}%`, backgroundColor: colors.text },
                                    ]}
                                />
                            </View>
                        </View>
                    )}

                    {/* Status 3: Downloaded (Ready to Load or Delete) */}
                    {isDownloaded && (
                        <View style={styles.downloadedActionsRow}>
                            <View style={styles.buttonGroup}>
                                <Pressable
                                    onPress={onDelete}
                                    hitSlop={8}
                                    style={styles.deleteIconButton}>
                                    <DeleteIcon color="#FF453A" size={20} />
                                </Pressable>
                                <Pressable
                                    onPress={onLoad}
                                    style={styles.loadButton}>
                                    <PlayIcon color={colors.text} size={20} />
                                    <Text style={[styles.loadButtonText, { color: colors.text }]}>
                                        Load Model
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    )}

                    {/* Status 4: Loading */}
                    {isLoading && (
                        <View
                            style={[
                                styles.loadingButton,
                                { backgroundColor: colors.card },
                            ]}>
                            <LoaderIcon color={colors.text} size={20} />
                            <Text
                                style={[
                                    styles.buttonText,
                                    { color: colors.text },
                                ]}>
                                Trying {backendChainLabel(preferredBackend)}...
                            </Text>
                        </View>
                    )}

                    {/* Status 5: Loaded (Active) */}
                    {isLoaded && (() => {
                        // Check if the model is loaded on a different backend than preferred
                        const needsReload = activeBackend && preferredBackend !== 'AUTO' && 
                            activeBackend.toUpperCase() !== preferredBackend.toUpperCase();
                        
                        return (
                            <View style={styles.loadedRow}>
                                <View style={styles.buttonGroup}>
                                    <Pressable
                                        onPress={onDelete}
                                        disabled={isUnloading}
                                        hitSlop={8}
                                        style={[styles.deleteIconButton, isUnloading && styles.disabledButton]}>
                                        <DeleteIcon color="#FF453A" size={20} />
                                    </Pressable>
                                    <Pressable
                                        onPress={onUnload}
                                        disabled={isUnloading}
                                        style={[
                                            styles.unloadButton,
                                            { backgroundColor: colors.card, borderColor: colors.border },
                                        ]}>
                                        {isUnloading ? (
                                            <View style={styles.unloadingRow}>
                                                <LoaderIcon color={colors.text} size={20} />
                                                <Text style={[styles.unloadButtonText, { color: colors.text }]}>
                                                    Unloading…
                                                </Text>
                                            </View>
                                        ) : (
                                            <Text style={[styles.unloadButtonText, { color: colors.text }]}>
                                                Unload
                                            </Text>
                                        )}
                                    </Pressable>
                                    {needsReload && !isUnloading && (
                                        <Pressable
                                            onPress={onLoad}
                                            style={styles.loadButton}>
                                            <ReloadIcon color={colors.text} size={20} />
                                            <Text style={[styles.loadButtonText, { color: colors.text }]}>
                                                Reload on {preferredBackend}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            </View>
                        );
                    })()}
                </View>
            </View>
        );
    }
);

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
    visible,
    onClose,
    selectedModelId,
    onSelectModel,
}) => {
    const { colors } = useTheme();
    const dispatch = useDispatch();

    const translateY = React.useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = React.useRef(new Animated.Value(0)).current;

    const panResponder = React.useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                // Only take over if pulling down significantly
                return gestureState.dy > 5;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    translateY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 120 || gestureState.vy > 0.8) {
                    closeModal();
                } else {
                    Animated.spring(translateY, {
                        toValue: 0,
                        useNativeDriver: true,
                        bounciness: 4,
                    }).start();
                }
            },
        })
    ).current;

    const openModal = React.useCallback(() => {
        backdropOpacity.setValue(0);
        translateY.setValue(SCREEN_HEIGHT);
        Animated.parallel([
            Animated.timing(backdropOpacity, {
                toValue: 1,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 4,
            }),
        ]).start();
    }, [backdropOpacity, translateY]);

    const closeModal = React.useCallback(() => {
        Animated.parallel([
            Animated.timing(backdropOpacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: SCREEN_HEIGHT,
                duration: 250,
                useNativeDriver: true,
            }),
        ]).start(() => {
            onClose();
        });
    }, [backdropOpacity, translateY, onClose]);

    useEffect(() => {
        if (visible) {
            openModal();
        }
    }, [visible, openModal]);

    const handleBackdropPress = () => {
        closeModal();
    };

    const modelStatuses = useSelector(
        (state: RootState) => state.llm.modelStatuses
    );
    const preferredBackend = useSelector(
        (state: RootState) => state.llm.preferredBackend
    );
    const activeBackend = useSelector(
        (state: RootState) => state.llm.activeBackend
    );
    const loadedModelId = useSelector(
        (state: RootState) => state.llm.loadedModelId
    );

    // Sync disk state for all models on mount & when modal opens
    useEffect(() => {
        if (!visible) return;

        AVAILABLE_MODELS.forEach(async (model) => {
            const check = await LLMService.checkModelStatus(model.fileName);
            dispatch(
                syncModelStatus({
                    modelId: model.id,
                    isDownloaded: check.isDownloaded,
                    localPath: check.localPath,
                })
            );
        });
    }, [visible, dispatch]);

    // Re-entrancy guard shared by load / unload / delete so a double-tap (or a
    // Load tapped while an Unload is still in flight) can never race the native
    // engine lifecycle.
    const lifecycleBusyRef = React.useRef(false);
    const [unloadingModelId, setUnloadingModelId] = React.useState<string | null>(null);

    const loadedModel = React.useMemo(
        () => AVAILABLE_MODELS.find((m) => m.id === loadedModelId) || null,
        [loadedModelId]
    );

    /**
     * If the model is mid-generation, ask the user before interrupting it.
     * Resolves true when it is OK to proceed (not generating, or user confirmed).
     */
    const confirmInterruptGeneration = useCallback(
        async (actionLabel: string): Promise<boolean> => {
            const generating = await LLMService.isGenerating();
            if (!generating) return true;
            return new Promise<boolean>((resolve) => {
                Alert.alert(
                    'Model is generating',
                    `${loadedModel?.name || 'The model'} is still generating a response. ${actionLabel} will cancel the current generation. Are you sure?`,
                    [
                        { text: 'Keep generating', style: 'cancel', onPress: () => resolve(false) },
                        { text: `Yes, ${actionLabel.toLowerCase()}`, style: 'destructive', onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) }
                );
            });
        },
        [loadedModel]
    );

    /**
     * Gracefully stops generation (waits for the native runtime to wind down)
     * and unloads the engine. Returns true on success.
     */
    const stopAndUnload = useCallback(async (): Promise<boolean> => {
        await LLMService.stopGeneration().catch(() => {});
        const ok = await LLMService.unloadModel();
        if (ok) {
            dispatch(unloadModel());
        }
        return ok;
    }, [dispatch]);

    // Real Native Download Handler
    const handleDownload = useCallback(
        async (model: ModelInfo) => {
            dispatch(startDownload(model.id));

            try {
                await LLMService.downloadModel(
                    model.id,
                    model.url,
                    model.fileName,
                    (progressEvent: DownloadProgressEvent) => {
                        dispatch(
                            setDownloadProgress({
                                modelId: model.id,
                                progress: progressEvent.progress,
                                speedMBs: progressEvent.speedMBs,
                                bytesDownloaded: progressEvent.bytesDownloaded,
                                totalBytes: progressEvent.totalBytes,
                            })
                        );
                    },
                    (completeEvent: DownloadCompleteEvent) => {
                        dispatch(
                            setDownloaded({
                                modelId: model.id,
                                localPath: completeEvent.localPath,
                            })
                        );
                    },
                    (errorEvent: DownloadErrorEvent) => {
                        dispatch(
                            setDownloadError({
                                modelId: model.id,
                                error: errorEvent.error,
                            })
                        );
                    }
                );
            } catch (err: any) {
                console.error('[ModelSelector] Download launch error:', err);
                dispatch(
                    setDownloadError({
                        modelId: model.id,
                        error: err?.message || 'Download failed',
                    })
                );
            }
        },
        [dispatch]
    );

    // Cancel Download Handler
    const handleCancelDownload = useCallback(
        async (modelId: string) => {
            await LLMService.cancelDownload(modelId);
        },
        []
    );

    // Delete Model Handler
    const handleDelete = useCallback(
        (model: ModelInfo) => {
            if (lifecycleBusyRef.current) return;
            const isLoadedModel = loadedModelId === model.id;
            Alert.alert(
                'Delete Model File',
                `Are you sure you want to delete ${model.name} (${model.size}) from device storage?${
                    isLoadedModel ? ' It is currently loaded and will be unloaded first.' : ''
                }`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                            if (lifecycleBusyRef.current) return;
                            lifecycleBusyRef.current = true;
                            try {
                                if (isLoadedModel) {
                                    const proceed = await confirmInterruptGeneration('Deleting');
                                    if (!proceed) return;
                                    // Properly unload via JS layer so hook + Redux state stay in sync.
                                    const unloaded = await stopAndUnload();
                                    if (!unloaded) {
                                        Alert.alert('Delete Failed', 'Could not unload the model before deleting. Please try again.');
                                        return;
                                    }
                                }
                                const deleted = await LLMService.deleteDownloadedModel(model.fileName);
                                if (deleted) {
                                    dispatch(deleteModel(model.id));
                                } else {
                                    Alert.alert('Delete Failed', 'The model file could not be removed.');
                                }
                            } catch (err) {
                                console.error('Failed to delete model:', err);
                            } finally {
                                lifecycleBusyRef.current = false;
                            }
                        },
                    },
                ]
            );
        },
        [dispatch, loadedModelId, confirmInterruptGeneration, stopAndUnload]
    );

    // Real Model Loading Handler with Fallback Notification
    // Auto-unloads any previously loaded model before loading the new one
    const handleLoad = useCallback(
        async (model: ModelInfo) => {
            if (lifecycleBusyRef.current) return;
            const currentStatus = modelStatuses[model.id]?.status;
            if (currentStatus === 'loading') return;

            lifecycleBusyRef.current = true;
            try {
                if (loadedModelId) {
                    const proceed = await confirmInterruptGeneration('Loading');
                    if (!proceed) return;
                    const unloaded = await stopAndUnload();
                    if (!unloaded) {
                        Alert.alert('Load Failed', 'Could not unload the current model. Please try again.');
                        return;
                    }
                }

                dispatch(startLoadingModel(model.id));
                try {
                    const result = await LLMService.initialize(
                        model.fileName,
                        preferredBackend
                    );
                    dispatch(
                        setLoadedModel({
                            modelId: model.id,
                            backend: result.actualBackend,
                        })
                    );
                    onSelectModel(model.id);

                    if (result.wasFallback) {
                        Alert.alert(
                            'Backend Fallback Applied',
                            `Requested backend (${result.requestedBackend}) is not available on this device chipset. Successfully loaded on ${result.actualBackend}!`
                        );
                    }
                } catch (err: any) {
                    console.error('[ModelSelector] Native initialization error:', err);
                    const message =
                        err?.message ||
                        'Could not initialize LiteRT-LM model. Please ensure the model file is completely downloaded.';
                    Alert.alert('Load Failed', message);
                    dispatch(setModelLoadFailed({ modelId: model.id, error: message }));
                }
            } finally {
                lifecycleBusyRef.current = false;
            }
        },
        [dispatch, onSelectModel, preferredBackend, loadedModelId, modelStatuses, confirmInterruptGeneration, stopAndUnload]
    );

    // Unload Model Handler
    const handleUnload = useCallback(
        async () => {
            if (lifecycleBusyRef.current || !loadedModelId) return;
            const modelName = loadedModel?.name || 'Model';
            const backend = activeBackend || 'unknown backend';

            lifecycleBusyRef.current = true;
            try {
                const proceed = await confirmInterruptGeneration('Unloading');
                if (!proceed) return;

                setUnloadingModelId(loadedModelId);
                const ok = await stopAndUnload();
                if (ok) {
                    Alert.alert(
                        'Model Unloaded',
                        `${modelName} was unloaded from ${backend} and its memory has been freed.`
                    );
                } else {
                    Alert.alert('Unload Failed', 'Could not unload the model from memory.');
                }
            } catch (err) {
                console.error('[ModelSelector] Unload error:', err);
                Alert.alert('Unload Failed', 'Could not unload the model from memory.');
            } finally {
                setUnloadingModelId(null);
                lifecycleBusyRef.current = false;
            }
        },
        [loadedModelId, loadedModel, activeBackend, confirmInterruptGeneration, stopAndUnload]
    );

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={closeModal}>
            <View style={styles.overlay}>
                {/* Backdrop dismiss */}
                <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
                    <Pressable style={styles.backdropPressable} onPress={handleBackdropPress} />
                </Animated.View>

                {/* Bottom Sheet */}
                <Animated.View
                    style={[
                        styles.sheetContainer,
                        {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                            transform: [{ translateY }],
                        },
                    ]}
                >
                    <View {...panResponder.panHandlers}>
                        {/* Handle Bar */}
                        <View style={styles.handleContainer}>
                            <View
                                style={[
                                    styles.handleBar,
                                    { backgroundColor: colors.border },
                                ]}
                            />
                        </View>

                        {/* Header */}
                        <View style={styles.sheetHeader}>
                            <View style={styles.titleWithIcon}>
                                <CpuIcon color={colors.text} size={24} />
                                <Text
                                    style={[styles.sheetTitle, { color: colors.text }]}>
                                    LiteRT-LM Models
                                </Text>
                            </View>
                            <Pressable
                                hitSlop={12}
                                onPress={closeModal}
                                style={[
                                    styles.closeButton,
                                    { backgroundColor: colors.background },
                                ]}>
                                <Text
                                    style={[
                                        styles.closeButtonText,
                                        { color: colors.secondaryText },
                                    ]}>
                                    ✕
                                </Text>
                            </Pressable>
                        </View>
                    </View>

                    {/* Acceleration Backend Selector Segment */}
                    <View style={styles.backendSection}>
                        <Text
                            style={[
                                styles.backendSectionTitle,
                                { color: colors.secondaryText },
                            ]}>
                            Acceleration Backend (with auto-fallback):
                        </Text>
                        <View style={styles.backendRow}>
                            {BACKENDS.map((b) => {
                                const isChosen = preferredBackend === b.key;
                                const IconComponent = BackendIcons[b.key];
                                return (
                                    <Pressable
                                        key={b.key}
                                        onPress={() =>
                                            dispatch(setPreferredBackend(b.key))
                                        }
                                        style={[
                                            styles.backendTab,
                                            {
                                                backgroundColor: isChosen
                                                    ? colors.text
                                                    : 'rgba(128, 128, 128, 0.15)',
                                                borderColor: isChosen
                                                    ? colors.text
                                                    : 'rgba(128, 128, 128, 0.25)',
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                gap: 6,
                                            },
                                        ]}>
                                        {IconComponent && (
                                            <IconComponent
                                                color={isChosen ? colors.background : colors.text}
                                                size={16}
                                            />
                                        )}
                                        <Text
                                            style={[
                                                styles.backendTabText,
                                                {
                                                    color: isChosen
                                                        ? colors.background
                                                        : colors.text,
                                                },
                                            ]}>
                                            {b.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>

                    {/* Model List */}
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.listContent}>
                        {AVAILABLE_MODELS.map((model) => {
                            const modelState: ModelState = modelStatuses[
                                model.id
                            ] || {
                                status: 'not_downloaded',
                                progress: 0,
                            };

                            return (
                                <ModelItem
                                    key={model.id}
                                    model={model}
                                    isSelected={model.id === selectedModelId}
                                    modelState={modelState}
                                    activeBackend={
                                        model.id === loadedModelId
                                            ? activeBackend
                                            : null
                                    }
                                    onDownload={() => handleDownload(model)}
                                    onCancelDownload={() =>
                                        handleCancelDownload(model.id)
                                    }
                                    onLoad={() => handleLoad(model)}
                                    onUnload={handleUnload}
                                    onDelete={() => handleDelete(model)}
                                    onSelect={() => {
                                        onSelectModel(model.id);
                                        closeModal();
                                    }}
                                    preferredBackend={preferredBackend}
                                    isUnloading={unloadingModelId === model.id}
                                    colors={colors}
                                />
                            );
                        })}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
    },
    backdropPressable: {
        flex: 1,
    },
    sheetContainer: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        paddingHorizontal: 20,
        paddingBottom: 32,
        maxHeight: '85%',
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    handleBar: {
        width: 40,
        height: 4.5,
        borderRadius: 2.25,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    titleWithIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    sheetTitle: {
        fontSize: 20,
        fontWeight: '700',
    },
    closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    // Backend Selector
    backendSection: {
        marginTop: 10,
        marginBottom: 14,
    },
    backendSectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 8,
    },
    backendRow: {
        flexDirection: 'row',
        gap: 8,
    },
    backendTab: {
        flex: 1,
        paddingVertical: 7,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backendTabText: {
        fontSize: 12,
        fontWeight: '700',
    },
    listContent: {
        gap: 12,
        paddingBottom: 16,
    },
    modelCard: {
        borderRadius: 16,
        borderWidth: 1.5,
        padding: 16,
    },
    modelHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 6,
    },
    modelTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        flex: 1,
    },
    modelName: {
        fontSize: 16,
        fontWeight: '700',
    },
    tagBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
        borderWidth: 1,
    },
    tagText: {
        fontSize: 11,
        fontWeight: '600',
    },
    recommendedBadge: {
        backgroundColor: 'rgba(128, 128, 128, 0.15)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(128, 128, 128, 0.25)',
    },
    recommendedBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    rightHeaderAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    sizeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    checkCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#10A37F',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modelDescription: {
        fontSize: 13,
        lineHeight: 18,
    },
    modelFooter: {
        marginTop: 8,
        paddingTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255, 255, 255, 0.08)',
    },
    fileNameText: {
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        flex: 1,
    },
    activeBackendChip: {
        backgroundColor: '#10A37F',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#10A37F',
    },
    activeBackendChipText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '700',
    },
    errorText: {
        color: '#FF453A',
        fontSize: 12,
        marginTop: 6,
        fontWeight: '500',
    },
    // Actions Section
    actionContainer: {
        marginTop: 12,
    },
    downloadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    progressSection: {
        gap: 6,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    progressText: {
        fontSize: 13,
        fontWeight: '600',
    },
    subProgressText: {
        fontSize: 11,
        marginTop: 2,
    },
    cancelDownloadButton: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 69, 58, 0.15)',
    },
    cancelDownloadText: {
        color: '#FF453A',
        fontSize: 12,
        fontWeight: '600',
    },
    progressBarBackground: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 3,
    },
    downloadedActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    buttonGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        justifyContent: 'space-between'
    },
    deleteIconButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: 'rgba(255, 69, 58, 0.12)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 69, 58, 0.25)',
    },
    downloadedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    downloadedBadgeText: {
        fontSize: 13,
        fontWeight: '600',
    },
    loadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: 'rgba(128, 128, 128, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(128, 128, 128, 0.25)',
    },
    loadButtonText: {
        fontSize: 13,
        fontWeight: '700',
    },
    loadingButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        borderRadius: 12,
    },
    unloadButton: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
    },
    unloadButtonText: {
        fontSize: 13,
        fontWeight: '600',
    },
    unloadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    disabledButton: {
        opacity: 0.4,
    },
    loadedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    activeLoadedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    activeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    activeLoadedText: {
        fontSize: 13,
        fontWeight: '700',
    },
    selectedModelButton: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    selectedModelButtonText: {
        fontSize: 13,
        fontWeight: '600',
    },

});

export default memo(ModelSelectorModal);
