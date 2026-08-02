import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, gradients, radius, shadow, spacing } from "../theme";
import { GlyphTile } from "../components/AppIcon";
import { previewKind, formatBytes } from "../api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Preview">;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
      const res = await fetch(
        `${api.baseUrl}/api/v1/files/content?root=${encodeURIComponent(item.root_id || rootId)}&path=${encodeURIComponent(item.path)}`,
        { headers: api.token ? { Authorization: `Bearer ${api.token}` } : {} }
      );
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
            transition={180}
            placeholder={colors.surfaceMuted}
            cachePolicy="memory-disk"
          />
          <View style={styles.metaChip}>
            <MaterialCommunityIcons name="image-outline" size={13} color={colors.muted} />
            <Text style={styles.metaChipText}>{formatBytes(item.size)} · {item.mime || item.extension?.toUpperCase()}</Text>
          </View>
        </View>
      )}

      {kind === "video" && (
        <View style={styles.center}>
          <VideoPlayer uri={rawUrl} />
        </View>
      )}

      {kind === "audio" && (
        <AudioPlayer uri={rawUrl} name={item.name} size={item.size} ext={item.extension || ""} />
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
          <GlyphTile icon={kind === "pdf" ? "file-pdf-box" : "file-outline"} color={kind === "pdf" ? colors.red : colors.muted} size={88} />
          <Text style={styles.otherTitle}>{item.name}</Text>
          <Text style={styles.otherSub}>
            {formatBytes(item.size)} · {item.mime || "unknown type"}
          </Text>
          <Text style={styles.otherHint}>
            {kind === "pdf" ? "PDF preview opens in your system viewer." : "No inline preview for this file type."}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={downloadAndOpen} activeOpacity={0.85}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <MaterialCommunityIcons name="open-in-new" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Open with…</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Video ─────────────────────────────────────────────────────────────
function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => setReady(status === "readyToPlay"));
    return () => sub.remove();
  }, [player]);
  return (
    <View style={styles.videoWrap}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
      {!ready ? (
        <View style={styles.videoLoading} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

// ── Immersive audio player ────────────────────────────────────────────
function AudioPlayer({ uri, name, size, ext }: { uri: string; name: string; size: number; ext: string }) {
  const player = useVideoPlayer(uri);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Scrubbing state.
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const barRef = useRef<View>(null);
  const barWidth = useRef(0);

  // Mirror scrubPos into a ref so the timeUpdate listener can read it.
  const scrubPosRef = useRef<number | null>(null);
  useEffect(() => {
    scrubPosRef.current = scrubPos;
  }, [scrubPos]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.5;
    const subs = [
      player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying)),
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (scrubPosRef.current === null) setCurrent(currentTime);
      }),
      player.addListener("statusChange", ({ status }) => {
        setReady(status === "readyToPlay");
        setError(status === "error");
        if (status === "readyToPlay" && player.duration) setDuration(player.duration);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  const togglePlay = useCallback(() => {
    if (!ready) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (playing) player.pause();
    else player.play();
  }, [player, playing, ready]);

  const skip = useCallback(
    (sec: number) => {
      if (!ready) return;
      player.seekBy(sec);
      setCurrent(Math.max(0, Math.min(duration, current + sec)));
    },
    [player, ready, duration, current]
  );

  const seekTo = useCallback(
    (frac: number) => {
      const t = frac * duration;
      player.currentTime = t;
      setCurrent(t);
    },
    [player, duration]
  );

  const shown = scrubPos ?? current;
  const pct = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;

  const onBarLayout = (e: any) => {
    barWidth.current = e.nativeEvent.layout.width;
  };
  const onBarMove = (e: any) => {
    if (barWidth.current <= 0) return;
    const x = Math.max(0, Math.min(barWidth.current, e.nativeEvent.locationX));
    setScrubPos((x / barWidth.current) * duration);
  };
  const onBarRelease = () => {
    if (scrubPos !== null) {
      seekTo(scrubPos / (duration || 1));
    }
    setScrubPos(null);
  };

  return (
    <LinearGradient colors={[...gradients.player]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.player}>
      <ScrollView contentContainerStyle={styles.playerInner} bounces={false}>
        {/* Artwork */}
        <LinearGradient
          colors={["#2A3A6E", "#1B2240"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.artwork}
        >
          <View style={styles.artGlow} />
          <MaterialCommunityIcons name="music-note" size={72} color="rgba(255,255,255,0.9)" />
          <View style={styles.artBadge}>
            <Text style={styles.artBadgeText}>{(ext || "audio").toUpperCase()}</Text>
          </View>
        </LinearGradient>

        {/* Track info */}
        <Text style={styles.trackName} numberOfLines={2}>{name}</Text>
        <Text style={styles.trackMeta}>{formatBytes(size)} · Nexora</Text>

        {/* Seek bar */}
        <View style={styles.seekWrap}>
          <View
            ref={barRef}
            style={styles.seekTrack}
            onLayout={onBarLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={onBarMove}
            onResponderMove={onBarMove}
            onResponderRelease={onBarRelease}
          >
            <View style={[styles.seekFill, { width: `${pct * 100}%` }]} />
            <View style={[styles.seekThumb, { left: `${pct * 100}%` }]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{fmtTime(shown)}</Text>
            <Text style={styles.timeText}>{ready ? fmtTime(duration) : "—:—"}</Text>
          </View>
        </View>

        {error ? (
          <Text style={styles.playerError}>Could not play this file. Try downloading it instead.</Text>
        ) : !ready ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 8 }} />
        ) : null}

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(-15)} hitSlop={8}>
            <MaterialCommunityIcons name="rewind-15" size={30} color={colors.content} />
            <Text style={styles.skipLabel}>15</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.85}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <MaterialCommunityIcons name={playing ? "pause" : "play"} size={34} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(15)} hitSlop={8}>
            <MaterialCommunityIcons name="fast-forward-15" size={30} color={colors.content} />
            <Text style={styles.skipLabel}>15</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      {/* Hidden view keeps the native player alive */}
      <VideoView player={player} style={styles.hiddenVideo} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: 12,
    backgroundColor: colors.bg,
  },
  image: { width: "100%", height: "100%" },
  metaChip: {
    position: "absolute",
    bottom: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(9,11,18,0.7)",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  metaChipText: { color: colors.muted, fontSize: font.xs },
  videoWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
  videoLoading: { position: "absolute", alignSelf: "center" },

  // Audio player
  player: { flex: 1 },
  playerInner: { flexGrow: 1, alignItems: "center", padding: spacing.xl, paddingBottom: 48, gap: 10 },
  artwork: {
    width: 220,
    height: 220,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    overflow: "hidden",
    ...shadow,
  },
  artGlow: {
    position: "absolute",
    top: "-30%",
    left: "-20%",
    right: "-20%",
    height: "80%",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  artBadge: {
    position: "absolute",
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  artBadgeText: { color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontWeight: "700", letterSpacing: 1 },
  trackName: {
    color: colors.content,
    fontSize: font.lg,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.lg,
    paddingHorizontal: 8,
  },
  trackMeta: { color: colors.muted, fontSize: font.sm },
  seekWrap: { width: "100%", marginTop: spacing.lg, gap: 6 },
  seekTrack: {
    height: 22,
    justifyContent: "center",
  },
  seekFill: {
    position: "absolute",
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  seekThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    marginLeft: -7,
    ...shadow,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: colors.muted, fontSize: font.xs, fontVariant: ["tabular-nums"] },
  playerError: { color: colors.danger, fontSize: font.sm, textAlign: "center", marginTop: 8 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 40,
    marginTop: spacing.lg,
  },
  skipBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  skipLabel: { color: colors.content, fontSize: 9, fontWeight: "700", marginTop: -10 },
  playBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...shadow,
  },
  hiddenVideo: { position: "absolute", width: 1, height: 1 },

  // Text
  textScroll: { flex: 1 },
  textContent: { padding: spacing.lg },
  text: { color: colors.content, fontSize: font.sm, lineHeight: 22 },
  mono: { fontFamily: "monospace", fontSize: 12.5 },

  // Other
  otherTitle: { color: colors.content, fontSize: font.lg, fontWeight: "700", textAlign: "center" },
  otherSub: { color: colors.muted, fontSize: font.sm },
  otherHint: { color: colors.muted, fontSize: font.sm, textAlign: "center", marginTop: 4 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 22,
    paddingVertical: 14,
    marginTop: 12,
    overflow: "hidden",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: font.md },
});
