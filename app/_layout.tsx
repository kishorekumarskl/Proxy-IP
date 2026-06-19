import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HistoryProvider } from "@/context/HistoryContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { useVpn, VpnProvider } from "@/context/VpnContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function HistoryBridge({ children }: { children: React.ReactNode }) {
  const { status, activeProfile } = useVpn();
  return (
    <HistoryProvider
      vpnState={status.state}
      activeIp={status.activeIp}
      activeProfileId={activeProfile.id}
      activeProfileName={activeProfile.profileName}
      activePort={activeProfile.port}
      errorMessage={status.message}
    >
      {children}
    </HistoryProvider>
  );
}

function RootLayoutNav() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="profiles" options={{ headerShown: false, animation: "slide_from_right" }} />
      <Stack.Screen name="history" options={{ headerShown: false, animation: "slide_from_right" }} />
      <Stack.Screen name="settings" options={{ headerShown: false, animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <SettingsProvider>
                <VpnProvider>
                  <HistoryBridge>
                    <RootLayoutNav />
                  </HistoryBridge>
                </VpnProvider>
              </SettingsProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
