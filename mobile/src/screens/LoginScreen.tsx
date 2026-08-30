import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Linking } from "react-native";
import { parseServerDeepLink } from "../lib/saveToDevice";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { AppIcon } from "../components/AppIcon";
import Constants from "expo-constants";

type Stage = "server" | "login" | "totp";

export default function LoginScreen({ onDone }: { onDone: () => void }) {
  const { connect, setSession, api } = useSession();
  const { colors, font, gradients, radius, spacing, shadow } = useTheme();
  const [stage, setStage] = useState<Stage>("server");
  const [serverUrl, setServerUrl] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const orbAnim = useRef(new Animated.Value(0.4)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  // Deep links — `nexora://connect?url=<encoded server url>` prefills the
  // server field (e.g. a QR code shown by the desktop/web app). Handled both
  // for cold starts (getInitialURL) and while the app is open (addEventListener).
  useEffect(() => {
    if (stage !== "server" || busy) return;
    const apply = (url: string | null) => {
      const target = parseServerDeepLink(url);
      if (!target) return;
      setServerUrl(target);
      setError(null);
    };
    Linking.getInitialURL().then(apply).catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => apply(url));
    return () => sub.remove();
  }, [stage, busy]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(orbAnim, {
          toValue: 0.8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(orbAnim, {
          toValue: 0.4,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [orbAnim]);

  const canContinue = useMemo(() => {
    if (stage === "server") return /^https?:\/\/.+\..+/.test(serverUrl.trim());
    if (stage === "login") return login.trim().length > 0 && password.length > 0;
    return code.trim().length >= 6;
  }, [stage, serverUrl, login, password, code]);

  const handleServer = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = serverUrl.trim().replace(/\/+$/, "");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let probe: Response;
      try {
        probe = await fetch(`${url}/api/v1/auth/needs-setup`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      let configured = false;
      try {
        const d = await probe.json();
        configured = d.configured === true;
      } catch {
        configured = probe.ok;
      }
      if (!configured) {
        setError(`Server is not configured yet — complete initial setup in the web UI first (${url}).`);
        return;
      }
      await connect(url);
      setStage("login");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setError(`Timed out reaching ${serverUrl.trim()}. Check the URL and that Nexora is running.`);
      } else {
        setError(`Cannot reach the server at ${serverUrl.trim()}. Check the URL and that Nexora is running.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(login.trim(), password);
      if (res.totp_required) {
        setStage("totp");
        return;
      }
      if (res.token && res.user) {
        await setSession(res.token, res.user);
        onDone();
      } else {
        setError("Unexpected server response.");
      }
    } catch (e: any) {
      setError(e?.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleTotp = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyTotp(login.trim(), password, code.trim());
      await setSession(res.token, res.user);
      onDone();
    } catch (e: any) {
      setError(e?.message || "Invalid code.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (stage === "server") await handleServer();
    else if (stage === "login") await handleLogin();
    else await handleTotp();
  };

  const inputStyle = (key: string) => [
    styles.input,
    {
      backgroundColor: focused === key ? colors.surface : colors.surfaceMuted,
      borderColor: focused === key ? colors.accent : colors.border,
      // Subtle ring when focused — fakes a 3-4px focus shadow.
      ...(focused === key
        ? Platform.select({
            ios: {
              shadowColor: colors.accent,
              shadowOpacity: 0.25,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
            },
            android: { elevation: 2 },
            default: {},
          })
        : {}),
      color: colors.content,
      fontSize: font.md,
      borderRadius: radius.md,
    },
  ];

  const renderStageIndicator = () => {
    const isLogin = stage === "login";
    const isTotp = stage === "totp";
    return (
      <View style={styles.stageIndicator}>
        <View style={[styles.dot, stage === "server" ? { width: 24, height: 6, backgroundColor: colors.accent } : { width: 6, height: 6, backgroundColor: colors.accent }]} />
        <View style={[styles.dot, isLogin ? { width: 24, height: 6, backgroundColor: colors.accent } : isTotp ? { width: 6, height: 6, backgroundColor: colors.accent } : { width: 6, height: 6, backgroundColor: colors.border }]} />
        <View style={[styles.dot, isTotp ? { width: 24, height: 6, backgroundColor: colors.accent } : { width: 6, height: 6, backgroundColor: colors.border }]} />
      </View>
    );
  };

  const handlePressIn = () => {
    Animated.spring(btnScale, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(btnScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  return (
    <KeyboardAvoidingView style={[styles.container2, { backgroundColor: colors.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.iconContainer}>
            <Animated.View style={[styles.orb, { opacity: orbAnim }]}>
              <LinearGradient colors={[...gradients.brand]} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <AppIcon size={88} />
          </View>
          <Text style={[styles.brandTitle, { color: colors.content, fontSize: font.xxl }]}>Nexora</Text>
          <Text style={[styles.brandSub, { color: colors.muted, fontSize: font.sm }]}>Self-hosted file workspace</Text>
          <Text style={[styles.version, { color: colors.muted, fontSize: font.xs }]}>v{Constants.expoConfig?.version || "1.0.0"}</Text>
        </View>

        <View style={[styles.card, shadow, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft, borderRadius: radius.xl }]}>
          <LinearGradient
            colors={["rgba(255,255,255,0.06)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.glassHighlight}
          />
          {renderStageIndicator()}

          {stage === "server" && (
            <>
              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="earth" size={16} color={colors.muted} />
                <Text style={[styles.label, { color: colors.muted, fontSize: font.sm }]}>Server address</Text>
              </View>
              <TextInput
                style={inputStyle("server")}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="http://192.168.1.100:8080"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onFocus={() => setFocused("server")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={submit}
                selectionColor={colors.accent}
              />
              <Text style={[styles.hint, { color: colors.muted, fontSize: font.xs }]}>
                The Nexora server you want to connect to.
              </Text>
              <View style={styles.chips}>
                {["http://192.168.1.5", "http://192.168.1.100:8080", "https://files.example.com"].map((h) => (
                  <View key={h} style={[styles.chipWrapper, { borderRadius: radius.pill }]}>
                    <LinearGradient colors={[colors.border, colors.border]} style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />
                    <TouchableOpacity onPress={() => setServerUrl(h)} style={[styles.chip, { backgroundColor: colors.card, borderRadius: radius.pill }]}>
                      <MaterialCommunityIcons name="history" size={13} color={colors.muted} />
                      <Text style={[styles.chipText, { color: colors.muted, fontSize: font.xs }]}>{h}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}

          {stage === "login" && (
            <>
              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="account" size={16} color={colors.muted} />
                <Text style={[styles.label, { color: colors.muted, fontSize: font.sm }]}>Username</Text>
              </View>
              <TextInput
                style={inputStyle("login")}
                value={login}
                onChangeText={setLogin}
                placeholder="username"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocused("login")}
                onBlur={() => setFocused(null)}
                selectionColor={colors.accent}
              />

              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="lock" size={16} color={colors.muted} />
                <Text style={[styles.label, { color: colors.muted, fontSize: font.sm }]}>Password</Text>
              </View>
              <TextInput
                style={inputStyle("password")}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.muted}
                secureTextEntry
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={submit}
                selectionColor={colors.accent}
              />
            </>
          )}

          {stage === "totp" && (
            <>
              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="shield" size={16} color={colors.muted} />
                <Text style={[styles.label, { color: colors.muted, fontSize: font.sm }]}>Two-factor code</Text>
              </View>
              <TextInput
                style={[inputStyle("code"), styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={8}
                onFocus={() => setFocused("code")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={submit}
                selectionColor={colors.accent}
              />
              <Text style={[styles.hint, { color: colors.muted, fontSize: font.xs }]}>
                Enter the 6-digit code from your authenticator app.
              </Text>
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <MaterialCommunityIcons name="alert-circle" size={16} color={colors.danger} />
              <Text style={[styles.error, { color: colors.danger, fontSize: font.sm }]}>{error}</Text>
            </View>
          ) : null}

          <Animated.View style={{ transform: [{ scale: btnScale }], marginTop: 4 }}>
            <TouchableOpacity
              style={[styles.button, { borderRadius: radius.md }, (!canContinue || busy) && styles.buttonDisabled]}
              disabled={!canContinue || busy}
              onPress={submit}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.85}
            >
              <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.buttonContent}>
                  <MaterialCommunityIcons
                    name={stage === "server" ? "arrow-right" : stage === "login" ? "login" : "check-circle"}
                    size={20}
                    color="#fff"
                  />
                  <Text style={[styles.buttonText, { fontSize: font.md }]}>
                    {stage === "server" ? "Continue" : stage === "login" ? "Sign in" : "Verify"}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {stage !== "server" && (
            <TouchableOpacity onPress={() => { setStage("server"); setError(null); }} style={styles.backLink}>
              <Text style={[styles.backText, { color: colors.muted, fontSize: font.sm }]}>← Change server</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={[styles.footerText, { color: colors.muted }]}>Powered by Nexora · Open Source</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 28 },
  container2: { flex: 1 },
  brand: { alignItems: "center", gap: 8 },
  brandTitle: { fontWeight: "800", letterSpacing: 0.3 },
  brandSub: {},
  iconContainer: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  orb: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
  },
  version: { marginTop: -4 },
  card: {
    padding: 24,
    gap: 16,
    overflow: "hidden",
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    pointerEvents: "none",
  },
  stageIndicator: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  dot: {
    borderRadius: 4,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: -4,
  },
  label: { fontWeight: "600" },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    letterSpacing: 0.1,
  },
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: "center", fontWeight: "600" },
  hint: { lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipWrapper: {
    padding: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {},
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(244, 63, 94, 0.10)",
    borderRadius: 12,
    padding: 12,
  },
  error: { flex: 1, lineHeight: 18, fontWeight: "500" },
  button: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700" },
  backLink: { alignItems: "center", paddingVertical: 4 },
  backText: {},
  footerText: {
    textAlign: "center",
    fontSize: 10,
    marginTop: 20,
    opacity: 0.7,
  },
});
