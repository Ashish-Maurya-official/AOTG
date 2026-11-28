import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { areToolsAvailable, getToolsEnabled, initializeTools, setToolsEnabled } from '../agentCore/toolRuntime';
import type { AgentPlugin } from '../agentCore/types';
import { useTheme } from '../theme/ThemeProvider';

const AgentToolSettings = memo(() => {
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const containerStyle = useMemo(() => [styles.container, { backgroundColor: colors.card, borderColor: colors.border }], [colors.card, colors.border]);
  const titleStyle = useMemo(() => [styles.title, { color: colors.text }], [colors.text]);
  const descriptionStyle = useMemo(() => [styles.description, { color: colors.secondaryText }], [colors.secondaryText]);
  useEffect(() => {
    let active = true;
    Promise.all([getToolsEnabled(), initializeTools()]).then(([value, registry]) => {
      if (active) { setEnabled(value); setPlugins(registry.getPlugins()); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const toggle = useCallback(async (value: boolean) => {
    setSaving(true);
    try {
      await setToolsEnabled(value);
      setEnabled(value);
      if (value) Alert.alert('Online tools enabled', 'Reload the model to enable tools in chat. A new LiveTalk session also applies this setting. A model with function-calling support is required. Website requests and search queries leave your device.');
    } catch { Alert.alert('Could not save', 'Please try again.'); }
    finally { setSaving(false); }
  }, []);
  const renderPlugin = useCallback((plugin: AgentPlugin) => plugin.Settings ? <plugin.Settings key={plugin.id} /> : null, []);
  if (!areToolsAvailable || !plugins.length) return null;
  return <View style={containerStyle}>
    <View style={styles.row}>
      <Text style={titleStyle}>Online tools in chat and LiveTalk</Text>
      <Switch accessibilityLabel="Enable online agent tools" value={enabled} onValueChange={toggle} disabled={saving} />
    </View>
    <Text style={descriptionStyle}>Let a compatible local model retrieve current information. Sources run on your phone with bounded requests. Disabling stops pending tools immediately.</Text>
    {plugins.map(renderPlugin)}
  </View>;
});

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14, marginTop: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' }, description: { fontSize: 13, lineHeight: 19 },
});
export default AgentToolSettings;
