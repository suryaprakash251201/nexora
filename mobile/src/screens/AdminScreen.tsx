import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { BottomSheet } from "../components/BottomSheet";
import { ListSkeleton } from "../components/Skeletons";
import { formatBytes, formatDate } from "../api/client";
import type { AdminUser, AdminRoot, AuditEntry, UsageInfo } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Admin">;
type Tab = "overview" | "users" | "roots" | "audit";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "chart-box-outline" },
  { id: "users", label: "Users", icon: "account-group-outline" },
  { id: "roots", label: "Roots", icon: "server-outline" },
  { id: "audit", label: "Audit", icon: "clipboard-text-clock-outline" },
];

const ROLE_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  admin: { color: "#5B8CFF", bg: "rgba(91,140,255,0.15)", label: "Admin" },
  user: { color: "#2DD4BF", bg: "rgba(45,212,191,0.15)", label: "User" },
  viewer: { color: "#8892A8", bg: "rgba(136,146,168,0.15)", label: "Viewer" },
};

const ROOT_TYPE_ICONS: Record<string, string> = {
  local: "folder-home-outline",
  smb: "lan",
  nfs: "server-network",
  sftp: "lock-outline",
  s3: "cloud-outline",
  default: "database-outline",
};

function initialsOf(u: { display_name?: string; username: string }): string {
  return (u.display_name || u.username || "?").slice(0, 1).toUpperCase();
}

export default function AdminScreen({ navigation }: Props) {
  const { api, user } = useSession();
  const { colors, font, gradients, radius, spacing, shadowSm } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("overview");

  // Data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roots, setRoots] = useState<AdminRoot[]>([]);
  const [usage, setUsage] = useState<UsageInfo[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sheets
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [actionUser, setActionUser] = useState<AdminUser | null>(null);
  const [showCreateRoot, setShowCreateRoot] = useState(false);
  const [actionRoot, setActionRoot] = useState<AdminRoot | null>(null);
  const [showUserRoots, setShowUserRoots] = useState<AdminUser | null>(null);
  const [userRoots, setUserRoots] = useState<{ id: string; name: string; read_only: boolean; granted: boolean; permission: string }[]>([]);

  // New user form
  const [nu, setNu] = useState({ username: "", display_name: "", email: "", password: "", role: "user" });
  // New root form
  const [nr, setNr] = useState({ name: "", path: "", type: "local", read_only: false, indexed: false });
  // Reset password field (in user action sheet)
  const [newPass, setNewPass] = useState("");
  // Busy flags
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (!api) return;
      const seq = ++loadSeq.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [u, r, us, a] = await Promise.all([
          api.listAdminUsers(),
          api.listAdminRoots(),
          api.listAdminUsage(),
          api.listAdminAudit(60),
        ]);
        if (seq !== loadSeq.current) return;
        setUsers(u.users);
        setRoots(r.roots);
        setUsage(us.roots);
        setAudit(a.items);
      } catch (e: any) {
        if (seq !== loadSeq.current) return;
        setError(e?.message || "Failed to load admin data.");
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    if (user?.role !== "admin") {
      // Non-admins should never land here (entry point is hidden), but guard anyway.
      setLoading(false);
      return;
    }
    loadAll();
  }, [loadAll, user?.role]);

  const toggle = (id: Tab) => {
    const next = TABS.find((t) => t.id === id);
    if (!next) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTab(id);
  };

  // ── User actions ────────────────────────────────────────────────────
  const createUser = async () => {
    if (!api || !nu.username.trim() || !nu.password) return;
    setBusy(true);
    try {
      await api.createAdminUser({
        username: nu.username.trim(),
        display_name: nu.display_name.trim() || undefined,
        email: nu.email.trim() || undefined,
        password: nu.password,
        role: nu.role,
      });
      setShowCreateUser(false);
      setNu({ username: "", display_name: "", email: "", password: "", role: "user" });
      loadAll();
      Alert.alert("User created", `${nu.username.trim()} can now sign in.`);
    } catch (e: any) {
      Alert.alert("Could not create user", e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (u: AdminUser, role: string) => {
    if (!api) return;
    try {
      await api.updateAdminUser(u.id, { role });
      loadAll();
    } catch (e: any) {
      Alert.alert("Could not update role", e?.message || "Something went wrong.");
    }
  };

  const toggleStatus = async (u: AdminUser) => {
    if (!api) return;
    const next = u.status === "active" ? "disabled" : "active";
    try {
      await api.updateAdminUser(u.id, { status: next });
      loadAll();
    } catch (e: any) {
      Alert.alert("Could not update user", e?.message || "Something went wrong.");
    }
  };

  const resetPassword = async () => {
    if (!api || !actionUser || !newPass.trim()) return;
    setBusy(true);
    try {
      await api.updateAdminUser(actionUser.id, { password: newPass.trim() });
      setNewPass("");
      setActionUser(null);
      Alert.alert("Password reset", `Password updated for ${actionUser.username}. Their sessions were revoked.`);
    } catch (e: any) {
      Alert.alert("Could not reset password", e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = (u: AdminUser) => {
    if (!api) return;
    Alert.alert("Delete user", `Delete "${u.username}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteAdminUser(u.id);
            loadAll();
          } catch (e: any) {
            Alert.alert("Could not delete user", e?.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  // ── Root actions ────────────────────────────────────────────────────
  const createRoot = async () => {
    if (!api || !nr.name.trim() || !nr.path.trim()) return;
    setBusy(true);
    try {
      await api.createAdminRoot({
        name: nr.name.trim(),
        path: nr.path.trim(),
        type: nr.type,
        read_only: nr.read_only,
        indexed: nr.indexed,
      });
      setShowCreateRoot(false);
      setNr({ name: "", path: "", type: "local", read_only: false, indexed: false });
      loadAll();
      Alert.alert("Root created", `${nr.name.trim()} is now available.`);
    } catch (e: any) {
      Alert.alert("Could not create root", e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRootEnabled = async (r: AdminRoot) => {
    if (!api) return;
    try {
      await api.updateAdminRoot(r.id, { enabled: !r.enabled });
      loadAll();
    } catch (e: any) {
      Alert.alert("Could not update root", e?.message || "Something went wrong.");
    }
  };

  const toggleRootReadOnly = async (r: AdminRoot) => {
    if (!api) return;
    try {
      await api.updateAdminRoot(r.id, { read_only: !r.read_only });
      loadAll();
    } catch (e: any) {
      Alert.alert("Could not update root", e?.message || "Something went wrong.");
    }
  };

  const deleteRoot = (r: AdminRoot) => {
    if (!api) return;
    Alert.alert("Delete root", `Remove storage root "${r.name}"? Files on disk are not touched.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteAdminRoot(r.id);
            loadAll();
          } catch (e: any) {
            Alert.alert("Could not delete root", e?.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  const openUserRoots = async (u: AdminUser) => {
    if (!api) return;
    try {
      const res = await api.listUserRoots(u.id);
      setUserRoots(res.roots);
      setShowUserRoots(u);
    } catch (e: any) {
      Alert.alert("Could not load access", e?.message || "Something went wrong.");
    }
  };

  const toggleUserRoot = async (rootId: string, granted: boolean) => {
    if (!api || !showUserRoots) return;
    try {
      if (granted) await api.revokeUserRoot(showUserRoots.id, rootId);
      else await api.grantUserRoot(showUserRoots.id, rootId, "write");
      openUserRoots(showUserRoots);
    } catch (e: any) {
      Alert.alert("Could not update access", e?.message || "Something went wrong.");
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────
  const agg = useMemo(() => {
    const total = usage.reduce((s, r) => s + (r.total || 0), 0);
    const used = usage.reduce((s, r) => s + (r.used || 0), 0);
    const available = usage.reduce((s, r) => s + (r.available || 0), 0);
    return { total, used, available, pct: total > 0 ? Math.min(100, (used / total) * 100) : 0 };
  }, [usage]);

  const auditLabel = (a: string) => a.replace(/_/g, " ");

  const renderContent = () => {
    if (loading) return <ListSkeleton rows={7} />;
    if (error && !users.length) {
      return (
        <View style={styles.centerBlock}>
          <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.danger} />
          <Text style={[styles.centerTitle, { color: colors.content, fontSize: font.md }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.accent, borderRadius: radius.md }]} onPress={() => loadAll()}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (tab === "overview") {
      return (
        <View style={{ gap: spacing.md, paddingBottom: insets.bottom + 120 }}>
          {/* Usage summary */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadowSm]}>
            <Text style={[styles.cardTitle, { color: colors.muted, fontSize: font.xs }]}>STORAGE USAGE</Text>
            <View style={[styles.usageTrack, { backgroundColor: colors.card }]}>
              <LinearGradient
                colors={[...gradients.brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.usageFill, { width: `${agg.pct}%` }]}
              />
            </View>
            <View style={styles.usageStatsRow}>
              <View>
                <Text style={[styles.usageValue, { color: colors.content, fontSize: font.lg }]}>{formatBytes(agg.used)}</Text>
                <Text style={[styles.usageLabel, { color: colors.muted, fontSize: font.xs }]}>used of {formatBytes(agg.total)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.usageValue, { color: colors.success, fontSize: font.lg }]}>{formatBytes(agg.available)}</Text>
                <Text style={[styles.usageLabel, { color: colors.muted, fontSize: font.xs }]}>available</Text>
              </View>
            </View>
          </View>

          {/* Quick stats */}
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            {[
              { icon: "account-group", value: users.length, label: "Users", color: colors.accent },
              { icon: "server", value: roots.length, label: "Roots", color: colors.teal },
              { icon: "clipboard-text", value: audit.length, label: "Audit events", color: colors.purple },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg }, shadowSm]}>
                <MaterialCommunityIcons name={s.icon as any} size={18} color={s.color} />
                <Text style={[styles.statValue, { color: colors.content, fontSize: font.xl }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.xs }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Per-root usage */}
          {usage.length > 0 ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadowSm]}>
              <Text style={[styles.cardTitle, { color: colors.muted, fontSize: font.xs }]}>BY STORAGE ROOT</Text>
              {usage.map((r) => {
                const pct = r.total > 0 ? Math.min(100, (r.used / r.total) * 100) : 0;
                return (
                  <View key={r.id} style={styles.usageRow}>
                    <View style={styles.usageRowHead}>
                      <Text style={[styles.usageRowName, { color: colors.content, fontSize: font.sm }]} numberOfLines={1}>{r.name}</Text>
                      <Text style={[styles.usageRowPct, { color: colors.muted, fontSize: font.xs }]}>{pct.toFixed(0)}%</Text>
                    </View>
                    <View style={[styles.usageTrack, { backgroundColor: colors.card, height: 6 }]}>
                      <View style={[styles.usageFill, { width: `${pct}%`, backgroundColor: colors.teal }]} />
                    </View>
                    <Text style={[styles.usageRowSub, { color: colors.muted, fontSize: font.xs }]}>
                      {formatBytes(r.used)} used · {formatBytes(r.available)} free
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    }

    if (tab === "users") {
      return (
        <View style={{ paddingBottom: insets.bottom + 120 }}>
          {users.map((u) => {
            const rs = ROLE_STYLES[u.role] || ROLE_STYLES.user;
            const active = u.status === "active";
            return (
              <TouchableOpacity
                key={u.id}
                style={[styles.userRow, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg }, shadowSm]}
                activeOpacity={0.7}
                onPress={() => setActionUser(u)}
              >
                <View style={[styles.avatar, { backgroundColor: rs.bg }]}>
                  <Text style={{ color: rs.color, fontWeight: "800", fontSize: font.md }}>{initialsOf(u)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.userNameRow}>
                    <Text style={[styles.userName, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>
                      {u.display_name || u.username}
                    </Text>
                    {u.totp_enabled ? (
                      <MaterialCommunityIcons name="shield-check" size={13} color={colors.success} style={{ marginLeft: 4 }} />
                    ) : null}
                  </View>
                  <Text style={[styles.userSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
                    @{u.username}{u.email ? ` · ${u.email}` : ""}
                  </Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: rs.bg }]}>
                  <Text style={{ color: rs.color, fontSize: font.xs, fontWeight: "700" }}>{rs.label}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: active ? colors.success : colors.danger }]} />
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} style={{ opacity: 0.5 }} />
              </TouchableOpacity>
            );
          })}
          {users.length === 0 && !loading ? (
            <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm }]}>No users found.</Text>
          ) : null}

          {/* FAB */}
          <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => setShowCreateUser(true)} activeOpacity={0.85}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <MaterialCommunityIcons name="account-plus" size={22} color="#fff" />
            <Text style={[styles.fabText, { fontSize: font.sm }]}>New User</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (tab === "roots") {
      return (
        <View style={{ paddingBottom: insets.bottom + 120 }}>
          {roots.map((r) => (
            <View key={r.id} style={[styles.userRow, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg }, shadowSm]}>
              <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
                <MaterialCommunityIcons name={(ROOT_TYPE_ICONS[r.type.toLowerCase()] || ROOT_TYPE_ICONS.default) as any} size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.userNameRow}>
                  <Text style={[styles.userName, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>{r.name}</Text>
                  {r.read_only ? (
                    <View style={[styles.roleBadge, { backgroundColor: "rgba(251,191,36,0.15)", marginLeft: 6 }]}>
                      <Text style={{ color: colors.warning, fontSize: font.xs, fontWeight: "700" }}>RO</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.userSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1} ellipsizeMode="middle">
                  {r.type.toUpperCase()} · {r.path}
                </Text>
              </View>
              <Switch
                value={r.enabled}
                onValueChange={() => toggleRootEnabled(r)}
                trackColor={{ true: colors.accent, false: colors.border }}
                thumbColor="#fff"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
              <TouchableOpacity onPress={() => deleteRoot(r)} hitSlop={8} style={{ padding: 6 }}>
                <MaterialCommunityIcons name="delete-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
          {roots.length === 0 && !loading ? (
            <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm }]}>No storage roots configured.</Text>
          ) : null}

          <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => setShowCreateRoot(true)} activeOpacity={0.85}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <MaterialCommunityIcons name="server-plus" size={22} color="#fff" />
            <Text style={[styles.fabText, { fontSize: font.sm }]}>Add Root</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // audit
    return (
      <View style={{ paddingBottom: insets.bottom + 120, gap: 8 }}>
        {audit.map((e) => {
          const isAction = ["create", "update", "grant"].some((k) => e.action.includes(k));
          const color = e.action.includes("delete") || e.action.includes("revoke") ? colors.danger : isAction ? colors.accent : colors.teal;
          return (
            <View key={e.id} style={[styles.userRow, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg }, shadowSm]}>
              <View style={[styles.avatar, { backgroundColor: `${color}18` }]}>
                <MaterialCommunityIcons name={e.action.includes("delete") ? "delete" : e.action.includes("grant") ? "key" : "history"} size={18} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.userName, { color: colors.content, fontSize: font.md, textTransform: "capitalize" }]} numberOfLines={1}>
                  {auditLabel(e.action)}
                </Text>
                <Text style={[styles.userSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
                  {e.target || e.detail || "—"}{e.ip ? ` · ${e.ip}` : ""}
                </Text>
              </View>
              <Text style={[styles.auditDate, { color: colors.muted, fontSize: font.xs }]}>{formatDate(e.created_at)}</Text>
            </View>
          );
        })}
        {audit.length === 0 && !loading ? (
          <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm }]}>No audit events yet.</Text>
        ) : null}
      </View>
    );
  };

  const inputStyle = (borderColor: string) => [
    styles.input,
    { backgroundColor: colors.surfaceMuted, borderColor, color: colors.content, borderRadius: radius.md },
  ];

  if (user?.role !== "admin") {
    return (
      <View style={[styles.root, styles.centerBlock, { backgroundColor: colors.bg }]}>
        <View style={[styles.avatar, { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.card }]}>
          <MaterialCommunityIcons name="shield-off-outline" size={26} color={colors.muted} />
        </View>
        <Text style={[styles.centerTitle, { color: colors.content, fontSize: font.md }]}>Administrator access required</Text>
        <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm }]}>This section is only available to admin accounts.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Tabs */}
      <View style={[styles.tabsBar, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft }, shadowSm]}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.tabPill, active && { backgroundColor: colors.card }]}
              onPress={() => toggle(t.id)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name={t.icon as any} size={17} color={active ? colors.accent : colors.muted} />
              <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.muted, fontSize: font.xs }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAll(true)} tintColor={colors.accent} />}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      {/* ── Create user sheet ── */}
      <BottomSheet visible={showCreateUser} onClose={() => setShowCreateUser(false)} title="New user">
        <TextInput style={inputStyle(colors.border)} value={nu.username} onChangeText={(v) => setNu({ ...nu, username: v })} placeholder="Username *" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} selectionColor={colors.accent} />
        <TextInput style={inputStyle(colors.border)} value={nu.display_name} onChangeText={(v) => setNu({ ...nu, display_name: v })} placeholder="Display name" placeholderTextColor={colors.muted} selectionColor={colors.accent} />
        <TextInput style={inputStyle(colors.border)} value={nu.email} onChangeText={(v) => setNu({ ...nu, email: v })} placeholder="Email (optional)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" selectionColor={colors.accent} />
        <TextInput style={inputStyle(colors.border)} value={nu.password} onChangeText={(v) => setNu({ ...nu, password: v })} placeholder="Password *" placeholderTextColor={colors.muted} secureTextEntry selectionColor={colors.accent} />
        <View style={styles.sheetRow}>
          <Text style={[styles.sheetLabel, { color: colors.muted, fontSize: font.xs }]}>ROLE</Text>
          <View style={styles.chipRow}>
            {["admin", "user", "viewer"].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, { backgroundColor: nu.role === r ? colors.accent : colors.card, borderColor: nu.role === r ? colors.accent : colors.borderSoft }]}
                onPress={() => setNu({ ...nu, role: r })}
              >
                <Text style={{ color: nu.role === r ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "700", textTransform: "capitalize" }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent, borderRadius: radius.md }, (!nu.username.trim() || !nu.password || busy) && { opacity: 0.5 }]}
          disabled={!nu.username.trim() || !nu.password || busy}
          onPress={createUser}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.md }}>Create User</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* ── User action sheet ── */}
      <BottomSheet
        visible={actionUser !== null}
        onClose={() => { setActionUser(null); setNewPass(""); }}
        title={actionUser ? `${actionUser.display_name || actionUser.username} (@${actionUser.username})` : ""}
      >
        {actionUser && (
          <>
            <Text style={[styles.sheetLabel, { color: colors.muted, fontSize: font.xs }]}>ROLE</Text>
            <View style={styles.chipRow}>
              {["admin", "user", "viewer"].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, { backgroundColor: actionUser.role === r ? colors.accent : colors.card, borderColor: actionUser.role === r ? colors.accent : colors.borderSoft }]}
                  onPress={() => changeRole(actionUser, r)}
                >
                  <Text style={{ color: actionUser.role === r ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "700", textTransform: "capitalize" }}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={[styles.sheetActionRow, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]} onPress={() => toggleStatus(actionUser)}>
              <MaterialCommunityIcons name={actionUser.status === "active" ? "pause-circle-outline" : "play-circle-outline"} size={18} color={colors.warning} />
              <Text style={{ color: colors.content, fontSize: font.md, fontWeight: "600", flex: 1 }}>
                {actionUser.status === "active" ? "Disable account" : "Enable account"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.sheetActionRow, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]} onPress={() => openUserRoots(actionUser)}>
              <MaterialCommunityIcons name="folder-key-outline" size={18} color={colors.accent} />
              <Text style={{ color: colors.content, fontSize: font.md, fontWeight: "600", flex: 1 }}>Manage storage access</Text>
            </TouchableOpacity>

            <Text style={[styles.sheetLabel, { color: colors.muted, fontSize: font.xs, marginTop: 8 }]}>RESET PASSWORD</Text>
            <TextInput style={inputStyle(colors.border)} value={newPass} onChangeText={setNewPass} placeholder="New password (optional)" placeholderTextColor={colors.muted} secureTextEntry selectionColor={colors.accent} />
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent, borderRadius: radius.md }, (!newPass.trim() || busy) && { opacity: 0.5 }]}
              disabled={!newPass.trim() || busy}
              onPress={resetPassword}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.md }}>Set Password</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.deleteBtn, { borderRadius: radius.md }]} onPress={() => { setActionUser(null); deleteUser(actionUser); }}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: "700", fontSize: font.md }}>Delete user</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheet>

      {/* ── User roots sheet ── */}
      <BottomSheet
        visible={showUserRoots !== null}
        onClose={() => setShowUserRoots(null)}
        title={showUserRoots ? `Access for ${showUserRoots.display_name || showUserRoots.username}` : ""}
      >
        {userRoots.map((r) => (
          <View key={r.id} style={styles.rootGrantRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.content, fontSize: font.md, fontWeight: "600" }}>{r.name}</Text>
              <Text style={{ color: colors.muted, fontSize: font.xs, textTransform: "capitalize" }}>{r.granted ? `${r.permission} access` : "no access"}</Text>
            </View>
            <Switch
              value={r.granted}
              onValueChange={() => toggleUserRoot(r.id, r.granted)}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </BottomSheet>

      {/* ── Create root sheet ── */}
      <BottomSheet visible={showCreateRoot} onClose={() => setShowCreateRoot(false)} title="Add storage root">
        <TextInput style={inputStyle(colors.border)} value={nr.name} onChangeText={(v) => setNr({ ...nr, name: v })} placeholder="Name * (e.g. Media)" placeholderTextColor={colors.muted} selectionColor={colors.accent} />
        <TextInput style={inputStyle(colors.border)} value={nr.path} onChangeText={(v) => setNr({ ...nr, path: v })} placeholder="Path * (e.g. /mnt/media)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} selectionColor={colors.accent} />
        <View style={styles.sheetRow}>
          <Text style={[styles.sheetLabel, { color: colors.muted, fontSize: font.xs }]}>TYPE</Text>
          <View style={styles.chipRow}>
            {["local", "smb", "nfs", "sftp", "s3"].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, { backgroundColor: nr.type === t ? colors.accent : colors.card, borderColor: nr.type === t ? colors.accent : colors.borderSoft }]}
                onPress={() => setNr({ ...nr, type: t })}
              >
                <Text style={{ color: nr.type === t ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "700", textTransform: "uppercase" }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.switchRow}>
          <Text style={{ color: colors.content, fontSize: font.md, fontWeight: "600", flex: 1 }}>Read-only</Text>
          <Switch value={nr.read_only} onValueChange={(v) => setNr({ ...nr, read_only: v })} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
        </View>
        <View style={styles.switchRow}>
          <Text style={{ color: colors.content, fontSize: font.md, fontWeight: "600", flex: 1 }}>Index for search</Text>
          <Switch value={nr.indexed} onValueChange={(v) => setNr({ ...nr, indexed: v })} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
        </View>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent, borderRadius: radius.md }, (!nr.name.trim() || !nr.path.trim() || busy) && { opacity: 0.5 }]}
          disabled={!nr.name.trim() || !nr.path.trim() || busy}
          onPress={createRoot}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.md }}>Add Root</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  tabsBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 5,
    gap: 2,
  },
  tabPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 14,
  },
  tabLabel: { fontWeight: "700" },

  card: { padding: 16, gap: 10, borderWidth: 1 },
  cardTitle: { fontWeight: "800", letterSpacing: 1 },
  usageTrack: { height: 10, borderRadius: 5, overflow: "hidden", marginTop: 4 },
  usageFill: { height: "100%", borderRadius: 5 },
  usageStatsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  usageValue: { fontWeight: "800" },
  usageLabel: { fontWeight: "600", marginTop: 2 },

  statCard: { flex: 1, alignItems: "center", paddingVertical: 14, gap: 4, borderWidth: 1 },
  statValue: { fontWeight: "800" },
  statLabel: { fontWeight: "600" },

  usageRow: { gap: 6, paddingVertical: 8 },
  usageRowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  usageRowName: { fontWeight: "700", flex: 1, marginRight: 8 },
  usageRowPct: { fontWeight: "700" },
  usageRowSub: { fontWeight: "500" },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  userNameRow: { flexDirection: "row", alignItems: "center" },
  userName: { fontWeight: "700", flexShrink: 1 },
  userSub: { marginTop: 2, fontWeight: "500" },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  auditDate: { fontWeight: "600" },

  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 26,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  fabText: { color: "#fff", fontWeight: "700" },

  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  sheetRow: { gap: 8, marginBottom: 12 },
  sheetLabel: { fontWeight: "800", letterSpacing: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  primaryBtn: { paddingVertical: 14, alignItems: "center", marginBottom: 8 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  sheetActionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 12, marginBottom: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, marginBottom: 4 },
  rootGrantRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  centerBlock: { alignItems: "center", paddingTop: 60, gap: 12 },
  centerTitle: { textAlign: "center", fontWeight: "600", paddingHorizontal: 20 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  emptyHint: { textAlign: "center", paddingVertical: 40 },
});
