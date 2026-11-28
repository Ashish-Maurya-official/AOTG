import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { subscribeToolActivity } from '../agentCore/toolRuntime';
import type { EvidenceSource, ToolActivity } from '../agentCore/types';
import { useTheme } from '../theme/ThemeProvider';

const SourceLink = memo(({ source }: { source: EvidenceSource }) => {
  const { colors } = useTheme();
  const style = useMemo(() => [styles.link, { color: colors.primary }], [colors.primary]);
  const open = useCallback(() => {
    if (/^https:\/\//i.test(source.url)) Linking.openURL(source.url).catch(() => {});
  }, [source.url]);
  return <Pressable accessibilityRole="link" onPress={open}><Text style={style} numberOfLines={2}>{source.title || source.url}</Text></Pressable>;
});

const ACTIVITY_LABELS: Record<ToolActivity['state'], string> = {
  idle: '', running: 'Checking sources…', complete: 'Source retrieved',
  partial: 'Some source content retrieved', cancelled: 'Source request stopped', failed: 'Source could not be verified',
};

const AgentToolActivity = memo(({ mode }: { mode: 'chat' | 'live' }) => {
  const { colors } = useTheme();
  const [activity, setActivity] = useState<ToolActivity>();
  const style = useMemo(() => [styles.text, { color: colors.secondaryText }], [colors.secondaryText]);
  useEffect(() => subscribeToolActivity(setActivity), []);
  const renderSource = useCallback((source: EvidenceSource) => <SourceLink key={source.id} source={source} />, []);
  if (!activity || activity.mode !== mode || activity.state === 'idle') return null;
  return <View style={styles.container} accessibilityLiveRegion="polite">
    <Text style={style}>{ACTIVITY_LABELS[activity.state]}</Text>
    {activity.sources.map(renderSource)}
  </View>;
});
const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 6, gap: 4 },
  text: { fontSize: 12 }, link: { fontSize: 12, textDecorationLine: 'underline' },
});
export default AgentToolActivity;
