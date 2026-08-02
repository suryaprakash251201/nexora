import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { File, Directory, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, radius, spacing } from "../theme";
import { previewKind, formatBytes } from "../api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Preview">;

export default function PreviewScreen({ route }: Props) {
  const { item, rootId } = route.params;
  const { api } = useSession();
  const kind = previewKind(item);

  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const rawUrl = api ? api.rawFileUrl(item.root_id || rootId, item.path) : "";

  // ── Text / code preview ─────────────────────────────────────────────
  const loadText = useCallback(async () => {
    if (!api) return;
    setTextLoading(true);
    try {
      const res = await fetch(`${api.baseUrl}/api/v1/files/content?root=${encodeURIComponent(item.root_id || rootId)}&path=${encodeURIComponent(item.path)}`, {
        headers: api.token ? { Authorization: `Bearer ${api.token}` } : {},
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setText(await res.text());
    } catch (e: any) {
      setText(`Could not load file preview: ${e?.message || "unknown error"}`);
    } finally {
      setTextLoading(false);
    }
  }, [api, item, rootId]);

  useEffect(() => {
    if (kind === "text" || kind === "code" || kind === "markdown") loadText();
  }, [kind, loadText]);

  // ── Download & open with system app ─────────────────────────────────
  const downloadAndOpen = async () => {
    if (!api) return;
    try {
      const target = new File(Paths.cache, "nexora-" + item.name.replace(/[^\w.\-]+/g, "_"));
      await File.downloadFileAsync(api.rawFileUrl(item.root_id || rootId, item.path), target);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, { mimeType: item.mime || undefined });
      } else {
        Alert.alert("Downloaded", `Saved to ${target.uri}`);
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.message || "Something went wrong.");
    }
  };

  return (
    <View style={styles.root}>
      {kind === "image" && (
        <View style={styles.center}>
          <Image
            source={{ uri: rawUrl }}
            style={styles.image}
            contentFit="contain"
            transition={150}
            placeholder={colors.surfaceMuted}
          />
        </View>
      )}

      {kind === "video" && (
        <View style={styles.center}>
          <VideoPlayer uri={rawUrl} name={item.name} />
        </View>
      )}

      {kind === "audio" && (
        <View style={styles.audioWrap}>
          <AudioPlayer uri={rawUrl} name={item.name} />
        </View>
      )}

      {(kind === "text" || kind === "code" || kind === "markdown") && (
        <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
          {textLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <Text style={[styles.text, (kind === "code" || kind === "text") && styles.mono]} selectable>
              {text}
            </Text>
          )}
        </ScrollView>
      )}

      {(kind === "pdf" || kind === "other") && (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name={kind === "pdf" ? "file-pdf-box" : "file-outline"}
            size={72}
            color={colors.muted}
          />
          <Text style={styles.otherTitle}>{item.name}</Text>
          <Text style={styles.otherSub}>
            {formatBytes(item.size)} · {item.mime || "unknown type"}
          </Text>
          <Text style={styles.otherHint}>
            {kind === "pdf" ? "PDF preview opens in your system viewer." : "No inline preview for this file type."}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={downloadAndOpen}>
            <MaterialCommunityIcons name="open-in-new" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Open with…</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function VideoPlayer({ uri, name }: { uri: string; name: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
    />
  );
}

function AudioPlayer({ uri, name }: { uri: string; name: string }) {
  const player = useVideoPlayer(uri);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const sub = player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying));
    return () => sub.remove();
  }, [player]);

  return (
    <View style={styles.audioCard}>
      <View style={styles.audioIcon}>
        <MaterialCommunityIcons name="music-note" size={30} color={colors.accent} />
      </View>
      <Text style={styles.audioName} numberOfLines={2}>{name}</Text>
      <TouchableOpacity
        style={styles.playBtn}
        onPress={() => (playing ? player.pause() : player.play())}
      >
        <MaterialCommunityIcons name={playing ? "pause" : "play"} size={26} color="#fff" />
      </TouchableOpacity>
      <VideoView player={player} style={{ width: 1, height: 1 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: spacing.xl, gap: 10,
  },
  image: { width: "100%", height: "100%" },
  video: { width: "100%", height: "100%" },
  audioWrap: { flex: 1, justifyContent: "center", padding: spacing.xl },
  audioCard: {
    alignItems: "center", gap: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.xl,
  },
  audioIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
  },
  audioName: { color: colors.content, fontSize: font.md, fontWeight: "600", textAlign: "center" },
  playBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  textScroll: { flex: 1 },
  textContent: { padding: spacing.lg },
  text: { color: colors.content, fontSize: font.sm, lineHeight: 22 },
  mono: { fontFamily: PlatformSelectMono(), fontSize: 12.5 },
  otherTitle: { color: colors.content, fontSize: font.lg, fontWeight: "700", textAlign: "center" },
  otherSub: { color: colors.muted, fontSize: font.sm },
  otherHint: { color: colors.muted, fontSize: font.sm, textAlign: "center", marginTop: 4 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 13,
    marginTop: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: font.md },
});

function PlatformSelectMono(): string {
  return "monospace";
}
