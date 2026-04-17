import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  createEmailPasswordSession,
  deleteCurrentSession,
  getCurrentAccount,
  isAppwriteConfigured,
} from './appwrite';

const AuthContext = createContext(null);

function mapAccountToUser(account) {
  return {
    id: account.$id,
    username: account.name || account.email?.split('@')?.[0] || 'User',
    email: account.email || '',
    user_id: account.$id,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const configured = isAppwriteConfigured();

  useEffect(() => {
    let active = true;

    const bootstrapSession = async () => {
      if (!configured) {
        if (!active) return;
        setAuthError(
          'Appwrite is not configured. Add VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID.',
        );
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        const account = await getCurrentAccount();
        if (!active) return;
        setUser(mapAccountToUser(account));
      } catch (error) {
        if (!active) return;

        if (error?.status !== 401) {
          setAuthError(error.message || 'Unable to initialize Appwrite session.');
        }

        setUser(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    bootstrapSession();

    return () => {
      active = false;
    };
  }, [configured]);

  const login = async (email, password) => {
    setAuthError('');
    await createEmailPasswordSession(email, password);
    const account = await getCurrentAccount();
    setUser(mapAccountToUser(account));
    return account;
  };

  const logout = async () => {
    setAuthError('');

    try {
      await deleteCurrentSession();
    } catch (error) {
      if (error?.status !== 401) {
        setAuthError(error.message || 'Unable to close the current Appwrite session.');
      }
    }

    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      isLoading,
      authError,
      isConfigured: configured,
    }),
    [user, isLoading, authError, configured],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
