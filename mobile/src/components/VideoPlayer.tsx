import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Brightness from "expo-brightness";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import type { AudioTrack, SubtitleTrack } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "../store/SettingsContext";
import { useAudio } from "../store/AudioContext";
import { setVideoOverlayActive } from "../lib/uiBus";
import { BottomSheet } from "./BottomSheet";

// ── Constants ─────────────────────────────────────────────────────────
const VIDEO_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const ASPECT_MODES = [
  { fit: "contain", label: "Fit", icon: "arrow-expand-all" },
  { fit: "cover", label: "Crop", icon: "crop" },
  { fit: "fill", label: "Stretch", icon: "arrow-expand-horizontal" },
] as const;
const RESUME_MIN = 15; // don't offer resume below 15s
const RESUME_END_FRAC = 0.98; // treat ≥98% as watched-to-end

type Hud =
  | { kind: "seek"; label: string }
  | { kind: "level"; icon: string; pct: number; label?: string };

export type VideoPlayerProps = {
  uri: string;
  /** Server transcode stream used for containers/codecs the device can't play. */
  transcodeUri: string;
  ext?: string;
  title?: string;
  /** Stable per-file key (rootId:path) used to persist the resume position. */
  storageKey?: string;
  onFallback?: () => void;
};

function fmtTimeLong(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ── Resume position persistence ───────────────────────────────────────
async function loadResumePos(key?: string): Promise<number | null> {
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(`nexora.vpos.${key}`);
    if (!raw) return null;
    const v = Number(raw);
    return isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * VideoPlayer — VLC-style playback experience.
 *
 * Features (iOS + Android):
 *  - Custom chrome only — native controls are never used (expo-video forces
 *    native controls in ITS fullscreen, so we implement fullscreen ourselves:
 *    orientation lock + hidden status bar + back-button exits first).
 *  - Gestures: tap toggles chrome · double-tap sides ±10s with ripple ·
 *    horizontal drag scrubs with a time bubble · left-edge vertical drag sets
 *    real system brightness (dim-overlay fallback) · right edge sets volume.
 *  - Lock mode (padlock) freezes all gestures except the unlock pill.
 *  - Speed sheet (0.75×–2×), mute, aspect cycle (fit/crop/stretch),
 *    repeat-one toggle, audio & subtitle track pickers, picture-in-picture,
 *    buffering indicator + buffer track, resume-position memory per file.
 */
export default function VideoPlayer({
  uri,
  transcodeUri,
  ext,
  title,
  storageKey,
  onFallback,
}: VideoPlayerProps) {
  const extNorm = (ext || "").toLowerCase().replace(/^\./, "");
  const needsTranscode = TRANSCODE_EXT.has(extNorm);
  const initialUri = needsTranscode && transcodeUri ? transcodeUri : uri;

  // ── Player ──
  const videoViewRef = useRef<VideoView>(null);
  const player = useVideoPlayer(initialUri, (p) => {
    p.loop = false; // repeat is user-controlled now
    // CRITICAL: expo-video defaults timeUpdateEventInterval to 0 — the
    // timeUpdate event is NEVER emitted — which froze the timeline. Emit
    // every 250ms (a poll below backs this up).
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  // Only one sound at a time: pause the global RNTP music player when a video
  // starts (VLC-style audio focus). Music stays paused after the video ends.
  const { player: musicPlayer } = useAudio();
  useEffect(() => {
    try {
      musicPlayer.pause();
    } catch {}
  }, [musicPlayer]);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switched = useRef(needsTranscode && !!transcodeUri);

  // ── Playback state (event-synced) ──
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rateIdx, setRateIdx] = useState(() =>
    Math.max(0, VIDEO_RATES.indexOf(1))
  );
  const [repeatOne, setRepeatOne] = useState(false);
  const [aspectIdx, setAspectIdx] = useState(0);
  const [ended, setEnded] = useState(false);
  // Real pixel dimensions of the active video track — drives the aspect-fit
  // surface sizing so portrait playback doesn't leave huge black bands.
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    try {
      player.loop = repeatOne;
    } catch {}
  }, [player, repeatOne]);

  // ── Core status handling: readiness, mid-play stalls, transcode fallback.
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      setReady((r) => r || status === "readyToPlay");
      setBuffering(status === "loading");
      setSwitching(false);
      setFailed(status === "error");
      if (status === "readyToPlay") {
        try {
          setDuration(player.duration || 0);
        } catch {}
        player.play();
      }
      // Native decode failed → swap to the server transcode stream once.
      if (status === "error" && !switched.current && transcodeUri) {
        switched.current = true;
        setSwitching(true);
        setFailed(false);
        player.replace(transcodeUri);
        player.play();
      }
    });
    return () => sub.remove();
  }, [player, transcodeUri]);

  useEffect(() => {
    const subs = [
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (isPlaying) setEnded(false);
      }),
      player.addListener("timeUpdate", ({ currentTime: t }) => {
        setCurrentTime(t);
        try {
          setBuffered(player.bufferedPosition || 0);
        } catch {}
      }),
      player.addListener("volumeChange", ({ volume }) => {
        volRef.current = clamp01(volume);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // Detect end-of-stream for the replay button.
  useEffect(() => {
    if (
      !playing &&
      ready &&
      duration > 0 &&
      currentTime >= duration - 0.25 &&
      !repeatOne
    ) {
      setEnded(true);
    }
    if (playing) setEnded(false);
  }, [playing, ready, duration, currentTime, repeatOne]);

  // ── Resume position ──
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadResumePos(storageKey).then((pos) => {
      if (!cancelled && pos && pos > RESUME_MIN) setResumeAt(pos);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Auto-dismiss the chip so it doesn't linger over playback.
  useEffect(() => {
    if (resumeAt == null) return;
    const t = setTimeout(() => setResumeAt(null), 8000);
    return () => clearTimeout(t);
  }, [resumeAt]);

  const lastSaveRef = useRef(0);
  const persistPos = useCallback(
    (t: number, force: boolean) => {
      if (!storageKey) return;
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 5000) return;
      lastSaveRef.current = now;
      try {
        const d = player.duration || duration || 0;
        if (d > 0 && t >= d * RESUME_END_FRAC) {
          AsyncStorage.removeItem(`nexora.vpos.${storageKey}`).catch(() => {});
        } else if (t > 3) {
          AsyncStorage.setItem(
            `nexora.vpos.${storageKey}`,
            String(Math.floor(t))
          ).catch(() => {});
        }
      } catch {}
    },
    [storageKey, player, duration]
  );
  useEffect(() => {
    if (playing) persistPos(currentTime, false);
  }, [currentTime, playing, persistPos]);
  // Save on unmount/pause too (uses ref mirrors).
  const curRef = useRef(0);
  useEffect(() => {
    curRef.current = currentTime;
  }, [currentTime]);
  useEffect(
    () => () => {
      persistPos(curRef.current, true);
    },
    [persistPos]
  );

  const applyResume = useCallback(
    (resume: boolean) => {
      if (resumeAt == null) return;
      haptic("light");
      if (resume) {
        try {
          player.currentTime = Math.min(resumeAt, (player.duration || 1e9) - 1);
          player.play();
        } catch {}
      }
      setResumeAt(null);
    },
    [player, resumeAt]
  );

  // ── Controls visibility ──
  const [uiVisible, setUiVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => setUiVisible(false), 3000);
  }, []);
  useEffect(() => {
    if (!uiVisible) {
      clearHideTimer();
      return;
    }
    if (playing) scheduleHide();
    else clearHideTimer();
    return clearHideTimer;
  }, [uiVisible, playing, scheduleHide]);
  useEffect(() => clearHideTimer, []);

  // ── Lock mode ──
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // ── Brightness (real system brightness, dim fallback) + volume HUD ──
  const insets = useSafeAreaInsets();
  const [dim, setDim] = useState(0); // fallback overlay opacity when real brightness unavailable
  const dimAvailable = useRef(false);
  const savedBrightness = useRef<number | null>(null);
  const volRef = useRef(1);
  useEffect(() => {
    try {
      if (typeof player.volume === "number") volRef.current = player.volume;
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore system brightness when leaving.
  useEffect(() => {
    return () => {
      if (savedBrightness.current != null) {
        Brightness.setSystemBrightnessAsync(savedBrightness.current).catch(
          () => {}
        );
      }
    };
  }, []);

  const setBrightnessLevel = useCallback(async (v: number) => {
    if (savedBrightness.current == null) {
      try {
        savedBrightness.current = await Brightness.getSystemBrightnessAsync();
        dimAvailable.current = true;
      } catch {
        dimAvailable.current = false;
      }
    }
    if (dimAvailable.current) {
      try {
        await Brightness.setSystemBrightnessAsync(clamp01(v));
      } catch {
        dimAvailable.current = false;
      }
    }
    if (!dimAvailable.current) setDim((1 - clamp01(v)) * 0.85);
  }, []);

  // ── Fullscreen (custom — orientation lock, no native controls ever) ──
  const [fullscreen, setFullscreen] = useState(false);
  const wasPortraitOnEnter = useRef(true);

  const enterFullscreen = useCallback(() => {
    haptic("medium");
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(
      () => {}
    );
    setFullscreen(true);
    setUiVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const exitFullscreen = useCallback(() => {
    haptic("medium");
    // Phones: snap back to portrait so the app doesn't stay sideways when the
    // device's auto-rotate is off. Tablets/unlock keeps sensor behavior.
    if (wasPortraitOnEnter.current) {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT
      ).catch(() => {});
    } else {
      ScreenOrientation.unlockAsync().catch(() => {});
    }
    setFullscreen(false);
    setUiVisible(true);
  }, []);

  // Capture the pre-fullscreen orientation each time it changes while closed.
  const { width: winW, height: winH } = useWindowDimensions();
  useEffect(() => {
    if (!fullscreen) wasPortraitOnEnter.current = winH >= winW;
  }, [fullscreen, winH, winW]);

  useEffect(() => {
    setVideoOverlayActive(fullscreen);
    return () => setVideoOverlayActive(false);
  }, [fullscreen]);

  // Hardware/gesture back exits fullscreen before leaving the screen.
  useEffect(() => {
    if (!fullscreen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exitFullscreen();
      return true;
    });
    return () => sub.remove();
  }, [fullscreen, exitFullscreen]);

  // ── Transport ──
  const togglePlay = useCallback(() => {
    haptic("light");
    try {
      if (ended) {
        player.currentTime = 0;
        setEnded(false);
        player.play();
      } else if (playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch {}
    if (!uiVisible) setUiVisible(true);
    else scheduleHide();
  }, [player, playing, ended, uiVisible, scheduleHide]);

  const seekTo = useCallback(
    (sec: number) => {
      try {
        player.currentTime = sec;
        setCurrentTime(sec);
      } catch {}
    },
    [player]
  );

  const skipBy = useCallback(
    (delta: number) => {
      haptic("light");
      try {
        const d = player.duration || duration || 0;
        const next = Math.min(
          Math.max(currentTime + delta, 0),
          d || Number.MAX_SAFE_INTEGER
        );
        player.seekBy(delta);
        setCurrentTime(next);
      } catch {}
      scheduleHide();
    },
    [player, currentTime, duration, scheduleHide]
  );

  const toggleMute = useCallback(() => {
    haptic("light");
    try {
      player.muted = !muted;
      setMuted(!muted);
    } catch {}
    scheduleHide();
  }, [player, muted, scheduleHide]);

  const setRate = useCallback(
    (idx: number) => {
      try {
        player.playbackRate = VIDEO_RATES[idx];
        setRateIdx(idx);
      } catch {}
    },
    [player]
  );

  const cycleAspect = useCallback(() => {
    haptic("light");
    const next = (aspectIdx + 1) % ASPECT_MODES.length;
    setAspectIdx(next);
    setHud({
      kind: "level",
      icon: ASPECT_MODES[next].icon as string,
      pct: 0,
      label: ASPECT_MODES[next].label,
    });
    setTimeout(() => setHud(null), 900);
  }, [aspectIdx]);

  const togglePiP = useCallback(() => {
    haptic("light");
    try {
      videoViewRef.current?.startPictureInPicture?.()?.catch?.(() => {});
    } catch {}
  }, []);

  // ── Sheets ──
  const [sheetOpen, setSheetOpen] = useState<
    null | "options" | "speed" | "audio" | "subs"
  >(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTrack, setAudioTrack] = useState<AudioTrack | null>(null);
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack | null>(null);
  const [qualityLabel, setQualityLabel] = useState<string | null>(null);

  // Refresh track lists whenever the source settles.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      try {
        setAudioTracks([...(player.availableAudioTracks || [])]);
        setSubtitleTracks([...(player.availableSubtitleTracks || [])]);
        // Mirror the currently active selections into sheet state.
        setAudioTrack(player.audioTrack ?? null);
        setSubtitleTrack(player.subtitleTrack ?? null);
        const vts = player.availableVideoTracks || [];
        if (vts.length && vts[0].size) {
          setQualityLabel(`${vts[0].size.width}×${vts[0].size.height}`);
          if (vts[0].size.width > 0 && vts[0].size.height > 0) {
            setVideoSize({ width: vts[0].size.width, height: vts[0].size.height });
          }
        }
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [ready, player, switching]);

  // Safety: stop playback when the preview unmounts (player release also
  // stops it, but an explicit pause avoids a trailing audio frame on Android).
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  // ── Surface gestures ──
  const surfaceWidth = useRef(0);
  const durRef = useRef(0);
  const dimRef = useRef(0);
  useEffect(() => {
    durRef.current = duration;
  }, [duration]);
  useEffect(() => {
    dimRef.current = dim;
  }, [dim]);

  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    },
    []
  );

  // Double-tap ripple feedback.
  const rippleL = useRef(new Animated.Value(0)).current;
  const rippleR = useRef(new Animated.Value(0)).current;
  const fireRipple = useCallback((side: "l" | "r") => {
    const anim = side === "l" ? rippleL : rippleR;
    anim.setValue(0);
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(anim, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start();
  }, [rippleL, rippleR]);

  const handleSurfaceTap = useCallback(
    (locationX: number) => {
      const w = surfaceWidth.current;
      const side: "l" | "r" | "c" =
        locationX < w / 3 ? "l" : locationX > (w * 2) / 3 ? "r" : "c";
      const now = Date.now();
      if (
        side !== "c" &&
        now - lastTapInfo.current.t < 300 &&
        lastTapInfo.current.side === side
      ) {
        lastTapInfo.current = { t: 0, side: "c" };
        if (singleTapTimer.current) {
          clearTimeout(singleTapTimer.current);
          singleTapTimer.current = null;
        }
        fireRipple(side);
        skipBy(side === "l" ? -10 : 10);
        return;
      }
      lastTapInfo.current = { t: now, side };
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = setTimeout(() => {
        haptic("light");
        setUiVisible((v) => !v);
      }, 260);
    },
    [skipBy, fireRipple]
  );
  const lastTapInfo = useRef<{ t: number; side: "l" | "r" | "c" }>({
    t: 0,
    side: "c",
  });

  const gesture = useRef({
    mode: "none" as "none" | "seek" | "bright" | "vol",
    side: "c" as "l" | "r" | "c",
    startX: 0,
    startY: 0,
    startTime: 0,
    startPos: 0,
    startVal: 1,
    target: undefined as number | undefined,
  });

  const surfacePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !lockedRef.current,
        onMoveShouldSetPanResponder: (_e, g) =>
          !lockedRef.current &&
          (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12),
        onPanResponderGrant: (e) => {
          const g = gesture.current;
          g.mode = "none";
          g.target = undefined;
          g.startX = e.nativeEvent.pageX;
          g.startY = e.nativeEvent.pageY;
          g.startTime = Date.now();
          g.startPos = curRef.current;
          g.startVal = volRef.current;
          const w = Math.max(surfaceWidth.current, 1);
          const localX =
            typeof e.nativeEvent.locationX === "number"
              ? e.nativeEvent.locationX
              : w / 2;
          g.side = localX < w / 2 ? "l" : "r";
        },
        onPanResponderMove: (e) => {
          const g = gesture.current;
          if (lockedRef.current) return;
          const dx = e.nativeEvent.pageX - g.startX;
          const dy = e.nativeEvent.pageY - g.startY;
          if (g.mode === "none") {
            if (Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) {
              g.mode = "seek";
              if (uiVisibleRef.current) setUiVisible(false);
              setResumeAt(null);
            } else if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
              g.mode = g.side === "l" ? "bright" : "vol";
              g.startVal =
                g.mode === "bright" ? clamp01(1 - dimRef.current / 0.85) : volRef.current;
            }
          }
          if (g.mode === "seek") {
            const d = durRef.current || 0;
            const deltaSec =
              (dx / Math.max(surfaceWidth.current, 1)) * Math.max(d * 0.9, 90);
            const target = Math.min(
              Math.max(g.startPos + deltaSec, 0),
              d || Number.MAX_SAFE_INTEGER
            );
            g.target = target;
            const sign = target >= g.startPos ? "+" : "−";
            setHud({
              kind: "seek",
              label: `${sign}${fmtTimeLong(Math.abs(target - g.startPos))}  ›  ${fmtTimeLong(target)}`,
            });
          } else if (g.mode === "bright") {
            const v = clamp01(g.startVal + -dy / ((winHRef.current || 600) * 0.6));
            setBrightnessLevel(v);
            setHud({ kind: "level", icon: "brightness-6", pct: Math.round(v * 100) });
          } else if (g.mode === "vol") {
            const v = clamp01(g.startVal + -dy / ((winHRef.current || 600) * 0.6));
            try {
              player.volume = v;
            } catch {}
            volRef.current = v;
            setHud({
              kind: "level",
              icon: v === 0 ? "volume-off" : "volume-high",
              pct: Math.round(v * 100),
            });
          }
        },
        onPanResponderRelease: (e) => {
          const g = gesture.current;
          const dt = Date.now() - g.startTime;
          if (g.mode === "seek" && typeof g.target === "number") {
            haptic("light");
            seekTo(g.target);
            persistPos(g.target, true);
            scheduleHide();
          }
          if (g.mode === "none" && dt < 280 && !lockedRef.current) {
            handleSurfaceTap(e.nativeEvent.locationX);
          }
          g.mode = "none";
          g.target = undefined;
          setHud(null);
        },
        onPanResponderTerminate: () => {
          const g = gesture.current;
          g.mode = "none";
          g.target = undefined;
          setHud(null);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, seekTo, scheduleHide, handleSurfaceTap, setBrightnessLevel, persistPos]
  );

  // Ref mirrors read inside PanResponder callbacks (created once).
  const [hud, setHud] = useState<Hud | null>(null);
  const uiVisibleRef = useRef(uiVisible);
  const winHRef = useRef(winH);
  useEffect(() => {
    uiVisibleRef.current = uiVisible;
  }, [uiVisible]);
  useEffect(() => {
    winHRef.current = winH;
  }, [winH]);

  // ── Seek bar ──
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const scrubbing = scrubRatio != null;
  const barWidth = useRef(0);
  const pct =
    scrubRatio ?? (duration > 0 ? Math.min(1, currentTime / duration) : 0);
  const bufPct =
    duration > 0 ? Math.min(1, Math.max(buffered, currentTime) / duration) : 0;

  // Poll fallback for the timeline. timeUpdateEventInterval drives the
  // timeUpdate event, but native players can stall event delivery during
  // buffering or rate changes — polling keeps the progress bar moving.
  useEffect(() => {
    if (!playing || scrubbing) return;
    const iv = setInterval(() => {
      try {
        setCurrentTime(player.currentTime);
        setBuffered(player.bufferedPosition || 0);
      } catch {}
    }, 250);
    return () => clearInterval(iv);
  }, [playing, scrubbing, player]);

  // ── Aspect-fit surface sizing ───────────────────────────────────────
  // The surface hugs the video's real aspect ratio: portrait playback gets a
  // tight video box instead of a full-area black slab with tiny letterboxed
  // content in the middle. Falls back to 16:9 until track metadata lands.
  const [surfaceMax, setSurfaceMax] = useState({ w: 0, h: 0 });
  const vidAr =
    videoSize && videoSize.width > 0 && videoSize.height > 0
      ? videoSize.width / videoSize.height
      : 16 / 9;
  let surfW = surfaceMax.w;
  let surfH = surfW / vidAr;
  if (surfH > surfaceMax.h) {
    surfH = surfaceMax.h;
    surfW = surfH * vidAr;
  }
  const surfaceReady = surfW > 1 && surfH > 1;

  const ratioFromX = (locationX: number) =>
    barWidth.current > 0
      ? Math.min(1, Math.max(0, locationX / barWidth.current))
      : 0;

  if (failed) {
    return (
      <View style={styles.videoErrorWrap}>
        <MaterialCommunityIcons name="video-off-outline" size={44} color="#8A8F98" />
        <Text style={styles.videoErrorTitle}>Could not play this video</Text>
        <Text style={styles.videoErrorSub}>
          The format may be unsupported on this device, or the connection was
          interrupted.
        </Text>
        <View style={styles.videoErrorRow}>
          <TouchableOpacity
            style={styles.videoErrorBtn}
            onPress={() => {
              // Retry: prefer the transcode stream when it hasn't been tried
              // yet, otherwise force-reload the current source.
              const useTranscode = !switched.current && !!transcodeUri;
              if (useTranscode) switched.current = true;
              setFailed(false);
              setSwitching(true);
              try {
                player.replace(useTranscode ? transcodeUri : uri);
                player.play();
              } catch {}
            }}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
            <Text style={styles.videoErrorBtnText}>Try server transcode</Text>
          </TouchableOpacity>
          {onFallback ? (
            <TouchableOpacity
              style={[styles.videoErrorBtn, styles.videoErrorBtnAlt]}
              onPress={onFallback}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="download" size={16} color="#fff" />
              <Text style={styles.videoErrorBtnText}>Download / Open with…</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const showChrome = uiVisible && ready && !locked;
  const aspect = ASPECT_MODES[aspectIdx];
  // Immersive surface when: custom fullscreen is on, OR the device was
  // physically rotated (matches the old player's landscape behavior).
  const deviceLandscape = winW > winH;
  const immersive = fullscreen || deviceLandscape;

  return (
    <View
      style={[styles.root, immersive ? styles.rootFullscreen : styles.rootInline]}
      collapsable={false}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (
          Math.abs(width - surfaceMax.w) > 1 ||
          Math.abs(height - surfaceMax.h) > 1
        ) {
          setSurfaceMax({ w: width, h: height });
        }
      }}
    >
      {/* Hide the OS status bar while immersed */}
      <StatusBar hidden={fullscreen} animated />

      {/* Aspect-fit surface — hugs the video; all layers live inside it so
          controls always align with the picture instead of floating over a
          large letterboxed area. */}
      <View
        style={[
          styles.surface,
          surfaceReady ? { width: Math.round(surfW), height: Math.round(surfH) } : null,
        ]}
      >
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.video}
        contentFit={aspect.fit}
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture
      />

      {/* Dim overlay fallback when real brightness control is unavailable */}
      {dim > 0 && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]}
        />
      )}

      {(!ready || switching) && !failed ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      ) : null}

      {/* Mid-play buffering pill (non-blocking) */}
      {ready && buffering && !switching ? (
        <View style={styles.bufferPill} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.bufferText}>Buffering…</Text>
        </View>
      ) : null}

      {/* Gesture surface */}
      <View style={StyleSheet.absoluteFill} {...surfacePan.panHandlers}>
        <View
          onLayout={(e) => {
            surfaceWidth.current = e.nativeEvent.layout.width;
          }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Double-tap ripples */}
      {(["l", "r"] as const).map((side) => {
        const v = side === "l" ? rippleL : rippleR;
        return (
          <Animated.View
            key={side}
            pointerEvents="none"
            style={[
              styles.ripple,
              side === "l" ? { left: "8%" } : { right: "8%" },
              {
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
                transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }) }],
              },
            ]}
          >
            <MaterialCommunityIcons
              name={side === "l" ? "rewind-10" : "fast-forward-10"}
              size={34}
              color="#fff"
            />
          </Animated.View>
        );
      })}

      {/* Gesture HUD */}
      {hud ? (
        <View pointerEvents="none" style={styles.hudWrap}>
          <View style={styles.hudBubble}>
            <MaterialCommunityIcons
              name={(hud.kind === "seek" ? "play-speed" : hud.icon) as any}
              size={16}
              color="#fff"
            />
            <Text style={styles.hudText}>
              {hud.kind === "seek"
                ? hud.label
                : hud.label
                  ? hud.label
                  : `${hud.pct}%`}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Resume chip */}
      {resumeAt != null && !locked ? (
        <View style={styles.resumeChip} pointerEvents="box-none">
          <Text style={styles.resumeText} numberOfLines={1}>
            Resume from {fmtTimeLong(resumeAt)}?
          </Text>
          <TouchableOpacity
            style={styles.resumeBtnGhost}
            onPress={() => applyResume(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.resumeBtnGhostText}>Start over</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.resumeBtn}
            onPress={() => applyResume(true)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#8B5CF6", "#5B8CFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.resumeBtnText}>Resume ▸</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Locked — unlock pill always available */}
      {locked ? (
        <TouchableOpacity
          style={styles.lockPill}
          onPress={() => {
            haptic("medium");
            setLocked(false);
            setUiVisible(true);
          }}
          accessibilityLabel="Unlock video controls"
        >
          <MaterialCommunityIcons name="lock-open-variant" size={15} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {showChrome ? (
        <>
          <LinearGradient
            colors={["rgba(0,0,0,0.55)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.fade, styles.fadeTop]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.65)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.fade, styles.fadeBottom]}
            pointerEvents="none"
          />

          {/* Top bar — close (fullscreen) · title · quality · lock. Safe-area
              aware so the notch never overlaps the title row. */}
          <View
            style={[
              styles.topBar,
              { paddingTop: (immersive ? insets.top : 0) + 8 },
            ]}
          >
            {fullscreen ? (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={exitFullscreen}
                activeOpacity={0.7}
                accessibilityLabel="Exit fullscreen"
              >
                <MaterialCommunityIcons name="chevron-down" size={26} color="#fff" />
              </TouchableOpacity>
            ) : null}
            <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
              {title || "Now playing"}
            </Text>
            {qualityLabel ? (
              <View style={styles.qualityChip}>
                <Text style={styles.qualityChipText}>{qualityLabel}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                haptic("medium");
                setLocked(true);
              }}
              activeOpacity={0.7}
              accessibilityLabel="Lock video controls"
            >
              <MaterialCommunityIcons name="lock-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Center cluster */}
          <View pointerEvents="box-none" style={styles.centerRow}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => skipBy(-10)}
              activeOpacity={0.7}
              accessibilityLabel="Back 10 seconds"
            >
              <MaterialCommunityIcons name="rewind-10" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={togglePlay}
              activeOpacity={0.85}
              accessibilityLabel={playing ? "Pause" : "Play"}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0.06)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <MaterialCommunityIcons
                name={ended ? "replay" : playing ? "pause" : "play"}
                size={38}
                color="#fff"
                style={!playing && !ended ? { marginLeft: 4 } : undefined}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => skipBy(10)}
              activeOpacity={0.7}
              accessibilityLabel="Forward 10 seconds"
            >
              <MaterialCommunityIcons name="fast-forward-10" size={28} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Bottom panel */}
          <View
            style={[
              styles.bottomPanel,
              { paddingBottom: (immersive ? insets.bottom : 0) + 12 },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.transportRow} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.smallPlay}
                onPress={togglePlay}
                activeOpacity={0.7}
                accessibilityLabel={playing ? "Pause" : "Play"}
              >
                <MaterialCommunityIcons
                  name={ended ? "replay" : playing ? "pause" : "play"}
                  size={22}
                  color="#fff"
                />
              </TouchableOpacity>
              <Text style={styles.timeText}>
                {fmtTimeLong(scrubRatio != null ? scrubRatio * duration : currentTime)}
              </Text>

              {/* Seek track with buffer layer */}
              <View
                style={styles.seekTrack}
                onLayout={(e) => {
                  barWidth.current = e.nativeEvent.layout.width;
                }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => setScrubRatio(ratioFromX(e.nativeEvent.locationX))}
                onResponderMove={(e) => setScrubRatio(ratioFromX(e.nativeEvent.locationX))}
                onResponderRelease={(e) => {
                  const r = ratioFromX(e.nativeEvent.locationX);
                  setScrubRatio(null);
                  const target = r * (player.duration || duration || 0);
                  seekTo(target);
                  persistPos(target, true);
                  setResumeAt(null);
                  haptic("light");
                  scheduleHide();
                }}
              >
                <View style={styles.seekBg} />
                <View style={[styles.seekBuf, { width: `${bufPct * 100}%` }]} />
                <View style={[styles.seekFill, { width: `${pct * 100}%` }]}>
                  <LinearGradient
                    colors={["#8FB5FF", "#5B8CFF"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
                <View style={[styles.seekThumbWrap, { left: `${pct * 100}%` }]}>
                  <View style={[styles.seekThumbGlow, scrubbing && styles.seekThumbGlowActive]} />
                  <View style={[styles.seekThumb, scrubbing && styles.seekThumbActive]} />
                </View>

                {/* Drag time bubble — shows the target position while scrubbing */}
                {scrubbing ? (
                  <View style={[styles.scrubBubbleWrap, { left: `${pct * 100}%` }]} pointerEvents="none">
                    <Text style={styles.scrubBubbleText}>
                      {fmtTimeLong(scrubRatio! * duration)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.timeText}>{fmtTimeLong(duration)}</Text>
            </View>

            {/* Secondary row */}
            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.pill}
                onPress={() => setSheetOpen("speed")}
                activeOpacity={0.7}
                accessibilityLabel={`Playback speed ${VIDEO_RATES[rateIdx]}x`}
              >
                <Text style={styles.pillText}>{VIDEO_RATES[rateIdx]}×</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={cycleAspect}
                activeOpacity={0.7}
                accessibilityLabel={`Aspect ratio ${aspect.label}`}
              >
                <MaterialCommunityIcons name={aspect.icon as any} size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={toggleMute}
                activeOpacity={0.7}
                accessibilityLabel={muted ? "Unmute" : "Mute"}
              >
                <MaterialCommunityIcons
                  name={muted ? "volume-off" : "volume-high"}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>

              {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => setSheetOpen("options")}
                  activeOpacity={0.7}
                  accessibilityLabel="Audio and subtitles"
                >
                  <MaterialCommunityIcons
                    name="subtitles-outline"
                    size={20}
                    color="#fff"
                  />
                </TouchableOpacity>
              )}

              <View style={{ flex: 1 }} />

              {Platform.OS !== "web" && (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={togglePiP}
                  activeOpacity={0.7}
                  accessibilityLabel="Picture in picture"
                >
                  <MaterialCommunityIcons
                    name="picture-in-picture-bottom-right"
                    size={20}
                    color="#fff"
                  />
                </TouchableOpacity>
              )}
              {!fullscreen ? (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={enterFullscreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Fullscreen"
                >
                  <MaterialCommunityIcons name="fullscreen" size={22} color="#fff" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={exitFullscreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Exit fullscreen"
                >
                  <MaterialCommunityIcons
                    name="fullscreen-exit"
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setSheetOpen("options")}
                activeOpacity={0.7}
                accessibilityLabel="Video options"
              >
                <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : null}
      </View>
      {/* /surface */}

      {/* ── Sheets ── */}
      <BottomSheet
        visible={sheetOpen === "options"}
        onClose={() => setSheetOpen(null)}
        title="Video Options"
      >
        <SheetActions
          onClose={() => setSheetOpen(null)}
          open={(s) => setSheetOpen(s)}
          hasAudio={audioTracks.length > 1}
          hasSubs={subtitleTracks.length > 0}
          subtitleOn={!!subtitleTrack}
          repeatOne={repeatOne}
          onRepeatToggle={() => {
            haptic("light");
            setRepeatOne((r) => !r);
          }}
          onFallback={onFallback}
        />
      </BottomSheet>

      <BottomSheet visible={sheetOpen === "speed"} onClose={() => setSheetOpen(null)} title="Playback speed">
        {VIDEO_RATES.map((r, i) => (
          <TouchableOpacity
            key={r}
            style={[styles.sheetRow, rateIdx === i && styles.sheetRowActive]}
            onPress={() => {
              setRate(i);
              setSheetOpen("options");
            }}
            activeOpacity={0.6}
          >
            <MaterialCommunityIcons
              name={rateIdx === i ? "check-circle" : "chevron-right"}
              size={18}
              color={rateIdx === i ? "#8B5CF6" : "rgba(255,255,255,0.4)"}
            />
            <Text style={styles.sheetRowText}>{r}×</Text>
          </TouchableOpacity>
        ))}
      </BottomSheet>

      <BottomSheet
        visible={sheetOpen === "audio"}
        onClose={() => setSheetOpen(null)}
        title="Audio track"
      >
        {audioTracks.length <= 1 ? (
          <Text style={styles.sheetEmpty}>Only one audio track available.</Text>
        ) : (
          audioTracks.map((tr) => (
            <TouchableOpacity
              key={tr.id}
              style={[styles.sheetRow, audioTrack?.id === tr.id && styles.sheetRowActive]}
              onPress={() => {
                try {
                  player.audioTrack = tr;
                  setAudioTrack(tr);
                } catch {}
                setSheetOpen(null);
              }}
              activeOpacity={0.6}
            >
              <MaterialCommunityIcons
                name={audioTrack?.id === tr.id ? "check-circle" : "music-note"}
                size={18}
                color={audioTrack?.id === tr.id ? "#8B5CF6" : "rgba(255,255,255,0.5)"}
              />
              <Text style={styles.sheetRowText} numberOfLines={1}>
                {tr.label || tr.language || tr.id}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </BottomSheet>

      <BottomSheet
        visible={sheetOpen === "subs"}
        onClose={() => setSheetOpen(null)}
        title="Subtitles"
      >
        <TouchableOpacity
          style={[styles.sheetRow, !subtitleTrack && styles.sheetRowActive]}
          onPress={() => {
            try {
              player.subtitleTrack = null;
            } catch {}
            setSubtitleTrack(null);
            setSheetOpen(null);
          }}
          activeOpacity={0.6}
        >
          <MaterialCommunityIcons
            name={!subtitleTrack ? "check-circle" : "subtitles-outline"}
            size={18}
            color={!subtitleTrack ? "#8B5CF6" : "rgba(255,255,255,0.5)"}
          />
          <Text style={styles.sheetRowText}>Off</Text>
        </TouchableOpacity>
        {subtitleTracks.map((tr) => (
          <TouchableOpacity
            key={tr.id}
            style={[styles.sheetRow, subtitleTrack?.id === tr.id && styles.sheetRowActive]}
            onPress={() => {
              try {
                player.subtitleTrack = tr;
                setSubtitleTrack(tr);
              } catch {}
              setSheetOpen(null);
            }}
            activeOpacity={0.6}
          >
            <MaterialCommunityIcons
              name={subtitleTrack?.id === tr.id ? "check-circle" : "subtitles"}
              size={18}
              color={subtitleTrack?.id === tr.id ? "#8B5CF6" : "rgba(255,255,255,0.5)"}
            />
            <Text style={styles.sheetRowText} numberOfLines={1}>
              {tr.label || tr.language || tr.id}
            </Text>
          </TouchableOpacity>
        ))}
      </BottomSheet>
    </View>
  );
}

// ── Options sheet body ────────────────────────────────────────────────
function SheetActions({
  onClose,
  open,
  hasAudio,
  hasSubs,
  subtitleOn,
  repeatOne,
  onRepeatToggle,
  onFallback,
}: {
  onClose: () => void;
  open: (s: "speed" | "audio" | "subs") => void;
  hasAudio: boolean;
  hasSubs: boolean;
  subtitleOn: boolean;
  repeatOne: boolean;
  onRepeatToggle: () => void;
  onFallback?: () => void;
}) {
  const rows: Array<{
    icon: string;
    label: string;
    value?: string;
    destructive?: boolean;
    onPress: () => void;
  }> = [
    { icon: "speedometer", label: "Playback speed", value: "›", onPress: () => open("speed") },
    ...(hasAudio
      ? [{ icon: "music-note", label: "Audio track", value: "›", onPress: () => open("audio") }]
      : []),
    ...(hasSubs
      ? [{ icon: "subtitles", label: "Subtitles", value: subtitleOn ? "On" : "Off", onPress: () => open("subs") }]
      : []),
    {
      icon: repeatOne ? "repeat-once" : "repeat-off",
      label: repeatOne ? "Repeat: one" : "Repeat: off",
      onPress: onRepeatToggle,
    },
  ];
  if (onFallback) {
    rows.push({
      icon: "open-in-new",
      label: "Open with external player…",
      onPress: () => {
        onClose();
        onFallback();
      },
    });
  }
  return (
    <>
      {rows.map((r) => (
        <TouchableOpacity
          key={r.label}
          style={styles.sheetActionRow}
          onPress={r.onPress}
          activeOpacity={0.6}
        >
          <MaterialCommunityIcons name={r.icon as any} size={20} color="#C9CDD6" />
          <Text style={styles.sheetActionText}>{r.label}</Text>
          {r.value ? <Text style={styles.sheetActionValue}>{r.value}</Text> : null}
        </TouchableOpacity>
      ))}
    </>
  );
}

// Mirrored from PreviewScreen — keep in sync (server-transcodable containers).
const TRANSCODE_EXT = new Set([
  "mkv", "avi", "wmv", "flv", "asf", "vob", "mts", "m2ts", "ts", "rm", "divx", "3gp",
]);

// ── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { backgroundColor: "#000" },
  // Inline (portrait): fills the preview area and centers the aspect-fit
  // surface — no more full-area black slab with tiny letterboxed video.
  rootInline: {
    flexGrow: 1,
    alignSelf: "stretch",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  rootFullscreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
  },
  video: { ...StyleSheet.absoluteFillObject },
  // The aspect-fit box that hugs the video picture; every overlay layer is
  // positioned inside it.
  surface: {
    backgroundColor: "#000",
    overflow: "hidden",
  },
  scrubBubbleWrap: {
    position: "absolute",
    top: -34,
    marginLeft: -32,
    width: 64,
    alignItems: "center",
  },
  scrubBubbleText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  seekThumbGlowActive: { width: 28, height: 28, borderRadius: 14 },
  seekThumbActive: { width: 16, height: 16, borderRadius: 8 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  bufferPill: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  bufferText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  ripple: {
    position: "absolute",
    top: "40%",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },

  hudWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  hudBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  hudText: { color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },

  resumeChip: {
    position: "absolute",
    left: 12,
    bottom: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "92%",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  resumeText: { color: "#fff", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  resumeBtnGhost: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  resumeBtnGhostText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  resumeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  resumeBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  lockPill: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  fade: { position: "absolute", left: 0, right: 0, height: 90 },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0, height: 120 },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  title: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  qualityChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  qualityChipText: { color: "#fff", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  iconBtn: { padding: 8 },

  centerRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 26,
  },
  skipBtn: { padding: 10, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.25)" },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    overflow: "hidden",
  },

  bottomPanel: { position: "absolute", left: 0, right: 0, bottom: 0 },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  smallPlay: { padding: 4 },
  timeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 42,
    textAlign: "center",
  },

  seekTrack: { height: 28, justifyContent: "center" },
  seekBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  seekBuf: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  seekFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  seekThumbWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 18,
    marginLeft: -9,
    alignItems: "center",
    justifyContent: "center",
  },
  seekThumbGlow: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(91,140,255,0.35)",
  },
  seekThumb: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff" },

  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  pillText: { color: "#fff", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },

  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  sheetRowActive: { backgroundColor: "rgba(139,92,246,0.12)" },
  sheetRowText: { color: "#fff", fontSize: 14, fontWeight: "600", flex: 1 },
  sheetEmpty: { color: "rgba(255,255,255,0.5)", fontSize: 13, paddingVertical: 10 },

  sheetActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  sheetActionText: { color: "#E7E9EE", fontSize: 14, fontWeight: "600", flex: 1 },
  sheetActionValue: { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "700" },

  videoErrorWrap: {
    width: "100%",
    minHeight: 220,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B0D12",
    gap: 8,
    padding: 24,
  },
  videoErrorTitle: { color: "#fff", fontWeight: "800", fontSize: 15, marginTop: 4 },
  videoErrorSub: {
    color: "#8A8F98",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    marginBottom: 8,
  },
  videoErrorRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  videoErrorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#8B5CF6",
  },
  videoErrorBtnAlt: { backgroundColor: "rgba(255,255,255,0.12)" },
  videoErrorBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
