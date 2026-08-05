import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Modal,
  Dimensions,
  Easing,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudio } from "../store/AudioContext";
import { useTheme } from "../store/ThemeContext";
import { useSession } from "../store/SessionContext";
import { EqBars } from "./EqBars";
import { AudioQualityPill } from "./AudioQualityBadge";
import { AudioQualityDetail } from "./AudioQualityDetail";

const { height } = Dimensions.get("window");

export function MiniPlayer() {
  const { currentTrack, player, nextTrack, prevTrack, closePlayer, shuffle, setShuffle } = useAudio();
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
  const slideAnim = useRef(new Animated.Value(height)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Listen to player state & sync timeline
  useEffect(() => {
    if (!player) return;
    const subPlaying = player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying));
    const subStatus = player.addListener("statusChange", ({ status }) => setStatus(status));
    setStatus(player.status);

    let lastT = -1;
    let lastD = -1;
    const interval = setInterval(() => {
      const t = player.currentTime;
      const d = player.duration || 0;
      // Only re-render when something actually changed.
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

  // Artwork scale animation in modal
  useEffect(() => {
    if (playing && modalVisible) {
      Animated.spring(spinAnim, {
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(spinAnim, {
        toValue: 0.9,
        useNativeDriver: true,
      }).start();
    }
  }, [playing, modalVisible]);

  if (!currentTrack) return null;

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
      toValue: height,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setModalVisible(false));
  };

  // Not actually spin anymore, it's a subtle scale effect
  const artworkScale = spinAnim;

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

  return (
    <>
      {/* Mini Player */}
      <View style={[styles.miniContainer, shadow]}>
        <TouchableOpacity style={[styles.miniInner, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft }]} activeOpacity={0.9} onPress={openModal}>
          <LinearGradient colors={["rgba(255,255,255,0.06)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.glassHighlight} />

          <View style={[styles.miniIconWrap, { backgroundColor: colors.surfaceMuted, overflow: "hidden" }]}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={300} />
            ) : (
              <MaterialCommunityIcons name="music-note" size={24} color={gradients.brand[0]} />
            )}
          </View>

          <View style={styles.miniTextWrap}>
            <Text style={[styles.miniTitle, { color: colors.content, fontSize: font.sm }]} numberOfLines={1}>{currentTrack.name}</Text>
            <View style={styles.miniSubRow}>
              <AudioQualityPill extension={ext} mime={currentTrack.mime} fileSize={currentTrack.size} />
              <Text style={[styles.miniSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>{currentTrack.extension?.toUpperCase() || "AUDIO"} · Nexora</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.miniBtn} onPress={togglePlay}>
            {status === "loading" ? (
              <ActivityIndicator color={colors.content} size="small" />
            ) : (
              <MaterialCommunityIcons name={playing ? "pause" : "play"} size={32} color={colors.content} />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={closePlayer}>
            <MaterialCommunityIcons name="close" size={28} color={colors.content} />
          </TouchableOpacity>
        </TouchableOpacity>
        {/* Live progress bar along the bottom edge of the mini card */}
        <View style={[styles.miniProgressTrack, { backgroundColor: colors.borderSoft }]}>
          <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.miniProgressFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      {/* Full Screen Modal */}
      {modalVisible && (
        <Modal transparent visible={modalVisible} animationType="none" onRequestClose={closeModal}>
          <Animated.View style={[styles.modalRoot, { transform: [{ translateY: slideAnim }] }]}>
            {/* Background Blur */}
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={90} />
            ) : (
              <LinearGradient colors={[...gradients.player]} style={StyleSheet.absoluteFill} />
            )}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.4)" }]} />
            <BlurView intensity={isDark ? 50 : 80} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
            
            <TouchableOpacity activeOpacity={0.9} onPress={closeModal} style={[styles.modalHeader, { paddingTop: insets.top + 10 }]}>
              <View style={styles.pullDownWrap}>
                <View style={[styles.pullDownIndicator, { backgroundColor: colors.muted }]} />
              </View>
            </TouchableOpacity>

            <View style={styles.modalContent}>
              {/* Artwork */}
              <View style={styles.artworkContainer}>
                <Animated.View style={[styles.artworkBox, { transform: [{ scale: artworkScale }] }]}>
                  {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%", position: "absolute" }} contentFit="cover" transition={300} />
                  ) : (
                    <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <MaterialCommunityIcons name="music-note" size={100} color="#fff" />
                      </View>
                    </LinearGradient>
                  )}
                  {status === "loading" && (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center" }]}>
                      <ActivityIndicator size="large" color={colors.content} />
                    </View>
                  )}
                </Animated.View>
              </View>

              {/* Title & Artist */}
              <View style={styles.trackInfo}>
                <View style={styles.trackTextCol}>
                  <Text style={[styles.trackName, { fontSize: font.xxxl, color: colors.content }]} numberOfLines={1}>{currentTrack.name}</Text>
                  <Text style={[styles.trackArtist, { fontSize: font.xl, color: colors.content, opacity: 0.7 }]} numberOfLines={1}>{currentTrack.extension?.toUpperCase() || "AUDIO"} · Nexora</Text>
                </View>
                <TouchableOpacity style={[styles.moreBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)" }]}>
                  <MaterialCommunityIcons name="dots-horizontal" size={24} color={colors.content} />
                </TouchableOpacity>
              </View>
              
              <View style={{ marginBottom: 16 }}>
                <AudioQualityDetail
                  extension={ext}
                  mime={currentTrack.mime}
                  fileSize={currentTrack.size}
                  duration={duration > 0 ? duration : undefined}
                />
              </View>

              {/* Scrubber */}
              <View style={styles.scrubberWrap}>
                <View
                  style={styles.scrubberHitbox}
                  onLayout={(e) => setScrubberWidth(e.nativeEvent.layout.width)}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => {
                    if (player && duration > 0 && e.nativeEvent.locationX != null) {
                      const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubberWidth));
                      player.currentTime = pct * duration;
                    }
                  }}
                  onResponderMove={(e) => {
                    if (player && duration > 0 && e.nativeEvent.locationX != null) {
                      const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubberWidth));
                      player.currentTime = pct * duration;
                    }
                  }}
                >
                  <View style={[styles.scrubberTrack, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)" }]}>
                    <View style={[styles.scrubberFill, { width: `${progressPct}%`, backgroundColor: colors.content }]} />
                    <View style={[styles.scrubberThumb, { left: `${progressPct}%`, backgroundColor: colors.content }]} />
                  </View>
                </View>
                <View style={styles.timeRow}>
                  <Text style={[styles.timeText, { color: colors.content, opacity: 0.6 }]}>{formatTime(currentTime)}</Text>
                  <Text style={[styles.timeText, { color: colors.content, opacity: 0.6 }]}>{duration > 0 ? `-${formatTime(duration - currentTime)}` : "-:-"}</Text>
                </View>
              </View>

              {/* Controls */}
              <View style={styles.controlsRow}>
                <TouchableOpacity style={styles.controlBtnSmall} onPress={toggleRepeat}>
                  <MaterialCommunityIcons 
                    name={repeat === "one" ? "repeat-once" : "repeat"} 
                    size={24} 
                    color={repeat !== "off" ? colors.content : colors.muted} 
                  />
                </TouchableOpacity>
                
                <View style={styles.mainControls}>
                  <TouchableOpacity style={styles.controlBtn} onPress={prevTrack}>
                    <MaterialCommunityIcons name="skip-backward" size={48} color={colors.content} />
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
                    {status === "loading" ? (
                      <ActivityIndicator color={colors.content} size="large" />
                    ) : (
                      <MaterialCommunityIcons name={playing ? "pause" : "play"} size={64} color={colors.content} />
                    )}
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.controlBtn} onPress={nextTrack}>
                    <MaterialCommunityIcons name="skip-forward" size={48} color={colors.content} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.controlBtnSmall} onPress={() => setShuffle(!shuffle)}>
                  <MaterialCommunityIcons name="shuffle" size={24} color={shuffle ? colors.content : colors.muted} />
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  miniContainer: {
    position: "absolute",
    bottom: 100, // Above bottom nav
    left: 16,
    right: 16,
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

  // Modal
  modalRoot: { flex: 1 },
  modalHeader: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  pullDownWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: 12,
  },
  pullDownIndicator: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.5,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  artworkContainer: {
    aspectRatio: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    marginBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  artworkBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  trackInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  trackTextCol: { flex: 1, paddingRight: 16 },
  trackName: { fontWeight: "800", marginBottom: 4 },
  trackArtist: { fontWeight: "600" },
  moreBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  
  scrubberWrap: { marginBottom: 40 },
  scrubberHitbox: { height: 30, justifyContent: "center" },
  scrubberTrack: { height: 6, borderRadius: 3, position: "relative" },
  scrubberFill: { height: "100%", borderRadius: 3 },
  scrubberThumb: {
    position: "absolute",
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
    marginLeft: -7,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  timeText: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "600" },

  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mainControls: { flexDirection: "row", alignItems: "center", gap: 32 },
  controlBtn: { padding: 4 },
  controlBtnSmall: { padding: 8 },
  playBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
});
