import React, { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View, Text } from "react-native";
import { WebView } from "react-native-webview";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../store/ThemeContext";

interface Props {
  /** Server origin, e.g. http://192.168.1.5:8080 (no trailing slash). */
  baseUrl: string;
  /** Authenticated raw URL of the PDF (includes ?token=…). */
  pdfUrl: string;
  fileName: string;
  /** Fallback when the viewer page can't load (old server / offline). */
  onOpenExternal: () => void;
}

/**
 * Built-in PDF viewer.
 *
 * Loads the self-hosted pdf.js viewer page served by the Nexora server
 * (`/pdfviewer/index.html` — pdf.js runs in the WebView, so both iOS and
 * Android render PDFs in-app with page nav + zoom + swipe, no native module
 * and no third-party cloud). The PDF itself is streamed from the same server
 * origin with the session token, so nothing leaves the network.
 */
export default function PdfViewer({ baseUrl, pdfUrl, fileName, onOpenExternal }: Props) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [missingViewer, setMissingViewer] = useState(false);
  const readyRef = useRef(false);
  const [viewKey, setViewKey] = useState(0);

  const viewerUrl = `${baseUrl.replace(/\/+$/, "")}/pdfviewer/index.html?file=${encodeURIComponent(
    pdfUrl
  )}&name=${encodeURIComponent(fileName)}`;

  const retry = () => {
    readyRef.current = false;
    setMissingViewer(false);
    setFailed(false);
    setViewKey((k) => k + 1);
  };

  if (failed) {
    return (
      <View style={[styles.failed, { backgroundColor: colors.surface, borderColor: colors.borderSoft }]}>
        <MaterialCommunityIcons name="file-pdf-box" size={44} color={colors.danger} />
        <Text style={[styles.failedTitle, { color: colors.content }]}>Could not open the PDF viewer</Text>
        <Text style={[styles.failedSub, { color: colors.muted }]}>
          {missingViewer
            ? "Your Nexora server doesn't have the PDF viewer page installed yet — update the server to the latest build (web/public/pdfviewer is auto-copied on rebuild), or open the PDF in another app."
            : "The viewer page wasn't found on the server, or the connection failed."}
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
          onPress={retry}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
          <Text style={[styles.retryText]}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.extBtn, { borderColor: colors.border }]} onPress={onOpenExternal} activeOpacity={0.7}>
          <MaterialCommunityIcons name="open-in-new" size={16} color={colors.content} />
          <Text style={[styles.extText, { color: colors.content }]}>Open with another app</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        key={viewKey}
        source={{ uri: viewerUrl }}
        style={styles.web}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}
        // Detect an old server: the real viewer page reports PDF_READY via
        // postMessage (it defines window.pdfjsLib). If nothing reports
        // within ~6s, the server likely served the Nexora web SPA fallback
        // instead — surface the missing-viewer state.
        injectedJavaScript={`(function(){try{if(window.pdfjsLib){window.ReactNativeWebView.postMessage("PDF_READY");}}catch(e){}})();`}
        onMessage={(e) => {
          if (e.nativeEvent.data === "PDF_READY") readyRef.current = true;
        }}
        onLoadEnd={() => {
          setTimeout(() => {
            if (!readyRef.current) {
              setMissingViewer(true);
              setFailed(true);
            }
          }, 6000);
        }}
        onHttpError={(s) => {
          if (s.nativeEvent.statusCode >= 400) setFailed(true);
        }}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B0E17" },
  web: { flex: 1, backgroundColor: "#0B0E17" },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  failed: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 32,
    borderWidth: 1,
    borderRadius: 20,
    margin: 16,
  },
  failedTitle: { fontWeight: "700", fontSize: 16, marginTop: 4 },
  failedSub: { textAlign: "center", fontSize: 13, lineHeight: 19, marginBottom: 8 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
  },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  extBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  extText: { fontWeight: "600", fontSize: 14 },
});
