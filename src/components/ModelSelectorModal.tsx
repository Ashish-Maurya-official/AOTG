import React, { memo, useCallback, useEffect, useMemo } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    Linking,
    PermissionsAndroid,
    FlatList,
} from 'react-native';
import { pick, types as DocumentPickerTypes, isErrorWithCode, errorCodes, saveDocuments } from '@react-native-documents/picker';
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
import ShareIcon from '../static/images/SVG/ShareIcon';
import EditIcon from '../static/images/SVG/EditIcon';

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
    setExternalPath,
    clearExternalPath,
    addCustomModel,
    updateCustomModel,
    removeCustomModel,
} from '../store/slices/llmSlice';
import PermissionModal from './PermissionModal';
import CustomModelConfigModal from './CustomModelConfigModal';
import LLMService, {
    DownloadProgressEvent,
    DownloadCompleteEvent,
    DownloadErrorEvent,
} from '../services/llmService';
import {
    loadExternalModelPaths,
    saveExternalModelPath,
    removeExternalModelPath,
    loadCustomModels,
    saveCustomModel,
    removeCustomModelStorage,
} from '../services/modelStorageService';
import {
    findMatchingCatalogModel,
    inferModelCapabilities,
} from '../utils/modelMatching';

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

/** Human-readable backend fallback chain — dynamically based on model capabilities */
const backendChainLabel = (backend: string, model: ModelInfo): string => {
    if (backend === 'AUTO') {
        return model.supportedBackends.join(' → ');
    }
    const chain: string[] = [];
    if (model.supportedBackends.includes(backend as BackendType)) {
        chain.push(backend);
    }
    if (backend === 'NPU') {
        if (model.supportedBackends.includes('GPU')) chain.push('GPU');
        if (model.supportedBackends.includes('CPU')) chain.push('CPU');
    } else if (backend === 'GPU') {
        if (model.supportedBackends.includes('CPU')) chain.push('CPU');
    }
    if (chain.length === 0) return model.supportedBackends.join(' → ') || 'CPU';
    return chain.join(' → ');
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
        isSelected: _isSelected,
        modelState,
        activeBackend,
        onDownload,
        onCancelDownload,
        onLoad,
        onUnload,
        onDelete,
        onSelect: _onSelect,
        onExport,
        onConfigure,
        preferredBackend,
        isUnloading,
        isCustomModel,
        isGenerating = false,
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
        onExport: () => void;
        onConfigure?: () => void;
        preferredBackend: string;
        isUnloading: boolean;
        isCustomModel: boolean;
        isGenerating?: boolean;
        colors: any;
    }) => {
        const { status, progress, speedMBs, bytesDownloaded, totalBytes, error } =
            modelState;

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
                        {model.supportsVision && model.badge !== 'Multimodal' && model.badge !== 'Vision' && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#10b98135' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Vision
                                </Text>
                            </View>
                        )}
                        {model.supportsAudio && model.badge !== 'Multimodal' && model.badge !== 'Audio' && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#ec489935' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Audio
                                </Text>
                            </View>
                        )}
                        {model.isCoder && model.badge !== 'Coder' && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#3b82f640' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Coder
                                </Text>
                            </View>
                        )}
                        {model.supportsThinking && model.badge !== 'Reasoning' && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#f59e0b40' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Reasoning
                                </Text>
                            </View>
                        )}
                        {model.isEmbedding && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#8b5cf640' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Embedding
                                </Text>
                            </View>
                        )}
                        {model.isDraftModel && (
                            <View style={[styles.recommendedBadge, { backgroundColor: '#ef444440' }]}>
                                <Text style={[styles.recommendedBadgeText, { color: colors.text }]}>
                                    Draft
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
                    {status === 'not_downloaded' && !isCustomModel && (
                        <View style={{ gap: 8 }}>
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
                        </View>
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
                                {isCustomModel && onConfigure && (
                                    <Pressable
                                        onPress={onConfigure}
                                        hitSlop={8}
                                        style={styles.deleteIconButton}>
                                        <EditIcon color={colors.text} size={18} />
                                    </Pressable>
                                )}
                                <Pressable
                                    onPress={onExport}
                                    hitSlop={8}
                                    style={styles.deleteIconButton}>
                                    <ShareIcon color={colors.secondaryText} size={20} />
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
                                Trying {backendChainLabel(preferredBackend, model)}...
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
                                    {isCustomModel && onConfigure && (
                                        <Pressable
                                            onPress={onConfigure}
                                            disabled={isUnloading}
                                            hitSlop={8}
                                            style={[styles.deleteIconButton, isUnloading && styles.disabledButton]}>
                                            <EditIcon color={colors.text} size={18} />
                                        </Pressable>
                                    )}
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
                                    {!isCustomModel && (
                                        <Pressable
                                            onPress={onExport}
                                            hitSlop={8}
                                            style={styles.deleteIconButton}>
                                            <ShareIcon color={colors.secondaryText} size={20} />
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

    const [isOpenSettled, setIsOpenSettled] = React.useState(false);

    const openModal = React.useCallback(() => {
        setIsOpenSettled(false);
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
        ]).start(() => {
            setIsOpenSettled(true);
        });
    }, [backdropOpacity, translateY]);

    const closeModal = React.useCallback(() => {
        setIsOpenSettled(false);
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
    const customModels = useSelector(
        (state: RootState) => state.llm.customModels
    );
    const isGenerating = useSelector(
        (state: RootState) => state.llm.isGenerating
    );

    // Permission Handling State
    const [showPermissionModal, setShowPermissionModal] = React.useState(false);
    const [isPermanentlyDenied, setIsPermanentlyDenied] = React.useState(false);
    const pendingAction = React.useRef<(() => void) | null>(null);

    const executeWithPermission = React.useCallback(async (action: () => void) => {
        if (Platform.OS !== 'android' || Number(Platform.Version) >= 33) {
            action();
            return;
        }

        const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
        if (hasPermission) {
            action();
        } else {
            pendingAction.current = action;
            setShowPermissionModal(true);
        }
    }, []);

    const handleGrantPermission = React.useCallback(async () => {
        if (isPermanentlyDenied) {
            Linking.openSettings();
            setShowPermissionModal(false);
            return;
        }

        try {
            const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
            if (result === PermissionsAndroid.RESULTS.GRANTED) {
                setShowPermissionModal(false);
                if (pendingAction.current) {
                    pendingAction.current();
                    pendingAction.current = null;
                }
            } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
                setIsPermanentlyDenied(true);
            } else {
                setShowPermissionModal(false);
            }
        } catch (err) {
            console.warn(err);
            setShowPermissionModal(false);
        }
    }, [isPermanentlyDenied]);

    const handleCancelPermission = React.useCallback(() => {
        setShowPermissionModal(false);
        pendingAction.current = null;
    }, []);

    // Sync disk state for all models on mount & when modal opens (only after slide-up settles)
    useEffect(() => {
        if (!visible || !isOpenSettled) return;

        let isCancelled = false;

        (async () => {
                // 1. Restore custom models from persistence & reconcile any matching catalog models
                const persistedCustomModels = await loadCustomModels();
                if (isCancelled) return;
                const externalPaths = await loadExternalModelPaths();
                if (isCancelled) return;

                for (const cm of persistedCustomModels) {
                    if (isCancelled) return;
                    const matchedCatalog = findMatchingCatalogModel(cm.fileName) || findMatchingCatalogModel(cm.name);
                    if (matchedCatalog) {
                        const extPath = externalPaths[cm.id];
                        let resolvedPath = extPath;
                        if (!resolvedPath) {
                            const checkInternal = await LLMService.checkModelStatus(cm.fileName);
                            if (checkInternal.isDownloaded) {
                                resolvedPath = checkInternal.localPath;
                            }
                        }

                        if (resolvedPath) {
                            const exists = await LLMService.checkFileExists(resolvedPath);
                            if (exists && !isCancelled) {
                                dispatch(syncModelStatus({ modelId: matchedCatalog.id, isDownloaded: true, localPath: resolvedPath }));
                                dispatch(setExternalPath({ modelId: matchedCatalog.id, externalPath: resolvedPath }));
                                await saveExternalModelPath(matchedCatalog.id, resolvedPath);
                                externalPaths[matchedCatalog.id] = resolvedPath;
                            }
                        }
                        if (!isCancelled) {
                            await removeCustomModelStorage(cm.id);
                            await removeExternalModelPath(cm.id);
                            dispatch(removeCustomModel(cm.id));
                        }
                    } else {
                        if (!isCancelled) {
                            dispatch(addCustomModel(cm));
                        }
                    }
                }

                // 2. Sync catalog models
                for (const model of AVAILABLE_MODELS) {
                    if (isCancelled) return;
                    const externalPath = externalPaths[model.id];
                    if (externalPath) {
                        // Validate the external file still exists
                        const exists = await LLMService.checkFileExists(externalPath);
                        if (isCancelled) return;
                        if (exists) {
                            const cur = modelStatuses[model.id];
                            if (!cur || cur.status !== 'downloaded' || cur.localPath !== externalPath) {
                                dispatch(syncModelStatus({ modelId: model.id, isDownloaded: true, localPath: externalPath }));
                                dispatch(setExternalPath({ modelId: model.id, externalPath }));
                            }
                        } else {
                            // File was deleted externally — clear stale path
                            await removeExternalModelPath(model.id);
                            if (isCancelled) return;
                            dispatch(clearExternalPath(model.id));
                            // Fall back to checking internal storage
                            let check = await LLMService.checkModelStatus(model.fileName);
                            if (!check.isDownloaded) {
                                const urlBasename = model.url.split('/').pop()?.split('?')[0];
                                if (urlBasename && urlBasename !== model.fileName) {
                                    const urlCheck = await LLMService.checkModelStatus(urlBasename);
                                    if (urlCheck.isDownloaded) {
                                        check = urlCheck;
                                    }
                                }
                            }
                            if (!isCancelled) {
                                const cur = modelStatuses[model.id];
                                const targetStatus = check.isDownloaded ? 'downloaded' : 'not_downloaded';
                                if (!cur || cur.status !== targetStatus || cur.localPath !== check.localPath) {
                                    dispatch(syncModelStatus({ modelId: model.id, isDownloaded: check.isDownloaded, localPath: check.localPath }));
                                }
                            }
                        }
                    } else {
                        // Normal check against internal models/ dir
                        let check = await LLMService.checkModelStatus(model.fileName);
                        if (!check.isDownloaded) {
                            const urlBasename = model.url.split('/').pop()?.split('?')[0];
                            if (urlBasename && urlBasename !== model.fileName) {
                                const urlCheck = await LLMService.checkModelStatus(urlBasename);
                                if (urlCheck.isDownloaded) {
                                    check = urlCheck;
                                }
                            }
                        }
                        if (!isCancelled) {
                            const cur = modelStatuses[model.id];
                            const targetStatus = check.isDownloaded ? 'downloaded' : 'not_downloaded';
                            if (!cur || cur.status !== targetStatus || cur.localPath !== check.localPath) {
                                dispatch(syncModelStatus({ modelId: model.id, isDownloaded: check.isDownloaded, localPath: check.localPath }));
                            }
                        }
                    }
                }

                // 3. Sync remaining non-catalog custom models
                if (isCancelled) return;
                const remainingCustomModels = await loadCustomModels();
                for (const cm of remainingCustomModels) {
                    if (isCancelled) return;
                    const externalPath = externalPaths[cm.id];
                    if (externalPath) {
                        const exists = await LLMService.checkFileExists(externalPath);
                        if (isCancelled) return;
                        if (exists) {
                            const cur = modelStatuses[cm.id];
                            if (!cur || cur.status !== 'downloaded' || cur.localPath !== externalPath) {
                                dispatch(syncModelStatus({ modelId: cm.id, isDownloaded: true, localPath: externalPath }));
                                dispatch(setExternalPath({ modelId: cm.id, externalPath }));
                            }
                        } else {
                            await removeExternalModelPath(cm.id);
                            if (isCancelled) return;
                            const check = await LLMService.checkModelStatus(cm.fileName);
                            if (!isCancelled) {
                                if (check.isDownloaded) {
                                    dispatch(syncModelStatus({ modelId: cm.id, isDownloaded: true, localPath: check.localPath }));
                                } else {
                                    await removeCustomModelStorage(cm.id);
                                    dispatch(removeCustomModel(cm.id));
                                }
                            }
                        }
                    } else {
                        const check = await LLMService.checkModelStatus(cm.fileName);
                        if (!isCancelled) {
                            if (check.isDownloaded) {
                                const cur = modelStatuses[cm.id];
                                if (!cur || cur.status !== 'downloaded' || cur.localPath !== check.localPath) {
                                    dispatch(syncModelStatus({ modelId: cm.id, isDownloaded: true, localPath: check.localPath }));
                                }
                            } else {
                                await removeCustomModelStorage(cm.id);
                                dispatch(removeCustomModel(cm.id));
                            }
                        }
                    }
                }
            })();

        return () => {
            isCancelled = true;
        };
    }, [visible, isOpenSettled, dispatch, modelStatuses]);

    // Re-entrancy guard shared by load / unload / delete so a double-tap (or a
    // Load tapped while an Unload is still in flight) can never race the native
    // engine lifecycle.
    const lifecycleBusyRef = React.useRef(false);
    const [unloadingModelId, setUnloadingModelId] = React.useState<string | null>(null);

    const allModels = useMemo(
        () => [...AVAILABLE_MODELS, ...customModels],
        [customModels]
    );

    const customModelIds = useMemo(
        () => new Set(customModels.map(m => m.id)),
        [customModels]
    );

    const loadedModel = React.useMemo(
        () => allModels.find((m) => m.id === loadedModelId) || null,
        [loadedModelId, allModels]
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

    // Global Import Model Handler — called from the header import button
    const handleGlobalImport = useCallback(
        async () => {
            try {
                const result = await pick({
                    type: [DocumentPickerTypes.allFiles],
                });
                if (!result || result.length === 0) return;
                const pickedFile = result[0];
                const rawFileName = pickedFile.name || 'imported_model.litertlm';
                const fileName = rawFileName.trim();

                if (!fileName.toLowerCase().endsWith('.litertlm')) {
                    Alert.alert('Invalid File', 'Please select a valid .litertlm model file.');
                    return;
                }

                // Try to match against catalog first using our smart matching logic
                const matchedModel = findMatchingCatalogModel(fileName, AVAILABLE_MODELS);

                if (matchedModel) {
                    const status = modelStatuses[matchedModel.id]?.status;
                    if (['downloaded', 'loaded'].includes(status)) {
                        Alert.alert('Already Available', `"${matchedModel.name}" is already available on your device.`);
                        return;
                    }

                    // Native import: resolves real absolute path or copies to models dir
                    const localPath = await LLMService.importModelFile(pickedFile.uri, fileName);

                    // Catalog model — set as downloaded with the imported path
                    dispatch(setDownloaded({ modelId: matchedModel.id, localPath }));
                    dispatch(setExternalPath({ modelId: matchedModel.id, externalPath: localPath }));
                    await saveExternalModelPath(matchedModel.id, localPath);

                    // If a custom model previously existed for this file, clean it up
                    const staleCustom = customModels.find(
                        cm => cm.fileName.toLowerCase() === fileName.toLowerCase() ||
                              findMatchingCatalogModel(cm.fileName)?.id === matchedModel.id
                    );
                    if (staleCustom) {
                        dispatch(removeCustomModel(staleCustom.id));
                        await removeCustomModelStorage(staleCustom.id);
                        await removeExternalModelPath(staleCustom.id);
                    }

                    Alert.alert(
                        'Catalog Model Recognized',
                        `"${matchedModel.name}" was recognized and linked to the catalog successfully!\n\nAll features (multimodal input, acceleration backends, and context settings) are active and ready to load.`
                    );
                } else {
                    // Truly custom model: infer realistic capabilities rather than disabling everything
                    const customId = `custom-${fileName.replace(/\.litertlm$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()}`;
                    if (customModels.some(m => m.id === customId)) {
                        Alert.alert('Already Imported', 'This model is already in your imported models list.');
                        return;
                    }

                    const localPath = await LLMService.importModelFile(pickedFile.uri, fileName);
                    const displayName = fileName.replace(/\.litertlm$/i, '').replace(/[_-]/g, ' ');
                    const inferred = inferModelCapabilities(fileName, pickedFile.size ?? undefined);

                    const customModel: ModelInfo = {
                        id: customId,
                        name: displayName,
                        tag: 'custom-import',
                        size: pickedFile.size ? `${(pickedFile.size / (1024 * 1024)).toFixed(1)} MB` : 'Unknown',
                        description: `Custom imported model from ${fileName}. Tap the edit icon to configure its capabilities and backends.`,
                        url: '',
                        fileName: fileName,
                        badge: inferred.badge || 'Custom',
                        supportsVision: inferred.supportsVision ?? false,
                        supportsAudio: inferred.supportsAudio ?? false,
                        supportsThinking: inferred.supportsThinking ?? false,
                        supportedBackends: inferred.supportedBackends || ['GPU', 'CPU'],
                        maxContextLength: inferred.maxContextLength || 4096,
                        quantization: undefined,
                        isEmbedding: inferred.isEmbedding ?? false,
                        isCoder: inferred.isCoder ?? false,
                        isInstruct: inferred.isInstruct ?? true,
                        supportsFunctionCalling: inferred.supportsFunctionCalling ?? false,
                        isDraftModel: false,
                        isASR: inferred.isASR ?? false,
                    };

                    dispatch(addCustomModel(customModel));
                    dispatch(setDownloaded({ modelId: customId, localPath }));
                    dispatch(setExternalPath({ modelId: customId, externalPath: localPath }));
                    await saveExternalModelPath(customId, localPath);
                    await saveCustomModel(customModel);

                    // Automatically open configuration sheet so user can review and customize options
                    setConfiguringModel(customModel);
                }
            } catch (err: any) {
                if (isErrorWithCode(err) && (err.code === errorCodes.IN_PROGRESS || err.code === errorCodes.OPERATION_CANCELED)) {
                    return;
                }
                console.error('[ModelSelector] Import error:', err);
                const message = err?.message || 'Could not import the model file.';
                Alert.alert('Import Failed', message);
            }
        },
        [dispatch, customModels, modelStatuses]
    );

    // Export Model Handler — copies model to user's chosen location for backup/sharing
    const handleExportModel = useCallback(
        async (model: ModelInfo) => {
            const modelState = modelStatuses[model.id];
            const sourcePath = modelState?.localPath;
            if (!sourcePath) {
                Alert.alert('Export Failed', 'No local model file found to export.');
                return;
            }

            try {
                const sourceUri = sourcePath.startsWith('file://') ? sourcePath : `file://${sourcePath}`;
                await saveDocuments({
                    sourceUris: [sourceUri],
                    fileName: model.fileName,
                });

                Alert.alert(
                    'Model Exported',
                    `${model.name} has been saved to your chosen location.`
                );
            } catch (err: any) {
                if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
                Alert.alert('Export Failed', 'Could not export the model file.');
            }
        },
        [modelStatuses]
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
            const isCustom = customModelIds.has(model.id);
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
                                    const unloaded = await stopAndUnload();
                                    if (!unloaded) {
                                        Alert.alert('Delete Failed', 'Could not unload the model before deleting. Please try again.');
                                        return;
                                    }
                                }
                                // Try deleting the internal copy (may not exist for external-only models)
                                const localPath = modelStatuses[model.id]?.localPath;
                                const pathToDelete = localPath && (localPath.startsWith('/') || localPath.startsWith('file://')) ? localPath : model.fileName;
                                await LLMService.deleteDownloadedModel(pathToDelete);

                                // Clean up persistence
                                await removeExternalModelPath(model.id);
                                dispatch(clearExternalPath(model.id));

                                if (isCustom) {
                                    await removeCustomModelStorage(model.id);
                                    dispatch(removeCustomModel(model.id));
                                } else {
                                    dispatch(deleteModel(model.id));
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
        [dispatch, loadedModelId, customModelIds, confirmInterruptGeneration, stopAndUnload, modelStatuses]
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
                    // Use the stored localPath (may be external) or fall back to fileName
                    const modelPath = modelStatuses[model.id]?.localPath || model.fileName;
                    const result = await LLMService.initialize(
                        modelPath,
                        preferredBackend,
                        model.supportedBackends,
                        model.supportsVision,
                        model.maxContextLength
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

    const [configuringModel, setConfiguringModel] = React.useState<ModelInfo | null>(null);

    const handleSaveModelConfig = useCallback(
        async (updated: ModelInfo) => {
            dispatch(updateCustomModel(updated));
            await saveCustomModel(updated);
            Alert.alert('Settings Saved', `Capabilities for "${updated.name}" have been updated.`);
        },
        [dispatch]
    );

    const handleCloseConfigModal = useCallback(() => {
        setConfiguringModel(null);
    }, []);

    const displayedModels = useMemo(() => {
        return allModels
            .filter(
                (m) =>
                    preferredBackend === 'AUTO' ||
                    m.supportedBackends.includes(
                        preferredBackend as BackendType
                    )
            )
            .sort((a, b) => {
                const statusA = modelStatuses[a.id]?.status || 'not_downloaded';
                const statusB = modelStatuses[b.id]?.status || 'not_downloaded';

                const isDownloadedA =
                    statusA === 'downloaded' ||
                    statusA === 'loading' ||
                    statusA === 'loaded';
                const isDownloadedB =
                    statusB === 'downloaded' ||
                    statusB === 'loading' ||
                    statusB === 'loaded';

                if (isDownloadedA && !isDownloadedB) return -1;
                if (!isDownloadedA && isDownloadedB) return 1;
                return 0;
            });
    }, [allModels, preferredBackend, modelStatuses]);

    const keyExtractor = useCallback((item: ModelInfo) => item.id, []);

    const handleSelectAndClose = useCallback(
        (modelId: string) => {
            onSelectModel(modelId);
            closeModal();
        },
        [onSelectModel, closeModal]
    );

    const renderModelItem = useCallback(
        ({ item }: { item: ModelInfo }) => {
            const modelState: ModelState = modelStatuses[item.id] || {
                status: 'not_downloaded',
                progress: 0,
            };

            return (
                <ModelItem
                    model={item}
                    isSelected={item.id === selectedModelId}
                    modelState={modelState}
                    activeBackend={
                        item.id === loadedModelId ? activeBackend : null
                    }
                    onDownload={() => handleDownload(item)}
                    onCancelDownload={() => handleCancelDownload(item.id)}
                    onLoad={() => handleLoad(item)}
                    onUnload={handleUnload}
                    onDelete={() => handleDelete(item)}
                    onSelect={() => handleSelectAndClose(item.id)}
                    onExport={() => handleExportModel(item)}
                    onConfigure={() => setConfiguringModel(item)}
                    preferredBackend={preferredBackend}
                    isUnloading={unloadingModelId === item.id}
                    isCustomModel={customModelIds.has(item.id)}
                    isGenerating={isGenerating}
                    colors={colors}
                />
            );
        },
        [
            modelStatuses,
            selectedModelId,
            loadedModelId,
            activeBackend,
            handleDownload,
            handleCancelDownload,
            handleLoad,
            handleUnload,
            handleDelete,
            handleSelectAndClose,
            handleExportModel,
            preferredBackend,
            unloadingModelId,
            customModelIds,
            isGenerating,
            colors,
        ]
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
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Pressable
                                    hitSlop={12}
                                    onPress={() => executeWithPermission(handleGlobalImport)}
                                    style={[
                                        styles.closeButton,
                                        { backgroundColor: colors.background },
                                    ]}>
                                    <DownloadIcon color={colors.secondaryText} size={16} />
                                </Pressable>
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

                    {/* Model List (Virtualized with FlatList) */}
                    <FlatList
                        data={displayedModels}
                        keyExtractor={keyExtractor}
                        renderItem={renderModelItem}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.listContent}
                        initialNumToRender={6}
                        maxToRenderPerBatch={6}
                        windowSize={5}
                        removeClippedSubviews={Platform.OS === 'android'}
                    />
                </Animated.View>
            </View>

            <PermissionModal
                visible={showPermissionModal}
                isPermanentlyDenied={isPermanentlyDenied}
                onGrant={handleGrantPermission}
                onCancel={handleCancelPermission}
            />

            <CustomModelConfigModal
                visible={!!configuringModel}
                model={configuringModel}
                onClose={handleCloseConfigModal}
                onSave={handleSaveModelConfig}
            />
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
