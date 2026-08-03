import React, { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { mediaThumbnailUrl } from "../api/client";
import { fileIconFor } from "../lib/fileMeta";
import type { FileItem } from "../api/types";

/**
 * Renders embedded album art (if the backend can extract it) for audio files,
 * gracefully falling back to the colored music icon when the cover is missing
 * or the server has no thumbnail. The icon is drawn underneath the image so
 * the icon shows while the cover streams in, then the cover fades over it.
 */
export const AudioCover = memo(function AudioCover({
  item,
  size = 256,
  iconSize = 22,
}: {
  item: FileItem;
  size?: number;
  iconSize?: number;
}) {
  const { name, color } = fileIconFor(item);
  const [failed, setFailed] = useState(false);
  const uri = mediaThumbnailUrl(item.root_id, item.path, size);

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.fallback}>
        <MaterialCommunityIcons name={name as any} size={iconSize} color={color} />
      </View>
      {!failed && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});