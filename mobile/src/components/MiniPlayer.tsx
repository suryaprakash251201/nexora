import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  FlatList,
  Animated,
  Modal,
  Dimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FileItem } from "../api/types";
import { useAudio } from "../store/AudioContext";
import { useTheme } from "../store/ThemeContext";
import { useSession } from "../store/SessionContext";
import { tabBarTotalHeight } from "./PremiumTabBar";
import { EqBars } from "./EqBars";
import { PressScale } from "./motion";
import { BottomSheet } from "./BottomSheet";
import { AudioQualityPill } from "./AudioQualityBadge";
import { AudioQualityDetail } from "./AudioQualityDetail";
import { LosslessWave } from "./LosslessBadge";
import { detectAudioQuality } from "../lib/audioQuality";
import { cleanTrackTitle } from "../lib/fileMeta";
import { copyShareLink } from "../lib/shareLink";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export function MiniPlayer({ tabVisible = true }: { tabVisible?: boolean }) {
  const { currentTrack, player, nextTrack, prevTrack, closePlayer, shuffle, setShuffle, playTrack, playlist, queueIndex } = useAudio();
  const { colors, font, gradients, radius, shadow, isDark } = useTheme();
  const { api } = useSession();
  const insets = useSafeAreaInsets();

  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [modalVisible, setModalVisible] = useState(false);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [moreSheet, setMoreSheet] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  // Tap the lossless wave in the fullscreen player to reveal/hide the
  // track's audio details (codec · bit depth · sample rate).
  const [showQuality, setShowQuality] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const qualityAnim = useRef(new Animated.Value(0)).current;

  // Lossless / hi-res detection for the wave badge — computed early so the
  // quality-toggle effect below can read it.
  const qInfo = detectAudioQuality(currentTrack?.extension || "", currentTrack?.mime, currentTrack?.size);
  const isLossless = qInfo.isLossless;

  // Animate the quality details panel in/out (always visible for
  // non-lossless tracks, which have no wave toggle).
  useEffect(() => {
    Animated.timing(qualityAnim, {
      toValue: isLossless ? (showQuality ? 1 : 0) : 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [showQuality, qualityAnim, isLossless]);
  const [favorited, setFavorited] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const artworkScaleAnim = useRef(new Animated.Value(0.92)).current;

  const haptic = (style: "light" | "medium" = "light") =>
    Haptics.impactAsync(
      style === "light" ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
    ).catch(() => {});

  // Sync the favorite state for the current track.
  useEffect(() => {
    let cancelled = false;
    setFavorited(false);
    if (!currentTrack || !api) return;
    api
      .listFavorites()
      .then((res) => {
        if (cancelled) return;
        setFavorited(res.items.some((f) => f.root_id === currentTrack.root_id && f.path === currentTrack.path));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentTrack, api]);

  // ─── Listen to player state & sync timeline ──────────────────────────
  useEffect(() => {
    if (!player) return;
    const subPlaying = player.addListener("playingChange", ({ isPlaying }: { isPlaying: boolean }) =>
      setPlaying(isPlaying)
    );
    const subStatus = player.addListener("statusChange", ({ status: s }: { status: string }) =>
      setStatus(s)
    );
    setStatus(player.status);

    let lastT = -1;
    let lastD = -1;
    const interval = setInterval(() => {
      const t = player.currentTime;
      const d = player.duration || 0;
      if (Math.abs(t - lastT) > 0.25) {
        setCurrentTime(t);
        lastT = t;
      }
      if (d !== lastD) {
        setDuration(d);
        lastD = d;
      }
    }, 500);

    return () => {
      subPlaying.remove();
      subStatus.remove();
      clearInterval(interval);
    };
  }, [player]);

  // Wire repeat "one" to the native loop; "all" lets the queue auto-advance.
  useEffect(() => {
    if (!player) return;
    player.loop = repeat === "one";
  }, [player, repeat]);

  // ─── Artwork scale animation (Apple Music style) ─────────────────────
  useEffect(() => {
    if (playing && modalVisible) {
      Animated.spring(artworkScaleAnim, {
        toValue: 1.0,
        damping: 15,
        stiffness: 150,
        mass: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(artworkScaleAnim, {
        toValue: 0.92,
        damping: 15,
        stiffness: 150,
        mass: 1,
        useNativeDriver: true,
      }).start();
    }
  }, [playing, modalVisible]);

  if (!currentTrack) return null;

  // ─── Helpers ─────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (!player) return;
    if (playing) player.pause();
    else player.play();
  };

  const openModal = () => {
    setModalVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 25,
      stiffness: 250,
    }).start();
  };

  const closeModal = () => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setModalVisible(false));
  };

  const coverUrl = api ? api.thumbnailUrl(currentTrack.root_id, currentTrack.path, 512) : null;
  const ext = currentTrack.extension || "";

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const toggleRepeat = () => {
    if (repeat === "off") setRepeat("all");
    else if (repeat === "all") setRepeat("one");
    else setRepeat("off");
  };

  const handleScrub = (locationX: number) => {
    if (player && duration > 0 && locationX != null) {
      const pct = Math.max(0, Math.min(1, locationX / scrubberWidth));
      player.currentTime = pct * duration;
    }
  };

  // ── Track actions (favorite / share / download / link) ──────────────
  const toggleFavorite = () => {
    if (!currentTrack || !api) return;
    haptic();
    if (favorited) {
      api
        .removeFavorite(currentTrack.root_id, currentTrack.path)
        .then(() => {
          setFavorited(false);
          Alert.alert("Removed", "Removed from Liked Songs.");
        })
        .catch(() => Alert.alert("Could not remove", "Try again in a moment."));
    } else {
      api
        .addFavorite(currentTrack.root_id, currentTrack.path)
        .then(() => {
          setFavorited(true);
          haptic("medium");
          Alert.alert("Liked", "Added to Liked Songs.");
        })
        .catch(() => Alert.alert("Could not like", "Try again in a moment."));
    }
  };

  const downloadAndShare = async (share: boolean) => {
    if (!currentTrack || !api) return;
    setDownloading(true);
    try {
      const target = new File(
        Paths.cache,
        "nexora-" + currentTrack.name.replace(/[^\w.\-]+/g, "_")
      );
      await File.downloadFileAsync(
        api.rawFileUrl(currentTrack.root_id, currentTrack.path),
        target
      );
      if (share && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(target.uri, { mimeType: currentTrack.mime || undefined });
      } else {
        Alert.alert("Downloaded", `"${currentTrack.name}" saved to the app cache.`);
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.message || "Something went wrong.");
    } finally {
      setDownloading(false);
    }
  };

  const copyLink = async () => {
    if (!currentTrack || !api) return;
    haptic();
    const url = await copyShareLink(api, currentTrack.root_id, currentTrack.path);
    if (url) Alert.alert("Link copied", url);
  };

  const jumpTo = (item: FileItem) => {
    haptic();
    setQueueOpen(false);
    if (!currentTrack || item.path !== currentTrack.path) {
      playTrack(item, playlist);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────────
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          MINI PLAYER (bottom bar — flush above the tab bar on tab screens,
          at the very bottom on pushed screens with no tab bar)
          ═══════════════════════════════════════════════════════════════ */}
      <View
        style={[
          styles.miniContainer,
          {
            bottom: tabVisible
              ? tabBarTotalHeight(insets.bottom) + 10
              : insets.bottom + 10,
          },
          shadow,
        ]}
      >
        <TouchableOpacity
          style={[
            styles.miniInner,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft },
          ]}
          activeOpacity={0.9}
          onPress={openModal}
        >
          <LinearGradient
            colors={["rgba(255,255,255,0.06)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.glassHighlight}
          />

          <View style={[styles.miniIconWrap, { backgroundColor: colors.surfaceMuted, overflow: "hidden" }]}>
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={300}
              />
            ) : (
              <MaterialCommunityIcons name="music-note" size={24} color={gradients.brand[0]} />
            )}
          </View>

          <View style={styles.miniTextWrap}>
            <Text
              style={[styles.miniTitle, { color: colors.content, fontSize: font.sm }]}
              numberOfLines={1}
            >
              {cleanTrackTitle(currentTrack.name)}
            </Text>
            <View style={styles.miniSubRow}>
              {isLossless ? (
                <LosslessWave />
              ) : (
                <AudioQualityPill
                  extension={ext}
                  mime={currentTrack.mime}
                  fileSize={currentTrack.size}
                />
              )}
              <Text
                style={[styles.miniSub, { color: colors.muted, fontSize: font.xs }]}
                numberOfLines={1}
              >
                {currentTrack.extension?.toUpperCase() || "AUDIO"} · Nexora
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.miniBtn} onPress={() => { haptic(); togglePlay(); }}>
            {status === "loading" ? (
              <ActivityIndicator color={colors.content} size="small" />
            ) : (
              <MaterialCommunityIcons
                name={playing ? "pause" : "play"}
                size={32}
                color={colors.content}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={() => { haptic(); closePlayer(); }}>
            <MaterialCommunityIcons name="close" size={28} color={colors.content} />
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Live progress bar along the bottom edge of the mini card */}
        <View style={[styles.miniProgressTrack, { backgroundColor: colors.borderSoft }]}>
          <LinearGradient
            colors={[...gradients.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.miniProgressFill, { width: `${progressPct}%` }]}
          />
        </View>
      </View>

      {/* ═══════════════════════════════════════════════════════════════
          FULL SCREEN PLAYER (modal) — Apple Music style
          ═══════════════════════════════════════════════════════════════ */}
      {modalVisible && (
        <Modal transparent visible={modalVisible} animationType="none" onRequestClose={closeModal}>
          <Animated.View style={[styles.modalRoot, { transform: [{ translateY: slideAnim }] }]}>
            {/* ── Background: blurred artwork + dark overlay + blur ── */}
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={90}
              />
            ) : (
              <LinearGradient colors={[...gradients.player]} style={StyleSheet.absoluteFill} />
            )}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)" },
              ]}
            />
            <BlurView
              intensity={60}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />

            {/* ── Header: chevron-down / source label / more ── */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={closeModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialCommunityIcons name="chevron-down" size={30} color={colors.content} />
              </TouchableOpacity>

              <View style={styles.headerCenter}>
                <Text
                  style={[
                    styles.headerLabel,
                    { color: colors.content, opacity: 0.55 },
                  ]}
                >
                  PLAYING FROM
                </Text>
                <Text
                  style={[
                    styles.headerSource,
                    { color: colors.content, opacity: 0.85 },
                  ]}
                  numberOfLines={1}
                >
                  Nexora
                </Text>
              </View>

              <TouchableOpacity
                style={styles.headerBtn}
                onPress={() => {
                  haptic();
                  setMoreSheet(true);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialCommunityIcons
                  name="dots-horizontal"
                  size={24}
                  color={colors.content}
                  style={{ opacity: 0.7 }}
                />
              </TouchableOpacity>
            </View>

            {/* ── Main Content Area ── */}
            <View style={styles.modalContent}>
              {/* ── Artwork ── */}
              <View style={styles.artworkSection}>
                <View style={styles.artworkShadowWrap}>
                  <Animated.View
                    style={[
                      styles.artworkBox,
                      { transform: [{ scale: artworkScaleAnim }] },
                    ]}
                  >
                    {coverUrl ? (
                      <Image
                        source={{ uri: coverUrl }}
                        style={styles.artworkImage}
                        contentFit="cover"
                        transition={300}
                      />
                    ) : (
                      <LinearGradient
                        colors={[...gradients.brand]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      >
                        <View style={styles.artworkPlaceholder}>
                          <MaterialCommunityIcons name="music-note" size={80} color="#fff" />
                        </View>
                      </LinearGradient>
                    )}
                    {status === "loading" && (
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          styles.artworkLoading,
                          {
                            backgroundColor: isDark
                              ? "rgba(0,0,0,0.45)"
                              : "rgba(255,255,255,0.45)",
                          },
                        ]}
                      >
                        <ActivityIndicator size="large" color={colors.content} />
                      </View>
                    )}
                  </Animated.View>
                </View>
              </View>

              {/* ── Track Info + More Button ── */}
              <View style={styles.trackInfoRow}>
                <View style={styles.trackTextCol}>
                  <Text
                    style={[
                      styles.trackName,
                      { fontSize: font.xl, color: colors.content },
                    ]}
                    numberOfLines={1}
                  >
                    {cleanTrackTitle(currentTrack.name)}
                  </Text>
                  <Text
                    style={[
                      styles.trackArtist,
                      { fontSize: font.sm, color: colors.content, opacity: 0.55 },
                    ]}
                    numberOfLines={1}
                  >
                    {ext.toUpperCase() || "AUDIO"} · Nexora
                  </Text>
                </View>
              </View>

              {/* ── Lossless wave — centered below title; tap to toggle the
                    audio details (codec · bit depth · sample rate) ── */}
              {isLossless && (
                <TouchableOpacity
                  style={styles.titleWaveWrap}
                  onPress={() => {
                    haptic();
                    setShowQuality((v) => !v);
                  }}
                  activeOpacity={0.7}
                >
                  <LosslessWave size="lg" />
                </TouchableOpacity>
              )}

              {/* ── Audio quality details (hidden by default for lossless;
                    revealed by tapping the wave icon) ── */}
              {(isLossless ? showQuality : true) && (
                <Animated.View
                  style={[
                    styles.qualityRow,
                    {
                      opacity: qualityAnim,
                      transform: [
                        {
                          translateY: qualityAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [6, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View style={styles.qualityBadgeRow}>
                    <AudioQualityDetail
                      extension={ext}
                      mime={currentTrack.mime}
                      fileSize={currentTrack.size}
                      duration={duration > 0 ? duration : undefined}
                    />
                  </View>
                  {isLossless && (
                    <Text style={[styles.qualitySummary, { color: colors.content, opacity: 0.55, fontSize: font.xs }]}>
                      {qInfo.isHiRes ? "HI-RES" : "LOSSLESS"} {qInfo.codec} · {qInfo.detail || qInfo.label}
                    </Text>
                  )}
                </Animated.View>
              )}

              {/* ── Progress Scrubber — gradient fill, drag knob ── */}
              <View style={styles.scrubberWrap}>
                <View
                  style={styles.scrubberHitbox}
                  onLayout={(e) => setScrubberWidth(e.nativeEvent.layout.width)}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => {
                    setScrubbing(true);
                    handleScrub(e.nativeEvent.locationX);
                  }}
                  onResponderMove={(e) => handleScrub(e.nativeEvent.locationX)}
                  onResponderRelease={() => setScrubbing(false)}
                  onResponderTerminate={() => setScrubbing(false)}
                >
                  <View
                    style={[
                      styles.scrubberTrack,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.14)"
                          : "rgba(0,0,0,0.10)",
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={[...gradients.brand]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[
                        styles.scrubberFill,
                        { width: `${progressPct}%` },
                      ]}
                    />
                  </View>
                  {/* Drag knob — appears while scrubbing (Apple Music style) */}
                  {scrubbing && (
                    <View style={[styles.scrubberThumb, { left: `${progressPct}%` }]}>
                      <View
                        style={[
                          styles.scrubberThumbGlow,
                          { backgroundColor: colors.accent },
                        ]}
                      />
                      <View
                        style={[
                          styles.scrubberThumbCore,
                          { backgroundColor: colors.accent },
                        ]}
                      />
                    </View>
                  )}
                </View>
                <View style={styles.timeRow}>
                  <Text
                    style={[
                      styles.timeText,
                      { color: colors.content, opacity: 0.9, fontSize: 12 },
                    ]}
                  >
                    {formatTime(currentTime)}
                  </Text>
                  <Text
                    style={[
                      styles.timeText,
                      { color: colors.content, opacity: 0.45, fontSize: 12 },
                    ]}
                  >
                    {duration > 0 ? `-${formatTime(duration - currentTime)}` : "-:--"}
                  </Text>
                </View>
              </View>

              {/* ── Main Controls: skip-back / play-pause / skip-forward ── */}
              <View style={styles.mainControlsRow}>
                <PressScale scaleTo={0.9}>
                  <TouchableOpacity
                    style={[
                      styles.skipBtn,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.05)",
                        borderColor: isDark
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(0,0,0,0.08)",
                      },
                    ]}
                    onPress={prevTrack}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="skip-previous"
                      size={30}
                      color={colors.content}
                    />
                  </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.94}>
                  <TouchableOpacity
                    style={styles.playPauseBtn}
                    onPress={togglePlay}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {status === "loading" ? (
                      <ActivityIndicator color="#fff" size="large" />
                    ) : (
                      <View style={styles.playPauseCircle}>
                        <LinearGradient
                          colors={[...gradients.brand]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                        {/* Inner highlight ring for depth */}
                        <View style={styles.playPauseRing} />
                        <MaterialCommunityIcons
                          name={playing ? "pause" : "play"}
                          size={36}
                          color="#fff"
                          style={playing ? undefined : { marginLeft: 4 }}
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.9}>
                  <TouchableOpacity
                    style={[
                      styles.skipBtn,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.05)",
                        borderColor: isDark
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(0,0,0,0.08)",
                      },
                    ]}
                    onPress={nextTrack}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="skip-next"
                      size={30}
                      color={colors.content}
                    />
                  </TouchableOpacity>
                </PressScale>
              </View>

              {/* ── Secondary Controls Row: shuffle / repeat / queue / like ── */}
              <View style={styles.secondaryControlsRow}>
                <PressScale scaleTo={0.88}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, shuffle && styles.secondaryBtnActive]}
                    onPress={() => {
                      haptic();
                      setShuffle(!shuffle);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="shuffle-variant"
                      size={22}
                      color={shuffle ? colors.accent : colors.muted}
                    />
                  </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.88}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, repeat !== "off" && styles.secondaryBtnActive]}
                    onPress={() => {
                      haptic();
                      toggleRepeat();
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name={repeat === "one" ? "repeat-once" : "repeat"}
                      size={22}
                      color={repeat !== "off" ? colors.accent : colors.muted}
                    />
                  </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.88}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, queueOpen && styles.secondaryBtnActive]}
                    onPress={() => {
                      haptic();
                      setQueueOpen(true);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="playlist-music"
                      size={22}
                      color={queueOpen ? colors.accent : colors.muted}
                    />
                  </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.88}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, favorited && styles.secondaryBtnActive]}
                    onPress={toggleFavorite}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name={favorited ? "heart" : "heart-outline"}
                      size={22}
                      color={favorited ? colors.danger : colors.muted}
                    />
                  </TouchableOpacity>
                </PressScale>
              </View>
            </View>

            {/* ── Queue panel (slide-up overlay) ── */}
            {queueOpen && (
              <View style={styles.queueOverlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setQueueOpen(false)} />
                <View
                  style={[
                    styles.queuePanel,
                    {
                      backgroundColor: isDark ? "rgba(16,18,26,0.96)" : "rgba(255,255,255,0.98)",
                      borderColor: colors.borderSoft,
                      paddingBottom: insets.bottom + 16,
                    },
                  ]}
                >
                  <View style={styles.queueHeader}>
                    <View style={styles.queueHeaderLeft}>
                      <MaterialCommunityIcons name="playlist-music" size={18} color={colors.accent} />
                      <Text style={[styles.queueTitle, { color: colors.content, fontSize: font.md }]}>Up Next</Text>
                      <Text style={[styles.queueCount, { color: colors.muted, fontSize: font.xs }]}>
                        {playlist.length} track{playlist.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setQueueOpen(false)} hitSlop={10} style={styles.queueClose}>
                      <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
                    </TouchableOpacity>
                  </View>

                  <FlatList
                    data={playlist}
                    keyExtractor={(it, i) => it.root_id + it.path + i}
                    style={styles.queueList}
                    contentContainerStyle={{ paddingBottom: 8 }}
                    ListEmptyComponent={
                      <Text style={[styles.queueEmpty, { color: colors.muted, fontSize: font.sm }]}>
                        The queue is empty — add tracks from your library.
                      </Text>
                    }
                    renderItem={({ item, index }) => {
                      const isCur = index === queueIndex;
                      return (
                        <TouchableOpacity
                          style={[
                            styles.queueRow,
                            isCur && { backgroundColor: colors.accentSoft },
                          ]}
                          onPress={() => jumpTo(item)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.queueIndexWrap}>
                            {isCur && playing ? (
                              <EqBars playing barCount={3} tint={colors.accent} />
                            ) : (
                              <Text style={[styles.queueIndex, { color: isCur ? colors.accent : colors.muted }]}>
                                {String(index + 1).padStart(2, "0")}
                              </Text>
                            )}
                          </View>
                          <View style={styles.queueText}>
                            <Text
                              style={[
                                styles.queueName,
                                { color: isCur ? colors.accent : colors.content, fontSize: font.sm },
                              ]}
                              numberOfLines={1}
                            >
                              {cleanTrackTitle(item.name)}
                            </Text>
                            <Text style={[styles.queueSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
                              {(item.extension || "").toUpperCase()} · {item.path}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="play" size={16} color={isCur ? colors.accent : "transparent"} />
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              </View>
            )}
          </Animated.View>
        </Modal>
      )}

      {/* ── Track actions sheet ── */}
      <BottomSheet
        visible={moreSheet}
        onClose={() => setMoreSheet(false)}
        title={currentTrack?.name}
        actions={[
          {
            label: favorited ? "Remove from favorites" : "Add to favorites",
            icon: favorited ? "heart" : "heart-outline",
            onPress: toggleFavorite,
          },
          {
            label: "Download",
            icon: "download",
            onPress: () => downloadAndShare(false),
          },
          {
            label: "Share",
            icon: "share-variant",
            onPress: () => downloadAndShare(true),
          },
          {
            label: "Copy share link",
            icon: "link-variant",
            onPress: copyLink,
          },
        ]}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  /* ── Mini Player ─────────────────────────────────────────────────── */
  miniContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0, // overridden at runtime: tab bar height + gap
    zIndex: 999,
  },
  miniInner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    padding: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: "none",
  },
  miniIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  miniTextWrap: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center",
  },
  miniSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  miniTitle: { fontWeight: "700" },
  miniSub: {},
  miniBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  miniProgressTrack: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: -3,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  miniProgressFill: { height: "100%", borderRadius: 2 },

  /* ── Full Screen Modal ───────────────────────────────────────────── */
  modalRoot: {
    flex: 1,
  },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  headerSource: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 1,
  },

  /* Modal Content */
  modalContent: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "flex-end",
    paddingBottom: 48,
  },

  /* Artwork */
  artworkSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  artworkShadowWrap: {
    width: "100%",
    aspectRatio: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.55,
    shadowRadius: 40,
    elevation: 28,
  },
  artworkBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  artworkImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  artworkPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  artworkLoading: {
    alignItems: "center",
    justifyContent: "center",
  },

  /* Track Info */
  trackInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 4,
  },
  trackTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  trackName: {
    fontWeight: "800",
    marginBottom: 3,
  },
  trackArtist: {
    fontWeight: "500",
  },
  /* Lossless wave under the title */
  titleWaveWrap: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 2,
  },

  /* Audio Quality */
  qualityRow: {
    marginBottom: 20,
    marginTop: 4,
    alignItems: "center",
    gap: 6,
  },
  qualityBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  qualitySummary: {
    fontWeight: "600",
    letterSpacing: 0.3,
    textAlign: "center",
  },

  /* Scrubber */
  scrubberWrap: {
    marginBottom: 16,
  },
  scrubberHitbox: {
    height: 32,
    justifyContent: "center",
  },
  scrubberTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  scrubberFill: {
    height: "100%",
    borderRadius: 3,
  },
  scrubberThumb: {
    position: "absolute",
    width: 22,
    height: 22,
    marginLeft: -11,
    alignItems: "center",
    justifyContent: "center",
  },
  scrubberThumbGlow: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    opacity: 0.18,
  },
  scrubberThumbCore: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingHorizontal: 2,
  },
  timeText: {
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },

  /* Main Controls */
  mainControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 30,
    marginBottom: 28,
    marginTop: 8,
  },
  skipBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  playPauseBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  playPauseCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#4F46E5",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  playPauseRing: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },

  /* Secondary Controls */
  secondaryControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  secondaryBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnActive: {
    backgroundColor: "rgba(79,70,229,0.14)",
  },

  /* Queue Panel */
  queueOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    zIndex: 50,
  },
  queuePanel: {
    maxHeight: "70%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  queueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  queueHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  queueTitle: { fontWeight: "700" },
  queueCount: { fontWeight: "600" },
  queueClose: { padding: 4 },
  queueList: { flexGrow: 0 },
  queueEmpty: { textAlign: "center", paddingVertical: 24 },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  queueIndexWrap: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  queueIndex: { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  queueText: { flex: 1 },
  queueName: { fontWeight: "600" },
  queueSub: { marginTop: 2, fontWeight: "500" },
});
