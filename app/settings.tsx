import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DnsMode, useSettings } from "@/context/SettingsContext";
import { useVpn } from "@/context/VpnContext";
import { useColors } from "@/hooks/useColors";

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
      {title}
    </Text>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  value,
  onChange,
  accentColor,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  accentColor?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: (accentColor ?? colors.primary) + "18" }]}>
        <Feather name={icon} size={16} color={accentColor ?? colors.primary} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync();
          onChange(v);
        }}
        trackColor={{ false: colors.border, true: accentColor ?? colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function DnsModeRow() {
  const colors = useColors();
  const { settings, updateSettings } = useSettings();
  const modes: { key: DnsMode; label: string; sub: string }[] = [
    { key: "direct", label: "Direct", sub: "DNS queries routed via UDP through proxy" },
    { key: "fake", label: "Fake DNS", sub: "For HTTP-only proxies that block UDP" },
  ];
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "flex-start" }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18", marginTop: 2 }]}>
        <Feather name="globe" size={16} color={colors.primary} />
      </View>
      <View style={[styles.rowContent, { gap: 10 }]}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>DNS Mode</Text>
        <View style={styles.segmentRow}>
          {modes.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => { Haptics.selectionAsync(); updateSettings({ dnsMode: m.key }); }}
              style={[
                styles.segment,
                {
                  backgroundColor: settings.dnsMode === m.key ? colors.primary : colors.background,
                  borderColor: settings.dnsMode === m.key ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.segmentText, { color: settings.dnsMode === m.key ? "#fff" : colors.mutedForeground }]}>
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
          {modes.find((m) => m.key === settings.dnsMode)?.sub}
        </Text>
      </View>
    </View>
  );
}

function CustomDnsRow() {
  const colors = useColors();
  const { settings, updateSettings } = useSettings();
  const [draft, setDraft] = useState(settings.customDns);

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
        <Feather name="terminal" size={16} color={colors.primary} />
      </View>
      <View style={[styles.rowContent, { gap: 6 }]}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>DNS Server</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => updateSettings({ customDns: draft.trim() || "1.1.1.1" })}
          onSubmitEditing={() => updateSettings({ customDns: draft.trim() || "1.1.1.1" })}
          placeholder="1.1.1.1"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="decimal-pad"
          autoCapitalize="none"
          style={[styles.dnsInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { exportProfilesJson, importProfilesJson } = useVpn();
  const [importText, setImportText] = useState("");
  const [importVisible, setImportVisible] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const handleImport = () => {
    if (!importText.trim()) return;
    const result = importProfilesJson(importText.trim());
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Imported", `${result.count} profile${result.count !== 1 ? "s" : ""} added.`);
      setImportText("");
      setImportVisible(false);
    } else {
      Alert.alert("Import failed", result.error ?? "Invalid format");
    }
  };

  const handleReset = () => {
    Alert.alert("Reset Settings", "Restore all settings to defaults?", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); resetSettings(); } },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>App & VPN configuration</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader title="VPN SECURITY" />

        <ToggleRow
          icon="shield-off"
          label="Kill Switch"
          description="Aggressively reconnect if VPN drops. Enable 'Always-on VPN' in Android Settings for full OS-level protection."
          value={settings.killSwitch}
          onChange={(v) => updateSettings({ killSwitch: v })}
          accentColor={colors.statusError}
        />

        <ToggleRow
          icon="refresh-cw"
          label="Auto-Reconnect"
          description="Reconnect automatically when the network changes or becomes available."
          value={settings.autoReconnect}
          onChange={(v) => updateSettings({ autoReconnect: v })}
        />

        <SectionHeader title="DNS" />

        <DnsModeRow />
        <CustomDnsRow />

        <SectionHeader title="DISPLAY" />

        <ToggleRow
          icon="bar-chart-2"
          label="Show Traffic Stats"
          description="Display bytes transferred on the home screen while connected."
          value={settings.showTrafficStats}
          onChange={(v) => updateSettings({ showTrafficStats: v })}
        />

        <SectionHeader title="PROFILES" />

        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); exportProfilesJson(); }}
          style={({ pressed }) => [styles.actionRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="upload" size={16} color={colors.primary} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Export All Profiles</Text>
            <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>Share as JSON via system share sheet</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Pressable
          onPress={() => setImportVisible(!importVisible)}
          style={({ pressed }) => [styles.actionRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="download" size={16} color={colors.primary} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Import Profiles</Text>
            <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>Paste exported JSON to import profiles</Text>
          </View>
          <Feather name={importVisible ? "chevron-up" : "chevron-right"} size={18} color={colors.mutedForeground} />
        </Pressable>

        {importVisible && (
          <View style={[styles.importBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              value={importText}
              onChangeText={setImportText}
              placeholder='Paste JSON here, e.g. [{"id":"...","serverIp":"..."}]'
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={5}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.importInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            <Pressable
              onPress={handleImport}
              style={({ pressed }) => [styles.importBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={styles.importBtnText}>Import</Text>
            </Pressable>
          </View>
        )}

        <SectionHeader title="ABOUT" />

        <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="info" size={16} color={colors.primary} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Private Proxy Client</Text>
            <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>Version 1.0.0 · com.privateproxyclient</Text>
          </View>
        </View>

        <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="cpu" size={16} color={colors.primary} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Forwarding Modes</Text>
            <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
              Mode A: tun2socks packet-level forwarding (all apps){"\n"}
              Mode B: Android HTTP proxy fallback (most apps)
            </Text>
          </View>
        </View>

        <Pressable
          onPress={handleReset}
          style={({ pressed }) => [styles.resetBtn, { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.resetBtnText, { color: colors.destructive }]}>Reset All Settings</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { alignItems: "center", flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  segmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dnsInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  importBox: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  importInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    minHeight: 90,
    textAlignVertical: "top",
  },
  importBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  importBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  resetBtn: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  resetBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
