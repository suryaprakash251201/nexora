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
import { LinearGradient } from "expo-linear-gradient";
import { useSession } from "../store/SessionContext";
import { colors, font, gradients, radius, spacing } from "../theme";
import { AppIcon } from "../components/AppIcon";

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

  const initials = (user?.display_name || user?.username || "?").slice(0, 1).toUpperCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 56 }}>
      <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.heroGrad} pointerEvents="none" />
      <View style={styles.profile}>
        <View style={styles.avatarWrap}>
          <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Text style={styles.avatarText}>{initials}</Text>
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
          selectionColor={colors.accent}
        />
        <TouchableOpacity
          style={[styles.btn, (!urlDraft.trim() || saving) && styles.btnDisabled]}
          disabled={!urlDraft.trim() || saving}
          onPress={saveUrl}
          activeOpacity={0.85}
        >
          <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <Text style={styles.btnText}>{saving ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.hint}>Connected to {api?.baseUrl}</Text>
        </View>
      </View>

      <Text style={styles.section}>About</Text>
      <View style={styles.card}>
        <Row icon="cellphone" label="Nexora Mobile" value="v1.1.0" />
        <View style={styles.divider} />
        <Row icon="shield-check" label="Auth" value="Bearer token (session)" />
      </View>

      <View style={styles.brandRow}>
        <AppIcon size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.brandName}>Nexora</Text>
          <Text style={styles.brandTag}>Self-hosted file workspace</Text>
        </View>
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
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon as any} size={17} color={colors.accent} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heroGrad: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  profile: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: 4 },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    overflow: "hidden",
  },
  avatarText: { color: "#fff", fontSize: 28, fontWeight: "800" },
  name: { color: colors.content, fontSize: font.xl, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: font.sm },
  section: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
  card: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
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
  btn: {
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: "center",
    overflow: "hidden",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: font.sm },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  hint: { color: colors.muted, fontSize: font.xs, flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { color: colors.content, fontSize: font.sm, flex: 1, fontWeight: "600" },
  rowValue: { color: colors.muted, fontSize: font.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandName: { color: colors.content, fontSize: font.md, fontWeight: "700" },
  brandTag: { color: colors.muted, fontSize: font.xs },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: font.sm },
});
