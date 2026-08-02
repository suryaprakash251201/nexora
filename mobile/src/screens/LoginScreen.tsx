import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useSession } from "../store/SessionContext";
import { colors, font, gradients, radius, spacing } from "../theme";
import { AppIcon } from "../components/AppIcon";

type Stage = "server" | "login" | "totp";

export default function LoginScreen({ onDone }: { onDone: () => void }) {
  const { connect, setSession, api } = useSession();
  const [stage, setStage] = useState<Stage>("server");
  const [serverUrl, setServerUrl] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

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
      const probe = await fetch(`${url}/api/v1/auth/needs-setup`);
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
    } catch (e) {
      setError(`Cannot reach the server at ${serverUrl.trim()}. Check the URL and that Nexora is running.`);
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

  const inputStyle = (key: string) => [styles.input, focused === key && styles.inputFocused];

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <AppIcon size={76} />
          <Text style={styles.title}>Nexora</Text>
          <Text style={styles.subtitle}>Self-hosted file workspace</Text>
        </View>

        <View style={styles.card}>
          {stage === "server" && (
            <>
              <Text style={styles.label}>Server address</Text>
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
              <Text style={styles.hint}>The Nexora server you want to connect to.</Text>
              <View style={styles.chips}>
                {["http://192.168.1.5", "http://192.168.1.100:8080"].map((h) => (
                  <TouchableOpacity key={h} onPress={() => setServerUrl(h)} style={styles.chip}>
                    <MaterialCommunityIcons name="history" size={13} color={colors.muted} />
                    <Text style={styles.chipText}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {stage === "login" && (
            <>
              <Text style={styles.label}>Username</Text>
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
              <Text style={styles.label}>Password</Text>
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
              <Text style={styles.label}>Two-factor code</Text>
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
              <Text style={styles.hint}>Enter the 6-digit code from your authenticator app.</Text>
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <MaterialCommunityIcons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.button, (!canContinue || busy) && styles.buttonDisabled]}
            disabled={!canContinue || busy}
            onPress={submit}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {stage === "server" ? "Continue" : stage === "login" ? "Sign in" : "Verify"}
              </Text>
            )}
          </TouchableOpacity>

          {stage !== "server" && (
            <TouchableOpacity onPress={() => { setStage("server"); setError(null); }} style={styles.backLink}>
              <Text style={styles.backText}>← Change server</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 28 },
  brand: { alignItems: "center", gap: 8 },
  title: { color: colors.content, fontSize: font.xxl, fontWeight: "800", letterSpacing: 0.3 },
  subtitle: { color: colors.muted, fontSize: font.sm },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.content,
    fontSize: font.md,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.surface },
  codeInput: { fontSize: 20, letterSpacing: 8, textAlign: "center" },
  hint: { color: colors.muted, fontSize: font.xs, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { color: colors.muted, fontSize: font.xs },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  error: { color: colors.danger, fontSize: font.sm, flex: 1, lineHeight: 18 },
  button: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
    overflow: "hidden",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: font.md, fontWeight: "700" },
  backLink: { alignItems: "center", paddingVertical: 4 },
  backText: { color: colors.muted, fontSize: font.sm },
});
