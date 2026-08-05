import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
  Easing,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { GlyphTile } from "../components/AppIcon";
import { previewKind, formatBytes, formatDate } from "../api/client";
import { copyShareLink } from "../lib/shareLink";
import { EqBars } from "../components/EqBars";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Preview">;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PreviewScreen({ route }: Props) {
  const { item, rootId } = route.params;
  const { api } = useSession();
  const { colors, font, gradients, radius, shadow, shadowSm } = useTheme();
  const kind = previewKind(item);

  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

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

  const copyContent = useCallback(async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "File content copied to clipboard.");
  }, [text]);

  const handleShareLink = async () => {
    if (!api) return;
    const url = await copyShareLink(api, item.root_id || rootId, item.path);
    if (url) Alert.alert("Link copied", url);
  };

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
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {kind === "image" && (
        <View style={styles.imageContainer}>
          {imageLoading && (
            <View style={styles.imageLoadingWrap}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          )}
          <Image
            source={{ uri: rawUrl }}
            style={styles.image}
            contentFit="contain"
            transition={180}
            onLoadEnd={() => setImageLoading(false)}
            onError={() => setImageLoading(false)}
            cachePolicy="memory-disk"
          />
          <LinearGradient colors={["rgba(0,0,0,0.6)", "transparent"]} style={styles.imageGradientTop} pointerEvents="none" />
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.8)"]} style={styles.imageGradientBottom} pointerEvents="none" />

          <View style={styles.imageToolbar}>
            <View style={styles.imageInfoChip}>
              <Text style={styles.imageInfoText}>{formatBytes(item.size)} · {(item.mime || item.extension || "").toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.imageToolBtn} onPress={downloadAndOpen}>
              <MaterialCommunityIcons name="download" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageToolBtn} onPress={downloadAndOpen}>
              <MaterialCommunityIcons name="share-variant" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {kind === "video" && (
        <View style={styles.center}>
          <VideoPlayer uri={rawUrl} />
        </View>
      )}

      {kind === "audio" && (
        <AudioPlayer
          uri={rawUrl}
          name={item.name}
          size={item.size}
          ext={item.extension || ""}
          rootId={item.root_id || rootId}
          path={item.path}
          onShare={downloadAndOpen}
        />
      )}

      {(kind === "text" || kind === "code" || kind === "markdown") && (
        <View style={[styles.textRoot, { backgroundColor: colors.bg }]}>
          <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
            <View style={[styles.docHeader, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadow]}>
              <LinearGradient
                colors={["rgba(255,255,255,0.04)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.glassHighlight}
              />
              <View style={styles.docHeaderInfo}>
                <Text style={[styles.docFileName, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>{item.name}</Text>
                <View style={styles.docBadges}>
                  <View style={[styles.docBadge, { borderRadius: radius.sm }]}>
                    <Text style={[styles.docBadgeText, { color: colors.accent }]}>{item.extension?.toUpperCase() || "TXT"}</Text>
                  </View>
                  {text && <Text style={[styles.docLinesText, { color: colors.muted, fontSize: font.xs }]}>{text.split("\n").length} lines</Text>}
                </View>
              </View>
              <View style={styles.docHeaderActions}>
                <TouchableOpacity style={[styles.docActionBtn, { backgroundColor: colors.surfaceMuted }]} onPress={copyContent}>
                  <MaterialCommunityIcons name="content-copy" size={20} color={colors.content} />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.docActionBtn, { backgroundColor: colors.surfaceMuted }]} onPress={downloadAndOpen}>
                  <MaterialCommunityIcons name="share-variant" size={20} color={colors.content} />
                </TouchableOpacity>
              </View>
            </View>

            {textLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
            ) : (
              <>
                {kind === "code" && text && (
                  <View style={[styles.codeContainer, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
                    <ScrollView horizontal bounces={false} style={{ flex: 1 }}>
                      <View style={styles.codeInner}>
                        {text.split("\n").map((line, i) => (
                          <View key={i} style={styles.codeLine}>
                            <Text style={[styles.codeLineNum, { color: colors.muted }]}>{i + 1}</Text>
                            <Text style={[styles.codeLineText, { color: colors.content }]} selectable>{line || " "}</Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
                {kind === "text" && text && (
                  <Text style={[styles.plainText, { color: colors.content, fontSize: font.md }]} selectable>
                    {text}
                  </Text>
                )}
                {kind === "markdown" && text && (
                  <View style={styles.markdownContainer}>
                    <Markdown
                      style={{
                        body: { color: colors.content, fontSize: font.md, lineHeight: 24 },
                        heading1: { color: colors.content, fontSize: font.xl, fontWeight: '700', marginTop: 16, marginBottom: 8 },
                        heading2: { color: colors.content, fontSize: font.lg, fontWeight: '700', marginTop: 16, marginBottom: 8 },
                        heading3: { color: colors.content, fontSize: font.md, fontWeight: '700', marginTop: 16, marginBottom: 8 },
                        code_inline: { backgroundColor: colors.surfaceMuted, color: colors.accent, fontFamily: "monospace", borderRadius: radius.sm, paddingHorizontal: 4 },
                        fence: { backgroundColor: colors.surfaceMuted, color: colors.content, fontFamily: "monospace", padding: 12, borderRadius: radius.md, marginVertical: 8, overflow: 'hidden' },
                        link: { color: colors.accent, textDecorationLine: 'underline' },
                        blockquote: { borderLeftWidth: 4, borderLeftColor: colors.accent, paddingLeft: 12, opacity: 0.8 },
                        list_item: { marginVertical: 4 },
                        bullet_list: { marginBottom: 12 },
                        ordered_list: { marginBottom: 12 },
                      }}
                    >
                      {text}
                    </Markdown>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.floatingCopyBtn, { backgroundColor: colors.accent, borderRadius: radius.pill }]}
            onPress={copyContent}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="content-copy" size={20} color="#fff" />
            <Text style={[styles.floatingCopyText, { fontSize: font.sm }]}>Copy all</Text>
          </TouchableOpacity>
        </View>
      )}

      {(kind === "pdf" || kind === "other") && (
        <View style={styles.center}>
          <View style={[styles.fileCard, { backgroundColor: colors.surface, borderRadius: radius.xxl, borderColor: colors.borderSoft }, shadow]}>
            <LinearGradient
              colors={["rgba(255,255,255,0.04)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glassHighlight}
            />
            <View style={styles.fileCardIconWrap}>
              <GlyphTile icon={kind === "pdf" ? "file-pdf-box" : "file-outline"} color={kind === "pdf" ? colors.red : colors.muted} size={56} />
            </View>
            <Text style={[styles.fileCardTitle, { color: colors.content, fontSize: font.xl }]}>{item.name}</Text>
            <Text style={[styles.fileCardSub, { color: colors.muted, fontSize: font.sm }]}>
              {formatBytes(item.size)} · {(item.extension || "unknown").toUpperCase()}
            </Text>

            <View style={[styles.fileCardDetails, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
              <View style={styles.fileCardRow}>
                <Text style={[styles.fileCardLabel, { color: colors.muted, fontSize: font.sm }]}>Modified</Text>
                <Text style={[styles.fileCardValue, { color: colors.content, fontSize: font.sm }]}>{formatDate(item.modified)}</Text>
              </View>
              <View style={styles.fileCardRow}>
                <Text style={[styles.fileCardLabel, { color: colors.muted, fontSize: font.sm }]}>Type</Text>
                <Text style={[styles.fileCardValue, { color: colors.content, fontSize: font.sm }]}>{item.mime || "unknown type"}</Text>
              </View>
              <View style={styles.fileCardRow}>
                <Text style={[styles.fileCardLabel, { color: colors.muted, fontSize: font.sm }]}>Path</Text>
                <Text style={[styles.fileCardValue, { color: colors.content, fontSize: font.sm }]} numberOfLines={1} ellipsizeMode="middle">{item.path}</Text>
              </View>
            </View>

            <View style={styles.fileCardButtons}>
              <TouchableOpacity style={[styles.fileCardBtnPrimary, { borderRadius: radius.lg }]} onPress={downloadAndOpen} activeOpacity={0.85}>
                <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <MaterialCommunityIcons name="open-in-new" size={18} color="#fff" />
                <Text style={[styles.primaryBtnText, { fontSize: font.md }]}>Open with…</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fileCardBtnOutline, { borderRadius: radius.lg, borderColor: colors.borderSoft }]} onPress={downloadAndOpen} activeOpacity={0.7}>
                <MaterialCommunityIcons name="share-variant" size={18} color={colors.content} />
                <Text style={[styles.outlineBtnText, { color: colors.content, fontSize: font.md }]}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fileCardBtnOutline, { borderRadius: radius.lg, borderColor: colors.borderSoft }]} onPress={handleShareLink} activeOpacity={0.7}>
                <MaterialCommunityIcons name="link-variant" size={18} color={colors.content} />
                <Text style={[styles.outlineBtnText, { color: colors.content, fontSize: font.md }]}>Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Video ─────────────────────────────────────────────────────────────
function VideoPlayer({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => setReady(status === "readyToPlay"));
    return () => {
      sub.remove();
      player.pause();
    };
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

// ── Immersive Vinyl Audio Player ────────────────────────────────────────────
function AudioPlayer({ uri, name, size, ext, rootId, path, onShare }: { uri: string; name: string; size: number; ext: string; rootId: string; path: string; onShare: () => void }) {
  const { colors, font, gradients } = useTheme();
  const { api } = useSession();
  const [favorited, setFavorited] = useState(false);
  const player = useVideoPlayer(uri);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const [loop, setLoop] = useState(false);
  const [isEnded, setIsEnded] = useState(false);

  // Scrubbing state.
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const barRef = useRef<View>(null);
  const barWidth = useRef(0);

  // Animation values
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Mirror scrubPos into a ref so the timeUpdate listener can read it.
  const scrubPosRef = useRef<number | null>(null);
  useEffect(() => {
    scrubPosRef.current = scrubPos;
  }, [scrubPos]);

  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
    player.loop = loop;
  }, [loop, player]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.5;
    const subs = [
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (isPlaying) setIsEnded(false);
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (scrubPosRef.current === null) setCurrent(currentTime);
      }),
      player.addListener("statusChange", ({ status }) => {
        setReady(status === "readyToPlay");
        setError(status === "error");
        if (status === "readyToPlay") {
          if (player.duration) setDuration(player.duration);
          player.play();
        }
      }),
      player.addListener("playToEnd", () => {
        if (!loopRef.current) {
          setIsEnded(true);
          setPlaying(false);
        }
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      player.pause();
    };
  }, [player]);

  // Handle Disc Rotation
  useEffect(() => {
    if (playing) {
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      spinAnim.stopAnimation();
      spinAnim.extractOffset(); // Keeps current rotation, resets value to 0 for next loop
    }
  }, [playing, spinAnim]);

  // Handle Loading Pulse
  useEffect(() => {
    if (!ready && !error) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [ready, error, pulseAnim]);

  const togglePlay = useCallback(() => {
    if (!ready) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isEnded) {
      player.currentTime = 0;
      player.play();
      setIsEnded(false);
      return;
    }
    if (playing) player.pause();
    else player.play();
  }, [player, playing, ready, isEnded]);

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

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.playerRoot}>
      <LinearGradient colors={["#0F172A", "#060E20"]} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={styles.playerInner} bounces={false}>
        {/* Vinyl Disc Component */}
        <View style={styles.vinylWrap}>
          {/* Glass Overlay Container */}
          <View style={styles.glassContainer}>
            <LinearGradient colors={["rgba(255,255,255,0.15)", "rgba(255,255,255,0)"]} style={[StyleSheet.absoluteFill, { borderRadius: 150 }]} />
            <View style={styles.glassInner}>
              <Animated.View style={[styles.vinylDisc, { transform: [{ rotate: spinInterpolate }] }, error && { opacity: 0.5 }]}>
                <View style={styles.groove1} />
                <View style={styles.groove2} />
                <View style={styles.groove3} />
                <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.vinylLabel}>
                  <MaterialCommunityIcons name="music-note" size={32} color="#fff" />
                  <View style={styles.vinylHole} />
                </LinearGradient>
              </Animated.View>
            </View>
          </View>
        </View>

        {/* Track Info */}
        <View style={styles.infoWrap}>
          {error ? (
            <>
              <Text style={[styles.trackName, { fontSize: font.xl }]} numberOfLines={2}>Playback Error</Text>
              <Text style={[styles.playerError, { color: colors.danger, fontSize: font.sm }]}>Could not play this file.</Text>
            </>
          ) : !ready ? (
            <>
              <Text style={[styles.trackName, { fontSize: font.xl }]} numberOfLines={2}>Loading...</Text>
              <Text style={[styles.trackMeta, { color: "rgba(218, 226, 253, 0.7)", fontSize: font.sm }]}>Preparing audio track</Text>
            </>
          ) : (
            <>
              <Text style={[styles.trackName, { fontSize: font.xl }]} numberOfLines={2}>{name}</Text>
              <View style={styles.trackMetaRow}>
                <Text style={[styles.trackMeta, { color: "rgba(218, 226, 253, 0.7)", fontSize: font.sm, textTransform: "uppercase", letterSpacing: 2 }]}>
                  {ext.toUpperCase()} AUDIO
                </Text>
                <EqBars playing={playing && !error} tint={colors.accent} />
              </View>
            </>
          )}
        </View>

        <View style={{ flex: 1 }} />

        {/* Seek Bar */}
        <View style={styles.seekWrap}>
          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: "rgba(218, 226, 253, 0.7)" }]}>{fmtTime(shown)}</Text>
            <Text style={[styles.timeText, { color: "rgba(218, 226, 253, 0.7)" }]}>{ready ? fmtTime(duration) : "—:—"}</Text>
          </View>
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
            <View style={styles.seekBg} />
            <View style={[styles.seekFill, { width: `${pct * 100}%` }]}>
              <LinearGradient colors={["#a6c8ff", "#6366F1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </View>
            <View style={[styles.seekThumbWrap, { left: `${pct * 100}%` }]}>
              <View style={[styles.seekThumbGlow, { backgroundColor: "#a6c8ff" }]} />
              <View style={styles.seekThumb} />
            </View>
          </View>
        </View>

        {/* Controls Row */}
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(-15)} hitSlop={8}>
            <MaterialCommunityIcons name="rewind-15" size={32} color="#dae2fd" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.playBtnWrap} onPress={error ? onShare : togglePlay} activeOpacity={0.85}>
            <View style={[StyleSheet.absoluteFill, styles.playBtnGlass]} />
            <MaterialCommunityIcons
              name={error ? "download" : isEnded ? "replay" : playing ? "pause" : "play"}
              size={44}
              color="#c0c1ff"
              style={!playing && !isEnded && !error ? { marginLeft: 4 } : {}}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(15)} hitSlop={8}>
            <MaterialCommunityIcons name="fast-forward-15" size={32} color="#dae2fd" />
          </TouchableOpacity>
        </View>

        {/* Bottom Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              if (!api) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              if (favorited) {
                api.removeFavorite(rootId, path)
                  .then(() => setFavorited(false))
                  .catch(() => {});
              } else {
                api.addFavorite(rootId, path)
                  .then(() => setFavorited(true))
                  .catch(() => {});
              }
            }}
          >
            <MaterialCommunityIcons name={favorited ? "heart" : "heart-outline"} size={24} color={favorited ? colors.danger : "rgba(255,255,255,0.5)"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
            <MaterialCommunityIcons name="share-variant" size={24} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setLoop(!loop)}>
            <MaterialCommunityIcons name={loop ? "repeat-once" : "repeat"} size={24} color={loop ? "#c0c1ff" : "rgba(255,255,255,0.5)"} />
          </TouchableOpacity>
        </View>
      </ScrollView>
      {/* Hidden view keeps the native player alive */}
      <VideoView player={player} style={styles.hiddenVideo} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },

  // Image Preview
  imageContainer: { flex: 1, backgroundColor: "#000" },
  imageLoadingWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center", zIndex: 2 },
  image: { width: "100%", height: "100%" },
  imageGradientTop: { position: "absolute", top: 0, left: 0, right: 0, height: 120 },
  imageGradientBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 160 },
  imageToolbar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", padding: 24, paddingBottom: 44, zIndex: 10 },
  imageInfoChip: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  imageInfoText: { color: "#fff", fontSize: 11, fontWeight: "500" },
  imageToolBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", marginLeft: 12 },

  // Video
  videoWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
  videoLoading: { position: "absolute", alignSelf: "center" },

  // Text / Code / Markdown
  textRoot: { flex: 1 },
  docHeader: { flexDirection: "row", alignItems: "center", padding: 20, marginBottom: 16, borderWidth: 1, overflow: "hidden" },
  docHeaderInfo: { flex: 1, marginRight: 16 },
  docFileName: { fontWeight: "700", marginBottom: 6 },
  docBadges: { flexDirection: "row", alignItems: "center", gap: 8 },
  docBadge: { backgroundColor: "rgba(92,107,192,0.15)", paddingHorizontal: 8, paddingVertical: 2 },
  docBadgeText: { fontSize: 10, fontWeight: "700" },
  docLinesText: {},
  docHeaderActions: { flexDirection: "row", gap: 12 },
  docActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  textScroll: { flex: 1 },
  textContent: { padding: 16, paddingBottom: 100 },
  plainText: { lineHeight: 24 },

  codeContainer: { overflow: "hidden" },
  codeInner: { paddingVertical: 12 },
  codeLine: { flexDirection: "row" },
  codeLineNum: { width: 40, textAlign: "right", paddingRight: 12, fontFamily: "monospace", fontSize: 13, lineHeight: 22 },
  codeLineText: { fontFamily: "monospace", fontSize: 13, lineHeight: 22 },

  markdownContainer: { flex: 1 },
  mdHeader: { fontWeight: "700", marginTop: 16, marginBottom: 8 },
  mdText: { lineHeight: 24, marginBottom: 12 },
  mdBold: { fontWeight: "bold" },
  mdCodeInline: { fontFamily: "monospace" },
  mdCodeBlockDelim: { fontFamily: "monospace", marginVertical: 4 },

  floatingCopyBtn: {
    position: "absolute",
    bottom: 32,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#5B8CFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  floatingCopyText: { color: "#fff", fontWeight: "600", marginLeft: 8 },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    pointerEvents: "none",
  },

  // PDF / Other File Card
  fileCard: { width: "100%", maxWidth: 400, padding: 32, alignItems: "center", borderWidth: 1, overflow: "hidden" },
  fileCardIconWrap: { marginBottom: 16 },
  fileCardTitle: { fontWeight: "700", textAlign: "center", marginBottom: 4 },
  fileCardSub: { marginBottom: 24 },
  fileCardDetails: { width: "100%", padding: 12, gap: 12, marginBottom: 24 },
  fileCardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fileCardLabel: { fontWeight: "500" },
  fileCardValue: { flex: 1, textAlign: "right", marginLeft: 16 },
  fileCardButtons: { flexDirection: "row", gap: 12, width: "100%" },
  fileCardBtnPrimary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, overflow: "hidden" },
  fileCardBtnOutline: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderWidth: 1 },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  outlineBtnText: { fontWeight: "600" },

  // --- Audio Player Styles (Digital Sanctuary) ---
  playerRoot: { flex: 1, overflow: "hidden", backgroundColor: "#060E20" },
  playerInner: { flexGrow: 1, padding: 24, paddingTop: 40, paddingBottom: 48 },

  // Vinyl Glass Container
  vinylWrap: { alignItems: "center", justifyContent: "center", marginVertical: 40 },
  glassContainer: {
    padding: 12,
    borderRadius: 150,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 10,
  },
  glassInner: {
    borderRadius: 138,
    overflow: "hidden",
  },
  vinylDisc: {
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  groove1: { position: "absolute", width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  groove2: { position: "absolute", width: 170, height: 170, borderRadius: 85, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  groove3: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  vinylLabel: { width: 90, height: 90, borderRadius: 45, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" },
  vinylHole: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: "#111", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },

  // Track Info
  infoWrap: { alignItems: "center", marginTop: 10, marginBottom: 40, paddingHorizontal: 16 },
  trackName: { color: "#fff", fontWeight: "700", textAlign: "center", marginBottom: 6 },
  trackMeta: {},
  trackMetaRow: { flexDirection: "row", alignItems: "center", gap: 12, opacity: 0.7 },
  playerError: { marginTop: 4 },

  // Seek bar
  seekWrap: { width: "100%", marginBottom: 40 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 4 },
  timeText: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "500", opacity: 0.7 },
  seekTrack: { height: 30, justifyContent: "center", marginHorizontal: 4 },
  seekBg: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)" },
  seekFill: { height: 4, borderRadius: 2, overflow: "hidden" },
  seekThumbWrap: { position: "absolute", width: 24, height: 24, marginLeft: -12, alignItems: "center", justifyContent: "center" },
  seekThumbGlow: { position: "absolute", width: 36, height: 36, borderRadius: 18, opacity: 0.2 },
  seekThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    shadowColor: "#fff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },

  // Controls Row
  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 32, marginBottom: 40 },
  skipBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  playBtnWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  playBtnGlass: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 44,
  },

  // Bottom Actions
  actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 48 },
  actionBtn: { padding: 10 },

  hiddenVideo: { position: "absolute", width: 1, height: 1 },
});
