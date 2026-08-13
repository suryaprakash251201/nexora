import React, { Component, useEffect, useRef, useState } from "react";
import { StyleSheet, View, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import type { NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { SessionProvider, useSession } from "./src/store/SessionContext";
import { ThemeProvider, useTheme } from "./src/store/ThemeContext";
import { AudioProvider } from "./src/store/AudioContext";
import { AppIcon } from "./src/components/AppIcon";
import { MiniPlayer } from "./src/components/MiniPlayer";
import { PremiumTabBar } from "./src/components/PremiumTabBar";
import type { RootStackParamList, MainTabParamList } from "./src/navigation/types";

import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import RecentsScreen from "./src/screens/RecentsScreen";
import SearchScreen from "./src/screens/SearchScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import BrowserScreen from "./src/screens/BrowserScreen";
import PreviewScreen from "./src/screens/PreviewScreen";
import PlaylistScreen from "./src/screens/PlaylistScreen";
import CategoryScreen from "./src/screens/CategoryScreen";
import LikedScreen from "./src/screens/LikedScreen";
import AdminScreen from "./src/screens/AdminScreen";
import FavoritesScreen from "./src/screens/FavoritesScreen";
import TrashScreen from "./src/screens/TrashScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

// getCurrentRoute() returns the DEEPEST focused route, so on the tab
// navigator it reports the active tab name (Home/Search/Recents/Settings) —
// not the stack screen name "Main".
const TAB_ROUTES = new Set(["Home", "Search", "Recents", "Settings"]);

function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tabs.Navigator
      tabBar={(props) => <PremiumTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.content,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
      })}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: "Home",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="Search"
        component={SearchScreen}
        options={{
          title: "Search",
        }}
      />
      <Tabs.Screen
        name="Recents"
        component={RecentsScreen}
        options={{
          title: "Recents",
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "Settings",
        }}
      />
    </Tabs.Navigator>
  );
}

function Splash() {
  const { gradients } = useTheme();
  return (
    <LinearGradient colors={[...gradients.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.splash}>
      <View style={styles.splashInner}>
        <AppIcon size={96} />
        <View style={styles.splashText}>
          <Text style={styles.splashTitle}>Nexora</Text>
          <Text style={styles.splashSub}>Self-hosted file workspace</Text>
        </View>
        <View style={styles.splashLoader}>
          <View style={styles.splashDot} />
          <View style={[styles.splashDot, styles.splashDotMid]} />
          <View style={styles.splashDot} />
        </View>
      </View>
    </LinearGradient>
  );
}

function RootNavigation() {
  const { user, booting, api } = useSession();
  const { colors, isDark } = useTheme();
  // Whether the current screen shows the tab bar — the mini player uses this
  // to sit flush above the tab bar on tab screens and at the very bottom on
  // pushed screens (Browser, Preview, Playlist, …) where there is no tab bar.
  const [tabVisible, setTabVisible] = useState(true);
  const navRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  // CRITICAL: the NavigationContainer only mounts AFTER the user is signed in
  // (LoginScreen renders without it). A one-shot effect would run while
  // navRef.current is still null — leaving tabVisible stuck at false and the
  // mini player permanently overlapping the bottom nav bar. Re-run whenever
  // auth state flips so we always attach the state listener to the live
  // container and capture the initial route.
  useEffect(() => {
    if (!user || !api) return;
    const syncTab = () => {
      const route = navRef.current?.getCurrentRoute();
      setTabVisible(!!route && TAB_ROUTES.has(route.name));
    };
    // The container may not have finished initializing its navigation state
    // during this commit — sample it on the next tick, then keep listening.
    const t = setTimeout(syncTab, 0);
    const unsub = navRef.current?.addListener("state", syncTab);
    return () => {
      clearTimeout(t);
      unsub?.();
    };
  }, [user, api]);

  if (booting) {
    return (
      <>
        <StatusBar style="light" />
        <Splash />
      </>
    );
  }

  if (!user || !api) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen onDone={() => {}} />
      </>
    );
  }

  const dynamicNavTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.content,
      border: colors.borderSoft,
      primary: colors.accent,
    },
  };

  return (
    <NavigationContainer ref={navRef} theme={dynamicNavTheme}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.content,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Browser" component={BrowserScreen} options={({ route }) => ({ title: route.params.rootName })} />
        <Stack.Screen name="Preview" component={PreviewScreen} options={({ route }) => ({ title: route.params.item.name })} />
        <Stack.Screen name="Playlist" component={PlaylistScreen} options={{ title: "Playlist" }} />
        <Stack.Screen name="Category" component={CategoryScreen} options={{ title: "Category" }} />
        <Stack.Screen name="Liked" component={LikedScreen} options={{ title: "Liked Songs" }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: "Administration" }} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: "Favorites" }} />
        <Stack.Screen name="Trash" component={TrashScreen} options={{ title: "Trash" }} />
      </Stack.Navigator>
      <MiniPlayer tabVisible={tabVisible} />
    </NavigationContainer>
  );
}

/**
 * Root error boundary — catches render crashes (e.g. the RN "Text strings
 * must be rendered within a <Text> component" invariant) so the app stays
 * usable instead of unmounting to a blank screen, and logs the full
 * component stack to the Metro console for precise diagnosis.
 */
class AppErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Full component stack goes to the Metro/dev console.
    console.error("[AppErrorBoundary]", error?.message || error, "\nComponent stack:\n" + (info?.componentStack || "(none)"));
  }

  render() {
    if (this.state.error) {
      return (
        <View style={crashStyles.crashRoot}>
          <View style={crashStyles.crashIcon}>
            <MaterialCommunityIcons name="alert-decagram-outline" size={40} color="#8B5CF6" />
          </View>
          <Text style={crashStyles.crashTitle}>Something went wrong</Text>
          <Text style={crashStyles.crashMsg} numberOfLines={6}>
            {this.state.error?.message || "Unknown error"}
          </Text>
          <Text style={crashStyles.crashHint}>
            The error details were logged to the Metro console. Pull the app down to reload.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <AudioProvider>
            <AppErrorBoundary>
              <RootNavigation />
            </AppErrorBoundary>
          </AudioProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const crashStyles = StyleSheet.create({
  crashRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
    backgroundColor: "#040508",
  },
  crashIcon: { marginBottom: 4 },
  crashTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  crashMsg: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", lineHeight: 20 },
  crashHint: { color: "rgba(255,255,255,0.4)", fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: 8 },
});

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  splashInner: { alignItems: "center", gap: 20 },
  splashText: { alignItems: "center", gap: 4 },
  splashTitle: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: 0.5 },
  splashSub: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "500" },
  splashLoader: { flexDirection: "row", gap: 6, marginTop: 16 },
  splashDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  splashDotMid: {
    backgroundColor: "rgba(255,255,255,0.7)",
  },
});
