import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import {
  LiveCaptionTurn,
  LiveOutputRoute,
  LiveTalkSliceState,
} from '../store/slices/liveTalkSlice';
import MicIcon from '../static/images/SVG/MicIcon';
import LiveIcon from '../static/images/SVG/LiveIcon';
import { CloseIcon, StopIcon } from './SharedIcons';

interface LiveTalkModalProps {
  liveTalk: LiveTalkSliceState;
  modelName: string;
  micLevelSV: SharedValue<number>;
  speakerLevelSV: SharedValue<number>;
  onClose: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onCommitTurn: () => void;
  onCycleRoute: () => void;
  onRetry: () => void;
}

interface CaptionItemProps {
  turn: LiveCaptionTurn;
  userBgStyle: object;
  assistantBgStyle: object;
  textStyle: object;
  metaTextStyle: object;
}

const CaptionItem = memo(
  ({
    turn,
    userBgStyle,
    assistantBgStyle,
    textStyle,
    metaTextStyle,
  }: CaptionItemProps) => {
    const isUser = turn.role === 'user';
    return (
      <View
        style={[
          styles.captionBubble,
          isUser ? styles.captionBubbleUser : styles.captionBubbleAssistant,
          isUser ? userBgStyle : assistantBgStyle,
        ]}>
        <Text style={[styles.captionRoleLabel, metaTextStyle]}>
          {isUser ? 'You' : turn.wasInterrupted ? 'Assistant (Interrupted)' : 'Assistant'}
        </Text>
        <Text style={[styles.captionText, textStyle]}>{turn.text}</Text>
      </View>
    );
  }
);

function getRouteLabel(route: LiveOutputRoute, preferred: LiveOutputRoute): string {
  if (preferred === 'auto') {
    if (route === 'bluetooth') return 'Auto (BT)';
    if (route === 'wired') return 'Auto (Headset)';
    if (route === 'earpiece') return 'Auto (Earpiece)';
    return 'Auto (Speaker)';
  }
  switch (route) {
    case 'bluetooth':
      return 'Bluetooth';
    case 'wired':
      return 'Headset';
    case 'earpiece':
      return 'Earpiece';
    default:
      return 'Speaker';
  }
}

function getStateTitle(state: LiveTalkSliceState): string {
  if (state.isStarting) return 'Preparing Live Voice...';
  if (state.isMuted) return 'Microphone Muted';
  switch (state.sessionState) {
    case 'LISTENING':
      return state.vadSpeechActive ? 'Listening to You...' : 'Listening';
    case 'THINKING':
      return 'Thinking...';
    case 'SPEAKING':
      return 'Speaking (Tap or Speak to Interrupt)';
    case 'INTERRUPTED':
      return 'Interrupted';
    default:
      return 'Ready';
  }
}

export const LiveTalkModal: React.FC<LiveTalkModalProps> = memo(
  ({
    liveTalk,
    modelName,
    micLevelSV,
    speakerLevelSV,
    onClose,
    onToggleMute,
    onInterrupt,
    onCommitTurn,
    onCycleRoute,
    onRetry,
  }) => {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const isTablet = (width || Dimensions.get('window').width) >= 768;

    const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const pulseSV = useSharedValue(1);

    const isListening = liveTalk.sessionState === 'LISTENING';
    const isThinking = liveTalk.sessionState === 'THINKING';
    const isSpeaking = liveTalk.sessionState === 'SPEAKING';
    const isMuted = liveTalk.isMuted;

    useEffect(() => {
      if (!liveTalk.isVisible) {
        pulseSV.value = 1;
        return;
      }
      if (isThinking) {
        pulseSV.value = withRepeat(
          withSequence(
            withTiming(1.12, { duration: 550, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.95, { duration: 550, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        );
      } else if (isListening && !isMuted) {
        pulseSV.value = withRepeat(
          withSequence(
            withTiming(1.04, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            withTiming(1.0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        );
      } else {
        pulseSV.value = withTiming(1.0, { duration: 220 });
      }
    }, [isListening, isMuted, isThinking, liveTalk.isVisible, pulseSV]);

    const outerHaloStyle = useAnimatedStyle(() => {
      const level = isSpeaking
        ? speakerLevelSV.value
        : isListening && !isMuted
        ? micLevelSV.value
        : 0;
      const scaleTarget = pulseSV.value + Math.min(0.42, level * 0.48);
      const opacityTarget = isMuted
        ? 0.08
        : Math.min(0.45, 0.14 + level * 0.35 + (isThinking ? 0.1 : 0));
      return {
        transform: [{ scale: scaleTarget }],
        opacity: opacityTarget,
      };
    }, [isListening, isMuted, isSpeaking, isThinking]);

    const coreOrbAnimStyle = useAnimatedStyle(() => {
      const level = isSpeaking
        ? speakerLevelSV.value
        : isListening && !isMuted
        ? micLevelSV.value
        : 0;
      const scaleTarget = isMuted ? 0.94 : 1 + Math.min(0.16, level * 0.18);
      return {
        transform: [{ scale: scaleTarget }],
      };
    }, [isListening, isMuted, isSpeaking]);

    const dynamicStyles = useMemo(() => {
      const orbSize = isTablet ? 184 : 148;
      const haloSize = isTablet ? 256 : 206;
      const contentMaxWidth = isTablet ? 600 : 480;

      return StyleSheet.create({
        rootBackground: {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top + 8, 20),
          paddingBottom: Math.max(insets.bottom + 14, 24),
        },
        contentShell: {
          maxWidth: contentMaxWidth,
        },
        cardSurface: {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        userCaptionSurface: {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        assistantCaptionSurface: {
          backgroundColor: 'transparent',
        },
        primaryText: {
          color: colors.text,
        },
        secondaryText: {
          color: colors.secondaryText,
        },
        accentText: {
          color: colors.primary,
        },
        errorBox: {
          backgroundColor: colors.card,
          borderColor: colors.error,
        },
        errorText: {
          color: colors.error,
        },
        orbHalo: {
          width: haloSize,
          height: haloSize,
          borderRadius: haloSize / 2,
          backgroundColor: isSpeaking ? colors.primary : colors.headphoneBg,
        },
        orbCore: {
          width: orbSize,
          height: orbSize,
          borderRadius: orbSize / 2,
          backgroundColor: isSpeaking ? colors.primary : colors.headphoneBg,
        },
        orbWrapperResponsive: {
          minHeight: isTablet ? 270 : 220,
        },
        muteBtnActive: {
          backgroundColor: colors.error,
          borderColor: colors.error,
        },
        primaryActionBtn: {
          backgroundColor: colors.headphoneBg,
          borderColor: colors.headphoneBg,
        },
        primaryActionBtnText: {
          color: colors.headphoneIcon,
        },
        retryBtn: {
          backgroundColor: colors.primary,
        },
      });
    }, [colors, insets.bottom, insets.top, isSpeaking, isTablet]);

    const handleOrbPress = useCallback(() => {
      if (liveTalk.isStarting) return;
      if (isSpeaking || isThinking) {
        onInterrupt();
      } else if (isListening && !isMuted) {
        onCommitTurn();
      }
    }, [isListening, isMuted, isSpeaking, isThinking, liveTalk.isStarting, onCommitTurn, onInterrupt]);

    const handleCaptionContentSizeChange = useCallback(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, []);

    useEffect(() => {
      if (liveTalk.userTranscript || liveTalk.assistantTranscript || liveTalk.turns.length > 0) {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, [liveTalk.assistantTranscript, liveTalk.turns.length, liveTalk.userTranscript]);

    const modeBadgeText = liveTalk.inputMode === 'audio_bytes' ? 'Native Audio' : 'Device Speech';
    const routeText = getRouteLabel(liveTalk.activeRoute, liveTalk.preferredRoute);
    const statusTitle = getStateTitle(liveTalk);
    const hasStreamingCaptions =
      liveTalk.turns.length > 0 ||
      liveTalk.userTranscript.length > 0 ||
      liveTalk.assistantTranscript.length > 0;

    return (
      <Modal
        visible={liveTalk.isVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={onClose}>
        <View style={[styles.container, dynamicStyles.rootBackground]}>
          <View style={[styles.shell, dynamicStyles.contentShell]}>
            {/* Header Bar */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={[styles.badgePill, dynamicStyles.cardSurface]}>
                  <Text numberOfLines={1} style={[styles.badgeModelText, dynamicStyles.primaryText]}>
                    {modelName}
                  </Text>
                </View>
                <View style={[styles.badgePill, dynamicStyles.cardSurface]}>
                  <Text style={[styles.badgeMetaText, dynamicStyles.accentText]}>
                    {modeBadgeText}
                  </Text>
                </View>
              </View>

              <View style={styles.headerRight}>
                <Pressable
                  onPress={onCycleRoute}
                  accessibilityRole="button"
                  accessibilityLabel="Switch audio output route"
                  style={[styles.routeButton, dynamicStyles.cardSurface]}>
                  <Text style={[styles.routeButtonText, dynamicStyles.primaryText]}>
                    {routeText}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="End live voice session"
                  style={[styles.closeButton, dynamicStyles.cardSurface]}>
                  <CloseIcon size={18} color={colors.text} />
                </Pressable>
              </View>
            </View>

            {/* Reanimated Voice Orb Stage */}
            <View style={styles.orbSection}>
              <View style={[styles.orbWrapper, dynamicStyles.orbWrapperResponsive]}>
                <Reanimated.View style={[styles.haloRing, dynamicStyles.orbHalo, outerHaloStyle]} />
                <Pressable
                  onPress={handleOrbPress}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSpeaking || isThinking ? 'Interrupt response' : 'Finish speaking turn'
                  }>
                  <Reanimated.View style={[styles.orbCore, dynamicStyles.orbCore, coreOrbAnimStyle]}>
                    {liveTalk.isStarting || isThinking ? (
                      <ActivityIndicator
                        size="large"
                        color={isSpeaking ? '#FFFFFF' : colors.headphoneIcon}
                      />
                    ) : isSpeaking ? (
                      <LiveIcon size={isTablet ? 52 : 44} color="#FFFFFF" isAnimated={true} />
                    ) : (
                      <MicIcon size={isTablet ? 48 : 40} color={colors.headphoneIcon} />
                    )}
                  </Reanimated.View>
                </Pressable>
              </View>

              <Text style={[styles.statusTitle, dynamicStyles.primaryText]}>{statusTitle}</Text>
              <Text style={[styles.statusSub, dynamicStyles.secondaryText]}>
                {liveTalk.aecEnabled ? 'Hardware AEC Active' : 'Voice Channel Active'}
                {liveTalk.vadBackend === 'silero_onnx' ? ' · Silero VAD' : ' · Adaptive VAD'}
              </Text>
            </View>

            {/* Error Banner */}
            {liveTalk.error ? (
              <View style={[styles.errorBanner, dynamicStyles.errorBox]}>
                <Text style={[styles.errorBannerText, dynamicStyles.errorText]}>
                  {liveTalk.error}
                </Text>
                {liveTalk.sessionState === 'IDLE' && !liveTalk.isStarting ? (
                  <Pressable
                    onPress={onRetry}
                    accessibilityRole="button"
                    accessibilityLabel="Retry voice session"
                    style={[styles.retryButton, dynamicStyles.retryBtn]}>
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Plain-Text Streaming Captions */}
            <ScrollView
              ref={scrollRef}
              style={styles.captionScroll}
              contentContainerStyle={styles.captionScrollContent}
              onContentSizeChange={handleCaptionContentSizeChange}
              showsVerticalScrollIndicator={false}>
              {!hasStreamingCaptions ? (
                <Text style={[styles.emptyCaptionHint, dynamicStyles.secondaryText]}>
                  Speak naturally at any time. You can interrupt mid-response whenever you want.
                </Text>
              ) : null}

              {liveTalk.turns.map((turn) => (
                <CaptionItem
                  key={turn.id}
                  turn={turn}
                  userBgStyle={dynamicStyles.userCaptionSurface}
                  assistantBgStyle={dynamicStyles.assistantCaptionSurface}
                  textStyle={dynamicStyles.primaryText}
                  metaTextStyle={dynamicStyles.secondaryText}
                />
              ))}

              {liveTalk.userTranscript ? (
                <View
                  style={[
                    styles.captionBubble,
                    styles.captionBubbleUser,
                    dynamicStyles.userCaptionSurface,
                  ]}>
                  <Text style={[styles.captionRoleLabel, dynamicStyles.secondaryText]}>You</Text>
                  <Text style={[styles.captionText, dynamicStyles.primaryText]}>
                    {liveTalk.userTranscript}
                  </Text>
                </View>
              ) : null}

              {liveTalk.assistantTranscript ? (
                <View
                  style={[
                    styles.captionBubble,
                    styles.captionBubbleAssistant,
                    dynamicStyles.assistantCaptionSurface,
                  ]}>
                  <Text style={[styles.captionRoleLabel, dynamicStyles.accentText]}>
                    Assistant
                  </Text>
                  <Text style={[styles.captionText, dynamicStyles.primaryText]}>
                    {liveTalk.assistantTranscript}
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {/* Bottom Controls */}
            <View style={styles.controlsRow}>
              <Pressable
                onPress={onToggleMute}
                accessibilityRole="button"
                accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                style={[
                  styles.controlBtn,
                  isMuted ? dynamicStyles.muteBtnActive : dynamicStyles.cardSurface,
                ]}>
                <MicIcon size={20} color={isMuted ? '#FFFFFF' : colors.text} />
                <Text
                  style={[
                    styles.controlBtnText,
                    isMuted ? styles.whiteLabel : dynamicStyles.primaryText,
                  ]}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </Text>
              </Pressable>

              {isSpeaking || isThinking ? (
                <Pressable
                  onPress={onInterrupt}
                  accessibilityRole="button"
                  accessibilityLabel="Interrupt assistant response"
                  style={[styles.controlBtn, dynamicStyles.primaryActionBtn]}>
                  <StopIcon color={colors.headphoneIcon} />
                  <Text style={[styles.controlBtnText, dynamicStyles.primaryActionBtnText]}>
                    Interrupt
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={onCommitTurn}
                  disabled={!isListening || isMuted || liveTalk.isStarting}
                  accessibilityRole="button"
                  accessibilityLabel="Send spoken turn now"
                  style={[
                    styles.controlBtn,
                    dynamicStyles.primaryActionBtn,
                    (!isListening || isMuted || liveTalk.isStarting) ? styles.controlBtnDisabled : null,
                  ]}>
                  <Text style={[styles.controlBtnText, dynamicStyles.primaryActionBtnText]}>
                    Send Turn
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close live voice talk"
                style={[styles.controlBtn, dynamicStyles.cardSurface]}>
                <CloseIcon size={16} color={colors.text} />
                <Text style={[styles.controlBtnText, dynamicStyles.primaryText]}>End</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  shell: {
    flex: 1,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 160,
  },
  badgeModelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badgeMetaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  routeButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  routeButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orbSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  orbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
    width: '100%',
  },
  haloRing: {
    position: 'absolute',
  },
  orbCore: {
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  statusSub: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  captionScroll: {
    flex: 1,
  },
  captionScrollContent: {
    paddingVertical: 8,
    gap: 10,
  },
  emptyCaptionHint: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  captionBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  captionBubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
    borderWidth: 1,
  },
  captionBubbleAssistant: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    paddingHorizontal: 4,
  },
  captionRoleLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  captionText: {
    fontSize: 15,
    lineHeight: 22,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 12,
  },
  controlBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 25,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  controlBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  controlBtnDisabled: {
    opacity: 0.45,
  },
  whiteLabel: {
    color: '#FFFFFF',
  },
});

export default LiveTalkModal;
