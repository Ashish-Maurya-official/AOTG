import React, { memo, useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { BackendType, ModelInfo } from '../store/slices/llmSlice';
import BrainIcon from '../static/images/SVG/BrainIcon';
import ImageIcon from '../static/images/SVG/ImageIcon';
import MicIcon from '../static/images/SVG/MicIcon';
import CpuIcon from '../static/images/SVG/CpuIcon';
import GpuIcon from '../static/images/SVG/GpuIcon';
import NpuIcon from '../static/images/SVG/NpuIcon';

interface CustomModelConfigModalProps {
    visible: boolean;
    model: ModelInfo | null;
    onClose: () => void;
    onSave: (updatedModel: ModelInfo) => void;
}

const CONTEXT_OPTIONS = [4096, 8192, 16384, 32768, 65536, 128000, 256000];
const BACKEND_OPTIONS: BackendType[] = ['NPU', 'GPU', 'CPU'];

const CustomModelConfigModal: React.FC<CustomModelConfigModalProps> = ({
    visible,
    model,
    onClose,
    onSave,
}) => {
    const { colors } = useTheme();

    const [displayName, setDisplayName] = useState('');
    const [supportsVision, setSupportsVision] = useState(false);
    const [supportsAudio, setSupportsAudio] = useState(false);
    const [supportsThinking, setSupportsThinking] = useState(false);
    const [supportsFunctionCalling, setSupportsFunctionCalling] = useState(false);
    const [maxContextLength, setMaxContextLength] = useState(4096);
    const [supportedBackends, setSupportedBackends] = useState<BackendType[]>(['GPU', 'CPU']);

    useEffect(() => {
        if (model) {
            setDisplayName(model.name);
            setSupportsVision(!!model.supportsVision);
            setSupportsAudio(!!model.supportsAudio);
            setSupportsThinking(!!model.supportsThinking);
            setSupportsFunctionCalling(!!model.supportsFunctionCalling);
            setMaxContextLength(model.maxContextLength || 4096);
            setSupportedBackends(model.supportedBackends?.length ? [...model.supportedBackends] : ['GPU', 'CPU']);
        }
    }, [model]);

    const toggleBackend = useCallback((backend: BackendType) => {
        setSupportedBackends(prev => {
            if (prev.includes(backend)) {
                // Keep at least one backend
                if (prev.length === 1) {
                    Alert.alert('Backend Required', 'At least one execution backend must be enabled.');
                    return prev;
                }
                return prev.filter(b => b !== backend);
            } else {
                return [...prev, backend];
            }
        });
    }, []);

    const handleSave = useCallback(() => {
        if (!model) return;
        const trimmedName = displayName.trim() || model.name;

        let badge = model.badge;
        if (supportsVision && supportsAudio) {
            badge = 'Multimodal';
        } else if (supportsVision) {
            badge = 'Vision';
        } else if (supportsAudio) {
            badge = 'Audio';
        } else if (supportsThinking) {
            badge = 'Reasoning';
        } else if (model.isCoder) {
            badge = 'Coder';
        } else {
            badge = 'Custom';
        }

        const updated: ModelInfo = {
            ...model,
            name: trimmedName,
            supportsVision,
            supportsAudio,
            supportsThinking,
            supportsFunctionCalling,
            maxContextLength,
            supportedBackends,
            badge,
        };

        onSave(updated);
        onClose();
    }, [
        model,
        displayName,
        supportsVision,
        supportsAudio,
        supportsThinking,
        supportsFunctionCalling,
        maxContextLength,
        supportedBackends,
        onSave,
        onClose,
    ]);

    if (!model) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.header}>
                        <Text style={[styles.headerTitle, { color: colors.text }]}>Model Settings</Text>
                        <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]}>
                            Configure capabilities & hardware acceleration for {model.fileName}
                        </Text>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                        {/* Display Name */}
                        <View style={styles.section}>
                            <Text style={[styles.label, { color: colors.text }]}>Display Name</Text>
                            <TextInput
                                value={displayName}
                                onChangeText={setDisplayName}
                                placeholder="Enter model name"
                                placeholderTextColor={colors.secondaryText}
                                style={[
                                    styles.input,
                                    {
                                        backgroundColor: colors.background,
                                        borderColor: colors.border,
                                        color: colors.text,
                                    },
                                ]}
                            />
                        </View>

                        {/* Capabilities Section */}
                        <View style={styles.section}>
                            <Text style={[styles.label, { color: colors.text }]}>Capabilities</Text>

                            {/* Vision Toggle */}
                            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
                                <View style={styles.toggleInfo}>
                                    <View style={styles.toggleTitleRow}>
                                        <ImageIcon color={colors.text} size={18} />
                                        <Text style={[styles.toggleTitle, { color: colors.text }]}>Image / Vision Support</Text>
                                    </View>
                                    <Text style={[styles.toggleDesc, { color: colors.secondaryText }]}>
                                        Enables photo attachments and multimodal image understanding.
                                    </Text>
                                </View>
                                <Switch
                                    value={supportsVision}
                                    onValueChange={setSupportsVision}
                                    trackColor={{ false: 'rgba(128,128,128,0.3)', true: colors.text }}
                                    thumbColor={colors.background}
                                />
                            </View>

                            {/* Audio Toggle */}
                            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
                                <View style={styles.toggleInfo}>
                                    <View style={styles.toggleTitleRow}>
                                        <MicIcon color={colors.text} size={18} />
                                        <Text style={[styles.toggleTitle, { color: colors.text }]}>Audio Support</Text>
                                    </View>
                                    <Text style={[styles.toggleDesc, { color: colors.secondaryText }]}>
                                        Enables audio/voice attachments and transcription.
                                    </Text>
                                </View>
                                <Switch
                                    value={supportsAudio}
                                    onValueChange={setSupportsAudio}
                                    trackColor={{ false: 'rgba(128,128,128,0.3)', true: colors.text }}
                                    thumbColor={colors.background}
                                />
                            </View>

                            {/* Thinking Toggle */}
                            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
                                <View style={styles.toggleInfo}>
                                    <View style={styles.toggleTitleRow}>
                                        <BrainIcon color={colors.text} size={18} />
                                        <Text style={[styles.toggleTitle, { color: colors.text }]}>Reasoning / Thinking</Text>
                                    </View>
                                    <Text style={[styles.toggleDesc, { color: colors.secondaryText }]}>
                                        Enables chain-of-thought reasoning tokens and thinking tags.
                                    </Text>
                                </View>
                                <Switch
                                    value={supportsThinking}
                                    onValueChange={setSupportsThinking}
                                    trackColor={{ false: 'rgba(128,128,128,0.3)', true: colors.text }}
                                    thumbColor={colors.background}
                                />
                            </View>

                            {/* Function Calling Toggle */}
                            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
                                <View style={styles.toggleInfo}>
                                    <View style={styles.toggleTitleRow}>
                                        <CpuIcon color={colors.text} size={18} />
                                        <Text style={[styles.toggleTitle, { color: colors.text }]}>Function Calling / Tools</Text>
                                    </View>
                                    <Text style={[styles.toggleDesc, { color: colors.secondaryText }]}>
                                        Allows model to trigger tools, agents, and structured functions.
                                    </Text>
                                </View>
                                <Switch
                                    value={supportsFunctionCalling}
                                    onValueChange={setSupportsFunctionCalling}
                                    trackColor={{ false: 'rgba(128,128,128,0.3)', true: colors.text }}
                                    thumbColor={colors.background}
                                />
                            </View>
                        </View>

                        {/* Backends Selection */}
                        <View style={styles.section}>
                            <Text style={[styles.label, { color: colors.text }]}>Supported Acceleration Backends</Text>
                            <View style={styles.backendsGrid}>
                                {BACKEND_OPTIONS.map(b => {
                                    const active = supportedBackends.includes(b);
                                    const IconComponent = b === 'NPU' ? NpuIcon : b === 'GPU' ? GpuIcon : CpuIcon;
                                    return (
                                        <Pressable
                                            key={b}
                                            onPress={() => toggleBackend(b)}
                                            style={[
                                                styles.backendOption,
                                                {
                                                    backgroundColor: active ? colors.text : 'rgba(128,128,128,0.12)',
                                                    borderColor: active ? colors.text : colors.border,
                                                },
                                            ]}
                                        >
                                            <IconComponent color={active ? colors.background : colors.text} size={16} />
                                            <Text
                                                style={[
                                                    styles.backendOptionText,
                                                    { color: active ? colors.background : colors.text },
                                                ]}
                                            >
                                                {b}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Max Context Length */}
                        <View style={styles.section}>
                            <Text style={[styles.label, { color: colors.text }]}>
                                Max Context Length: {maxContextLength.toLocaleString()} tokens
                            </Text>
                            <View style={styles.contextGrid}>
                                {CONTEXT_OPTIONS.map(tokens => {
                                    const isChosen = maxContextLength === tokens;
                                    const label = tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
                                    return (
                                        <Pressable
                                            key={tokens}
                                            onPress={() => setMaxContextLength(tokens)}
                                            style={[
                                                styles.contextOption,
                                                {
                                                    backgroundColor: isChosen ? colors.text : 'rgba(128,128,128,0.12)',
                                                    borderColor: isChosen ? colors.text : colors.border,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.contextOptionText,
                                                    { color: isChosen ? colors.background : colors.text },
                                                ]}
                                            >
                                                {label}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    </ScrollView>

                    {/* Footer Actions */}
                    <View style={styles.footer}>
                        <Pressable
                            onPress={onClose}
                            style={[styles.footerButton, styles.cancelButton, { borderColor: colors.border }]}
                        >
                            <Text style={[styles.footerButtonText, { color: colors.text }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            onPress={handleSave}
                            style={[styles.footerButton, styles.saveButton, { backgroundColor: colors.text }]}
                        >
                            <Text style={[styles.footerButtonText, { color: colors.background }]}>Save Changes</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const isTablet = Dimensions.get('window').width >= 768;

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: isTablet ? 48 : 16,
    },
    dialog: {
        width: '100%',
        maxWidth: isTablet ? 600 : 440,
        maxHeight: '90%',
        borderRadius: 24,
        padding: 20,
        borderWidth: 1,
    },
    header: {
        marginBottom: 16,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
    },
    headerSubtitle: {
        fontSize: 13,
        marginTop: 4,
        lineHeight: 18,
    },
    scrollContent: {
        gap: 16,
        paddingBottom: 12,
    },
    section: {
        gap: 8,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 14,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 6,
    },
    toggleInfo: {
        flex: 1,
        paddingRight: 12,
    },
    toggleTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 2,
    },
    toggleTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    toggleDesc: {
        fontSize: 11,
        lineHeight: 15,
    },
    backendsGrid: {
        flexDirection: 'row',
        gap: 10,
    },
    backendOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    backendOptionText: {
        fontSize: 13,
        fontWeight: '700',
    },
    contextGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    contextOption: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
    },
    contextOptionText: {
        fontSize: 12,
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(128,128,128,0.2)',
    },
    footerButton: {
        flex: 1,
        paddingVertical: 13,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        borderWidth: 1,
    },
    saveButton: {},
    footerButtonText: {
        fontSize: 14,
        fontWeight: '700',
    },
});

export default memo(CustomModelConfigModal);
