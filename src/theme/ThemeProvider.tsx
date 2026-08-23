import React, {
  createContext,
  useContext,
  useMemo,
  ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { useSelector } from 'react-redux';

import lightTheme from './lightTheme';
import darkTheme from './darkTheme';
import { RootState } from '../store/store';

export type ThemeType = typeof lightTheme;

export const ThemeContext = createContext<ThemeType>(lightTheme);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const systemTheme = useColorScheme();
  const themeMode = useSelector(
    (state: RootState) => state.theme.themeMode
  );

  const theme = useMemo(() => {
    switch (themeMode) {
      case 'light':
        return lightTheme;

      case 'dark':
        return darkTheme;

      case 'system':
      default:
        return systemTheme === 'dark' ? darkTheme : lightTheme;
    }
  }, [themeMode, systemTheme]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
