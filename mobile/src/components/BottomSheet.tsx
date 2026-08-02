import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "../theme";

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
 * Slide-up action sheet / bottom sheet. Used for item actions,
 * upload progress, new-folder and rename dialogs.
 */
export function BottomSheet({ visible, onClose, title, actions, children }: Props) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.back} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {actions?.map((a, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.action, i < (actions.length - 1) && styles.actionBorder]}
              onPress={() => {
              a.onPress();
              onClose();
            }}
            >
              {a.icon ? (
                <MaterialCommunityIcons name={a.icon as any} size={20} color={a.destructive ? colors.danger : colors.muted} />
              ) : null}
              <Text style={[styles.actionText, a.destructive && { color: colors.danger }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          {children}
          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: 36,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.card,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.muted,
    fontSize: font.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 15,
    paddingHorizontal: spacing.xs,
  },
  actionBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionText: { color: colors.content, fontSize: font.md, fontWeight: "600" },
  cancel: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelText: { color: colors.content, fontSize: font.md, fontWeight: "600" },
});
