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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudio } from "../store/AudioContext";
import { useTheme } from "../store/ThemeContext";
import { useSession } from "../store/SessionContext";

const { height } = Dimensions.get("window");

export function MiniPlayer() {
  const { currentTrack, player, nextTrack, prevTrack, closePlayer } = useAudio();
  const { colors, font, gradients, radius, shadow } = useTheme();
  const { api } = useSession();
  const insets = useSafeAreaInsets();

  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
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
    
    const interval = setInterval(() => {
      setCurrentTime(player.currentTime);
      setDuration(player.duration || 0);
    }, 500);

    return () => {
      subPlaying.remove();
      subStatus.remove();
      clearInterval(interval);
    };
  }, [player]);

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

  let formatBadge = null;
  const ext = (currentTrack.extension || "").toLowerCase();
  if (ext === ".flac" || ext === ".alac" || ext === ".wav") {
    formatBadge = "High-Res Lossless 24-bit";
  } else if (ext === ".mp3") {
    formatBadge = "High-Quality 320kbps";
  } else if (ext === ".aac" || ext === ".m4a") {
    formatBadge = "Lossless 16-bit";
  } else {
    formatBadge = "Standard Quality";
  }

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
            <Text style={[styles.miniSub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>Unknown Artist</Text>
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
      </View>

      {/* Full Screen Modal */}
      {modalVisible && (
        <Modal transparent visible={modalVisible} animationType="none" onRequestClose={closeModal}>
          <Animated.View style={[styles.modalRoot, { transform: [{ translateY: slideAnim }] }]}>
            <LinearGradient colors={["#0F1729", "#040508"]} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={[gradients.brand[0] + "33", "transparent"]} style={StyleSheet.absoluteFill} />
            
            <View style={[styles.modalHeader, { paddingTop: insets.top + 20 }]}>
              <TouchableOpacity style={styles.closeBtn} onPress={closeModal}>
                <MaterialCommunityIcons name="chevron-down" size={36} color="#fff" />
              </TouchableOpacity>
              <View style={styles.headerTitleWrap}>
                <Text style={[styles.headerSub, { fontSize: font.xs }]}>PLAYING FROM</Text>
                <Text style={[styles.headerTitle, { fontSize: font.sm }]}>Nexora Music</Text>
              </View>
              <View style={{ width: 36 }} />
            </View>

            <View style={styles.modalContent}>
              {/* Artwork / Box Shape */}
              <View style={[styles.artworkContainer, shadow]}>
                <Animated.View style={[styles.artworkBox, { transform: [{ scale: artworkScale }], backgroundColor: colors.surfaceMuted }]}>
                  {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%", position: "absolute" }} contentFit="cover" transition={300} />
                  ) : (
                    <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <MaterialCommunityIcons name="music-note" size={80} color="#fff" />
                      </View>
                    </LinearGradient>
                  )}
                  {status === "loading" && (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }]}>
                      <ActivityIndicator size="large" color="#fff" />
                    </View>
                  )}
                </Animated.View>
              </View>

              {/* Title & Artist */}
              <View style={styles.trackInfo}>
                <Text style={[styles.trackName, { fontSize: font.xxl }]} numberOfLines={2}>{currentTrack.name}</Text>
                <Text style={[styles.trackArtist, { fontSize: font.lg }]} numberOfLines={1}>Unknown Artist</Text>
                
                {formatBadge && (
                  <View style={styles.formatBadge}>
                    <Text style={styles.formatBadgeText}>{formatBadge}</Text>
                  </View>
                )}
              </View>

              {/* Scrubber */}
              <View style={styles.scrubberWrap}>
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.scrubberHitbox}
                  onLayout={(e) => setScrubberWidth(e.nativeEvent.layout.width)}
                  onPress={(e) => {
                    if (player && duration > 0) {
                      const pct = e.nativeEvent.locationX / scrubberWidth;
                      player.currentTime = pct * duration;
                    }
                  }}
                >
                  <View style={styles.scrubberTrack}>
                    <View style={[styles.scrubberFill, { width: `${progressPct}%` }]} />
                    <View style={[styles.scrubberThumb, { left: `${progressPct}%` }]} />
                  </View>
                </TouchableOpacity>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                  <Text style={styles.timeText}>{duration > 0 ? `-${formatTime(duration - currentTime)}` : "-:-"}</Text>
                </View>
              </View>

              {/* Controls */}
              <View style={styles.controlsRow}>
                <TouchableOpacity style={styles.controlBtnSmall} onPress={() => setShuffle(!shuffle)}>
                  <MaterialCommunityIcons name="shuffle" size={24} color={shuffle ? gradients.brand[0] : "rgba(255,255,255,0.5)"} />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.controlBtn} onPress={prevTrack}>
                  <MaterialCommunityIcons name="skip-backward" size={38} color="#fff" />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
                  {status === "loading" ? (
                    <ActivityIndicator color="#000" size="large" />
                  ) : (
                    <MaterialCommunityIcons name={playing ? "pause" : "play"} size={44} color="#000" />
                  )}
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.controlBtn} onPress={nextTrack}>
                  <MaterialCommunityIcons name="skip-forward" size={38} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.controlBtnSmall} onPress={toggleRepeat}>
                  <MaterialCommunityIcons 
                    name={repeat === "one" ? "repeat-once" : "repeat"} 
                    size={24} 
                    color={repeat !== "off" ? gradients.brand[0] : "rgba(255,255,255,0.5)"} 
                  />
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
  miniTitle: { fontWeight: "700" },
  miniSub: {},
  miniBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  // Modal
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: { alignItems: "center" },
  headerSub: { color: "rgba(255,255,255,0.6)", fontWeight: "700", letterSpacing: 1 },
  headerTitle: { color: "#fff", fontWeight: "600", marginTop: 2 },
  modalContent: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "center",
    paddingBottom: 40,
  },
  artworkContainer: {
    aspectRatio: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  artworkBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 20,
  },

  trackInfo: { alignItems: "flex-start", marginBottom: 30 },
  trackName: { color: "#fff", fontWeight: "800", marginBottom: 8 },
  trackArtist: { color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  formatBadge: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  formatBadgeText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  scrubberWrap: { marginBottom: 40 },
  scrubberHitbox: { height: 30, justifyContent: "center" },
  scrubberTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, position: "relative" },
  scrubberFill: { height: "100%", backgroundColor: "#fff", borderRadius: 3 },
  scrubberThumb: {
    position: "absolute",
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
    marginLeft: -7,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontVariant: ["tabular-nums"] },

  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  controlBtn: { padding: 10 },
  controlBtnSmall: { padding: 10 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
