import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../store/ThemeContext";

export interface SheetAction {
  label: string;
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions?: SheetAction[];
  children?: React.ReactNode;
}

/**
 * Slide-up action sheet / bottom sheet with dynamic theme integration.
 */
export function BottomSheet({ visible, onClose, title, actions, children }: Props) {
  const { colors, font, radius, spacing, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.back} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: isDark ? "rgba(21,24,34,0.72)" : "rgba(255,255,255,0.85)",
                borderColor: colors.borderSoft,
                paddingHorizontal: spacing.lg,
                paddingBottom: insets.bottom + 20,
                paddingTop: 8,
              },
            ]}
            onPress={() => {}}
          >
          {/* Frosted glass surface — the dimmed app glows softly through. */}
          <BlurView
            intensity={isDark ? 60 : 75}
            tint={isDark ? "dark" : "light"}
            experimentalBlurMethod={Platform.OS === "android" ? ("dimezisBlurView" as const) : undefined}
            style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 28, borderTopRightRadius: 28 }]}
            pointerEvents="none"
          />
          {/* Hairline highlight along the top edge for a glassy sheen */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 24,
              right: 24,
              height: StyleSheet.hairlineWidth,
              backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
            }}
            pointerEvents="none"
          />
          <View style={[styles.grabber, { backgroundColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)" }]} />
          {title ? (
            <Text style={[styles.title, { color: colors.content, fontSize: font.md, marginBottom: spacing.md }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}

          {actions?.map((a, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.action,
                i < actions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
              ]}
              onPress={() => {
                // Wrap in try/catch so a synchronous throw in an action can
                // never skip onClose() — otherwise the sheet's full-screen
                // backdrop stays mounted and blocks the whole app.
                try {
                  a.onPress();
                } catch (e) {
                  console.warn("BottomSheet action error", e);
                } finally {
                  onClose();
                }
              }}
              activeOpacity={0.55}
            >
              {a.icon ? (
                <View
                  style={[
                    styles.actionIconWrap,
                    { backgroundColor: a.destructive ? colors.dangerSoft : colors.accentSofter, borderRadius: radius.sm },
                  ]}
                >
                  <MaterialCommunityIcons name={a.icon as any} size={18} color={a.destructive ? colors.danger : colors.accent} />
                </View>
              ) : null}
              <Text style={[styles.actionText, { color: a.destructive ? colors.danger : colors.content, fontSize: font.md }]}>
                {a.label}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} style={{ opacity: 0.45 }} />
            </TouchableOpacity>
          ))}

          {children}

          <TouchableOpacity
            style={[styles.cancel, { backgroundColor: colors.card, borderRadius: radius.lg, marginTop: spacing.md }]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelText, { color: colors.muted, fontSize: font.md, fontWeight: "600" }]}>Cancel</Text>
          </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    marginBottom: 14,
  },
  title: {
    fontWeight: "700",
    paddingHorizontal: 4,
    letterSpacing: -0.1,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  actionIconWrap: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontWeight: "600",
    flex: 1,
    letterSpacing: -0.1,
  },
  cancel: {
    paddingVertical: 15,
    alignItems: "center",
  },
  cancelText: {},
});
