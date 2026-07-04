import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';

/**
 * DESIGN-2: light/dark theme foundation.
 *
 * - 'system' (the default) follows the OS preference via matchMedia, mirroring
 *   ardrive_ui's onPlatformBrightnessChanged.
 * - An explicit 'light' | 'dark' override can be set by the user and is
 *   persisted via the config IPC (config:set-theme / AppConfig.theme).
 * - Dark is the default resolved theme (matches ardrive_ui's themes.dart
 *   default) — used whenever matchMedia is unavailable and before the
 *   persisted preference has loaded.
 *
 * Components never need to read this context directly: they consume colors
 * via the CSS custom properties in styles/theme.css, which key off the
 * `data-theme` attribute this provider sets on <html>.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** The theme actually applied to the document right now. */
  theme: ResolvedTheme;
  /** The user's stored preference — 'system' means "follow the OS". */
  preference: ThemePreference;
  /** Update the preference and persist it. */
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true; // dark is the default when we can't detect OS preference
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(getSystemPrefersDark);

  // Track OS preference changes live.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  // Load any persisted manual override once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await window.electronAPI?.config?.get?.();
        const stored = config?.theme;
        if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setPreferenceState(stored);
        }
      } catch (error) {
        console.error('[ThemeProvider] Failed to load persisted theme preference:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const theme = resolveTheme(preference, systemPrefersDark);

  // useLayoutEffect: flip the attribute before paint to avoid a flash when
  // switching themes (the initial dark default is already baked into
  // styles/theme.css's bare `:root` selector, so first paint never flashes).
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    window.electronAPI?.config?.setTheme?.(next)?.catch((error: unknown) => {
      console.error('[ThemeProvider] Failed to persist theme preference:', error);
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
