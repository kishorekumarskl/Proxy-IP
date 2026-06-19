import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHistory } from "@/context/HistoryContext";
import { useSettings } from "@/context/SettingsContext";
import { formatBytes, ProxyType, useVpn, VpnState } from "@/context/VpnContext";
import { useColors } from "@/hooks/useColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(startTs: number): string {
  const sec = Math.floor((Date.now() - startTs) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const PROTOCOL_LABELS: Record<ProxyType, string> = {
  socks5: "SOCKS5",
  http: "HTTP",
  shadowsocks: "SS",
};

const PROTOCOL_COLORS: Record<ProxyType, string> = {
  socks5: "#6366f1",
  http: "#0ea5e9",
  shadowsocks: "#f59e0b",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ state }: { state: VpnState }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === "connecting") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulse.setValue(1);
    }
  }, [state, pulse]);

  const dotColor =
    state === "connected"
      ? colors.statusConnected
      : state === "connecting"
      ? colors.statusConnecting
      : state === "error"
      ? colors.statusError
      : colors.statusDisconnected;

  return (
    <Animated.View style={[styles.statusDot, { backgroundColor: dotColor, opacity: pulse }]} />
  );
}

function StatusLabel({ state }: { state: VpnState }) {
  const colors = useColors();
  const color =
    state === "connected"
      ? colors.statusConnected
      : state === "connecting"
      ? colors.statusConnecting
      : state === "error"
      ? colors.statusError
      : colors.foreground;
  const label =
    state === "connected" ? "Connected"
    : state === "connecting" ? "Connecting…"
    : state === "error" ? "Error"
    : "Disconnected";
  return <Text style={[styles.statusLabel, { color }]}>{label}</Text>;
}

function TrafficRow({ bytesIn, bytesOut }: { bytesIn: number; bytesOut: number }) {
  const colors = useColors();
  return (
    <View style={[styles.trafficRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.trafficItem}>
        <Feather name="arrow-down-circle" size={14} color={colors.statusConnected} />
        <Text style={[styles.trafficLabel, { color: colors.mutedForeground }]}>IN</Text>
        <Text style={[styles.trafficValue, { color: colors.foreground }]}>{formatBytes(bytesIn)}</Text>
      </View>
      <View style={[styles.trafficDivider, { backgroundColor: colors.border }]} />
      <View style={styles.trafficItem}>
        <Feather name="arrow-up-circle" size={14} color={colors.primary} />
        <Text style={[styles.trafficLabel, { color: colors.mutedForeground }]}>OUT</Text>
        <Text style={[styles.trafficValue, { color: colors.foreground }]}>{formatBytes(bytesOut)}</Text>
      </View>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  returnKeyType,
  onSubmitEditing,
  inputRef,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "numeric" | "email-address" | "url";
  autoCapitalize?: "none" | "sentences";
  returnKeyType?: "done" | "next";
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "none"}
        autoCorrect={false}
        returnKeyType={returnKeyType ?? "done"}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.input,
          { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const {
    activeProfile,
    profiles,
    status,
    trafficStats,
    updateActiveProfile,
    connect,
    disconnect,
  } = useVpn();
  const { totalSessions, lastConnectedAt } = useHistory();

  const [elapsed, setElapsed] = useState<string | null>(null);

  const ipRef = useRef<TextInput>(null);
  const portRef = useRef<TextInput>(null);
  const userRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const ssPassRef = useRef<TextInput>(null);

  const isActive = status.state === "connected" || status.state === "connecting";

  // Live connection timer
  useEffect(() => {
    if (status.state !== "connected" || !status.connectedAt) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(formatElapsed(status.connectedAt!));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status.state, status.connectedAt]);

  const handleToggle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isActive) disconnect(); else await connect();
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const lastSeenLabel = lastConnectedAt
    ? new Date(lastConnectedAt).toLocaleDateString([], { month: "short", day: "numeric" })
    : null;

  const protoColor = PROTOCOL_COLORS[activeProfile.proxyType] ?? colors.primary;
  const protoLabel = PROTOCOL_LABELS[activeProfile.proxyType] ?? activeProfile.proxyType.toUpperCase();

  const showTraffic =
    settings.showTrafficStats &&
    status.state === "connected" &&
    (trafficStats.bytesIn > 0 || trafficStats.bytesOut > 0);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: bottomPad },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={[styles.headerBadge, { backgroundColor: colors.secondary }]}>
              <Feather name="shield" size={13} color={colors.primary} />
              <Text style={[styles.headerBadgeText, { color: colors.primary }]}>
                PRIVATE PROXY
              </Text>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                onPress={() => router.push("/history")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconPill,
                  { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="clock" size={14} color={colors.mutedForeground} />
                {totalSessions > 0 && (
                  <Text style={[styles.iconPillText, { color: colors.mutedForeground }]}>
                    {totalSessions > 99 ? "99+" : totalSessions}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => router.push("/profiles")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconPill,
                  { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="layers" size={14} color={colors.mutedForeground} />
                <Text style={[styles.iconPillText, { color: colors.mutedForeground }]}>
                  {profiles.length}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/settings")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconPill,
                  { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="settings" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Secure Android{"\n"}VPN Router
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Multi-protocol proxy tunnel with full packet-level forwarding.
          </Text>

          {lastSeenLabel && (
            <View style={styles.lastSessionRow}>
              <Feather name="clock" size={12} color={colors.mutedForeground} />
              <Text style={[styles.lastSessionText, { color: colors.mutedForeground }]}>
                Last session: {lastSeenLabel}
              </Text>
              <Pressable onPress={() => router.push("/history")} hitSlop={8}>
                <Text style={[styles.viewHistoryLink, { color: colors.primary }]}>View all →</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Status card ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statusRow}>
            <View>
              <Text style={[styles.statusCaption, { color: colors.mutedForeground }]}>
                Current Status
              </Text>
              <StatusLabel state={status.state} />
            </View>
            <View style={styles.statusRight}>
              {elapsed && (
                <View style={[styles.timerPill, { backgroundColor: colors.statusConnected + "18", borderColor: colors.statusConnected + "44" }]}>
                  <Feather name="clock" size={11} color={colors.statusConnected} />
                  <Text style={[styles.timerText, { color: colors.statusConnected }]}>{elapsed}</Text>
                </View>
              )}
              <StatusDot state={status.state} />
            </View>
          </View>

          <View style={[styles.statusDetail, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.detailCaption, { color: colors.mutedForeground }]}>
              ACTIVE IP / HOST
            </Text>
            <Text style={[styles.detailIp, { color: colors.foreground }]}>
              {status.activeIp || "None"}
            </Text>
            <Text style={[styles.detailMsg, { color: colors.mutedForeground }]} numberOfLines={2}>
              {status.message}
            </Text>
          </View>

          {showTraffic && (
            <TrafficRow bytesIn={trafficStats.bytesIn} bytesOut={trafficStats.bytesOut} />
          )}

          {settings.killSwitch && (
            <View style={[styles.killSwitchBadge, { backgroundColor: colors.statusError + "15", borderColor: colors.statusError + "44" }]}>
              <Feather name="shield-off" size={12} color={colors.statusError} />
              <Text style={[styles.killSwitchText, { color: colors.statusError }]}>
                Kill Switch active · Enable "Always-on VPN" in Android Settings for full protection
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleToggle}
            style={({ pressed }) => [
              styles.connectBtn,
              {
                backgroundColor: isActive ? colors.destructive : colors.primary,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Feather name={isActive ? "wifi-off" : "wifi"} size={20} color="#fff" />
            <Text style={styles.connectBtnText}>
              {status.state === "connecting" ? "Cancel" : isActive ? "Disconnect" : "Connect"}
            </Text>
          </Pressable>
        </View>

        {/* ── Profile form ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Proxy Profile</Text>
            <Pressable
              onPress={() => router.push("/profiles")}
              hitSlop={8}
              style={({ pressed }) => [
                styles.manageBtn,
                { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="layers" size={13} color={colors.primary} />
              <Text style={[styles.manageBtnText, { color: colors.primary }]}>Manage</Text>
            </Pressable>
          </View>

          <View style={[styles.activeProfileBadge, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.protoBadge, { backgroundColor: protoColor + "18" }]}>
              <Text style={[styles.protoText, { color: protoColor }]}>{protoLabel}</Text>
            </View>
            <Feather name="check-circle" size={12} color={colors.statusConnected} />
            <Text style={[styles.activeProfileName, { color: colors.foreground }]} numberOfLines={1}>
              {activeProfile.profileName}
            </Text>
          </View>

          <FormField
            label="Profile Name"
            value={activeProfile.profileName}
            onChangeText={(v) => updateActiveProfile({ profileName: v })}
            placeholder="Office Proxy"
            autoCapitalize="sentences"
            returnKeyType="next"
            onSubmitEditing={() => ipRef.current?.focus()}
          />
          <FormField
            inputRef={ipRef}
            label="Server IP / Host"
            value={activeProfile.serverIp}
            onChangeText={(v) => updateActiveProfile({ serverIp: v })}
            placeholder="203.0.113.10"
            keyboardType="url"
            returnKeyType="next"
            onSubmitEditing={() => portRef.current?.focus()}
          />
          <FormField
            inputRef={portRef}
            label="Port"
            value={activeProfile.port}
            onChangeText={(v) => updateActiveProfile({ port: v.replace(/[^0-9]/g, "") })}
            placeholder={activeProfile.proxyType === "socks5" ? "1080" : "8080"}
            keyboardType="numeric"
            returnKeyType="next"
            onSubmitEditing={() => userRef.current?.focus()}
          />

          {activeProfile.proxyType !== "shadowsocks" && (
            <>
              <FormField
                inputRef={userRef}
                label="Username"
                value={activeProfile.username}
                onChangeText={(v) => updateActiveProfile({ username: v })}
                placeholder="Optional"
                returnKeyType="next"
                onSubmitEditing={() => passRef.current?.focus()}
              />
              <FormField
                inputRef={passRef}
                label="Password"
                value={activeProfile.password}
                onChangeText={(v) => updateActiveProfile({ password: v })}
                placeholder="Optional"
                secureTextEntry
                returnKeyType="done"
              />
            </>
          )}

          {activeProfile.proxyType === "shadowsocks" && (
            <FormField
              inputRef={ssPassRef}
              label="Shadowsocks Password"
              value={activeProfile.ssPassword}
              onChangeText={(v) => updateActiveProfile({ ssPassword: v })}
              placeholder="Required"
              secureTextEntry
              returnKeyType="done"
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  header: { marginBottom: 4, gap: 10 },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    gap: 6,
  },
  headerBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    gap: 5,
  },
  iconPillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  headerTitle: { fontSize: 36, fontFamily: "Inter_700Bold", lineHeight: 42 },
  headerSub: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  lastSessionRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  lastSessionText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  viewHistoryLink: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 24, borderWidth: 1, padding: 20, gap: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusCaption: { fontSize: 13, fontFamily: "Inter_500Medium" },
  statusLabel: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 2 },
  statusRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 1,
    gap: 5,
  },
  timerText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statusDot: { width: 16, height: 16, borderRadius: 8 },
  statusDetail: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  detailCaption: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  detailIp: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 2 },
  detailMsg: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 2 },
  trafficRow: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  trafficItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 7,
  },
  trafficDivider: { width: 1 },
  trafficLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  trafficValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  killSwitchBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  killSwitchText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  connectBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  connectBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  profileHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 5,
  },
  manageBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeProfileBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  protoBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  protoText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  activeProfileName: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
