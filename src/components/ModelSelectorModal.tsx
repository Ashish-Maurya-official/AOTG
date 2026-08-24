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
    { key: 'AUTO', label: '⚡ Auto', desc: 'NPU → GPU → CPU' },
    { key: 'NPU', label: '🧠 NPU', desc: 'Fastest / Low Power' },
    { key: 'GPU', label: '🎮 GPU', desc: 'High Performance' },
    { key: 'CPU', label: '⚙️ CPU', desc: 'Universal Fallback' },
];

// Checkmark Vector Icon
const CheckIcon = ({ color }: { color: string }) => (
    <View style={styles.checkIconContainer}>
        <View style={[styles.checkStemShort, { backgroundColor: color }]} />
        <View style={[styles.checkStemLong, { backgroundColor: color }]} />
    </View>
);

// Download Arrow Vector Icon
const DownloadIcon = ({ color }: { color: string }) => (
    <View style={styles.downloadIconContainer}>
        <View style={[styles.downloadStem, { backgroundColor: color }]} />
        <View style={[styles.downloadArrowLeft, { backgroundColor: color }]} />
        <View style={[styles.downloadArrowRight, { backgroundColor: color }]} />
        <View style={[styles.downloadBase, { backgroundColor: color }]} />
    </View>
);

// Bolt / Flash Vector Icon
const BoltIcon = ({ color }: { color: string }) => (
    <View style={styles.boltIconContainer}>
        <View style={[styles.boltTop, { backgroundColor: color }]} />
        <View style={[styles.boltBottom, { backgroundColor: color }]} />
    </View>
);

// Trash / Delete Vector Icon
const TrashIcon = ({ color }: { color: string }) => (
    <View style={styles.trashContainer}>
        <View style={[styles.trashHandle, { backgroundColor: color }]} />
        <View style={[styles.trashLid, { backgroundColor: color }]} />
        <View style={[styles.trashBody, { borderColor: color }]}>
            <View style={[styles.trashLine, { backgroundColor: color }]} />
            <View style={[styles.trashLine, { backgroundColor: color }]} />
        </View>
    </View>
);

// Sparkle / Chip Icon
const SparkleIcon = ({ color }: { color: string }) => (
    <View style={styles.sparkleContainer}>
        <View style={[styles.sparkleH, { backgroundColor: color }]} />
        <View style={[styles.sparkleV, { backgroundColor: color }]} />
        <View style={[styles.sparkleDiag1, { backgroundColor: color }]} />
        <View style={[styles.sparkleDiag2, { backgroundColor: color }]} />
    </View>
);

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
        colors: any;
    }) => {
        const { status, progress, speedMBs, bytesDownloaded, totalBytes, error } =
            modelState;

        const isLoaded = status === 'loaded';
        const isDownloaded = status === 'downloaded';
        const isDownloading = status === 'downloading';
        const isLoading = status === 'loading';

        return (
            <View
                style={[
                    styles.modelCard,
                    {
                        backgroundColor: isLoaded
                            ? 'rgba(16, 163, 127, 0.12)'
                            : isSelected
                                ? 'rgba(255, 255, 255, 0.04)'
                                : colors.background,
                        borderColor: isLoaded
                            ? '#10A37F'
                            : isSelected
                                ? 'rgba(255, 255, 255, 0.2)'
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
                                <Text style={styles.recommendedBadgeText}>
                                    {model.badge}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.rightHeaderAction}>
                        <Text
                            style={[
                                styles.sizeText,
                                { color: colors.secondaryText },
                            ]}>
                            {model.size}
                        </Text>
                        {isLoaded && (
                            <View style={styles.checkCircle}>
                                <CheckIcon color="#FFFFFF" />
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
                    {isLoaded && activeBackend && (
                        <View style={styles.activeBackendChip}>
                            <Text style={styles.activeBackendChipText}>
                                ⚡ {activeBackend}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Error Banner if download/load failed */}
                {error && (
                    <Text style={styles.errorText}>
                        ⚠ Error: {error}
                    </Text>
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
                            <DownloadIcon color={colors.text} />
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
                                            { color: '#10A37F' },
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
                                        { width: `${Math.min(progress, 100)}%` },
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
                                    <TrashIcon color="#FF453A" />
                                </Pressable>
                                <Pressable
                                    onPress={onLoad}
                                    style={styles.loadButton}>
                                    <BoltIcon color="#FFFFFF" />
                                    <Text style={styles.loadButtonText}>
                                        Load Model
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    )}

                    {/* Status 4: Loading */}
                    {isLoading && (() => {
                        // Show the actual backend chain being tried
                        const backendChain = (() => {
                            switch (preferredBackend) {
                                case 'NPU': return 'NPU → GPU → CPU';
                                case 'GPU': return 'GPU → CPU';
                                case 'CPU': return 'CPU';
                                default: return 'NPU \u2192 GPU \u2192 CPU'; // AUTO
                            }
                        })();
                        return (
                            <View
                                style={[
                                    styles.loadingButton,
                                    { backgroundColor: colors.card },
                                ]}>
                                <ActivityIndicator size="small" color="#10A37F" />
                                <Text
                                    style={[
                                        styles.buttonText,
                                        { color: '#10A37F' },
                                    ]}>
                                    Trying {backendChain}...
                                </Text>
                            </View>
                        );
                    })()}

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
                                        hitSlop={8}
                                        style={styles.deleteIconButton}>
                                        <TrashIcon color="#FF453A" />
                                    </Pressable>
                                    <Pressable
                                        onPress={onUnload}
                                        style={[
                                            styles.unloadButton,
                                            { backgroundColor: colors.card, borderColor: colors.border },
                                        ]}>
                                        <Text style={[styles.unloadButtonText, { color: colors.text }]}>
                                            Unload
                                        </Text>
                                    </Pressable>
                                    {needsReload && (
                                        <Pressable
                                            onPress={onLoad}
                                            style={styles.loadButton}>
                                            <BoltIcon color="#FFFFFF" />
                                            <Text style={styles.loadButtonText}>
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
            Alert.alert(
                'Delete Model File',
                `Are you sure you want to delete ${model.name} (${model.size}) from device storage?`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                await LLMService.deleteDownloadedModel(model.fileName);
                                dispatch(deleteModel(model.id));
                            } catch (err) {
                                console.error('Failed to delete model:', err);
                            }
                        },
                    },
                ]
            );
        },
        [dispatch]
    );

    // Real Model Loading Handler with Fallback Notification
    // Auto-unloads any previously loaded model before loading the new one
    const handleLoad = useCallback(
        async (model: ModelInfo) => {
            // Unload any currently loaded model first
            if (loadedModelId && loadedModelId !== model.id) {
                try {
                    // Stop any active generation before unloading
                    await LLMService.stopGeneration().catch(() => {});
                    await LLMService.unloadModel();
                    dispatch(unloadModel());
                } catch (err) {
                    console.warn('[ModelSelector] Failed to unload previous model:', err);
                }
            } else if (loadedModelId === model.id) {
                // Same model but reloading on different backend
                try {
                    // Stop any active generation before reloading
                    await LLMService.stopGeneration().catch(() => {});
                    await LLMService.unloadModel();
                    dispatch(unloadModel());
                } catch (err) {
                    console.warn('[ModelSelector] Failed to unload model for reload:', err);
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
                Alert.alert(
                    'Load Failed',
                    err?.message ||
                    'Could not initialize LiteRT-LM model. Please ensure the model file is completely downloaded.'
                );
                dispatch(
                    syncModelStatus({
                        modelId: model.id,
                        isDownloaded: true,
                    })
                );
            }
        },
        [dispatch, onSelectModel, preferredBackend, loadedModelId]
    );

    // Unload Model Handler
    const handleUnload = useCallback(
        async () => {
            try {
                // Stop any active generation before unloading
                await LLMService.stopGeneration().catch(() => {});
                await LLMService.unloadModel();
                dispatch(unloadModel());
            } catch (err) {
                console.error('[ModelSelector] Unload error:', err);
                Alert.alert('Unload Failed', 'Could not unload the model from memory.');
            }
        },
        [dispatch]
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
                                <SparkleIcon color="#10A37F" />
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
                                                    ? '#10A37F'
                                                    : colors.background,
                                                borderColor: isChosen
                                                    ? '#10A37F'
                                                    : colors.border,
                                            },
                                        ]}>
                                        <Text
                                            style={[
                                                styles.backendTabText,
                                                {
                                                    color: isChosen
                                                        ? '#FFFFFF'
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
        alignItems: 'center',
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
        backgroundColor: '#10A37F',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    recommendedBadgeText: {
        color: '#FFFFFF',
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
        backgroundColor: 'rgba(16, 163, 127, 0.2)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    activeBackendChipText: {
        color: '#10A37F',
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
        backgroundColor: '#10A37F',
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
        color: '#10A37F',
        fontSize: 13,
        fontWeight: '600',
    },
    loadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#10A37F',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 10,
    },
    loadButtonText: {
        color: '#FFFFFF',
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
        backgroundColor: '#10A37F',
    },
    activeLoadedText: {
        color: '#10A37F',
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
        color: '#10A37F',
        fontSize: 13,
        fontWeight: '600',
    },
    // Checkmark Icon
    checkIconContainer: {
        width: 14,
        height: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkStemShort: {
        position: 'absolute',
        width: 2,
        height: 5,
        borderRadius: 1,
        transform: [{ rotate: '-45deg' }, { translateX: -2.5 }, { translateY: 2 }],
    },
    checkStemLong: {
        position: 'absolute',
        width: 2,
        height: 9,
        borderRadius: 1,
        transform: [{ rotate: '45deg' }, { translateX: 2 }, { translateY: 0.5 }],
    },
    // Download Arrow Icon
    downloadIconContainer: {
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    downloadStem: {
        width: 2,
        height: 8,
        borderRadius: 1,
        position: 'absolute',
        top: 2,
    },
    downloadArrowLeft: {
        position: 'absolute',
        width: 2,
        height: 6,
        borderRadius: 1,
        bottom: 4,
        left: 5,
        transform: [{ rotate: '-45deg' }],
    },
    downloadArrowRight: {
        position: 'absolute',
        width: 2,
        height: 6,
        borderRadius: 1,
        bottom: 4,
        right: 5,
        transform: [{ rotate: '45deg' }],
    },
    downloadBase: {
        position: 'absolute',
        bottom: 1,
        width: 12,
        height: 2,
        borderRadius: 1,
    },
    // Bolt Icon
    boltIconContainer: {
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    boltTop: {
        width: 2.2,
        height: 7,
        borderRadius: 1,
        position: 'absolute',
        top: 1,
        right: 5,
        transform: [{ rotate: '25deg' }],
    },
    boltBottom: {
        width: 2.2,
        height: 7,
        borderRadius: 1,
        position: 'absolute',
        bottom: 1,
        left: 5,
        transform: [{ rotate: '25deg' }],
    },
    // Trash Icon
    trashContainer: {
        width: 14,
        height: 15,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    trashHandle: {
        width: 4,
        height: 1.5,
        borderTopLeftRadius: 1,
        borderTopRightRadius: 1,
    },
    trashLid: {
        width: 13,
        height: 1.8,
        borderRadius: 0.9,
        marginBottom: 1,
    },
    trashBody: {
        width: 10,
        height: 10,
        borderWidth: 1.2,
        borderTopWidth: 0,
        borderBottomLeftRadius: 2.5,
        borderBottomRightRadius: 2.5,
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        paddingVertical: 1.5,
    },
    trashLine: {
        width: 1,
        height: 5,
        borderRadius: 0.5,
    },
    // Sparkle Icon
    sparkleContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sparkleH: {
        width: 14,
        height: 2,
        borderRadius: 1,
    },
    sparkleV: {
        width: 2,
        height: 14,
        borderRadius: 1,
        position: 'absolute',
    },
    sparkleDiag1: {
        width: 2,
        height: 9,
        borderRadius: 1,
        position: 'absolute',
        transform: [{ rotate: '45deg' }],
    },
    sparkleDiag2: {
        width: 2,
        height: 9,
        borderRadius: 1,
        position: 'absolute',
        transform: [{ rotate: '-45deg' }],
    },
});

export default memo(ModelSelectorModal);
