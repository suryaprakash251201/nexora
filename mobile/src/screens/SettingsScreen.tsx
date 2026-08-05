import React, { useState, useEffect, useRef } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { AppIcon } from "../components/AppIcon";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";

type SettingsNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Settings">,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function SettingsScreen() {
  const { serverUrl, user, api, connect, logout } = useSession();
  const { colors, font, gradients, radius, spacing, shadow, shadowSm, isDark, setTheme } = useTheme();
  const navigation = useNavigation<SettingsNav>();

  const [urlDraft, setUrlDraft] = useState(serverUrl || "");
  const [saving, setSaving] = useState(false);

  // Real storage usage (admin-only endpoint). Hidden for non-admins.
  const [storageUsed, setStorageUsed] = useState<number>(0);
  const [storageLoaded, setStorageLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    if (user?.role === "admin" && api) {
      api
        .listAdminUsage()
        .then((u) => {
          if (alive) {
            setStorageUsed(u.used);
            setStorageLoaded(true);
          }
        })
        .catch(() => {
          if (alive) setStorageLoaded(true);
        });
    }
    return () => {
      alive = false;
    };
  }, [api, user?.role]);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setTheme(nextDark ? "dark" : "light");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

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
    <ScrollView style={[styles.root, { backgroundColor: colors.bg }]} contentContainerStyle={{ paddingBottom: 130 }}>
      <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.heroGrad} pointerEvents="none" />

      {/* User Profile Header */}
      <View style={styles.profile}>
        <View style={[styles.avatarRing, { borderColor: colors.accent }]}>
          <View style={styles.avatarWrap}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>
        <Text style={[styles.name, { color: colors.content, fontSize: font.xl }]}>{user?.display_name || user?.username}</Text>
        <Text style={[styles.email, { color: colors.muted, fontSize: font.sm }]}>{user?.email || "no email attached"}</Text>

        <View style={[styles.badge, { backgroundColor: user?.role === "admin" ? colors.accentSoft : colors.card }]}>
          <Text style={{ fontSize: font.xs, fontWeight: "700", color: user?.role === "admin" ? colors.accent : colors.muted }}>
            {user?.role === "admin" ? "Administrator" : "Standard User"}
          </Text>
        </View>
      </View>

      {/* Appearance Section */}
      <Text style={[styles.section, { color: colors.muted }]}>Appearance</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.glassHighlight}
        />
        <View style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
            <MaterialCommunityIcons name={isDark ? "moon-waning-crescent" : "white-balance-sunny"} size={17} color={colors.accent} />
          </View>
          <Text style={[styles.rowLabel, { color: colors.content, fontSize: font.sm }]}>Theme Mode</Text>
          <Text style={[styles.rowValue, { color: colors.muted, fontSize: font.sm }]}>{isDark ? "Dark Mode" : "Light Mode"}</Text>
          <CustomSwitch value={isDark} onValueChange={toggleTheme} />
        </View>
      </View>

      {/* Preferences — admins see real server storage usage. */}
      {user?.role === "admin" ? (
        <>
          <Text style={[styles.section, { color: colors.muted }]}>Preferences</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
            <LinearGradient
              colors={["rgba(255,255,255,0.04)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glassHighlight}
            />
            <Row
              icon="harddisk"
              label="Storage Usage"
              value={storageLoaded ? `${formatBytes(storageUsed)} used` : "Loading…"}
              iconColor="#F59E0B"
              iconBg="rgba(245,158,11,0.15)"
            />
          </View>
        </>
      ) : null}

      {/* Server Section */}
      <Text style={[styles.section, { color: colors.muted }]}>Server Settings</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.glassHighlight}
        />
        <Text style={[styles.label, { color: colors.muted, fontSize: font.sm }]}>Server endpoint URL</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.borderSoft, color: colors.content, borderRadius: radius.md }]}
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
          style={[styles.btn, (!urlDraft.trim() || saving) && { opacity: 0.5 }]}
          disabled={!urlDraft.trim() || saving}
          onPress={saveUrl}
          activeOpacity={0.85}
        >
          <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <Text style={styles.btnText}>{saving ? "Connecting…" : "Save Endpoint"}</Text>
        </TouchableOpacity>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.hint, { color: colors.muted, fontSize: font.xs }]}>Active: {api?.baseUrl}</Text>
        </View>
      </View>

      {/* Administration — visible to admin accounts only. */}
      {user?.role === "admin" ? (
        <>
          <Text style={[styles.section, { color: colors.muted }]}>Administration</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg }, shadowSm]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate("Admin")}
              style={[styles.adminRow, { backgroundColor: colors.accentSoft, borderRadius: radius.md }]}
            >
              <View style={[styles.adminIcon, { backgroundColor: colors.accent }]}>
                <MaterialCommunityIcons name="shield-lock-outline" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.adminTitle, { color: colors.content, fontSize: font.md }]}>Admin Dashboard</Text>
                <Text style={[styles.adminSub, { color: colors.muted, fontSize: font.xs }]}>
                  Users, storage roots, permissions & audit log
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* About Section */}
      <Text style={[styles.section, { color: colors.muted }]}>About</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.glassHighlight}
        />
        <Row icon="server" label="Storage Mode" value="Self-hosted" iconColor="#10b981" iconBg="rgba(16,185,129,0.15)" />
        <View style={[styles.divider, { backgroundColor: colors.borderSoft }]} />
        <Row icon="scale-balance" label="License" value="MIT License" iconColor="#f59e0b" iconBg="rgba(245,158,11,0.15)" />
        <View style={[styles.divider, { backgroundColor: colors.borderSoft }]} />
        <Row icon="cellphone" label="App Version" value={`v${Constants.expoConfig?.version || "1.0.0"}`} iconColor="#3b82f6" iconBg="rgba(59,130,246,0.15)" />
      </View>

      {/* App Branding Card */}
      <View style={[styles.brandRow, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.glassHighlight}
        />
        <AppIcon size={40} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.brandName, { color: colors.content, fontSize: font.md }]}>Nexora Mobile</Text>
          <Text style={[styles.brandTag, { color: colors.muted, fontSize: font.xs }]}>Self-hosted file workspace for Android & iOS</Text>
        </View>
      </View>

      {/* Logout Button */}
      <TouchableOpacity activeOpacity={0.8} onPress={confirmLogout}>
        <LinearGradient
          colors={["#ef4444", "#b91c1c"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoutGradient}
        >
          <View style={[styles.logoutInner, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
            <Text style={[styles.logoutText, { color: colors.danger, fontSize: font.sm }]}>Sign Out</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

function formatBytes(n: number): string {
  if (!isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function Row({
  icon,
  label,
  value,
  iconColor = "#5B8CFF",
  iconBg = "rgba(91,140,255,0.15)",
  onPress,
  rightElement,
}: {
  icon: string;
  label: string;
  value?: string;
  iconColor?: string;
  iconBg?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
}) {
  const { colors, font } = useTheme();
  const content = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={icon as any} size={17} color={iconColor} />
      </View>
      <Text style={[styles.rowLabel, { color: colors.content, fontSize: font.sm }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, { color: colors.muted, fontSize: font.sm, marginRight: rightElement ? 8 : 0 }]}>{value}</Text> : null}
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

function CustomSwitch({ value, onValueChange }: { value: boolean; onValueChange: () => void }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const toggleBg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.accent],
  });

  const thumbPos = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 27],
  });

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onValueChange}>
      <Animated.View style={[styles.toggleTrack, { backgroundColor: toggleBg }]}>
        <Animated.View style={[styles.toggleThumb, { transform: [{ translateX: thumbPos }] }]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroGrad: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  profile: { alignItems: "center", paddingTop: 24, paddingBottom: 16, gap: 6 },
  avatarRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#fff", fontSize: 32, fontWeight: "800" },
  name: { fontWeight: "800" },
  email: { fontWeight: "500" },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  section: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
  },
  card: {
    marginHorizontal: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
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
  label: { fontWeight: "600" },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    overflow: "hidden",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  hint: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontWeight: "600" },
  rowValue: { fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 24,
    padding: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  brandName: { fontWeight: "700" },
  brandTag: { marginTop: 2 },

  toggleTrack: {
    width: 52,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },

  logoutGradient: {
    marginHorizontal: 20,
    marginTop: 24,
    padding: 1.5,
    borderRadius: 14,
  },
  logoutInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12.5,
    paddingVertical: 14,
  },
  logoutText: { fontWeight: "700" },

  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  adminIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  adminTitle: { fontWeight: "700" },
  adminSub: { marginTop: 2, fontWeight: "500" },
});
