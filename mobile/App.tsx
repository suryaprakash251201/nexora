import React from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession } from "./src/store/SessionContext";
import { colors, gradients, shadow } from "./src/theme";
import { AppIcon } from "./src/components/AppIcon";
import { LinearGradient } from "expo-linear-gradient";
import type { RootStackParamList, MainTabParamList } from "./src/navigation/types";

import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import RecentsScreen from "./src/screens/RecentsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import BrowserScreen from "./src/screens/BrowserScreen";
import PreviewScreen from "./src/screens/PreviewScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.content,
    border: colors.border,
    primary: colors.accent,
  },
};

const tabIcon =
  (active: string, inactive: string) =>
  ({ focused, color, size }: { focused: boolean; color: string; size: number }) =>
    <MaterialCommunityIcons name={(focused ? active : inactive) as any} size={size} color={color} />;

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.content,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        tabBarStyle: { 
          backgroundColor: colors.surfaceElevated, 
          borderTopWidth: 0, 
          position: "absolute",
          bottom: 24,
          left: 16,
          right: 16,
          height: 64,
          borderRadius: 32,
          ...shadow,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "600", fontSize: 11, marginBottom: 8 },
        tabBarIconStyle: { marginTop: 8 },
      }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: "Storage",
          headerShown: false,
          tabBarIcon: tabIcon("server", "server-outline"),
        }}
      />
      <Tabs.Screen
        name="Recents"
        component={RecentsScreen}
        options={{
          title: "Recents",
          tabBarIcon: tabIcon("clock", "clock-outline"),
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "Settings",
          tabBarIcon: tabIcon("cog", "cog-outline"),
        }}
      />
    </Tabs.Navigator>
  );
}

function Splash() {
  return (
    <LinearGradient colors={[...gradients.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.splash}>
      <View style={styles.splashInner}>
        <View style={styles.splashMark}>
          <MaterialCommunityIcons name="server" size={44} color="#fff" />
        </View>
        <View style={styles.splashText}>
          <View style={styles.splashBar} />
          <View style={[styles.splashBar, { width: 120 }]} />
        </View>
      </View>
    </LinearGradient>
  );
}

function Root() {
  const { user, booting, api } = useSession();

  if (booting) {
    return <Splash />;
  }

  if (!user || !api) {
    return <LoginScreen onDone={() => {}} />;
  }

  return (
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
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <Root />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  splashInner: { alignItems: "center", gap: 24 },
  splashMark: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  splashText: { alignItems: "center", gap: 8 },
  splashBar: { width: 160, height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.35)" },
});
