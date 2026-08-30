import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";

/** expo-image wrapped for native-driver opacity animation. */
const AnimatedImage = Animated.createAnimatedComponent(Image);

/**
 * NowPlayingArtwork — atomic artwork surface for the audio player.
 *
 * Guarantees:
 *  • A successfully loaded cover NEVER unmounts while a new one loads — the
 *    previous artwork stays fully visible underneath and the new artwork
 *    crossfades over it (~250ms). No blank frame between tracks, ever.
 *  • Rapid swipes are race-guarded: every target URL gets a monotonic token;
 *    only the latest token may commit or retire layers. Stale loads/failures
 *    are silently discarded.
 *  • Loading ≠ blank: while loading, whatever was on screen stays on screen;
 *    with nothing committed yet, the branded Nexora fallback shows instead.
 *  • `url === null` (track confirmed to have no embedded art) fades the
 *    committed layer out to reveal the same branded fallback — an explicit,
 *    designed state rather than an empty box.
 *
 * The component fills its parent (absoluteFill) and is memoized so progress/
 * playback re-renders never touch the image layers.
 */
function NowPlayingArtworkInner({
  url,
  trackKey,
  blurRadius,
  contentFit = "cover",
  onLoaded,
  onError,
}: {
  /** Target artwork URL; null means "no artwork available" */
  url: string | null;
  /** Stable per-track identity (${rootId}:${path}) — used as recycling key */
  trackKey?: string | null;
  blurRadius?: number;
  contentFit?: "cover" | "contain";
  /** Fired when THIS url finishes decoding (not for stale superseded loads) */
  onLoaded?: () => void;
  /** Fired when THIS url fails (stale failures are swallowed) */
  onError?: () => void;
}) {
  // Last artwork that finished loading — remains visible indefinitely.
  const [committed, setCommitted] = useState<string | null>(null);
  // Artwork currently loading on top of the committed layer.
  const [pending, setPending] = useState<string | null>(null);
  const pendingOpacity = useRef(new Animated.Value(0)).current;
  // Monotonic request token: increments for every new target URL / retire.
  // Callbacks compare against it so rapid swipes can't let stale results act.
  const reqRef = useRef(0);
  const pendingUrlRef = useRef<string | null>(null);
  const committedRef = useRef<string | null>(null);

  useEffect(() => {
    // Explicit "no artwork": retire whatever is committed with a soft fade
    // so the transition reads as intentional, not as a flash to empty.
    if (!url) {
      const retireId = ++reqRef.current; // invalidates any in-flight load
      setPending(null);
      pendingUrlRef.current = null;
      if (committedRef.current !== null) {
        pendingOpacity.setValue(1);
        Animated.timing(pendingOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && reqRef.current === retireId) {
            committedRef.current = null;
            setCommitted(null);
          }
        });
      }
      return;
    }
    if (url === committed || pendingUrlRef.current === url) {
      // Target equals what's already on screen (e.g. rapid A→B→A): cancel
      // any in-flight load for another track so it can never commit over
      // the correct artwork.
      if (pending && pending !== url) {
        reqRef.current++;
        pendingUrlRef.current = null;
        setPending(null);
      }
      return;
    }

    const id = ++reqRef.current;
    pendingUrlRef.current = url;
    pendingOpacity.setValue(0);
    setPending(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handlePendingLoad = useCallback(() => {
    const wonUrl = pendingUrlRef.current;
    if (!wonUrl) return; // superseded / retired before decode finished
    Animated.timing(pendingOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      if (pendingUrlRef.current !== wonUrl) return; // superseded mid-fade
      committedRef.current = wonUrl;
      setCommitted(wonUrl);
      setPending((cur) => (cur === wonUrl ? null : cur));
    });
    onLoaded?.();
  }, [pendingOpacity, onLoaded]);

  const handlePendingError = useCallback(() => {
    if (pendingUrlRef.current === null) return;
    // Drop the failed layer; committed artwork stays visible underneath.
    pendingUrlRef.current = null;
    setPending(null);
    onError?.();
  }, [onError]);

  const fallback = useMemo(
    () => (
      <LinearGradient
        colors={["#1C2650", "#3D53DB", "#5B8CFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      >
        <MaterialCommunityIcons
          name="music-note"
          size={80}
          color="rgba(255,255,255,0.92)"
          style={styles.fallbackIcon}
        />
      </LinearGradient>
    ),
    []
  );

  return (
    <View style={StyleSheet.absoluteFill} collapsable={false}>
      {/* Layer 0 — branded fallback (always present, bottom of stack) */}
      {fallback}

      {/* Layer 1 — committed artwork (never unmounts while loading next) */}
      {committed ? (
        <Image
          source={{ uri: committed }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          recyclingKey={trackKey ?? undefined}
        />
      ) : null}

      {/* Layer 2 — incoming artwork, fades in above the committed layer */}
      {pending ? (
        <AnimatedImage
          source={{ uri: pending }}
          style={[StyleSheet.absoluteFill, { opacity: pendingOpacity }]}
          contentFit={contentFit}
          blurRadius={blurRadius}
          cachePolicy="memory-disk"
          onLoad={handlePendingLoad}
          onError={handlePendingError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackIcon: { flex: 1, textAlignVertical: "center", textAlign: "center" },
});

export default React.memo(NowPlayingArtworkInner);
