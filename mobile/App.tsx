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
import { AppIcon } from "./src/components/AppIcon";
import type { RootStackParamList, MainTabParamList } from "./src/navigation/types";

import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import RecentsScreen from "./src/screens/RecentsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import BrowserScreen from "./src/screens/BrowserScreen";
import PreviewScreen from "./src/screens/PreviewScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home: { active: "view-dashboard", inactive: "view-dashboard-outline" },
  Recents: { active: "clock", inactive: "clock-outline" },
  Settings: { active: "cog", inactive: "cog-outline" },
};

function TabIcon({ routeName, focused, color, size }: { routeName: string; focused: boolean; color: string; size: number }) {
  const { colors } = useTheme();
  const icons = TAB_ICONS[routeName] || TAB_ICONS.Home;
  const name = focused ? icons.active : icons.inactive;
  return (
    <View
      style={[
        styles.tabIconWrap,
        focused ? { backgroundColor: colors.accentSoft } : undefined,
      ]}
    >
      <MaterialCommunityIcons name={name as any} size={size} color={color} />
    </View>
  );
}

function MainTabs() {
  const { colors, shadow } = useTheme();

  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.content,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surfaceElevated,
          borderTopWidth: 0,
          position: "absolute",
          bottom: 24,
          left: 20,
          right: 20,
          height: 66,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.borderSoft,
          ...shadow,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "600", fontSize: 11, marginBottom: 10 },
        tabBarIconStyle: { marginTop: 10 },
        tabBarIcon: ({ focused, color, size }) => (
          <TabIcon routeName={route.name} focused={focused} color={color} size={size} />
        ),
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <RootNavigation />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
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
