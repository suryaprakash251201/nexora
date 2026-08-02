import React, { useState } from "react";
import {
  Alert,
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

export default function SettingsScreen() {
  const { serverUrl, user, api, connect, logout } = useSession();
  const [urlDraft, setUrlDraft] = useState(serverUrl || "");
  const [saving, setSaving] = useState(false);

  const saveUrl = async () => {
    if (!urlDraft.trim()) return;
    setSaving(true);
    try {
      await connect(urlDraft);
      Alert.alert("Server updated", "Reconnect if the new server requires different credentials.");
    } catch (e: any) {
      Alert.alert("Invalid URL", e?.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert("Sign out", "You will need to sign in again on this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.display_name || user?.username || "?").slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{user?.display_name || user?.username}</Text>
        <Text style={styles.sub}>
          {user?.role === "admin" ? "Administrator" : "User"} · {user?.email || "no email"}
        </Text>
      </View>

      <Text style={styles.section}>Server</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={urlDraft}
          onChangeText={setUrlDraft}
          placeholder="http://192.168.1.100:8080"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TouchableOpacity style={[styles.btn, !urlDraft.trim() && styles.btnDisabled]} disabled={!urlDraft.trim() || saving} onPress={saveUrl}>
          <Text style={styles.btnText}>{saving ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Connected to {api?.baseUrl}
        </Text>
      </View>

      <Text style={styles.section}>About</Text>
      <View style={styles.card}>
        <Row icon="cellphone" label="Nexora Mobile" value="v1.0.0" />
        <Row icon="shield-check" label="Auth" value="Bearer token (session)" />
      </View>

      <TouchableOpacity style={styles.logout} onPress={confirmLogout}>
        <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.muted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  profile: { alignItems: "center", paddingVertical: spacing.xl, gap: 4 },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  avatarText: { color: colors.accent, fontSize: 26, fontWeight: "700" },
  name: { color: colors.content, fontSize: font.lg, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: font.sm },
  section: {
    color: colors.muted, fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 6,
  },
  card: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg, gap: spacing.md,
  },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.content, fontSize: font.md,
  },
  btn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 12, alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: font.sm },
  hint: { color: colors.muted, fontSize: font.xs, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { color: colors.content, fontSize: font.sm, flex: 1 },
  rowValue: { color: colors.muted, fontSize: font.sm },
  logout: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.35)",
    borderRadius: radius.md, paddingVertical: 13,
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: font.sm },
});
