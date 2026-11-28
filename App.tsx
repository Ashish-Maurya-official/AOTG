/**
 * AOTG - AI On The Go
 * @format
 */

import React, {useState, useCallback, useEffect} from 'react';
import {Platform, StatusBar, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Provider} from 'react-redux';
import {store} from './src/store/store';
import {ThemeProvider} from './src/theme/ThemeProvider';
import HomePage from './src/screens/HomePage/HomePage';
import AgentPage from './src/screens/AgentPage/AgentPage';
import SettingsPage from './src/screens/SettingsPage/SettingsPage';
import {agentRuntime} from './src/agents/agentRuntime';

type Screen = 'home' | 'agent' | 'settings';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');

  useEffect(() => {
    if (Platform.OS === 'android') {
      agentRuntime.restore().catch(error => console.error('[AgentRuntime] Restore failed:', error));
    }
  }, []);

  const navigateToAgent = useCallback(() => {
    setCurrentScreen('agent');
  }, []);

  const navigateToSettings = useCallback(() => {
    setCurrentScreen('settings');
  }, []);

  const navigateToHome = useCallback(() => {
    setCurrentScreen('home');
  }, []);

  return (
    <Provider store={store}>
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar
            barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          />
          {currentScreen === 'home' ? (
            <HomePage
              onOpenAgent={navigateToAgent}
              onOpenSettings={navigateToSettings}
            />
          ) : currentScreen === 'agent' ? (
            <AgentPage onBack={navigateToHome} />
          ) : (
            <SettingsPage onBack={navigateToHome} />
          )}
        </SafeAreaProvider>
      </ThemeProvider>
    </Provider>
  );
}

export default App;
