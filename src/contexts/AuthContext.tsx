import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, QuotaInfo } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  quota: QuotaInfo | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string, confirmPassword?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateQuota: (quota: QuotaInfo) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('docconvert_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = useCallback(async () => {
    const savedToken = localStorage.getItem('docconvert_token');
    if (!savedToken) {
      setUser(null);
      setQuota(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.getMe();
      if (data.success && data.user) {
        setUser(data.user);
        setQuota(data.quota);
      } else {
        localStorage.removeItem('docconvert_token');
        setUser(null);
        setQuota(null);
        setToken(null);
      }
    } catch {
      localStorage.removeItem('docconvert_token');
      setUser(null);
      setQuota(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = async (email: string, password: string) => {
    const res = await api.login({ email, password });
    if (res.token && res.user) {
      localStorage.setItem('docconvert_token', res.token);
      setToken(res.token);
      setUser(res.user);
      setQuota(res.quota);
    }
  };

  const register = async (fullName: string, email: string, password: string, confirmPassword?: string) => {
    const res = await api.register({ fullName, email, password, confirmPassword });
    if (res.token && res.user) {
      localStorage.setItem('docconvert_token', res.token);
      setToken(res.token);
      setUser(res.user);
      setQuota(res.quota);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      localStorage.removeItem('docconvert_token');
      setToken(null);
      setUser(null);
      setQuota(null);
    }
  };

  const updateQuota = (newQuota: QuotaInfo) => {
    setQuota(newQuota);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        quota,
        token,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshProfile,
        updateQuota,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
