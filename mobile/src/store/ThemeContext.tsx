import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  darkColors, 
  lightColors, 
  gradients as darkGradients, 
  lightGradients,
  spacing,
  radius,
  font,
  shadow,
  shadowSm
} from '../theme';

type ThemeType = 'dark' | 'light';

interface ThemeContextType {
  theme: ThemeType;
  colors: typeof darkColors;
  gradients: typeof darkGradients;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: ThemeType) => void;
  spacing: typeof spacing;
  radius: typeof radius;
  font: typeof font;
  shadow: typeof shadow;
  shadowSm: typeof shadowSm;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeType>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await AsyncStorage.getItem('nexora.theme');
        if (storedTheme === 'light' || storedTheme === 'dark') {
          setThemeState(storedTheme);
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  const setTheme = async (newTheme: ThemeType) => {
    setThemeState(newTheme);
    try {
      await AsyncStorage.setItem('nexora.theme', newTheme);
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const isDark = theme === 'dark';
  const currentColors = isDark ? darkColors : lightColors;
  const currentGradients = isDark ? darkGradients : lightGradients;

  const value = {
    theme,
    colors: currentColors,
    gradients: currentGradients,
    isDark,
    toggleTheme,
    setTheme,
    spacing,
    radius,
    font,
    shadow,
    shadowSm
  };

  if (!isLoaded) {
    return null; // Or a loading spinner if preferred, but usually keep it minimal for theme
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
