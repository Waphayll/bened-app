import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);
const STORAGE_KEY = 'bened_user';

function readStoredUser() {
  try {
    const persistentUser = localStorage.getItem(STORAGE_KEY);
    if (persistentUser) return JSON.parse(persistentUser);

    const sessionUser = sessionStorage.getItem(STORAGE_KEY);
    return sessionUser ? JSON.parse(sessionUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  const login = (userData, { remember = false } = {}) => {
    const activeStorage = remember ? localStorage : sessionStorage;
    const inactiveStorage = remember ? sessionStorage : localStorage;

    inactiveStorage.removeItem(STORAGE_KEY);
    activeStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
