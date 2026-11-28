import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/ThemeProvider';
import NativeAgentTools from '../../native/turbo_modules/AgentTools/NativeAgentTools';

const SEARCH_KEY = '@aotg/plugin/web/searchEndpoint';
export const getSearchEndpoint = () => AsyncStorage.getItem(SEARCH_KEY);

export function validateSearchEndpoint(value: string): string {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new Error('Use a public HTTPS SearXNG search endpoint without credentials or query parameters.');
  }
  return url.toString();
}

const WebSettings = memo(() => {
  const { colors } = useTheme();
  const [endpoint, setEndpoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceStatus, setSourceStatus] = useState('');
  const textStyle = useMemo(() => [styles.text, { color: colors.secondaryText }], [colors.secondaryText]);
  const inputStyle = useMemo(() => [styles.input, { color: colors.text, borderColor: colors.border }], [colors.text, colors.border]);
  const buttonStyle = useMemo(() => [styles.button, { backgroundColor: colors.primary }], [colors.primary]);
  useEffect(() => {
    let active = true;
    getSearchEndpoint().then(value => { if (active) setEndpoint(value || ''); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const value = validateSearchEndpoint(endpoint);
      await AsyncStorage.setItem(SEARCH_KEY, value);
      setEndpoint(value);
      Alert.alert('Search settings saved', value ? 'Search queries will be sent to this server. Its availability and usage limits apply.' : 'Direct website reading remains available. Search is disabled.');
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Invalid endpoint');
    } finally { setSaving(false); }
  }, [endpoint]);
  const refreshStatus = useCallback(async () => {
    try { setSourceStatus(await NativeAgentTools?.sourceStatus() || 'Unavailable'); }
    catch { setSourceStatus('Could not read save status'); }
  }, []);
  const queueSource = useCallback(async () => {
    try {
      if (!NativeAgentTools) return;
      setSourceStatus(await NativeAgentTools.saveSource(sourceUrl.trim()));
      setSourceUrl('');
    } catch { setSourceStatus('Could not queue. Check the HTTPS URL and any pending save.'); }
  }, [sourceUrl]);
  const clear = useCallback(async () => {
    try { await NativeAgentTools?.clearSources(); setSourceStatus('Saved sources cleared'); }
    catch { setSourceStatus('Could not clear saved sources'); }
  }, []);
  const confirmClear = useCallback(() => Alert.alert('Clear saved sources?', 'This deletes all saved passages and cancels any queued save.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: clear },
  ]), [clear]);
  return <View style={styles.container}>
    <Text style={textStyle}>Optional SearXNG search endpoint. Leave empty for direct website reading only. Use an instance you operate or have permission to use; public instances can block automated requests.</Text>
    <TextInput accessibilityLabel="SearXNG search endpoint" value={endpoint} onChangeText={setEndpoint}
      placeholder="https://your-instance.example/search" placeholderTextColor={colors.secondaryText}
      autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={1800} style={inputStyle} />
    <Pressable accessibilityRole="button" onPress={save} disabled={saving} style={buttonStyle}>
      <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save search endpoint'}</Text>
    </Pressable>
    <Text style={textStyle}>Save a public page for later questions. Android fetches it when connected. Your phone keeps up to 32 sources.</Text>
    <TextInput accessibilityLabel="Website to save" value={sourceUrl} onChangeText={setSourceUrl}
      placeholder="https://example.org/article" autoCapitalize="none" autoCorrect={false}
      keyboardType="url" maxLength={2048} style={inputStyle} />
    <Pressable accessibilityRole="button" disabled={!sourceUrl.trim()} onPress={queueSource} style={buttonStyle}>
      <Text style={styles.buttonText}>Save page in background</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={refreshStatus}><Text style={textStyle}>Check save status</Text></Pressable>
    {sourceStatus ? <Text accessibilityLiveRegion="polite" style={textStyle}>{sourceStatus}</Text> : null}
    <Pressable accessibilityRole="button" onPress={confirmClear}><Text style={textStyle}>Clear saved sources</Text></Pressable>
  </View>;
});

const styles = StyleSheet.create({
  container: { gap: 10 }, text: { fontSize: 13, lineHeight: 19 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  button: { padding: 12, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
});
export default WebSettings;
