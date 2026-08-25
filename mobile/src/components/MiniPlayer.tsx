import React, { useState, useEffect, useRef, useCallback } from "react";
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
  TextInput,
  Platform,
  PanResponder,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FileItem, Playlist } from "../api/types";
import { useAudio } from "../store/AudioContext";
import { useTheme } from "../store/ThemeContext";
import { useSession } from "../store/SessionContext";
import { tabBarTotalHeight } from "./PremiumTabBar";
import { EqBars } from "./EqBars";
import { PressScale } from "./motion";
import { AudioQualityPill } from "./AudioQualityBadge";
import { AudioQualityDetail } from "./AudioQualityDetail";
import { LosslessWave } from "./LosslessBadge";
import { detectAudioQuality } from "../lib/audioQuality";
import { cleanTrackTitle } from "../lib/fileMeta";
import { copyShareLink } from "../lib/shareLink";

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

/** Horizontal swipe distance (px) on the artwork that triggers prev/next. */
const SWIPE_X_THRESHOLD = 70;
/** Vertical swipe distance (px) that triggers queue-up / collapse-down. */
const SWIPE_Y_THRESHOLD = 60;

export function MiniPlayer({ tabVisible = true }: { tabVisible?: boolean }) {
  const { currentTrack, player, nextTrack, prevTrack, closePlayer, shuffle, setShuffle, playTrack, playlist, queueIndex } = useAudio();
  const { colors, font, gradients, radius, shadow, isDark } = useTheme();
  const { api } = useSession();
  const insets = useSafeAreaInsets();
  // Adaptive layout: landscape phones get a side-by-side player (artwork
  // left, controls right) instead of the stacked portrait layout.
  const { width: winW, height: winH } = useWindowDimensions();
  const isLandscape = winW > winH;

  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [modalVisible, setModalVisible] = useState(false);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [moreSheet, setMoreSheet] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  // Playlist picker from the "..." menu: add current track to a playlist
  // or create a new one.
  const [playlistPicker, setPlaylistPicker] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlistBusy, setPlaylistBusy] = useState(false);
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

  // ── Fullscreen swipe gestures ───────────────────────────────────────
  // Horizontal swipe on the artwork → previous/next track (artwork slides
  // out in the drag direction). Vertical swipe up → open the Up Next
  // queue; swipe down → collapse the player. Direction-locked so a
  // horizontal drag never fights a vertical one.
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const swipeLock = useRef<"h" | "v" | null>(null);
  const gestureActions = useRef<{
    next: () => void;
    prev: () => void;
    close: () => void;
    openQueue: () => void;
  }>({ next: () => {}, prev: () => {}, close: () => {}, openQueue: () => {} });

  // ── Queue panel slide-in + drag-to-dismiss ──────────────────────────
  const queueAnim = useRef(new Animated.Value(0)).current;
  const queueDrag = useRef(new Animated.Value(0)).current;

  const haptic = (style: "light" | "medium" = "light") =>
    Haptics.impactAsync(
      style === "light" ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
    ).catch(() => {});

  // Artwork swipe responder — created once; actions are read from
  // gestureActions.current so the callbacks always see fresh closures.
  const swipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        swipeLock.current = null;
      },
      onPanResponderMove: (_, g) => {
        if (!swipeLock.current) {
          if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8) return;
          swipeLock.current = Math.abs(g.dx) > Math.abs(g.dy) ? "h" : "v";
        }
        if (swipeLock.current === "h") {
          panX.setValue(g.dx);
        } else {
          panY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_, g) => {
        const lock = swipeLock.current;
        swipeLock.current = null;
        if (lock === "h") {
          const dir = g.dx < -SWIPE_X_THRESHOLD ? -1 : g.dx > SWIPE_X_THRESHOLD ? 1 : 0;
          if (dir !== 0) {
            // Slide the artwork out in the drag direction, then change track.
            Animated.timing(panX, {
              toValue: dir * SCREEN_WIDTH,
              duration: 190,
              useNativeDriver: true,
            }).start(() => {
              panX.setValue(0);
              if (dir < 0) gestureActions.current.next();
              else gestureActions.current.prev();
            });
          } else {
            Animated.spring(panX, { toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
          }
        } else if (lock === "v") {
          if (g.dy < -SWIPE_Y_THRESHOLD) {
            gestureActions.current.openQueue();
          } else if (g.dy > SWIPE_Y_THRESHOLD) {
            gestureActions.current.close();
          }
          Animated.spring(panY, { toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        swipeLock.current = null;
        Animated.spring(panX, { toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
        Animated.spring(panY, { toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
      },
    })
  ).current;

  // Queue panel drag-to-dismiss (only claims the gesture once a downward
  // move starts, so taps on the header buttons still work).
  const queueSwipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) queueDrag.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 70) setQueueOpen(false);
        Animated.timing(queueDrag, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.timing(queueDrag, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      },
    })
  ).current;

  // Queue slide-up entrance.
  useEffect(() => {
    if (queueOpen) {
      queueAnim.setValue(0);
      Animated.spring(queueAnim, {
        toValue: 1,
        damping: 26,
        stiffness: 240,
        useNativeDriver: true,
      }).start();
    }
  }, [queueOpen, queueAnim]);

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
    // Reset to a slightly smaller scale on every track change so the
    // artwork does a subtle pop when the song switches (also after a
    // swipe gesture).
    if (currentTrack?.path) {
      artworkScaleAnim.setValue(0.9);
    }
    Animated.spring(artworkScaleAnim, {
      toValue: playing && modalVisible ? 1.0 : 0.92,
      damping: 15,
      stiffness: 150,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [playing, modalVisible, currentTrack?.path, artworkScaleAnim]);

  // ── Cover art loading with bounded retry ─────────────────────────────
  // Thumbnails are generated server-side on demand (embedded album art is
  // extracted from the file on FIRST request). Right after a swipe the first
  // request can fail or hang under load, leaving the artwork blank. Strategy:
  // brand placeholder beneath · bounded retries with cache-busting · a
  // watchdog for hung requests · and — critically — per-track retry state
  // that resets SYNCHRONOUSLY during render (see artTrack below), so a new
  // track's very first request is always clean instead of reusing the
  // previous track's stale attempt counter.
  //
  // NOTE: these hooks MUST stay ABOVE the `if (!currentTrack) return null`
  // below — React requires the same hooks in the same order on every render,
  // and this component renders both without and with an active track.
  const MAX_ART_ATTEMPTS = 10;
  const [artAttempt, setArtAttempt] = useState(0);
  const [artFailed, setArtFailed] = useState(false);
  // True while the current coverUrl is being fetched (drives the small
  // spinner overlays and the hung-request watchdog below).
  const [artLoading, setArtLoading] = useState(false);

  // Per-track identity — resets retry state SYNCHRONOUSLY on track change.
  // The old passive-effect reset ran AFTER a render that had already built
  // coverUrl from the previous track's attempt counter, so every swipe fired
  // a polluted `&_r=<stale>` request before the clean one (double fetch,
  // wasted retry budget, visible blank window).
  const artTrackKey = currentTrack ? `${currentTrack.root_id}:${currentTrack.path}` : null;
  const [artTrack, setArtTrack] = useState(artTrackKey);
  if (artTrack !== artTrackKey) {
    setArtTrack(artTrackKey);
    setArtAttempt(0);
    setArtFailed(false);
    setArtLoading(false);
  }

  // All retries burned → stop mounting dead images; show the branded
  // placeholder and gradient background instead (one slow ambient retry
  // keeps trying so late-extracted covers still arrive eventually).
  const artGaveUp = artFailed && artAttempt >= MAX_ART_ATTEMPTS;

  useEffect(() => {
    if (!artFailed || artAttempt >= MAX_ART_ATTEMPTS) return;
    const t = setTimeout(() => setArtAttempt((n) => n + 1), Math.min(400 + artAttempt * 500, 1500));
    return () => clearTimeout(t);
  }, [artFailed, artAttempt]);

  // Ambient recovery after exhaustion: one quiet attempt every 10s so a
  // cover whose server-side extraction finished late still shows up without
  // user interaction.
  useEffect(() => {
    if (!artGaveUp) return;
    const t = setTimeout(() => {
      setArtFailed(false);
      setArtAttempt((n) => n + 1); // new cache-busted URL
    }, 10000);
    return () => clearTimeout(t);
  }, [artGaveUp]);

  const onArtError = useCallback(() => {
    // Mark failure so the backoff effect schedules the next attempt.
    setArtLoading(false);
    setArtFailed(true);
  }, []);

  const onArtLoad = useCallback(() => {
    // Success stops the retry chain.
    setArtLoading(false);
    setArtFailed(false);
  }, []);

  // ── Cover art URL (with cache-busting retry param) ──────────────────
  // Derived null-safely so it can live ABOVE the early return — EVERY hook
  // and its inputs must execute unconditionally on each render.
  const baseCoverUrl =
    api && currentTrack && !artGaveUp
      ? api.thumbnailUrl(currentTrack.root_id, currentTrack.path, 512)
      : null;
  const coverUrl =
    baseCoverUrl && artAttempt > 0
      ? `${baseCoverUrl}${baseCoverUrl.includes("?") ? "&" : "?"}_r=${artAttempt}`
      : baseCoverUrl;

  useEffect(() => {
    if (!coverUrl) return;
    setArtLoading(true);
    // Watchdog: some cover requests neither load nor error for a long time
    // (server-side extraction queue). If nothing happened after 5s, bust the
    // cache with a new attempt — the retry URL is a different URI, so expo-
    // image issues a genuinely fresh request instead of waiting on the old one.
    const wd = setTimeout(() => {
      setArtLoading(false);
      setArtAttempt((n) => (n < MAX_ART_ATTEMPTS ? n + 1 : n));
    }, 5000);
    return () => clearTimeout(wd);
  }, [coverUrl]);

  // Prefetch the previous & next covers as soon as the track settles — the
  // single highest-value warm-up: it makes the MOST LIKELY swipe target
  // instant, even when the full-queue prefetch hasn't reached it yet.
  useEffect(() => {
    if (!api || !currentTrack) return;
    const idx = playlist.findIndex((x) => x.path === currentTrack.path);
    if (idx < 0) return;
    const neighbors = [playlist[idx - 1], playlist[idx + 1]];
    for (const n of neighbors) {
      if (!n) continue;
      Image.prefetch(api.thumbnailUrl(n.root_id, n.path, 512)).catch(() => {});
    }
  }, [api, currentTrack, playlist]);

  if (!currentTrack) return null;

  // ─── Helpers ─────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (!player) return;
    if (playing) player.pause();
    else player.play();
  };

  const openModal = () => {
    // Clear any leftover swipe transform (an interrupted swipe-down close
    // can leave the artwork translated — reopening would show it shifted
    // over the timeline/controls).
    panX.setValue(0);
    panY.setValue(0);
    swipeLock.current = null;
    // Fresh cover-art retry cycle on every open — if retries were exhausted
    // while the server was busy, opening the player tries again immediately.
    setArtAttempt(0);
    setArtFailed(false);
    setModalVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 25,
      stiffness: 250,
    }).start();
  };

  // Close the fullscreen player. modalVisible is set to false IMMEDIATELY (not
  // in the animation callback) so the Modal can never linger mounted with an
  // off-screen view — an invisible-but-touch-capturing overlay that made the
  // whole app unresponsive until the mini player was closed. Also force-close
  // the action sheet / queue so no full-screen Modal can get stuck.
  const closeModal = () => {
    setModalVisible(false);
    setMoreSheet(false);
    setQueueOpen(false);
    setPlaylistPicker(false);
    // Fire-and-forget slide-down so the view doesn't snap abruptly when the
    // player is reopened during the same frame.
    slideAnim.setValue(SCREEN_HEIGHT);
  };

  const ext = currentTrack.extension || "";

  // Keep the swipe actions pointing at the live handlers (defined above).
  gestureActions.current = {
    next: () => {
      haptic("medium");
      nextTrack();
    },
    prev: () => {
      haptic("medium");
      prevTrack();
    },
    close: () => closeModal(),
    openQueue: () => {
      haptic();
      setQueueOpen(true);
    },
  };

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

  // ── Add-to-playlist / create-playlist (from the "..." menu) ──────
  const openPlaylistPicker = async () => {
    setMoreSheet(false);
    haptic();
    if (!api) return;
    setPlaylistPicker(true);
    setNewPlaylistName("");
    try {
      const res = await api.listPlaylists();
      setPlaylists(res.items || []);
    } catch {
      setPlaylists([]);
    }
  };

  const addToPlaylist = async (playlistId: string) => {
    if (!currentTrack || !api || playlistBusy) return;
    setPlaylistBusy(true);
    try {
      await api.addPlaylistItems(playlistId, [
        { root_id: currentTrack.root_id, path: currentTrack.path },
      ]);
      haptic("medium");
      setPlaylistPicker(false);
      Alert.alert("Added", `"${cleanTrackTitle(currentTrack.name)}" added to playlist.`);
    } catch (e: any) {
      Alert.alert("Could not add", e?.message || "Try again in a moment.");
    } finally {
      setPlaylistBusy(false);
    }
  };

  const createPlaylistWithTrack = async () => {
    if (!currentTrack || !api || playlistBusy) return;
    const name = newPlaylistName.trim();
    if (!name) return;
    setPlaylistBusy(true);
    try {
      await api.createPlaylist(name, [
        { root_id: currentTrack.root_id, path: currentTrack.path },
      ]);
      haptic("medium");
      setPlaylistPicker(false);
      setNewPlaylistName("");
      Alert.alert("Created", `Playlist "${name}" created with this song.`);
    } catch (e: any) {
      Alert.alert("Could not create", e?.message || "Try again in a moment.");
    } finally {
      setPlaylistBusy(false);
    }
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
            { borderColor: colors.borderSoft },
          ]}
          activeOpacity={0.9}
          onPress={openModal}
        >
          {/* Frosted glass underlay — content scrolls visibly behind the bar. */}
          <BlurView
            intensity={isDark ? 50 : 65}
            tint={isDark ? "dark" : "light"}
            experimentalBlurMethod={Platform.OS === "android" ? ("dimezisBlurView" as const) : undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(13,15,22,0.52)" : "rgba(255,255,255,0.62)" }]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["rgba(255,255,255,0.06)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.glassHighlight}
          />

          <View style={[styles.miniIconWrap, { backgroundColor: colors.surfaceMuted, overflow: "hidden" }]}>
            {/* Icon fallback sits beneath so a slow/failing thumb still shows art. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <MaterialCommunityIcons name="music-note" size={24} color={gradients.brand[0]} />
            </View>
            {coverUrl ? (
              <Image
                key={`mini-${coverUrl}`}
                source={{ uri: coverUrl }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={300}
                recyclingKey={`mini-${currentTrack.path}`}
                onLoad={onArtLoad}
                onError={onArtError}
              />
            ) : null}
            {artLoading && (
              <ActivityIndicator
                size="small"
                color={gradients.brand[0]}
                style={StyleSheet.absoluteFill}
              />
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
            {coverUrl && !artGaveUp ? (
              <Image
                key={`bg-${coverUrl}`}
                source={{ uri: coverUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={90}
                pointerEvents="none"
                onError={onArtError}
              />
            ) : (
              <LinearGradient colors={[...gradients.player]} style={StyleSheet.absoluteFill} pointerEvents="none" />
            )}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)" },
              ]}
              pointerEvents="none"
            />
            <BlurView
              intensity={60}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* ── Header: chevron-down / source label / more ── */}
            <View style={[styles.header, isLandscape && styles.headerLandscape, { paddingTop: insets.top + (isLandscape ? 4 : 8) }]}>
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={closeModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialCommunityIcons name="chevron-down" size={30} color={colors.content} />
              </TouchableOpacity>

              {!isLandscape && (
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
              )}

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
            <View style={[styles.modalContent, isLandscape && styles.modalContentLandscape]}>
              {/* ── Artwork ── */}
              <Animated.View
                style={[
                  styles.artworkSection,
                  isLandscape && styles.artworkSectionLandscape,
                  {
                    transform: [{ translateX: panX }, { translateY: panY }],
                  },
                ]}
                {...swipeResponder.panHandlers}
              >
                <View style={[styles.artworkShadowWrap, isLandscape && styles.artworkShadowWrapLandscape]}>
                  <Animated.View
                    style={[
                      styles.artworkBox,
                      { transform: [{ scale: artworkScaleAnim }] },
                    ]}
                  >
                    {/* Brand placeholder ALWAYS beneath — a failed/slow
                        thumbnail can never render as an empty box. */}
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
                    {coverUrl ? (
                      <Image
                        key={coverUrl}
                        source={{ uri: coverUrl }}
                        style={styles.artworkImage}
                        contentFit="cover"
                        transition={300}
                        recyclingKey={currentTrack.path}
                        onLoad={onArtLoad}
                        onError={onArtError}
                      />
                    ) : null}
                    {(status === "loading" || artLoading) && (
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
              </Animated.View>

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
                <TouchableOpacity
                  style={[
                    styles.trackMoreBtn,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.04)",
                    },
                  ]}
                  onPress={() => {
                    haptic();
                    setMoreSheet(true);
                  }}
                  hitSlop={10}
                >
                  <MaterialCommunityIcons
                    name="dots-horizontal"
                    size={22}
                    color={colors.content}
                    style={{ opacity: 0.6 }}
                  />
                </TouchableOpacity>
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

            {/* ── Queue panel (slide-up overlay — swipe down to dismiss) ── */}
            {queueOpen && (
              <View style={styles.queueOverlay}>
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: queueAnim }]}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setQueueOpen(false)} />
                </Animated.View>
                <Animated.View
                  style={[
                    styles.queueSheet,
                    {
                      transform: [
                        {
                          translateY: Animated.add(
                            queueAnim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }),
                            queueDrag
                          ),
                        },
                      ],
                    },
                  ]}
                >
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
                  {/* Grabber — drag down to close the queue */}
                  <View
                    {...queueSwipe.panHandlers}
                    style={[styles.queueGrabber, { backgroundColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.14)" }]}
                  />
                  <View style={styles.queueHeader} {...queueSwipe.panHandlers}>
                    <View style={styles.queueHeaderLeft}>
                      <View style={[styles.queueTitleIcon, { backgroundColor: colors.accentSoft }]}>
                        <MaterialCommunityIcons name="playlist-music" size={16} color={colors.accent} />
                      </View>
                      <Text style={[styles.queueTitle, { color: colors.content, fontSize: font.md }]}>Up Next</Text>
                      <View style={[styles.queueCountPill, { backgroundColor: colors.surfaceMuted }]}>
                        <Text style={[styles.queueCount, { color: colors.muted, fontSize: font.xs }]}>
                          {playlist.length} track{playlist.length === 1 ? "" : "s"}
                        </Text>
                      </View>
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
                </Animated.View>
              </View>
            )}

            {/* ════════════════════════════════════════════════════════
                INLINE ACTION SHEETS (inside the modal — iOS-safe: a second
                Modal would stack BELOW this one on iOS; these overlays live
                in the same window so they always appear on top).
                ════════════════════════════════════════════════════════ */}

            {/* ── Track actions ("...") sheet ── */}
            {moreSheet && (
              <View style={styles.inlineOverlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreSheet(false)} />
                <View
                  style={[
                    styles.inlineSheet,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.borderSoft,
                      paddingBottom: insets.bottom + 24,
                    },
                  ]}
                >
                  <View
                    style={[styles.sheetGrabber, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }]}
                  />
                  <Text
                    style={[styles.inlineSheetTitle, { color: colors.content, fontSize: font.md }]}
                    numberOfLines={1}
                  >
                    {cleanTrackTitle(currentTrack.name)}
                  </Text>
                  {[
                    {
                      label: favorited ? "Remove from favorites" : "Add to favorites",
                      icon: favorited ? "heart" : "heart-outline",
                      danger: false,
                      onPress: toggleFavorite,
                    },
                    {
                      label: "Add to playlist",
                      icon: "playlist-plus",
                      danger: false,
                      onPress: openPlaylistPicker,
                    },
                    {
                      label: "Download",
                      icon: "download",
                      danger: false,
                      onPress: () => downloadAndShare(false),
                    },
                    {
                      label: "Share",
                      icon: "share-variant",
                      danger: false,
                      onPress: () => downloadAndShare(true),
                    },
                    {
                      label: "Copy share link",
                      icon: "link-variant",
                      danger: false,
                      onPress: copyLink,
                    },
                  ].map((a, i, arr) => (
                    <TouchableOpacity
                      key={a.label}
                      style={[
                        styles.inlineAction,
                        i < arr.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.borderSoft,
                        },
                      ]}
                      onPress={() => {
                        try {
                          a.onPress();
                        } finally {
                          setMoreSheet(false);
                        }
                      }}
                      activeOpacity={0.6}
                    >
                      <View
                        style={[
                          styles.inlineActionIcon,
                          { backgroundColor: a.danger ? "rgba(239,68,68,0.12)" : colors.accentSoft },
                        ]}
                      >
                        <MaterialCommunityIcons name={a.icon as any} size={18} color={a.danger ? colors.danger : colors.accent} />
                      </View>
                      <Text
                        style={[
                          styles.inlineActionText,
                          { color: a.danger ? colors.danger : colors.content, fontSize: font.md },
                        ]}
                      >
                        {a.label}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} style={{ opacity: 0.5 }} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.inlineCancel, { backgroundColor: colors.card }]}
                    onPress={() => setMoreSheet(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.inlineCancelText, { color: colors.muted, fontSize: font.md }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Add to playlist / create playlist picker (inline) ── */}
            {playlistPicker && (
              <View style={styles.inlineOverlay}>
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => {
                    setPlaylistPicker(false);
                    setNewPlaylistName("");
                  }}
                />
                <View
                  style={[
                    styles.inlineSheet,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.borderSoft,
                      paddingBottom: insets.bottom + 24,
                    },
                  ]}
                >
                  <View
                    style={[styles.sheetGrabber, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }]}
                  />
                  <Text style={[styles.inlineSheetTitle, { color: colors.content, fontSize: font.md }]}>
                    Add to playlist
                  </Text>
                  <View style={styles.pickerCreateRow}>
                    <TextInput
                      style={[styles.pickerInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.content, borderRadius: radius.md }]}
                      value={newPlaylistName}
                      onChangeText={setNewPlaylistName}
                      placeholder="New playlist name…"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="sentences"
                      selectionColor={colors.accent}
                      onSubmitEditing={createPlaylistWithTrack}
                    />
                    <TouchableOpacity
                      style={[styles.pickerCreateBtn, { backgroundColor: colors.accent, borderRadius: radius.md }, (!newPlaylistName.trim() || playlistBusy) && { opacity: 0.5 }]}
                      disabled={!newPlaylistName.trim() || playlistBusy}
                      onPress={createPlaylistWithTrack}
                    >
                      {playlistBusy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <MaterialCommunityIcons name="plus" size={20} color="#fff" />
                      )}
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.pickerSection, { color: colors.muted, fontSize: font.xs }]}>YOUR PLAYLISTS</Text>
                  {playlists.length === 0 ? (
                    <Text style={[styles.pickerEmpty, { color: colors.muted, fontSize: font.sm }]}>
                      No playlists yet — create one above.
                    </Text>
                  ) : (
                    <ScrollView style={{ maxHeight: 320, flexGrow: 0 }} keyboardShouldPersistTaps="handled">
                      {playlists.map((pl) => (
                        <TouchableOpacity
                          key={pl.id}
                          style={[styles.pickerRow, { borderBottomColor: colors.borderSoft }]}
                          onPress={() => addToPlaylist(pl.id)}
                          activeOpacity={0.6}
                        >
                          <View style={[styles.pickerRowIcon, { backgroundColor: colors.accentSoft }]}>
                            <MaterialCommunityIcons name="playlist-music" size={18} color={colors.accent} />
                          </View>
                          <View style={styles.pickerRowBody}>
                            <Text style={[styles.pickerRowTitle, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>
                              {pl.name}
                            </Text>
                            <Text style={[styles.pickerRowSub, { color: colors.muted, fontSize: font.xs }]}>
                              {pl.items.length} track{pl.items.length === 1 ? "" : "s"}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.accent} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  <TouchableOpacity
                    style={[styles.inlineCancel, { backgroundColor: colors.card }]}
                    onPress={() => {
                      setPlaylistPicker(false);
                      setNewPlaylistName("");
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.inlineCancelText, { color: colors.muted, fontSize: font.md }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Animated.View>
        </Modal>
      )}
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
    width: Platform.OS === "android" ? 40 : 44,
    height: Platform.OS === "android" ? 40 : 44,
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
    width: Platform.OS === "android" ? 40 : 44,
    height: Platform.OS === "android" ? 40 : 44,
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
  headerLandscape: {
    paddingHorizontal: 12,
    paddingBottom: 0,
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
  // Landscape: artwork pinned to the left half, controls in the right
  // column (centered), so nothing overflows on short screens.
  modalContentLandscape: {
    justifyContent: "center",
    paddingHorizontal: 0,
    paddingBottom: 0,
    paddingLeft: "44%",
    paddingRight: 20,
  },

  /* Artwork */
  artworkSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  artworkSectionLandscape: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "42%",
    flex: undefined,
    paddingVertical: 0,
    justifyContent: "center",
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
  artworkShadowWrapLandscape: {
    width: undefined,
    height: "74%",
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
  trackMoreBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
    shadowColor: "#5B8CFF",
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
  // The height cap lives HERE — this wrapper's parent is the full-screen
  // overlay, so "56%" is a true screen-relative half view. (A percentage
  // maxHeight on the inner panel resolves against an auto-height parent and
  // gets ignored, which made the card grow to fit every track.)
  queueSheet: {
    width: "100%",
    maxHeight: "56%",
  },
  queueGrabber: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    marginBottom: 4,
  },
  queuePanel: {
    maxHeight: "100%",
    flexShrink: 1,
    overflow: "hidden",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 4,
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
  queueTitle: { fontWeight: "800", letterSpacing: 0.2 },
  queueCount: { fontWeight: "600" },
  queueCountPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  queueTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  queueClose: { padding: 6 },
  // flexShrink lets the list scroll when the queue exceeds the half-view cap.
  queueList: { flexGrow: 0, flexShrink: 1 },
  queueEmpty: { textAlign: "center", paddingVertical: 24 },

  /* Inline action sheets (inside the fullscreen modal — iOS-safe) */
  inlineOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    zIndex: 60,
  },
  inlineSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 24,
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 3,
    marginBottom: 16,
  },
  inlineSheetTitle: {
    fontWeight: "700",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  inlineAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  inlineActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineActionText: {
    fontWeight: "600",
    flex: 1,
  },
  inlineCancel: {
    paddingVertical: 15,
    alignItems: "center",
    borderRadius: 18,
    marginTop: 12,
  },
  inlineCancelText: {
    fontWeight: "600",
  },

  /* Playlist picker (from "..." menu) */
  pickerCreateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  pickerInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  pickerCreateBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerSection: {
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  pickerEmpty: {
    textAlign: "center",
    paddingVertical: 16,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerRowBody: { flex: 1 },
  pickerRowTitle: { fontWeight: "600" },
  pickerRowSub: { marginTop: 2, fontWeight: "500" },
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
