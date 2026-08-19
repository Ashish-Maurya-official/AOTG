/**
 * AOTG - AI On The Go
 * @format
 */

import React from 'react';
import {StatusBar, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Provider} from 'react-redux';
import {store} from './src/store/store';
import {ThemeProvider} from './src/theme/ThemeProvider';
import HomePage from './src/screens/HomePage/HomePage';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <Provider store={store}>
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar
            barStyle={isDarkMode ? 'light-content' : 'dark-content'}
            backgroundColor="transparent"
            translucent
          />
          <HomePage />
        </SafeAreaProvider>
      </ThemeProvider>
    </Provider>
  );
}

export default App;
