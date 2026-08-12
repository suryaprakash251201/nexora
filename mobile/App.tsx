import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
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
import AdminScreen from "./src/screens/AdminScreen";
import FavoritesScreen from "./src/screens/FavoritesScreen";
import TrashScreen from "./src/screens/TrashScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

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
    <NavigationContainer theme={dynamicNavTheme}>
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
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: "Administration" }} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: "Favorites" }} />
        <Stack.Screen name="Trash" component={TrashScreen} options={{ title: "Trash" }} />
      </Stack.Navigator>
      <MiniPlayer />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <AudioProvider>
            <RootNavigation />
          </AudioProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

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
