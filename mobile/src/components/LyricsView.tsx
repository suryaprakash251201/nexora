import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Api } from "../api/client";
import type { LyricCue, LyricsResponse } from "../api/types";

/**
 * LyricsView — synced lyrics for the Now Playing screen.
 *
 * • Synced (.lrc) tracks: the active line is highlighted and auto-scrolled to
 *   ~35% from the top as playback progresses; tapping a line seeks there.
 * • Plain-text tracks: comfortable wrapped text.
 * • No lyrics: a quiet empty state — never an error wall.
 *
 * Auto-scroll only follows the timer while the user isn't touching the list;
 * manual scrolling pauses tracking for 4s so reading position is respected.
 */
export default function LyricsView({
  api,
  rootId,
  path,
  currentTime,
  accent,
  mutedColor,
  textColor,
  onSeek,
}: {
  api: Api | null;
  rootId: string;
  path: string;
  /** Live playback position in seconds (drives the active line). */
  currentTime: number;
  accent: string;
  mutedColor: string;
  textColor: string;
  onSeek?: (seconds: number) => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "none" } | { kind: "error"; msg: string } | { kind: "ready"; data: LyricsResponse }
  >({ kind: "loading" });

  // Persisted lyric font size (14–30px).
  const [lyricSize, setLyricSize] = useState(20);
  useEffect(() => {
    AsyncStorage.getItem("nexora.lyrsize")
      .then((v) => {
        const n = Number(v);
        if (isFinite(n) && n >= 14 && n <= 30) setLyricSize(n);
      })
      .catch(() => {});
  }, []);
  const changeSize = useCallback((delta: number) => {
    setLyricSize((s) => {
      const next = Math.min(30, Math.max(14, s + delta));
      AsyncStorage.setItem("nexora.lyrsize", String(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .getLyrics(rootId, path)
      .then((data) => {
        if (cancelled) return;
        setState(data.has_lyrics ? { kind: "ready", data } : { kind: "none" });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load lyrics";
        // A missing .lrc is the common case — surface it gently.
        setState({ kind: "error", msg });
      });
    return () => {
      cancelled = true;
    };
  }, [api, rootId, path]);

  const cues: LyricCue[] = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.data.cues || [];
  }, [state]);

  // Active cue index for synced lyrics.
  const activeIdx = useMemo(() => {
    if (!cues.length || !stateIsSynced(state)) return -1;
    let lo = 0;
    let hi = cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].time <= currentTime + 0.25) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [cues, currentTime, state]);

  // ── Auto-scroll ──
  const scrollRef = useRef<ScrollView>(null);
  const lineRefs = useRef<(View | null)[]>([]);
  const lineYs = useRef<number[]>([]);
  const userScrollUntil = useRef(0);

  useEffect(() => {
    if (activeIdx < 0) return;
    if (Date.now() < userScrollUntil.current) return; // user is browsing
    const t = setTimeout(() => {
      const target = lineRefs.current[activeIdx];
      if (!target || !scrollRef.current) return;
      target.measureLayout?.(
        scrollRef.current as never,
        (_x, y) => {
          lineYs.current[activeIdx] = y;
          const viewport = 320;
          scrollRef.current?.scrollTo({
            y: Math.max(0, y - viewport * 0.35),
            animated: true,
          });
        },
        () => {}
      );
    }, 60);
    return () => clearTimeout(t);
  }, [activeIdx]);

  const handleScrollBegin = useCallback(() => {
    userScrollUntil.current = Date.now() + 4000;
  }, []);

  if (state.kind === "loading") {
    return (
      <Centered>
        <ActivityIndicator size="large" color={accent} />
      </Centered>
    );
  }

  if (state.kind === "error") {
    return (
      <Centered>
        <MaterialCommunityIcons name="text-box-remove-outline" size={40} color={mutedColor} />
        <Text style={[styles.emptyTitle, { color: textColor }]}>Lyrics unavailable</Text>
        <Text style={[styles.emptySub, { color: mutedColor }]}>{state.msg}</Text>
        <Text style={[styles.emptyHint, { color: mutedColor }]}>
          Add a same-named .lrc file next to the track to get synced lyrics.
        </Text>
      </Centered>
    );
  }

  if (state.kind === "none") {
    return (
      <Centered>
        <MaterialCommunityIcons name="music-note-outline" size={40} color={mutedColor} />
        <Text style={[styles.emptyTitle, { color: textColor }]}>No lyrics</Text>
        <Text style={[styles.emptyHint, { color: mutedColor }]}>
          Place “{path.replace(/\.[^.]+$/, "")}.lrc” next to this track and it
          will show up here, synced to the music.
        </Text>
      </Centered>
    );
  }

  const synced = state.data.synced && cues.length > 0;

  if (!synced) {
    // Plain text mode
    const lines = (state.data.raw || "").split("\n");
    return (
      <ScrollView style={styles.fill} contentContainerStyle={styles.plainWrap}>
        {lines.map((ln, i) =>
          ln.trim() ? (
            <Text key={i} style={[styles.plainLine, { color: textColor }]}>
              {ln}
            </Text>
          ) : (
            <View key={i} style={{ height: 12 }} />
          )
        )}
      </ScrollView>
    );
  }

  // Synced mode
  return (
    <View style={styles.fill}>
      {/* Font size controls (persisted) */}
      <View style={styles.sizeRow} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.sizeBtn}
          onPress={() => changeSize(-2)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Smaller lyrics"
        >
          <Text style={[styles.sizeBtnText, { color: mutedColor }]}>A-</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sizeBtn}
          onPress={() => changeSize(2)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Larger lyrics"
        >
          <Text style={[styles.sizeBtnText, { color: mutedColor }]}>A+</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={styles.syncedWrap}
        onScrollBeginDrag={handleScrollBegin}
        showsVerticalScrollIndicator={false}
      >
      <View style={{ height: "32%" }} />
      {cues.map((cue, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        const unsyncedLine = cue.time < 0;
        return (
          <TouchableOpacity
            key={`${i}-${cue.time}`}
            ref={(r) => {
              lineRefs.current[i] = r;
            }}
            activeOpacity={0.6}
            disabled={unsyncedLine}
            onPress={() => cue.time >= 0 && onSeek?.(Math.max(0, cue.time))}
            style={styles.cueBtn}
          >
            <Text
              numberOfLines={3}
              style={[
                styles.cueText,
                { color: isActive ? accent : isPast ? mutedColor : textColor, fontSize: lyricSize },
                isActive && styles.cueActive,
                unsyncedLine && { fontStyle: "italic", opacity: 0.7 },
              ]}
            >
              {cue.text || "♪"}
            </Text>
          </TouchableOpacity>
        );
      })}
      <View style={{ height: "45%" }} />
      </ScrollView>
    </View>
  );
}

function stateIsSynced(
  s: { kind: string; data?: LyricsResponse }
): boolean {
  return s.kind === "ready" && !!s.data?.synced;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.fill, styles.center]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: "800" },
  emptySub: { fontSize: 13, textAlign: "center" },
  emptyHint: { fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: 4 },
  plainWrap: { paddingVertical: "30%", paddingHorizontal: 8 },
  plainLine: { fontSize: 17, fontWeight: "600", lineHeight: 28 },
  syncedWrap: { paddingHorizontal: 8 },
  sizeRow: {
    position: "absolute",
    top: -6,
    right: 4,
    flexDirection: "row",
    gap: 6,
    zIndex: 10,
  },
  sizeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(128,128,140,0.14)",
  },
  sizeBtnText: { fontSize: 12, fontWeight: "800" },
  cueBtn: { paddingVertical: 14 },
  cueText: {
    fontWeight: "800",
    lineHeight: undefined,
    opacity: 0.85,
  },
  cueActive: {
    transform: [{ scale: 1.06 }],
    textShadowColor: "rgba(139,92,246,0.45)",
    textShadowRadius: 12,
  },
});
