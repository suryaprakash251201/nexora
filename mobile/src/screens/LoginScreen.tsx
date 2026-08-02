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
import { useSession } from "../store/SessionContext";
import { colors, font, radius, spacing } from "../theme";

type Stage = "server" | "login" | "totp";

const DEFAULT_HOSTS = [
  "http://localhost:8080",
  "http://192.168.1.100:8080",
];

export default function LoginScreen({ onDone }: { onDone: () => void }) {
  const { connect, setSession, api } = useSession();
  const [stage, setStage] = useState<Stage>("server");
  const [serverUrl, setServerUrl] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="database" size={34} color={colors.accent} />
          </View>
          <Text style={styles.title}>Nexora</Text>
          <Text style={styles.subtitle}>Self-hosted file workspace</Text>
        </View>

        <View style={styles.card}>
          {stage === "server" && (
            <>
              <Text style={styles.label}>Server address</Text>
              <TextInput
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="http://192.168.1.100:8080"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={submit}
              />
              <Text style={styles.hint}>The Nexora server you want to connect to.</Text>
              {DEFAULT_HOSTS.map((h) => (
                <TouchableOpacity key={h} onPress={() => setServerUrl(h)} style={styles.chipRow}>
                  <MaterialCommunityIcons name="history" size={14} color={colors.muted} />
                  <Text style={styles.chipText}>{h}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {stage === "login" && (
            <>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                value={login}
                onChangeText={setLogin}
                placeholder="username"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.muted}
                secureTextEntry
                onSubmitEditing={submit}
              />
            </>
          )}

          {stage === "totp" && (
            <>
              <Text style={styles.label}>Two-factor code</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={8}
                onSubmitEditing={submit}
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
          >
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
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 24 },
  brand: { alignItems: "center", gap: 6 },
  logo: {
    width: 68, height: 68, borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  title: { color: colors.content, fontSize: font.xl, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: font.sm },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.content, fontSize: font.md,
  },
  hint: { color: colors.muted, fontSize: font.xs, lineHeight: 16 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  chipText: { color: colors.muted, fontSize: font.sm, textDecorationLine: "underline" },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  error: { color: colors.danger, fontSize: font.sm, flex: 1, lineHeight: 18 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: font.md, fontWeight: "700" },
  backLink: { alignItems: "center", paddingVertical: 4 },
  backText: { color: colors.muted, fontSize: font.sm },
});
