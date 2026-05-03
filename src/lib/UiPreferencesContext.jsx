import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const UiPreferencesContext = createContext(null);

const TEXT_SIZE_STORAGE_KEY = 'bened.ui.text-size.v1';
const TEXT_SIZE_OPTIONS = new Set(['default', 'large']);

function canUseStorage() {
  return typeof window !== 'undefined' && window.localStorage;
}

function readStoredTextSize() {
  if (!canUseStorage()) return 'default';

  try {
    const value = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    return TEXT_SIZE_OPTIONS.has(value) ? value : 'default';
  } catch {
    return 'default';
  }
}

export function UiPreferencesProvider({ children }) {
  const [textSize, setTextSize] = useState(() => readStoredTextSize());

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    document.body.dataset.textSize = textSize;

    if (canUseStorage()) {
      try {
        window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, textSize);
      } catch {
        // Ignore storage write failures.
      }
    }

    return () => {
      delete document.body.dataset.textSize;
    };
  }, [textSize]);

  const value = useMemo(() => ({
    textSize,
    isLargeText: textSize === 'large',
    setTextSize: (nextTextSize) => {
      if (TEXT_SIZE_OPTIONS.has(nextTextSize)) {
        setTextSize(nextTextSize);
      }
    },
    toggleTextSize: () => {
      setTextSize((current) => (current === 'large' ? 'default' : 'large'));
    },
  }), [textSize]);

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences() {
  return useContext(UiPreferencesContext);
}
