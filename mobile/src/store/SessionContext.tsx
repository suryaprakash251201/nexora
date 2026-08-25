import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Api } from "../api/client";
import type { User } from "../api/types";

const KEY_URL = "nexora.serverUrl";
const KEY_TOKEN = "nexora.token";
const KEY_USER = "nexora.user";

// Token is sensitive — keep it in the platform keychain via expo-secure-store
// on native (Keychain on iOS, EncryptedSharedPreferences on Android), with
// AsyncStorage as a fallback for web. Other session data (server URL, cached
// user) stays in AsyncStorage.
const canUseSecureStore = Platform.OS !== "web";

async function getToken(): Promise<string | null> {
  if (canUseSecureStore) {
    try {
      const v = await SecureStore.getItemAsync(KEY_TOKEN);
      if (v) return v;
      // One-time migration: token may still be in AsyncStorage from older builds.
      const legacy = await AsyncStorage.getItem(KEY_TOKEN);
      if (legacy) {
        await SecureStore.setItemAsync(KEY_TOKEN, legacy);
        await AsyncStorage.removeItem(KEY_TOKEN);
        return legacy;
      }
      return null;
    } catch {
      // Fall through to AsyncStorage.
    }
  }
  return AsyncStorage.getItem(KEY_TOKEN);
}

async function setTokenSecure(tok: string): Promise<void> {
  if (canUseSecureStore) {
    try {
      await SecureStore.setItemAsync(KEY_TOKEN, tok);
      await AsyncStorage.removeItem(KEY_TOKEN);
      return;
    } catch {}
  }
  await AsyncStorage.setItem(KEY_TOKEN, tok);
}

async function removeTokenSecure(): Promise<void> {
  if (canUseSecureStore) {
    try {
      await SecureStore.deleteItemAsync(KEY_TOKEN);
    } catch {}
  }
  await AsyncStorage.removeItem(KEY_TOKEN);
}

interface SessionState {
  serverUrl: string | null;
  token: string | null;
  user: User | null;
  api: Api | null;
  booting: boolean;
  connect: (url: string) => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  // Restore persisted session on launch.
  useEffect(() => {
    (async () => {
      try {
        const [url, tok, usr] = await Promise.all([
          AsyncStorage.getItem(KEY_URL),
          getToken(),
          AsyncStorage.getItem(KEY_USER),
        ]);
        if (url) setServerUrl(url);
        if (tok) setToken(tok);
        if (usr) {
          try {
            setUser(JSON.parse(usr));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const api = useMemo(() => {
    if (!serverUrl) return null;
    const a = new Api(serverUrl, token);
    a.setUnauthorizedHandler(() => {
      // Token rejected by the server — sign out so the user can log back in.
      removeTokenSecure().catch(() => {});
      AsyncStorage.removeItem(KEY_USER).catch(() => {});
      setToken(null);
      setUser(null);
    });
    return a;
  }, [serverUrl, token]);

  const connect = useCallback(async (url: string) => {
    const clean = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(clean)) {
      throw new Error("Server URL must start with http:// or https://");
    }
    await AsyncStorage.setItem(KEY_URL, clean);
    setServerUrl(clean);
  }, []);

  const setSession = useCallback(async (tok: string, usr: User) => {
    await Promise.all([setTokenSecure(tok), AsyncStorage.setItem(KEY_USER, JSON.stringify(usr))]);
    setToken(tok);
    setUser(usr);
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([removeTokenSecure(), AsyncStorage.removeItem(KEY_USER)]);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ serverUrl, token, user, api, booting, connect, setSession, logout }),
    [serverUrl, token, user, api, booting, connect, setSession, logout]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
