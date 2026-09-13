import React, {useCallback, useEffect, useRef, useState, memo} from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
  AppState,
  Dimensions,
  Alert,
} from 'react-native';
import {useSelector, useDispatch} from 'react-redux';
import {useTheme} from '../../theme/ThemeProvider';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {RootState} from '../../store/store';
import {
  setServiceEnabled,
  startExecution,
  updateStep,
  completeExecution,
  cancelExecution,
  resetAgent,
} from '../../store/slices/agentSlice';
import AccessibilityService from '../../services/accessibilityService';
import agentOrchestrator from '../../agents/agentOrchestrator';
import type {AgentStep} from '../../agents/types';
import {DEFAULT_AGENT_CONFIG} from '../../agents/types';
import {AVAILABLE_MODELS} from '../../store/slices/llmSlice';

const {width} = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// Icons (pure View-based, no dependencies)
// ─────────────────────────────────────────────────────────────

const BackArrowIcon = memo(({color}: {color: string}) => (
  <View style={iconStyles.backArrow}>
    <View
      style={[
        iconStyles.backArrowLine1,
        {backgroundColor: color},
      ]}
    />
    <View
      style={[
        iconStyles.backArrowLine2,
        {backgroundColor: color},
      ]}
    />
    <View
      style={[
        iconStyles.backArrowShaft,
        {backgroundColor: color},
      ]}
    />
  </View>
));

const AgentIcon = memo(({color, size = 20}: {color: string; size?: number}) => (
  <View style={[iconStyles.agentIcon, {width: size, height: size}]}>
    <View
      style={[
        iconStyles.agentEye,
        {
          backgroundColor: color,
          width: size * 0.25,
          height: size * 0.25,
          borderRadius: size * 0.125,
          left: size * 0.2,
          top: size * 0.3,
        },
      ]}
    />
    <View
      style={[
        iconStyles.agentEye,
        {
          backgroundColor: color,
          width: size * 0.25,
          height: size * 0.25,
          borderRadius: size * 0.125,
          right: size * 0.2,
          top: size * 0.3,
        },
      ]}
    />
    <View
      style={[
        iconStyles.agentMouth,
        {
          borderBottomColor: color,
          width: size * 0.4,
          bottom: size * 0.2,
        },
      ]}
    />
  </View>
));

const PlayIcon = memo(({color}: {color: string}) => (
  <View
    style={[
      iconStyles.playTriangle,
      {borderLeftColor: color},
    ]}
  />
));

const StopIcon = memo(({color}: {color: string}) => (
  <View style={[iconStyles.stopSquare, {backgroundColor: color}]} />
));

// ─────────────────────────────────────────────────────────────
// Step Status Indicator
// ─────────────────────────────────────────────────────────────

const StepStatusBadge = memo(
  ({status, colors}: {status: string; colors: any}) => {
    const badgeColor = {
      observing: '#3B82F6',
      thinking: '#F59E0B',
      executing: '#8B5CF6',
      completed: colors.success,
      failed: colors.error,
      pending: colors.secondaryText,
    }[status] || colors.secondaryText;

    const label = {
      observing: '👁 Observing',
      thinking: '🧠 Thinking',
      executing: '⚡ Executing',
      completed: '✓ Done',
      failed: '✗ Failed',
      pending: '⏳ Pending',
    }[status] || status;

    return (
      <View style={[stepStyles.badge, {backgroundColor: badgeColor + '20'}]}>
        <Text style={[stepStyles.badgeText, {color: badgeColor}]}>
          {label}
        </Text>
      </View>
    );
  },
);

// ─────────────────────────────────────────────────────────────
// Step Card
// ─────────────────────────────────────────────────────────────

const StepCard = memo(
  ({step, colors}: {step: AgentStep; colors: any}) => {
    const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
    
    // Auto-expand thinking while it's actively streaming
    useEffect(() => {
      if (step.status === 'thinking' && step.rawThinking) {
        setIsThinkingExpanded(true);
      }
    }, [step.status, step.rawThinking === undefined]);

    const actionSummary = step.action
      ? formatActionSummary(step.action)
      : 'Waiting...';

    return (
      <View style={[stepStyles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
        <View style={stepStyles.cardHeader}>
          <Text style={[stepStyles.stepNumber, {color: colors.primary}]}>
            Step {step.stepIndex + 1}
          </Text>
          <StepStatusBadge status={step.status} colors={colors} />
        </View>

        {step.observation && (
          <Text
            style={[stepStyles.appName, {color: colors.secondaryText}]}
            numberOfLines={1}>
            📱 {step.observation.app} · {step.observation.elements.length} elements
          </Text>
        )}

        {step.rawThinking ? (
          <View style={{marginTop: 8, marginBottom: 4}}>
            <Pressable 
              onPress={() => setIsThinkingExpanded(!isThinkingExpanded)}
              style={{paddingVertical: 4}}>
              <Text style={{color: colors.primary, fontSize: 12, fontWeight: '600'}}>
                {isThinkingExpanded ? '▼ Hide Thought Process' : '▶ Show Thought Process'}
              </Text>
            </Pressable>
            {isThinkingExpanded && (
              <Text style={[stepStyles.reasoning, {color: colors.text, opacity: 0.8, fontSize: 13, marginTop: 4}]}>
                {step.rawThinking}
                {step.status === 'thinking' ? ' █' : ''}
              </Text>
            )}
          </View>
        ) : null}

        {step.reasoning && !step.rawThinking ? (
          <Text
            style={[stepStyles.reasoning, {color: colors.text}]}
            numberOfLines={2}>
            {step.reasoning}
          </Text>
        ) : null}

        <Text
          style={[stepStyles.actionText, {color: colors.secondaryText}]}
          numberOfLines={1}>
          {actionSummary}
        </Text>

        {step.error && (
          <Text style={[stepStyles.errorText, {color: colors.error}]} numberOfLines={2}>
            {step.error}
          </Text>
        )}
      </View>
    );
  },
);

function formatActionSummary(action: any): string {
  switch (action.type) {
    case 'click':
      return `Tap → ${action.target}`;
    case 'long_click':
      return `Long press → ${action.target}`;
    case 'set_text':
      return `Type "${action.value}" → ${action.target}`;
    case 'scroll':
      return `Scroll ${action.direction} → ${action.target}`;
    case 'swipe':
      return `Swipe gesture`;
    case 'tap_coordinates':
      return `Tap at (${action.x}, ${action.y})`;
    case 'back':
      return `Press Back`;
    case 'home':
      return `Press Home`;
    case 'wait':
      return `Wait ${action.durationMs}ms`;
    case 'done':
      return `✓ ${action.result}`;
    case 'error':
      return `✗ ${action.message}`;
    default:
      return action.type;
  }
}

// ─────────────────────────────────────────────────────────────
// Quick Action Presets
// ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {label: '🔍 Search Amazon', instruction: 'Open Amazon and search for iPhone 17'},
  {label: '📱 Open Settings', instruction: 'Open Settings app'},
  {label: '📝 Fill a form', instruction: 'Fill this registration form with sample data'},
  {label: '📸 Open Camera', instruction: 'Open the camera app and take a photo'},
];

// ─────────────────────────────────────────────────────────────
// Main AgentPage Component
// ─────────────────────────────────────────────────────────────

interface AgentPageProps {
  onBack: () => void;
}

const AgentPage: React.FC<AgentPageProps> = ({onBack}) => {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const scrollViewRef = useRef<ScrollView>(null);

  const {executionStatus, steps, lastResult, error, isServiceEnabled: serviceEnabled} =
    useSelector((state: RootState) => state.agent);
  const loadedModelId = useSelector((state: RootState) => state.llm.loadedModelId);

  const [instruction, setInstruction] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Check service status on mount and when returning from Settings
  useEffect(() => {
    const checkService = async () => {
      const enabled = await AccessibilityService.isServiceEnabled();
      dispatch(setServiceEnabled(enabled));
    };
    checkService();

    // Re-check when app comes back to foreground (user returning from Settings)
    const appStateListener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkService();
      }
    });

    // Also poll periodically as a fallback
    const interval = setInterval(checkService, 1500);
    return () => {
      clearInterval(interval);
      appStateListener.remove();
    };
  }, [dispatch]);

  // Pulse animation when running
  useEffect(() => {
    if (executionStatus === 'running') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [executionStatus, pulseAnim]);

  // Auto-scroll to bottom on new steps
  useEffect(() => {
    if (steps.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({animated: true});
      }, 200);
    }
  }, [steps.length]);

  const handleExecute = useCallback(
    async (text?: string) => {
      if (!serviceEnabled) {
        Alert.alert(
          'Permission Required',
          'AOTG requires the Accessibility Service to observe the screen and perform actions on your behalf.',
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Open Settings',
              onPress: () => AccessibilityService.openAccessibilitySettings(),
            },
          ],
        );
        return;
      }

      if (!loadedModelId) {
        Alert.alert(
          'Model Required',
          'Please load an LLM model before using the agent.',
          [{text: 'OK', style: 'default'}],
        );
        return;
      }

      const cmd = text || instruction.trim();
      if (!cmd) return;

      dispatch(
        startExecution({
          instruction: cmd,
          agentId: 'accessibility-agent',
        }),
      );

      // Only enable vision (screenshots) when the loaded model can actually
      // accept images — otherwise run text-only against the accessibility tree.
      const loadedModel = AVAILABLE_MODELS.find(m => m.id === loadedModelId);
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        useVision: !!loadedModel?.supportsVision,
      };

      const result = await agentOrchestrator.execute(
        cmd,
        (step: AgentStep) => {
          dispatch(updateStep(step));
        },
        config,
      );

      dispatch(completeExecution(result));
    },
    [instruction, dispatch, serviceEnabled, loadedModelId],
  );

  const handleCancel = useCallback(() => {
    agentOrchestrator.cancel();
    dispatch(cancelExecution());
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch(resetAgent());
    setInstruction('');
  }, [dispatch]);

  const isRunning = executionStatus === 'running';
  const isIdle = executionStatus === 'idle';
  const hasResult = executionStatus === 'completed' || executionStatus === 'failed' || executionStatus === 'cancelled';

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 8,
          },
        ]}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <BackArrowIcon color={colors.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <AgentIcon color={colors.primary} size={22} />
          <Text style={[styles.headerTitle, {color: colors.text}]}>
            Agent Mode
          </Text>
        </View>

        {isRunning && (
          <Animated.View style={{opacity: pulseAnim}}>
            <View style={[styles.liveDot, {backgroundColor: colors.success}]} />
          </Animated.View>
        )}
      </View>

      {/* Service Warning Banner */}
      {!serviceEnabled && (
        <Pressable
          style={[styles.banner, {backgroundColor: '#F59E0B20'}]}
          onPress={() => AccessibilityService.openAccessibilitySettings()}>
          <Text style={[styles.bannerText, {color: '#F59E0B'}]}>
            ⚠️ Accessibility Service is not enabled. Tap to open Settings.
          </Text>
        </Pressable>
      )}

      {/* Model Warning Banner */}
      {!loadedModelId && serviceEnabled && (
        <View style={[styles.banner, {backgroundColor: colors.error + '15'}]}>
          <Text style={[styles.bannerText, {color: colors.error}]}>
            ⚠️ No LLM model loaded. Go back and load a model first.
          </Text>
        </View>
      )}

      {/* Steps Timeline */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {paddingBottom: insets.bottom + 120},
        ]}
        showsVerticalScrollIndicator={false}>

        {/* Empty state */}
        {isIdle && steps.length === 0 && (
          <View style={styles.emptyState}>
            <AgentIcon color={colors.secondaryText} size={48} />
            <Text style={[styles.emptyTitle, {color: colors.text}]}>
              AI Agent Ready
            </Text>
            <Text style={[styles.emptySubtitle, {color: colors.secondaryText}]}>
              Tell the agent what to do. It will observe the screen, think,
              and take actions to complete your task.
            </Text>

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <Text
                style={[
                  styles.quickActionsTitle,
                  {color: colors.secondaryText},
                ]}>
                Try these:
              </Text>
              {QUICK_ACTIONS.map((qa, index) => (
                <Pressable
                  key={index}
                  style={[
                    styles.quickActionBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    setInstruction(qa.instruction);
                    handleExecute(qa.instruction);
                  }}>
                  <Text style={[styles.quickActionText, {color: colors.text}]}>
                    {qa.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Step Cards */}
        {steps.map(step => (
          <StepCard key={step.stepIndex} step={step} colors={colors} />
        ))}

        {/* Result Banner */}
        {hasResult && lastResult && (
          <View
            style={[
              styles.resultBanner,
              {
                backgroundColor: lastResult.success
                  ? colors.success + '15'
                  : colors.error + '15',
                borderColor: lastResult.success
                  ? colors.success + '40'
                  : colors.error + '40',
              },
            ]}>
            <Text
              style={[
                styles.resultTitle,
                {
                  color: lastResult.success ? colors.success : colors.error,
                },
              ]}>
              {lastResult.success ? '✓ Task Completed' : '✗ Task Failed'}
            </Text>
            <Text
              style={[
                styles.resultSummary,
                {color: colors.text},
              ]}>
              {lastResult.summary}
            </Text>
            <Text style={[styles.resultMeta, {color: colors.secondaryText}]}>
              {lastResult.steps.length} steps ·{' '}
              {((lastResult.endTime - lastResult.startTime) / 1000).toFixed(1)}s
            </Text>

            <Pressable
              style={[
                styles.resetBtn,
                {backgroundColor: colors.primary + '20'},
              ]}
              onPress={handleReset}>
              <Text style={[styles.resetBtnText, {color: colors.primary}]}>
                New Task
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Input Bar */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}>
        {isRunning ? (
          <Pressable
            style={[styles.cancelBtn, {backgroundColor: colors.error + '15'}]}
            onPress={handleCancel}>
            <StopIcon color={colors.error} />
            <Text style={[styles.cancelBtnText, {color: colors.error}]}>
              Cancel
            </Text>
          </Pressable>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Tell the agent what to do..."
              placeholderTextColor={colors.secondaryText}
              value={instruction}
              onChangeText={setInstruction}
              multiline
              maxLength={500}
              editable={!isRunning}
            />
            <Pressable
              style={[
                styles.sendBtn,
                {
                  backgroundColor:
                    instruction.trim()
                      ? colors.primary
                      : colors.border,
                },
              ]}
              onPress={() => handleExecute()}
              disabled={
                !instruction.trim() || isRunning
              }>
              {isRunning ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <PlayIcon color="#fff" />
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  banner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  quickActions: {
    width: '100%',
    marginTop: 32,
    gap: 8,
  },
  quickActionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  quickActionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickActionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  resultBanner: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  resultSummary: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  resultMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  resetBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
  },
  resetBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputBar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

const stepStyles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  appName: {
    fontSize: 12,
  },
  reasoning: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

const iconStyles = StyleSheet.create({
  backArrow: {
    width: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrowLine1: {
    position: 'absolute',
    width: 10,
    height: 2,
    borderRadius: 1,
    transform: [{rotate: '-45deg'}, {translateY: -3}],
    left: 2,
  },
  backArrowLine2: {
    position: 'absolute',
    width: 10,
    height: 2,
    borderRadius: 1,
    transform: [{rotate: '45deg'}, {translateY: 3}],
    left: 2,
  },
  backArrowShaft: {
    position: 'absolute',
    width: 16,
    height: 2,
    borderRadius: 1,
    left: 2,
  },
  agentIcon: {
    position: 'relative',
  },
  agentEye: {
    position: 'absolute',
  },
  agentMouth: {
    position: 'absolute',
    alignSelf: 'center',
    height: 0,
    borderBottomWidth: 2,
    borderRadius: 2,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 3,
  },
  stopSquare: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
});

export default memo(AgentPage);
