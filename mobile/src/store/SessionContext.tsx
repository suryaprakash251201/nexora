import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Api } from "../api/client";
import type { User } from "../api/types";

const KEY_URL = "nexora.serverUrl";
const KEY_TOKEN = "nexora.token";
const KEY_USER = "nexora.user";

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
          AsyncStorage.getItem(KEY_TOKEN),
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
      AsyncStorage.multiRemove([KEY_TOKEN, KEY_USER]).catch(() => {});
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
    await AsyncStorage.multiSet([
      [KEY_TOKEN, tok],
      [KEY_USER, JSON.stringify(usr)],
    ]);
    setToken(tok);
    setUser(usr);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([KEY_TOKEN, KEY_USER]);
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
