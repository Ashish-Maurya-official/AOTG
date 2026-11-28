import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Svg, { Path } from 'react-native-svg';
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
  LiveLanguage,
  LiveOutputRoute,
  LiveTalkSliceState,
  LiveTtsEnginePref,
  PhononVoiceOption,
  SpeechModelId,
  SpeechModelOption,
} from '../store/slices/liveTalkSlice';
import MicIcon from '../static/images/SVG/MicIcon';
import LiveIcon from '../static/images/SVG/LiveIcon';
import { CloseIcon, StopIcon } from './SharedIcons';
import AgentToolActivity from './AgentToolActivity';

interface LiveTalkModalProps {
  liveTalk: LiveTalkSliceState;
  modelName: string;
  micLevelSV: SharedValue<number>;
  speakerLevelSV: SharedValue<number>;
  availableRoutes?: string[];
  onClose: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onCommitTurn: () => void;
  onCycleRoute: () => void;
  onSelectRoute?: (route: LiveOutputRoute) => void;
  onRetry: () => void;
  onDownloadPhonon: (variant?: 'q4' | 'fp32') => void;
  onCancelPhononDownload: () => void;
  onDeletePhonon: () => void;
  onDownloadSpeechModel?: (modelId: SpeechModelId, voiceId?: string) => void;
  onCancelSpeechModelDownload?: (modelId: SpeechModelId) => void;
  onDeleteSpeechModel?: (modelId: SpeechModelId) => void;
  onSelectTtsEngine: (engine: LiveTtsEnginePref) => void;
  onSelectVoice: (voiceId: string, engine?: LiveTtsEnginePref) => void;
  onSelectLanguage?: (language: LiveLanguage) => void;
}

interface RouteOptionSpec {
  id: LiveOutputRoute;
  title: string;
  subtitle: string;
  aecTag: string;
}

const ROUTE_OPTIONS: RouteOptionSpec[] = [
  {
    id: 'auto',
    title: 'Auto Smart Route',
    subtitle: 'Dynamically selects best acoustic output path',
    aecTag: 'HW-AEC LOCK',
  },
  {
    id: 'speaker',
    title: 'Phone Speaker',
    subtitle: 'Hands-free loudspeaker with echo cancellation',
    aecTag: 'AEC ACTIVE',
  },
  {
    id: 'earpiece',
    title: 'Earpiece',
    subtitle: 'Discreet close-ear private call output',
    aecTag: 'AEC ACTIVE',
  },
  {
    id: 'wired',
    title: 'Wired Headset',
    subtitle: 'USB-C or 3.5mm headset microphone & audio',
    aecTag: 'DIRECT PATH',
  },
  {
    id: 'bluetooth',
    title: 'Bluetooth Audio',
    subtitle: 'SCO / BLE wireless buds & headset audio',
    aecTag: 'AEC SUPPORTED',
  },
];

const SpeakerGlyph = memo(({ color, size = 15 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
));

const CheckGlyph = memo(({ color, size = 12 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M5 13l4 4L19 7"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
));

const EndCallGlyph = memo(({ color, size = 18 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 9c-3.7 0-7.1 1.2-9.9 3.3-.6.5-.8 1.3-.4 2l1.6 2.8c.4.7 1.3.9 2 .4 1.3-.9 2.9-1.5 4.7-1.7V13c0-.5.4-1 1-1h2c.6 0 1 .5 1 1v2.8c1.8.2 3.4.8 4.7 1.7.7.5 1.6.3 2-.4l1.6-2.8c.4-.7.2-1.5-.4-2C19.1 10.2 15.7 9 12 9z"
      fill={color}
    />
  </Svg>
));

interface CaptionItemProps {
  turn: LiveCaptionTurn;
  userBgStyle: object;
  assistantBgStyle: object;
  textStyle: object;
  metaTextStyle: object;
  accentTextStyle: object;
}

const CaptionItem = memo(
  ({
    turn,
    userBgStyle,
    assistantBgStyle,
    textStyle,
    metaTextStyle,
    accentTextStyle,
  }: CaptionItemProps) => {
    const isUser = turn.role === 'user';
    return (
      <View
        style={[
          styles.captionBubble,
          isUser ? styles.captionBubbleUser : styles.captionBubbleAssistant,
          isUser ? userBgStyle : assistantBgStyle,
        ]}>
        <Text
          style={[
            styles.captionRoleLabel,
            isUser ? metaTextStyle : accentTextStyle,
          ]}>
          {isUser ? 'YOU' : turn.wasInterrupted ? 'ASSISTANT • INTERRUPTED' : 'ASSISTANT'}
        </Text>
        <Text style={[styles.captionText, textStyle]}>{turn.text}</Text>
      </View>
    );
  }
);

interface SpeakerCardProps {
  voice: PhononVoiceOption;
  selected: boolean;
  isTablet: boolean;
  cardStyle: object;
  selectedCardStyle: object;
  avatarStyle: object;
  selectedAvatarStyle: object;
  titleStyle: object;
  subStyle: object;
  accentStyle: object;
  onSelect: (voiceId: string) => void;
}

const SpeakerCard = memo(
  ({
    voice,
    selected,
    isTablet,
    cardStyle,
    selectedCardStyle,
    avatarStyle,
    selectedAvatarStyle,
    titleStyle,
    subStyle,
    accentStyle,
    onSelect,
  }: SpeakerCardProps) => {
    const handlePress = useCallback(() => {
      onSelect(voice.id);
    }, [onSelect, voice.id]);

    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Voice ${voice.label}, ${voice.description}`}
        style={[
          styles.speakerCard,
          isTablet ? styles.speakerCardTablet : null,
          cardStyle,
          selected ? selectedCardStyle : null,
        ]}>
        <View style={styles.speakerCardTop}>
          <View style={styles.speakerTitleGroup}>
            <View style={[styles.speakerAvatar, avatarStyle, selected ? selectedAvatarStyle : null]}>
              <Text style={[styles.speakerAvatarText, selected ? accentStyle : titleStyle]}>
                {voice.label.charAt(0)}
              </Text>
            </View>
            <Text style={[styles.speakerName, titleStyle]}>{voice.label}</Text>
          </View>
          {selected ? (
            <View style={styles.speakerCheckActive}>
              <CheckGlyph color="#002113" size={11} />
            </View>
          ) : (
            <View style={styles.speakerRadioIdle} />
          )}
        </View>
        <Text numberOfLines={1} style={[styles.speakerDesc, subStyle]}>
          {voice.description}
        </Text>
        <View style={styles.speakerFooter}>
          <Text style={[styles.speakerMeta, selected ? accentStyle : subStyle]}>
            {selected ? '● ACTIVE' : voice.downloaded ? 'LOCAL READY' : 'DOWNLOAD ON TAP'}
          </Text>
        </View>
      </Pressable>
    );
  }
);

interface AnimatedBarProps {
  percent: number;
  trackStyle: object;
  fillStyle: object;
}

const AnimatedProgressBar = memo(({ percent, trackStyle, fillStyle }: AnimatedBarProps) => {
  const barSV = useSharedValue(0);

  useEffect(() => {
    barSV.value = withTiming(Math.max(0, Math.min(100, percent || 0)), { duration: 150 });
  }, [barSV, percent]);

  const animStyle = useAnimatedStyle(() => ({
    width: `${Math.round(barSV.value)}%`,
  }), []);

  return (
    <View style={[styles.progressTrack, trackStyle]}>
      <Reanimated.View style={[styles.progressFill, fillStyle, animStyle]} />
    </View>
  );
});

interface SpeechModelRowProps {
  model: SpeechModelOption;
  isSelected: boolean;
  isActiveBackend: boolean;
  errorText: string | null;
  cardStyle: object;
  selectedCardStyle: object;
  pillStyle: object;
  titleStyle: object;
  subStyle: object;
  accentStyle: object;
  errorBtnStyle: object;
  errorTextStyle: object;
  retryBtnStyle: object;
  progressTrackStyle: object;
  progressFillStyle: object;
  onSelect: (modelId: SpeechModelId) => void;
  onDownload: (modelId: SpeechModelId, voiceId: string) => void;
  onCancel: (modelId: SpeechModelId) => void;
  onConfirmDelete: (modelId: SpeechModelId, label: string, bytes: number) => void;
}

const SpeechModelRow = memo(
  ({
    model,
    isSelected,
    isActiveBackend,
    errorText,
    cardStyle,
    selectedCardStyle,
    pillStyle,
    titleStyle,
    subStyle,
    accentStyle,
    errorBtnStyle,
    errorTextStyle,
    retryBtnStyle,
    progressTrackStyle,
    progressFillStyle,
    onSelect,
    onDownload,
    onCancel,
    onConfirmDelete,
  }: SpeechModelRowProps) => {
    const sizeBytes = model.installed && model.installedBytes > 0
      ? model.installedBytes
      : model.estimatedBytes;
    const sizeLabel = formatMegabytes(sizeBytes);
    const langTag =
      model.supportsHindi && model.supportsEnglish
        ? 'HI + EN'
        : model.supportsHindi
        ? 'HINDI'
        : 'ENGLISH';
    const srLabel = model.sampleRate === 22_050 ? '22 kHz' : `${Math.round(model.sampleRate / 1000)} kHz`;

    const handleUse = useCallback(() => {
      onSelect(model.id);
    }, [model.id, onSelect]);

    const handleDownload = useCallback(() => {
      onDownload(model.id, model.defaultVoiceId);
    }, [model.defaultVoiceId, model.id, onDownload]);

    const handleCancel = useCallback(() => {
      onCancel(model.id);
    }, [model.id, onCancel]);

    const handleDelete = useCallback(() => {
      onConfirmDelete(model.id, model.label, sizeBytes);
    }, [model.id, model.label, onConfirmDelete, sizeBytes]);

    return (
      <View
        style={[
          styles.studioTelemetryCard,
          cardStyle,
          isSelected || isActiveBackend ? selectedCardStyle : null,
        ]}>
        {model.downloading ? (
          <View style={styles.bannerDownloadCol}>
            <View style={styles.bannerTopRow}>
              <View style={styles.bannerLeftCol}>
                <Text numberOfLines={1} style={[styles.studioCardTitle, titleStyle]}>
                  {model.label}
                </Text>
                <Text style={[styles.bannerSubMono, subStyle]}>
                  Downloading · {model.percent}% · ~{sizeLabel} MB
                </Text>
              </View>
              <Pressable
                onPress={handleCancel}
                accessibilityRole="button"
                accessibilityLabel={`Cancel ${model.label} download`}
                style={[styles.studioOutlineBtn, errorBtnStyle]}>
                <Text style={[styles.studioOutlineBtnText, errorTextStyle]}>Cancel</Text>
              </Pressable>
            </View>
            <AnimatedProgressBar
              percent={model.percent}
              trackStyle={progressTrackStyle}
              fillStyle={progressFillStyle}
            />
          </View>
        ) : (
          <View style={styles.bannerTopRow}>
            <Pressable
              onPress={model.installed ? handleUse : undefined}
              disabled={!model.installed}
              style={styles.bannerLeftCol}>
              <View style={styles.bannerTitleRow}>
                {isSelected || isActiveBackend ? <View style={styles.dotEmerald} /> : null}
                <Text numberOfLines={1} style={[styles.studioCardTitle, titleStyle]}>
                  {model.label}
                </Text>
                <View style={[styles.modelLangPill, pillStyle]}>
                  <Text style={[styles.modelLangPillText, accentStyle]}>{langTag}</Text>
                </View>
              </View>
              <Text numberOfLines={2} style={[styles.bannerSub, subStyle]}>
                {errorText || `${model.subtitle} · ${srLabel} · ${sizeLabel} MB`}
              </Text>
            </Pressable>
            <View style={styles.bannerActions}>
              {model.installed ? (
                <>
                  <Pressable
                    onPress={handleUse}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.studioOutlineBtn, pillStyle]}>
                    <Text style={[styles.studioOutlineBtnText, isSelected ? accentStyle : titleStyle]}>
                      {isSelected ? 'Selected' : isActiveBackend ? 'Auto Active' : 'Use'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDelete}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${model.label}`}
                    style={[styles.studioOutlineBtn, pillStyle]}>
                    <Text style={[styles.studioOutlineBtnText, errorTextStyle]}>Remove</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={handleDownload}
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${model.label}`}
                  style={[styles.bannerCtaBtn, retryBtnStyle]}>
                  <Text style={styles.bannerCtaText}>{errorText ? 'Retry' : 'Download'}</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>
    );
  }
);

interface RouteOptionRowProps {
  item: RouteOptionSpec;
  selected: boolean;
  enabled: boolean;
  rowStyle: object;
  selectedRowStyle: object;
  titleStyle: object;
  subStyle: object;
  tagStyle: object;
  selectedTagStyle: object;
  accentStyle: object;
  onSelect: (route: LiveOutputRoute) => void;
}

const RouteOptionRow = memo(
  ({
    item,
    selected,
    enabled,
    rowStyle,
    selectedRowStyle,
    titleStyle,
    subStyle,
    tagStyle,
    selectedTagStyle,
    accentStyle,
    onSelect,
  }: RouteOptionRowProps) => {
    const handlePress = useCallback(() => {
      if (enabled) {
        onSelect(item.id);
      }
    }, [enabled, item.id, onSelect]);

    return (
      <Pressable
        onPress={handlePress}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !enabled }}
        style={[
          styles.routeRow,
          rowStyle,
          selected ? selectedRowStyle : null,
          !enabled ? styles.routeRowDisabled : null,
        ]}>
        <View style={styles.routeRowLeft}>
          <View style={[styles.radioOuter, selected ? styles.radioOuterActive : null]}>
            {selected ? <View style={styles.radioInner} /> : null}
          </View>
          <View style={styles.routeTextCol}>
            <View style={styles.routeTitleRow}>
              <Text style={[styles.routeTitle, titleStyle]}>{item.title}</Text>
              {item.id === 'auto' ? (
                <View style={styles.recommendedBadge}>
                  <Text style={[styles.recommendedBadgeText, accentStyle]}>RECOMMENDED</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.routeSubtitle, subStyle]}>
              {enabled ? item.subtitle : 'Not currently connected'}
            </Text>
          </View>
        </View>
        <View style={[styles.routeTagPill, tagStyle, selected ? selectedTagStyle : null]}>
          <Text style={[styles.routeTagText, selected ? accentStyle : subStyle]}>
            {enabled ? item.aecTag : 'OFFLINE'}
          </Text>
        </View>
      </Pressable>
    );
  }
);

function formatMegabytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0';
  return (bytes / (1024 * 1024)).toFixed(1);
}

function getRouteLabel(route: LiveOutputRoute, preferred: LiveOutputRoute): string {
  if (preferred === 'auto') {
    if (route === 'bluetooth') return 'Auto (BT)';
    if (route === 'wired') return 'Auto (Headset)';
    if (route === 'earpiece') return 'Auto (Ear)';
    return 'Speaker';
  }
  switch (route) {
    case 'bluetooth':
      return 'BT Audio';
    case 'wired':
      return 'Headset';
    case 'earpiece':
      return 'Earpiece';
    default:
      return 'Speaker';
  }
}

function getStateTitle(state: LiveTalkSliceState): string {
  if (state.isStarting) return 'Initializing Audio Pipeline...';
  if (state.isMuted) return 'Microphone Muted';
  switch (state.sessionState) {
    case 'LISTENING':
      return state.vadSpeechActive ? 'Listening to You...' : 'Listening';
    case 'THINKING':
      return 'Processing Thought...';
    case 'SPEAKING':
      return 'Speaking (Tap or Speak to Interrupt)';
    case 'INTERRUPTED':
      return 'Interrupted';
    default:
      return 'Ready for Voice';
  }
}

export const LiveTalkModal: React.FC<LiveTalkModalProps> = memo(
  ({
    liveTalk,
    modelName,
    micLevelSV,
    speakerLevelSV,
    availableRoutes = ['speaker', 'earpiece'],
    onClose,
    onToggleMute,
    onInterrupt,
    onCommitTurn,
    onCycleRoute,
    onSelectRoute,
    onRetry,
    onDownloadPhonon,
    onCancelPhononDownload,
    onDeletePhonon,
    onDownloadSpeechModel,
    onCancelSpeechModelDownload,
    onDeleteSpeechModel,
    onSelectTtsEngine,
    onSelectVoice,
    onSelectLanguage,
  }) => {
    const { mode, colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const isTablet = (width || Dimensions.get('window').width) >= 768;
    const isDark = mode === 'dark';

    const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const pulseSV = useSharedValue(1);

    const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
    const [isRouteSheetOpen, setIsRouteSheetOpen] = useState(false);
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);

    const isListening = liveTalk.sessionState === 'LISTENING';
    const isThinking = liveTalk.sessionState === 'THINKING';
    const isSpeaking = liveTalk.sessionState === 'SPEAKING';
    const isMuted = liveTalk.isMuted;

    useEffect(() => {
      if (!liveTalk.isVisible) {
        pulseSV.value = 1;
        setIsVoiceStudioOpen(false);
        setIsRouteSheetOpen(false);
        setIsBannerDismissed(false);
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
            withTiming(1.05, { duration: 1150, easing: Easing.inOut(Easing.ease) }),
            withTiming(1.0, { duration: 1150, easing: Easing.inOut(Easing.ease) })
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
        : Math.min(0.5, 0.16 + level * 0.36 + (isThinking ? 0.12 : 0));
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
      const orbSize = isTablet ? 176 : 142;
      const haloSize = isTablet ? 248 : 200;
      const innerOrbSize = isTablet ? 152 : 122;
      const contentMaxWidth = isTablet ? 640 : 480;
      const sheetMaxWidth = isTablet ? 580 : 480;

      const bgCanvas = isDark ? '#090A0F' : colors.background;
      const surfaceCard = isDark ? '#12131A' : colors.card;
      const surfaceSheet = isDark ? '#1A1D27' : colors.background;
      const surfaceElevated = isDark ? '#1E1F26' : '#FFFFFF';
      const borderSubtle = isDark ? '#262A38' : colors.border;
      const borderSheetGlow = isDark ? 'rgba(60, 221, 199, 0.28)' : colors.border;

      const orbBorderColor = isMuted
        ? colors.error
        : isSpeaking
        ? '#3CDDC7'
        : isThinking
        ? '#F59E0B'
        : '#10B981';

      const haloBgColor = isMuted
        ? 'rgba(255, 69, 58, 0.18)'
        : isSpeaking
        ? 'rgba(60, 221, 199, 0.28)'
        : isThinking
        ? 'rgba(245, 158, 11, 0.25)'
        : 'rgba(16, 185, 129, 0.24)';

      return StyleSheet.create({
        rootBackground: {
          backgroundColor: bgCanvas,
          paddingTop: Math.max(insets.top + 8, 18),
          paddingBottom: Math.max(insets.bottom + 12, 20),
        },
        contentShell: {
          maxWidth: contentMaxWidth,
        },
        sheetShell: {
          maxWidth: sheetMaxWidth,
          paddingBottom: Math.max(insets.bottom + 16, 22),
        },
        sheetContainer: {
          backgroundColor: surfaceSheet,
          borderColor: borderSheetGlow,
        },
        sheetScrim: {
          backgroundColor: isDark ? 'rgba(9, 10, 15, 0.78)' : 'rgba(15, 23, 42, 0.5)',
        },
        cardSurface: {
          backgroundColor: surfaceCard,
          borderColor: borderSubtle,
        },
        elevatedPill: {
          backgroundColor: isDark ? '#1A1B22' : colors.card,
          borderColor: borderSubtle,
        },
        userCaptionSurface: {
          backgroundColor: surfaceElevated,
          borderColor: borderSubtle,
        },
        assistantCaptionSurface: {
          backgroundColor: surfaceCard,
          borderLeftColor: isDark ? '#3CDDC7' : colors.primary,
          borderColor: borderSubtle,
        },
        primaryText: {
          color: isDark ? '#F8FAFC' : colors.text,
        },
        secondaryText: {
          color: isDark ? '#94A3B8' : colors.secondaryText,
        },
        accentEmeraldText: {
          color: isDark ? '#4EDEA3' : colors.primary,
        },
        accentTealText: {
          color: isDark ? '#3CDDC7' : colors.primary,
        },
        errorBox: {
          backgroundColor: isDark ? 'rgba(147, 0, 10, 0.28)' : colors.card,
          borderColor: colors.error,
        },
        errorText: {
          color: isDark ? '#FFB4AB' : colors.error,
        },
        orbHalo: {
          width: haloSize,
          height: haloSize,
          borderRadius: haloSize / 2,
          backgroundColor: haloBgColor,
        },
        orbCore: {
          width: orbSize,
          height: orbSize,
          borderRadius: orbSize / 2,
          backgroundColor: surfaceCard,
          borderColor: orbBorderColor,
        },
        orbInnerCore: {
          width: innerOrbSize,
          height: innerOrbSize,
          borderRadius: innerOrbSize / 2,
          backgroundColor: isDark ? '#0D0E15' : colors.background,
          borderColor: isDark ? 'rgba(60, 221, 199, 0.22)' : colors.border,
        },
        orbWrapperResponsive: {
          minHeight: isTablet ? 250 : 206,
        },
        muteBtnActive: {
          backgroundColor: 'rgba(255, 69, 58, 0.16)',
          borderColor: colors.error,
        },
        primaryTurnBtn: {
          backgroundColor: isSpeaking || isThinking
            ? 'rgba(16, 185, 129, 0.22)'
            : 'rgba(16, 185, 129, 0.14)',
          borderColor: '#10B981',
        },
        endBtnSurface: {
          backgroundColor: isDark ? 'rgba(147, 0, 10, 0.30)' : 'rgba(255, 59, 48, 0.10)',
          borderColor: isDark ? 'rgba(255, 180, 171, 0.30)' : 'rgba(255, 59, 48, 0.30)',
        },
        endBtnText: {
          color: isDark ? '#FFB4AB' : colors.error,
        },
        retryBtn: {
          backgroundColor: '#10B981',
        },
        progressTrackSurface: {
          backgroundColor: isDark ? '#242735' : colors.border,
        },
        progressFillSurface: {
          backgroundColor: '#10B981',
        },
        segmentTrack: {
          backgroundColor: bgCanvas,
          borderColor: borderSubtle,
        },
        segmentSelected: {
          backgroundColor: isDark ? '#242735' : '#FFFFFF',
          borderColor: isDark ? 'rgba(60, 221, 199, 0.45)' : colors.primary,
        },
        segmentUnselected: {
          backgroundColor: 'transparent',
          borderColor: 'transparent',
        },
        speakerCardBase: {
          backgroundColor: bgCanvas,
          borderColor: borderSubtle,
        },
        speakerCardSelected: {
          backgroundColor: isDark ? '#151B22' : colors.card,
          borderColor: '#10B981',
        },
        speakerAvatarBase: {
          backgroundColor: isDark ? '#242735' : colors.card,
        },
        speakerAvatarSelected: {
          backgroundColor: 'rgba(16, 185, 129, 0.18)',
        },
        routeRowBase: {
          backgroundColor: bgCanvas,
          borderColor: borderSubtle,
        },
        routeRowSelected: {
          backgroundColor: isDark ? '#242735' : colors.card,
          borderColor: isDark ? 'rgba(60, 221, 199, 0.48)' : colors.primary,
        },
      });
    }, [colors, insets.bottom, insets.top, isDark, isMuted, isSpeaking, isTablet, isThinking]);

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

    const handleOpenVoiceStudio = useCallback(() => {
      setIsVoiceStudioOpen(true);
    }, []);

    const handleCloseVoiceStudio = useCallback(() => {
      setIsVoiceStudioOpen(false);
    }, []);

    const handleOpenRouteSheet = useCallback(() => {
      if (onSelectRoute) {
        setIsRouteSheetOpen(true);
      } else {
        onCycleRoute();
      }
    }, [onCycleRoute, onSelectRoute]);

    const handleCloseRouteSheet = useCallback(() => {
      setIsRouteSheetOpen(false);
    }, []);

    const handleChooseRoute = useCallback(
      (route: LiveOutputRoute) => {
        onSelectRoute?.(route);
        setIsRouteSheetOpen(false);
      },
      [onSelectRoute]
    );

    const handleDismissBanner = useCallback(() => {
      setIsBannerDismissed(true);
    }, []);

    const handleSelectAutoEngine = useCallback(() => {
      onSelectTtsEngine('auto');
    }, [onSelectTtsEngine]);

    const handleSelectDeviceEngine = useCallback(() => {
      onSelectTtsEngine('android_tts');
    }, [onSelectTtsEngine]);

    const handleDownloadModelPress = useCallback(
      (modelId: SpeechModelId, voiceId: string) => {
        setIsBannerDismissed(false);
        if (onDownloadSpeechModel) {
          onDownloadSpeechModel(modelId, voiceId);
        } else if (modelId === 'phonon_31m') {
          onDownloadPhonon('q4');
        }
      },
      [onDownloadPhonon, onDownloadSpeechModel]
    );

    const handleCancelModelPress = useCallback(
      (modelId: SpeechModelId) => {
        if (onCancelSpeechModelDownload) {
          onCancelSpeechModelDownload(modelId);
        } else if (modelId === 'phonon_31m') {
          onCancelPhononDownload();
        }
      },
      [onCancelPhononDownload, onCancelSpeechModelDownload]
    );

    const handleDeleteModelConfirmed = useCallback(
      (modelId: SpeechModelId) => {
        if (onDeleteSpeechModel) {
          onDeleteSpeechModel(modelId);
        } else if (modelId === 'phonon_31m') {
          onDeletePhonon();
        }
      },
      [onDeletePhonon, onDeleteSpeechModel]
    );

    const handleConfirmDeleteModel = useCallback(
      (modelId: SpeechModelId, label: string, bytes: number) => {
        const mb = formatMegabytes(bytes);
        Alert.alert(
          `Remove ${label}?`,
          `This frees ~${mb} MB of on-device storage.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => handleDeleteModelConfirmed(modelId),
            },
          ]
        );
      },
      [handleDeleteModelConfirmed]
    );

    const handleSelectLangAuto = useCallback(() => {
      onSelectLanguage?.('auto');
    }, [onSelectLanguage]);

    const handleSelectLangEn = useCallback(() => {
      onSelectLanguage?.('en');
    }, [onSelectLanguage]);

    const handleSelectLangHi = useCallback(() => {
      onSelectLanguage?.('hi');
    }, [onSelectLanguage]);

    const handleCycleLanguage = useCallback(() => {
      if (!onSelectLanguage) return;
      const next: LiveLanguage =
        liveTalk.language === 'auto' ? 'en' : liveTalk.language === 'en' ? 'hi' : 'auto';
      onSelectLanguage(next);
    }, [liveTalk.language, onSelectLanguage]);

    const allSpeechCatalog = useMemo<SpeechModelOption[]>(() => {
      const phononEntry: SpeechModelOption = {
        id: 'phonon_31m',
        label: 'Phonon-31M Neural (EN)',
        subtitle: 'Ultra-low-latency 24 kHz CPU streaming · 8 personas',
        engineFamily: 'phonon',
        languages: ['en'],
        sampleRate: 24_000,
        estimatedBytes: liveTalk.phononExpectedBytes,
        installedBytes: liveTalk.phononDiskBytes,
        installed: liveTalk.phononInstalled,
        downloading: liveTalk.phononDownloading,
        percent: liveTalk.phononDownload.percent,
        supportsHindi: false,
        supportsEnglish: true,
        defaultVoiceId: 'easton',
        installedVoices: liveTalk.availableVoices.filter((v) => v.downloaded).map((v) => v.id),
        voices: liveTalk.availableVoices.map((v) => ({
          ...v,
          language: 'en',
        })),
      };
      return [...liveTalk.ttsModels, phononEntry];
    }, [
      liveTalk.availableVoices,
      liveTalk.phononDiskBytes,
      liveTalk.phononDownload.percent,
      liveTalk.phononDownloading,
      liveTalk.phononExpectedBytes,
      liveTalk.phononInstalled,
      liveTalk.ttsModels,
    ]);

    const installedNeuralCount = useMemo(
      () => allSpeechCatalog.filter((m) => m.installed).length,
      [allSpeechCatalog]
    );
    const activeDownloadingModel = useMemo(
      () => allSpeechCatalog.find((m) => m.downloading) || null,
      [allSpeechCatalog]
    );
    const activeBackendModel = useMemo(
      () => allSpeechCatalog.find((m) => m.id === liveTalk.ttsBackend) || null,
      [allSpeechCatalog, liveTalk.ttsBackend]
    );
    const inspectedModel = useMemo(() => {
      if (liveTalk.ttsEnginePref !== 'auto' && liveTalk.ttsEnginePref !== 'android_tts') {
        const pinned = allSpeechCatalog.find((m) => m.id === liveTalk.ttsEnginePref);
        if (pinned) return pinned;
      }
      if (activeBackendModel) return activeBackendModel;
      return allSpeechCatalog.find((m) => m.installed) || allSpeechCatalog[0];
    }, [activeBackendModel, allSpeechCatalog, liveTalk.ttsEnginePref]);

    const displayedVoices = useMemo<PhononVoiceOption[]>(() => {
      if (!inspectedModel) return liveTalk.availableVoices;
      return inspectedModel.voices.map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        downloaded: v.downloaded,
      }));
    }, [inspectedModel, liveTalk.availableVoices]);

    const handleCancelActiveBannerDownload = useCallback(() => {
      if (!activeDownloadingModel) return;
      handleCancelModelPress(activeDownloadingModel.id);
    }, [activeDownloadingModel, handleCancelModelPress]);

    const handleSelectSpeechEngine = useCallback(
      (modelId: SpeechModelId) => {
        onSelectTtsEngine(modelId);
      },
      [onSelectTtsEngine]
    );

    const handleSelectVoiceForInspectedModel = useCallback(
      (voiceId: string) => {
        onSelectVoice(voiceId, inspectedModel?.id);
      },
      [inspectedModel?.id, onSelectVoice]
    );

    const modeBadgeText = liveTalk.inputMode === 'audio_bytes' ? 'NATIVE AUDIO' : 'ON-DEVICE ASR';
    const routeText = getRouteLabel(liveTalk.activeRoute, liveTalk.preferredRoute);
    const statusTitle = getStateTitle(liveTalk);
    const isUsingNeural = liveTalk.ttsBackend !== 'android_tts' && activeBackendModel != null;
    const activeVoiceLabel = useMemo(() => {
      const targetVoices = activeBackendModel?.voices || displayedVoices;
      const found = targetVoices.find((v) => v.id === liveTalk.selectedVoiceId);
      return found ? found.label : targetVoices[0]?.label || 'Default';
    }, [activeBackendModel, displayedVoices, liveTalk.selectedVoiceId]);
    const voicePillLabel = activeDownloadingModel
      ? `DL ${activeDownloadingModel.percent}%`
      : isUsingNeural && activeBackendModel
      ? `${activeVoiceLabel} · ${activeBackendModel.label.split(' ')[0]}`
      : installedNeuralCount > 0
      ? 'Device TTS'
      : 'Speech Models';
    const downloadedMbLabel = formatMegabytes(
      activeDownloadingModel?.id === 'phonon_31m'
        ? liveTalk.phononDownload.downloadedBytes
        : activeDownloadingModel
        ? liveTalk.speechDownloads[activeDownloadingModel.id]?.downloadedBytes || 0
        : liveTalk.phononDownload.downloadedBytes
    );
    const totalDownloadMbLabel = formatMegabytes(
      activeDownloadingModel?.id === 'phonon_31m'
        ? liveTalk.phononDownload.totalBytes || liveTalk.phononExpectedBytes
        : activeDownloadingModel
        ? liveTalk.speechDownloads[activeDownloadingModel.id]?.totalBytes || activeDownloadingModel.estimatedBytes
        : liveTalk.phononExpectedBytes
    );
    const showQuickBanner =
      activeDownloadingModel != null ||
      installedNeuralCount === 0 ||
      !isBannerDismissed;
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
            {/* 1. Header Control Bar */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={[styles.brandPill, dynamicStyles.elevatedPill]}>
                  <Text style={[styles.brandPillText, dynamicStyles.accentEmeraldText]}>AOTG</Text>
                </View>
                <View style={[styles.modelPill, dynamicStyles.cardSurface]}>
                  <View style={styles.liveDot} />
                  <Text numberOfLines={1} style={[styles.modelPillName, dynamicStyles.primaryText]}>
                    {modelName}
                  </Text>
                  {isTablet ? (
                    <Text style={[styles.modelPillMode, dynamicStyles.accentEmeraldText]}>
                      {modeBadgeText}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.headerRight}>
                <Pressable
                  onPress={handleOpenVoiceStudio}
                  accessibilityRole="button"
                  accessibilityLabel="Open Voice and Neural Engine Studio"
                  style={[styles.headerActionPill, dynamicStyles.elevatedPill]}>
                  <View style={isUsingNeural ? styles.dotTeal : styles.dotAmber} />
                  <Text numberOfLines={1} style={[styles.headerPillText, dynamicStyles.primaryText]}>
                    {voicePillLabel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleOpenRouteSheet}
                  accessibilityRole="button"
                  accessibilityLabel="Open Audio Output Route Picker"
                  style={[styles.headerActionPill, dynamicStyles.elevatedPill]}>
                  <SpeakerGlyph color={isDark ? '#4EDEA3' : colors.primary} size={14} />
                  <Text numberOfLines={1} style={[styles.headerPillText, dynamicStyles.primaryText]}>
                    {routeText}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="End live voice session"
                  style={[styles.closeButton, dynamicStyles.cardSurface]}>
                  <CloseIcon size={16} color={isDark ? '#E3E1EC' : colors.text} />
                </Pressable>
              </View>
            </View>

            {/* 2. Center Hero Stage (Dual-Halo Voice Orb) */}
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
                    <View style={[styles.orbInnerCore, dynamicStyles.orbInnerCore]}>
                      {liveTalk.isStarting || isThinking ? (
                        <ActivityIndicator
                          size="large"
                          color={isThinking ? '#F59E0B' : '#10B981'}
                        />
                      ) : isSpeaking ? (
                        <LiveIcon
                          size={isTablet ? 52 : 44}
                          color={isDark ? '#3CDDC7' : colors.primary}
                          isAnimated={true}
                        />
                      ) : (
                        <MicIcon
                          size={isTablet ? 46 : 38}
                          color={isMuted ? colors.error : isDark ? '#4EDEA3' : colors.primary}
                        />
                      )}
                    </View>
                  </Reanimated.View>
                </Pressable>
              </View>

              <Text style={[styles.statusTitle, dynamicStyles.primaryText]}>{statusTitle}</Text>
              <Text style={[styles.statusTelemetry, dynamicStyles.secondaryText]}>
                {liveTalk.aecEnabled ? 'AEC ACTIVE' : 'VOICE CHANNEL'}
                {liveTalk.vadBackend === 'silero_onnx' ? ' · SILERO VAD V5' : ' · ADAPTIVE VAD'}
                {isUsingNeural && activeBackendModel
                  ? ` · ${activeBackendModel.label.split(' ')[0].toUpperCase()} (${activeVoiceLabel.toUpperCase()})`
                  : ' · DEVICE TTS'}
              </Text>
              {onSelectLanguage ? (
                <Pressable
                  onPress={handleCycleLanguage}
                  accessibilityRole="button"
                  accessibilityLabel="Switch conversation language between Auto, English, and Hindi"
                  style={[styles.langQuickPill, dynamicStyles.elevatedPill]}>
                  <Text style={[styles.langQuickPillText, dynamicStyles.accentTealText]}>
                    {liveTalk.language === 'hi'
                      ? 'LANG: हिन्दी (HI)'
                      : liveTalk.language === 'en'
                      ? 'LANG: ENGLISH'
                      : 'LANG: AUTO'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* 3. Compact Quick Voice Banner */}
            {showQuickBanner ? (
              <View style={[styles.voiceBanner, dynamicStyles.cardSurface]}>
                {activeDownloadingModel ? (
                  <View style={styles.bannerDownloadCol}>
                    <View style={styles.bannerTopRow}>
                      <View style={styles.bannerLeftMeta}>
                        <View style={styles.dotTeal} />
                        <Text numberOfLines={1} style={[styles.bannerTitle, dynamicStyles.primaryText]}>
                          Downloading {activeDownloadingModel.label} ({activeDownloadingModel.percent}%)
                        </Text>
                      </View>
                      <View style={styles.bannerActions}>
                        <Pressable
                          onPress={handleOpenVoiceStudio}
                          accessibilityRole="button"
                          style={[styles.bannerSmallBtn, dynamicStyles.elevatedPill]}>
                          <Text style={[styles.bannerSmallBtnText, dynamicStyles.accentTealText]}>
                            Details
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={handleCancelActiveBannerDownload}
                          accessibilityRole="button"
                          style={[styles.bannerSmallBtn, dynamicStyles.elevatedPill]}>
                          <Text style={[styles.bannerSmallBtnText, dynamicStyles.errorText]}>
                            Cancel
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    <Text style={[styles.bannerSubMono, dynamicStyles.secondaryText]}>
                      {downloadedMbLabel} / {totalDownloadMbLabel} MB
                    </Text>
                    <AnimatedProgressBar
                      percent={activeDownloadingModel.percent}
                      trackStyle={dynamicStyles.progressTrackSurface}
                      fillStyle={dynamicStyles.progressFillSurface}
                    />
                  </View>
                ) : installedNeuralCount === 0 ? (
                  <View style={styles.bannerTopRow}>
                    <Pressable onPress={handleOpenVoiceStudio} style={styles.bannerLeftCol}>
                      <View style={styles.bannerTitleRow}>
                        <View style={styles.dotEmerald} />
                        <Text style={[styles.bannerTitle, dynamicStyles.primaryText]}>
                          Offline Neural Voices (Hindi & English)
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={[styles.bannerSub, dynamicStyles.secondaryText]}>
                        Download MMS-TTS Hindi, Indic-Tiny, Piper, Kokoro, or Phonon-31M
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleOpenVoiceStudio}
                      accessibilityRole="button"
                      accessibilityLabel="Choose and download speech model"
                      style={[styles.bannerCtaBtn, dynamicStyles.retryBtn]}>
                      <Text style={styles.bannerCtaText}>Models</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.bannerTopRow}>
                    <Pressable onPress={handleOpenVoiceStudio} style={styles.bannerLeftMeta}>
                      <View style={styles.dotEmerald} />
                      <Text numberOfLines={1} style={[styles.bannerTitle, dynamicStyles.primaryText]}>
                        {isUsingNeural && activeBackendModel
                          ? `${activeBackendModel.label} · ${activeVoiceLabel}`
                          : 'Device TTS Active · Neural Models Ready'}
                      </Text>
                    </Pressable>
                    <View style={styles.bannerActions}>
                      <Pressable
                        onPress={handleOpenVoiceStudio}
                        accessibilityRole="button"
                        style={[styles.bannerSmallBtn, dynamicStyles.elevatedPill]}>
                        <Text style={[styles.bannerSmallBtnText, dynamicStyles.accentTealText]}>
                          Models
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleDismissBanner}
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss voice status banner"
                        style={styles.bannerDismissBtn}>
                        <CloseIcon size={13} color={isDark ? '#94A3B8' : colors.secondaryText} />
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ) : null}

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

            {/* 4. Streaming Conversation Captions */}
            <AgentToolActivity mode="live" />
            <ScrollView
              ref={scrollRef}
              style={styles.captionScroll}
              contentContainerStyle={styles.captionScrollContent}
              onContentSizeChange={handleCaptionContentSizeChange}
              showsVerticalScrollIndicator={false}>
              {!hasStreamingCaptions ? (
                <Text style={[styles.emptyCaptionHint, dynamicStyles.secondaryText]}>
                  Speak naturally at any time. Your speech and the assistant stream live here with instant interruption support.
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
                  accentTextStyle={dynamicStyles.accentTealText}
                />
              ))}

              {liveTalk.userTranscript ? (
                <View
                  style={[
                    styles.captionBubble,
                    styles.captionBubbleUser,
                    dynamicStyles.userCaptionSurface,
                  ]}>
                  <Text style={[styles.captionRoleLabel, dynamicStyles.secondaryText]}>YOU</Text>
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
                  <View style={styles.assistantLabelRow}>
                    <Text style={[styles.captionRoleLabel, dynamicStyles.accentTealText]}>
                      ASSISTANT
                    </Text>
                    <View style={styles.dotTeal} />
                  </View>
                  <Text style={[styles.captionText, dynamicStyles.primaryText]}>
                    {liveTalk.assistantTranscript}
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {/* 5. Bottom Thumb-Zone Control Dock */}
            <View style={styles.controlsRow}>
              <Pressable
                onPress={onToggleMute}
                accessibilityRole="button"
                accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                style={[
                  styles.controlBtn,
                  dynamicStyles.cardSurface,
                  isMuted ? dynamicStyles.muteBtnActive : null,
                ]}>
                <MicIcon size={18} color={isMuted ? '#FFFFFF' : isDark ? '#94A3B8' : colors.text} />
                <Text
                  style={[
                    styles.controlBtnText,
                    isMuted ? styles.whiteLabel : dynamicStyles.primaryText,
                  ]}>
                  {isMuted ? 'Muted' : 'Mute'}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleOrbPress}
                disabled={liveTalk.isStarting}
                accessibilityRole="button"
                accessibilityLabel={isSpeaking || isThinking ? 'Interrupt reply' : 'Finish speaking turn'}
                style={[
                  styles.controlBtnPrimary,
                  dynamicStyles.primaryTurnBtn,
                  liveTalk.isStarting ? styles.controlBtnDisabled : null,
                ]}>
                {isSpeaking || isThinking ? (
                  <StopIcon size={14} radius={3} color={isDark ? '#4EDEA3' : colors.primary} />
                ) : (
                  <CheckGlyph color={isDark ? '#4EDEA3' : colors.primary} size={15} />
                )}
                <Text style={[styles.controlBtnTextStrong, dynamicStyles.accentEmeraldText]}>
                  {isSpeaking || isThinking ? 'Interrupt' : 'Finish Turn'}
                </Text>
              </Pressable>

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close live voice talk"
                style={[styles.controlBtn, dynamicStyles.endBtnSurface]}>
                <EndCallGlyph color={isDark ? '#FFB4AB' : colors.error} size={17} />
                <Text style={[styles.controlBtnText, dynamicStyles.endBtnText]}>End</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Sub-Modal 1: Voice & Neural Engine Studio Sheet */}
        <Modal
          visible={liveTalk.isVisible && isVoiceStudioOpen}
          animationType="slide"
          transparent={true}
          onRequestClose={handleCloseVoiceStudio}>
          <View style={[styles.sheetOverlay, dynamicStyles.sheetScrim]}>
            <Pressable style={styles.sheetScrimSpacer} onPress={handleCloseVoiceStudio} />
            <View style={[styles.sheetPanel, dynamicStyles.sheetContainer, dynamicStyles.sheetShell]}>
              <View style={styles.sheetHandleWrap}>
                <View style={styles.sheetHandle} />
              </View>

              <View style={styles.sheetHeader}>
                <View style={styles.sheetHeaderLeft}>
                  <View style={styles.sheetTitleRow}>
                    <View style={styles.dotTeal} />
                    <Text style={[styles.sheetTitle, dynamicStyles.primaryText]}>
                      Voice & Neural Engine
                    </Text>
                  </View>
                  <Text style={[styles.sheetSubtitle, dynamicStyles.secondaryText]}>
                    ON-DEVICE MULTILINGUAL SPEECH STUDIO
                  </Text>
                </View>

                <View style={styles.sheetHeaderRight}>
                  <View style={[styles.storageBadge, dynamicStyles.elevatedPill]}>
                    <Text style={[styles.storageBadgeText, dynamicStyles.accentTealText]}>
                      {installedNeuralCount}/{allSpeechCatalog.length} READY
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleCloseVoiceStudio}
                    accessibilityRole="button"
                    accessibilityLabel="Close Voice Studio"
                    style={[styles.sheetCloseBtn, dynamicStyles.cardSurface]}>
                    <CloseIcon size={14} color={isDark ? '#E3E1EC' : colors.text} />
                  </Pressable>
                </View>
              </View>

              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                showsVerticalScrollIndicator={false}>
                {onSelectLanguage ? (
                  <>
                    <Text style={[styles.personaSectionTitle, dynamicStyles.secondaryText]}>
                      CONVERSATION LANGUAGE
                    </Text>
                    <View style={[styles.engineSegmentTrack, dynamicStyles.segmentTrack]}>
                      <Pressable
                        onPress={handleSelectLangAuto}
                        accessibilityRole="button"
                        accessibilityLabel="Auto detect language"
                        style={[
                          styles.engineSegmentBtn,
                          liveTalk.language === 'auto'
                            ? dynamicStyles.segmentSelected
                            : dynamicStyles.segmentUnselected,
                        ]}>
                        <Text
                          style={[
                            styles.engineSegmentText,
                            liveTalk.language === 'auto'
                              ? dynamicStyles.primaryText
                              : dynamicStyles.secondaryText,
                          ]}>
                          Auto
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleSelectLangEn}
                        accessibilityRole="button"
                        accessibilityLabel="Select English"
                        style={[
                          styles.engineSegmentBtn,
                          liveTalk.language === 'en'
                            ? dynamicStyles.segmentSelected
                            : dynamicStyles.segmentUnselected,
                        ]}>
                        <Text
                          style={[
                            styles.engineSegmentText,
                            liveTalk.language === 'en'
                              ? dynamicStyles.primaryText
                              : dynamicStyles.secondaryText,
                          ]}>
                          English
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleSelectLangHi}
                        accessibilityRole="button"
                        accessibilityLabel="Select Hindi"
                        style={[
                          styles.engineSegmentBtn,
                          liveTalk.language === 'hi'
                            ? dynamicStyles.segmentSelected
                            : dynamicStyles.segmentUnselected,
                        ]}>
                        <Text
                          style={[
                            styles.engineSegmentText,
                            liveTalk.language === 'hi'
                              ? dynamicStyles.primaryText
                              : dynamicStyles.secondaryText,
                          ]}>
                          हिन्दी (Hindi)
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}

                {/* Routing Mode Strip */}
                <Text style={[styles.personaSectionTitle, dynamicStyles.secondaryText]}>
                  SPEECH ROUTING MODE
                </Text>
                <View style={[styles.engineSegmentTrack, dynamicStyles.segmentTrack]}>
                  <Pressable
                    onPress={handleSelectAutoEngine}
                    accessibilityRole="button"
                    accessibilityLabel="Select Auto Smart Bilingual Speech Routing"
                    style={[
                      styles.engineSegmentBtn,
                      liveTalk.ttsEnginePref !== 'android_tts'
                        ? dynamicStyles.segmentSelected
                        : dynamicStyles.segmentUnselected,
                    ]}>
                    <Text
                      style={[
                        styles.engineSegmentText,
                        liveTalk.ttsEnginePref !== 'android_tts'
                          ? dynamicStyles.primaryText
                          : dynamicStyles.secondaryText,
                      ]}>
                      {liveTalk.ttsEnginePref === 'auto'
                        ? 'Auto Bilingual'
                        : inspectedModel?.label.split(' ')[0] || 'Neural Active'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSelectDeviceEngine}
                    accessibilityRole="button"
                    accessibilityLabel="Select Android Device TTS"
                    style={[
                      styles.engineSegmentBtn,
                      liveTalk.ttsEnginePref === 'android_tts'
                        ? dynamicStyles.segmentSelected
                        : dynamicStyles.segmentUnselected,
                    ]}>
                    <Text
                      style={[
                        styles.engineSegmentText,
                        liveTalk.ttsEnginePref === 'android_tts'
                          ? dynamicStyles.primaryText
                          : dynamicStyles.secondaryText,
                      ]}>
                      Android Device TTS
                    </Text>
                  </Pressable>
                </View>

                {/* Downloadable & Selectable Neural Speech Models */}
                <View style={styles.personaSectionHeader}>
                  <Text style={[styles.personaSectionTitle, dynamicStyles.secondaryText]}>
                    NEURAL SPEECH MODELS (DOWNLOAD & SELECT)
                  </Text>
                  <View style={[styles.presetCountBadge, dynamicStyles.elevatedPill]}>
                    <Text style={[styles.presetCountText, dynamicStyles.secondaryText]}>
                      {allSpeechCatalog.length} MODELS
                    </Text>
                  </View>
                </View>

                {allSpeechCatalog.map((model) => {
                  const errMsg =
                    model.id === 'phonon_31m'
                      ? liveTalk.phononDownload.status === 'error'
                        ? liveTalk.phononDownload.error
                        : null
                      : liveTalk.speechDownloads[model.id]?.status === 'error'
                      ? liveTalk.speechDownloads[model.id]?.error || null
                      : null;
                  return (
                    <SpeechModelRow
                      key={model.id}
                      model={model}
                      isSelected={liveTalk.ttsEnginePref === model.id}
                      isActiveBackend={
                        liveTalk.ttsEnginePref === 'auto' && liveTalk.ttsBackend === model.id
                      }
                      errorText={errMsg}
                      cardStyle={dynamicStyles.cardSurface}
                      selectedCardStyle={dynamicStyles.speakerCardSelected}
                      pillStyle={dynamicStyles.elevatedPill}
                      titleStyle={dynamicStyles.primaryText}
                      subStyle={dynamicStyles.secondaryText}
                      accentStyle={dynamicStyles.accentEmeraldText}
                      errorBtnStyle={dynamicStyles.errorBox}
                      errorTextStyle={dynamicStyles.errorText}
                      retryBtnStyle={dynamicStyles.retryBtn}
                      progressTrackStyle={dynamicStyles.progressTrackSurface}
                      progressFillStyle={dynamicStyles.progressFillSurface}
                      onSelect={handleSelectSpeechEngine}
                      onDownload={handleDownloadModelPress}
                      onCancel={handleCancelModelPress}
                      onConfirmDelete={handleConfirmDeleteModel}
                    />
                  );
                })}

                {/* 2-Column Speaker Persona Grid */}
                <View style={styles.personaSectionHeader}>
                  <Text style={[styles.personaSectionTitle, dynamicStyles.secondaryText]}>
                    {inspectedModel
                      ? `VOICES · ${inspectedModel.label.toUpperCase()}`
                      : 'ACTIVE ACOUSTIC PERSONA'}
                  </Text>
                  <View style={[styles.presetCountBadge, dynamicStyles.elevatedPill]}>
                    <Text style={[styles.presetCountText, dynamicStyles.secondaryText]}>
                      {displayedVoices.length} PRESETS
                    </Text>
                  </View>
                </View>

                <View style={styles.speakerGrid}>
                  {displayedVoices.map((voice) => (
                    <SpeakerCard
                      key={`${inspectedModel?.id || 'default'}_${voice.id}`}
                      voice={voice}
                      selected={liveTalk.selectedVoiceId === voice.id}
                      isTablet={isTablet}
                      cardStyle={dynamicStyles.speakerCardBase}
                      selectedCardStyle={dynamicStyles.speakerCardSelected}
                      avatarStyle={dynamicStyles.speakerAvatarBase}
                      selectedAvatarStyle={dynamicStyles.speakerAvatarSelected}
                      titleStyle={dynamicStyles.primaryText}
                      subStyle={dynamicStyles.secondaryText}
                      accentStyle={dynamicStyles.accentEmeraldText}
                      onSelect={handleSelectVoiceForInspectedModel}
                    />
                  ))}
                </View>
              </ScrollView>

              <View style={styles.sheetFooter}>
                <Pressable
                  onPress={handleCloseVoiceStudio}
                  accessibilityRole="button"
                  style={[styles.sheetPrimaryCta, dynamicStyles.retryBtn]}>
                  <Text style={styles.sheetPrimaryCtaText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Sub-Modal 2: Audio Output Route Picker Sheet */}
        <Modal
          visible={liveTalk.isVisible && isRouteSheetOpen}
          animationType="slide"
          transparent={true}
          onRequestClose={handleCloseRouteSheet}>
          <View style={[styles.sheetOverlay, dynamicStyles.sheetScrim]}>
            <Pressable style={styles.sheetScrimSpacer} onPress={handleCloseRouteSheet} />
            <View style={[styles.sheetPanel, dynamicStyles.sheetContainer, dynamicStyles.sheetShell]}>
              <View style={styles.sheetHandleWrap}>
                <View style={styles.sheetHandle} />
              </View>

              <View style={styles.sheetHeader}>
                <View style={styles.sheetHeaderLeft}>
                  <View style={styles.sheetTitleRow}>
                    <SpeakerGlyph color={isDark ? '#3CDDC7' : colors.primary} size={17} />
                    <Text style={[styles.sheetTitle, dynamicStyles.primaryText]}>
                      Audio Output Route
                    </Text>
                  </View>
                  <Text style={[styles.sheetSubtitle, dynamicStyles.secondaryText]}>
                    HARDWARE ACOUSTIC ECHO CANCELLATION
                  </Text>
                </View>
                <Pressable
                  onPress={handleCloseRouteSheet}
                  accessibilityRole="button"
                  accessibilityLabel="Close Audio Route Picker"
                  style={[styles.sheetCloseBtn, dynamicStyles.cardSurface]}>
                  <CloseIcon size={14} color={isDark ? '#E3E1EC' : colors.text} />
                </Pressable>
              </View>

              <View style={[styles.aecBanner, dynamicStyles.cardSurface]}>
                <View style={styles.bannerLeftMeta}>
                  <View style={styles.dotEmerald} />
                  <Text style={[styles.aecBannerText, dynamicStyles.primaryText]}>
                    {liveTalk.aecEnabled ? 'Hardware AEC + Silero VAD Locked' : 'VoiceCommunication Stream Active'}
                  </Text>
                </View>
                <View style={[styles.storageBadge, dynamicStyles.elevatedPill]}>
                  <Text style={[styles.storageBadgeText, dynamicStyles.accentTealText]}>
                    LOW DRIFT
                  </Text>
                </View>
              </View>

              <View style={styles.routeList}>
                {ROUTE_OPTIONS.map((item) => {
                  const isAvailable =
                    item.id === 'auto' ||
                    item.id === 'speaker' ||
                    item.id === 'earpiece' ||
                    availableRoutes.includes(item.id);
                  const isSelected = liveTalk.preferredRoute === item.id;
                  return (
                    <RouteOptionRow
                      key={item.id}
                      item={item}
                      selected={isSelected}
                      enabled={isAvailable}
                      rowStyle={dynamicStyles.routeRowBase}
                      selectedRowStyle={dynamicStyles.routeRowSelected}
                      titleStyle={dynamicStyles.primaryText}
                      subStyle={dynamicStyles.secondaryText}
                      tagStyle={dynamicStyles.elevatedPill}
                      selectedTagStyle={dynamicStyles.segmentSelected}
                      accentStyle={dynamicStyles.accentTealText}
                      onSelect={handleChooseRoute}
                    />
                  );
                })}
              </View>

              <View style={styles.sheetFooter}>
                <Pressable
                  onPress={handleCloseRouteSheet}
                  accessibilityRole="button"
                  style={[styles.sheetSecondaryCta, dynamicStyles.elevatedPill]}>
                  <Text style={[styles.sheetSecondaryCtaText, dynamicStyles.primaryText]}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
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
    marginBottom: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  brandPill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  brandPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  modelPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  modelPillName: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  modelPillMode: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  headerActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 124,
  },
  headerPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotEmerald: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  dotTeal: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#3CDDC7',
  },
  dotAmber: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#F59E0B',
  },
  orbSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  orbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  haloRing: {
    position: 'absolute',
  },
  orbCore: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    elevation: 10,
  },
  orbInnerCore: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  statusTelemetry: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: 0.8,
  },
  langQuickPill: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  langQuickPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  voiceBanner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
  },
  bannerDownloadCol: {
    gap: 6,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bannerLeftCol: {
    flex: 1,
  },
  bannerLeftMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bannerTitle: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  bannerSub: {
    fontSize: 11,
    marginTop: 2,
  },
  bannerSubMono: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerCtaBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  bannerCtaText: {
    color: '#002113',
    fontSize: 11,
    fontWeight: '700',
  },
  bannerSmallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  bannerSmallBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  bannerDismissBtn: {
    padding: 4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  retryButtonText: {
    color: '#002113',
    fontSize: 11,
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
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
  },
  captionBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  captionBubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    borderWidth: 1,
  },
  captionBubbleAssistant: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderLeftWidth: 2.5,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  assistantLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  captionRoleLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 3,
    letterSpacing: 0.7,
  },
  captionText: {
    fontSize: 14,
    lineHeight: 21,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 10,
  },
  controlBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  controlBtnPrimary: {
    flex: 1.35,
    minHeight: 50,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  controlBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  controlBtnTextStrong: {
    fontSize: 13,
    fontWeight: '700',
  },
  controlBtnDisabled: {
    opacity: 0.45,
  },
  whiteLabel: {
    color: '#FFFFFF',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetScrimSpacer: {
    flex: 1,
    width: '100%',
  },
  sheetPanel: {
    width: '100%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '86%',
    overflow: 'hidden',
    elevation: 20,
  },
  sheetHandleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(60, 221, 199, 0.42)',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 8,
  },
  sheetHeaderLeft: {
    flex: 1,
  },
  sheetHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.7,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  storageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  storageBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sheetScroll: {
    maxHeight: 490,
  },
  sheetScrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 12,
  },
  engineSegmentTrack: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  engineSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  engineSegmentText: {
    fontSize: 12,
    fontWeight: '600',
  },
  studioTelemetryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
  },
  studioCardTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  studioOutlineBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  studioOutlineBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  personaSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  personaSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  presetCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  modelLangPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  modelLangPillText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  presetCountText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  speakerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  speakerCard: {
    width: '48.2%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
  },
  speakerCardTablet: {
    width: '48.8%',
  },
  speakerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  speakerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  speakerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speakerAvatarText: {
    fontSize: 11,
    fontWeight: '700',
  },
  speakerName: {
    fontSize: 13,
    fontWeight: '600',
  },
  speakerCheckActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speakerRadioIdle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#4B5563',
  },
  speakerDesc: {
    fontSize: 11,
  },
  speakerFooter: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.14)',
  },
  speakerMeta: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  aecBanner: {
    marginHorizontal: 18,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  aecBannerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  routeList: {
    paddingHorizontal: 18,
    gap: 8,
    paddingBottom: 10,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
  },
  routeRowDisabled: {
    opacity: 0.45,
  },
  routeRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#64748B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterActive: {
    borderColor: '#3CDDC7',
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#3CDDC7',
  },
  routeTextCol: {
    flex: 1,
  },
  routeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  routeTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  routeSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  recommendedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  recommendedBadgeText: {
    color: '#4EDEA3',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  routeTagPill: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  routeTagText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sheetFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetPrimaryCta: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryCtaText: {
    color: '#002113',
    fontSize: 13,
    fontWeight: '700',
  },
  sheetSecondaryCta: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSecondaryCtaText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default LiveTalkModal;
