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
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHistory } from "@/context/HistoryContext";
import { ProxyProfile, ProxyType, SS_METHODS, SsMethod, useVpn } from "@/context/VpnContext";
import { useColors } from "@/hooks/useColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function latencyColor(ms: number | null | undefined, colors: ReturnType<typeof useColors>): string {
  if (ms == null) return colors.mutedForeground;
  if (ms < 0) return colors.statusError;
  if (ms < 100) return colors.statusConnected;
  if (ms < 250) return "#f59e0b";
  return colors.statusError;
}

function latencyLabel(ms: number | null | undefined): string {
  if (ms === undefined) return "";
  if (ms === null) return "…";
  if (ms < 0) return "timeout";
  return `${ms} ms`;
}

const PROTO_COLORS: Record<ProxyType, string> = {
  socks5: "#6366f1",
  http: "#0ea5e9",
  shadowsocks: "#f59e0b",
};

// ─── Stat Pill ────────────────────────────────────────────────────────────────

function StatPill({ icon, value, color }: { icon: React.ComponentProps<typeof Feather>["name"]; value: string; color: string }) {
  return (
    <View style={[styles.statPill, { backgroundColor: color + "15", borderColor: color + "30" }]}>
      <Feather name={icon} size={10} color={color} />
      <Text style={[styles.statPillText, { color }]}>{value}</Text>
    </View>
  );
}

// ─── Protocol Selector ────────────────────────────────────────────────────────

function ProtoSelector({ value, onChange }: { value: ProxyType; onChange: (v: ProxyType) => void }) {
  const colors = useColors();
  const options: { key: ProxyType; label: string }[] = [
    { key: "socks5", label: "SOCKS5" },
    { key: "http", label: "HTTP" },
    { key: "shadowsocks", label: "Shadowsocks" },
  ];
  return (
    <View style={styles.protoRow}>
      {options.map((o) => {
        const active = value === o.key;
        const col = PROTO_COLORS[o.key];
        return (
          <Pressable
            key={o.key}
            onPress={() => { Haptics.selectionAsync(); onChange(o.key); }}
            style={[
              styles.protoBtn,
              {
                backgroundColor: active ? col + "18" : colors.background,
                borderColor: active ? col : colors.border,
              },
            ]}
          >
            <Text style={[styles.protoBtnText, { color: active ? col : colors.mutedForeground }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── SS Method Selector ───────────────────────────────────────────────────────

function SsMethodRow({ value, onChange }: { value: SsMethod; onChange: (v: SsMethod) => void }) {
  const colors = useColors();
  return (
    <View style={styles.ssMethodWrap}>
      <Text style={[styles.ssMethodLabel, { color: colors.mutedForeground }]}>Cipher Method</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ssMethodScroll}>
        {SS_METHODS.map((m) => {
          const active = value === m;
          return (
            <Pressable
              key={m}
              onPress={() => { Haptics.selectionAsync(); onChange(m); }}
              style={[
                styles.ssMethodBtn,
                {
                  backgroundColor: active ? "#f59e0b18" : colors.background,
                  borderColor: active ? "#f59e0b" : colors.border,
                },
              ]}
            >
              <Text style={[styles.ssMethodText, { color: active ? "#f59e0b" : colors.mutedForeground }]}>
                {m}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Import URI Modal ─────────────────────────────────────────────────────────

function ImportUriPanel({ onImport, onClose }: { onImport: (uri: string) => void; onClose: () => void }) {
  const colors = useColors();
  const [uri, setUri] = useState("");

  return (
    <View style={[styles.importPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.importTitle, { color: colors.foreground }]}>Import from URI</Text>
      <Text style={[styles.importSub, { color: colors.mutedForeground }]}>
        Paste a proxy URI: {"\n"}
        socks5://user:pass@host:port{"\n"}
        http://host:port{"\n"}
        ss://base64@host:port#Name
      </Text>
      <TextInput
        value={uri}
        onChangeText={setUri}
        placeholder="socks5://host:1080"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.uriInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
      />
      <View style={styles.importBtns}>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.importCancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.importCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onImport(uri)}
          style={({ pressed }) => [styles.importConfirmBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={styles.importConfirmText}>Import</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Profile Card ─────────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  isActive,
  latencyMs,
  onSelect,
  onDelete,
  onRename,
  onChangeProto,
  onChangeSsMethod,
  onTestLatency,
}: {
  profile: ProxyProfile;
  isActive: boolean;
  latencyMs: number | null | undefined;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onChangeProto: (t: ProxyType) => void;
  onChangeSsMethod: (m: SsMethod) => void;
  onTestLatency: () => void;
}) {
  const colors = useColors();
  const { getProfileStats } = useHistory();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.profileName);

  const stats = getProfileStats(profile.id);
  const hasStats = stats.sessionCount > 0;
  const protoColor = PROTO_COLORS[profile.proxyType] ?? colors.primary;
  const lColor = latencyColor(latencyMs, colors);

  const commitRename = () => {
    const trimmed = name.trim();
    if (trimmed.length > 0) onRename(trimmed);
    else setName(profile.profileName);
    setEditing(false);
  };

  const serverLabel = profile.serverIp.trim()
    ? `${profile.serverIp.trim()}:${profile.port}`
    : "No server configured";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isActive ? colors.secondary : colors.card,
          borderColor: isActive ? colors.primary : colors.border,
        },
      ]}
    >
      {/* Top row */}
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.cardTop, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.cardLeft}>
          <View style={styles.cardTitleRow}>
            {isActive && (
              <View style={[styles.activePill, { backgroundColor: colors.primary + "22" }]}>
                <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.activePillText, { color: colors.primary }]}>Active</Text>
              </View>
            )}
            <View style={[styles.miniProtoBadge, { backgroundColor: protoColor + "18" }]}>
              <Text style={[styles.miniProtoText, { color: protoColor }]}>
                {profile.proxyType === "shadowsocks" ? "SS" : profile.proxyType.toUpperCase()}
              </Text>
            </View>
            {editing ? (
              <TextInput
                value={name}
                onChangeText={setName}
                onBlur={commitRename}
                onSubmitEditing={commitRename}
                autoFocus
                style={[styles.renameInput, { color: colors.foreground, borderColor: colors.primary, backgroundColor: colors.background }]}
              />
            ) : (
              <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
                  {profile.profileName}
                </Text>
              </Pressable>
            )}
          </View>

          <View style={styles.cardMeta}>
            <Feather name="server" size={11} color={colors.mutedForeground} />
            <Text style={[styles.cardServer, { color: colors.mutedForeground }]} numberOfLines={1}>
              {serverLabel}
            </Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          {/* Latency indicator */}
          {latencyMs !== undefined && (
            <View style={[styles.latencyBadge, { backgroundColor: lColor + "15", borderColor: lColor + "44" }]}>
              <Text style={[styles.latencyText, { color: lColor }]}>{latencyLabel(latencyMs)}</Text>
            </View>
          )}
          <Pressable onPress={onDelete} hitSlop={8} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Feather name="trash-2" size={16} color={colors.destructive} />
          </Pressable>
          <Pressable onPress={() => setExpanded(!expanded)} hitSlop={8} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Feather name={expanded ? "chevron-up" : "settings"} size={16} color={colors.mutedForeground} />
          </Pressable>
          {isActive ? (
            <Feather name="check-circle" size={18} color={colors.primary} />
          ) : (
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          )}
        </View>
      </Pressable>

      {/* Expanded settings */}
      {expanded && (
        <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.expandedLabel, { color: colors.mutedForeground }]}>PROTOCOL</Text>
          <ProtoSelector value={profile.proxyType} onChange={onChangeProto} />

          {profile.proxyType === "shadowsocks" && (
            <SsMethodRow value={profile.ssMethod} onChange={onChangeSsMethod} />
          )}

          <Pressable
            onPress={onTestLatency}
            style={({ pressed }) => [
              styles.pingBtn,
              { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="activity" size={14} color={colors.primary} />
            <Text style={[styles.pingBtnText, { color: colors.primary }]}>
              {latencyMs === null ? "Testing…" : "Test Latency"}
            </Text>
            {latencyMs !== undefined && latencyMs !== null && (
              <Text style={[styles.pingResult, { color: lColor }]}>{latencyLabel(latencyMs)}</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Stats row */}
      {hasStats && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.statsRow}>
            <StatPill icon="activity" value={`${stats.sessionCount} session${stats.sessionCount !== 1 ? "s" : ""}`} color={colors.primary} />
            <StatPill icon="zap" value={formatDuration(stats.totalDurationSeconds)} color={colors.statusConnected} />
            {stats.lastConnectedAt && (
              <StatPill icon="clock" value={formatShortDate(stats.lastConnectedAt)} color={colors.mutedForeground} />
            )}
          </View>
        </>
      )}

      {!hasStats && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.noStatsText, { color: colors.mutedForeground }]}>No sessions yet</Text>
        </>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    profiles,
    activeProfile,
    latencies,
    selectProfile,
    saveAsNewProfile,
    createBlankProfile,
    deleteProfile,
    updateActiveProfile,
    importFromUri,
    testLatency,
  } = useVpn();
  const { sessions } = useHistory();
  const [showImport, setShowImport] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const totalSessionsAll = sessions.filter((s) => s.status !== "active").length;
  const totalDurationAll = sessions.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0);

  const handleSelect = (id: string) => {
    Haptics.selectionAsync();
    selectProfile(id);
    router.back();
  };

  const handleDelete = (profile: ProxyProfile) => {
    if (profiles.length <= 1) { Alert.alert("Cannot delete", "You need at least one profile."); return; }
    Alert.alert(
      "Delete Profile",
      `Delete "${profile.profileName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteProfile(profile.id); },
        },
      ]
    );
  };

  const handleRename = (id: string, name: string) => {
    if (id === activeProfile.id) updateActiveProfile({ profileName: name });
  };

  const handleChangeProto = (id: string, proxyType: ProxyType) => {
    if (id === activeProfile.id) updateActiveProfile({ proxyType });
  };

  const handleChangeSsMethod = (id: string, ssMethod: SsMethod) => {
    if (id === activeProfile.id) updateActiveProfile({ ssMethod });
  };

  const handleImportUri = (uri: string) => {
    if (!uri.trim()) { Alert.alert("Enter a proxy URI"); return; }
    const result = importFromUri(uri);
    if (result) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Imported", `"${result.profileName}" added and selected.`);
      setShowImport(false);
    } else {
      Alert.alert("Invalid URI", "Could not parse the proxy URI.\n\nSupported formats:\n• socks5://host:port\n• http://host:port\n• ss://base64@host:port");
    }
  };

  function formatDurationShort(s: number) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  }

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
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Saved Profiles</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => setShowImport(!showImport)}
          hitSlop={12}
          style={({ pressed }) => [styles.importIconBtn, { opacity: pressed ? 0.6 : 1, backgroundColor: showImport ? colors.primary + "18" : "transparent" }]}
        >
          <Feather name="link" size={20} color={showImport ? colors.primary : colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {showImport && (
          <ImportUriPanel onImport={handleImportUri} onClose={() => setShowImport(false)} />
        )}

        {totalSessionsAll > 0 && (
          <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.overviewTitle, { color: colors.foreground }]}>All-profile overview</Text>
            <View style={styles.overviewRow}>
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewValue, { color: colors.foreground }]}>{totalSessionsAll}</Text>
                <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>Sessions</Text>
              </View>
              <View style={[styles.overviewDivider, { backgroundColor: colors.border }]} />
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewValue, { color: colors.foreground }]}>{formatDurationShort(totalDurationAll)}</Text>
                <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>Total time</Text>
              </View>
              <View style={[styles.overviewDivider, { backgroundColor: colors.border }]} />
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewValue, { color: colors.foreground }]}>{profiles.length}</Text>
                <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>Profiles</Text>
              </View>
            </View>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          Tap a profile to activate · Tap ⚙ to configure protocol & test latency
        </Text>

        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            isActive={profile.id === activeProfile.id}
            latencyMs={latencies[profile.id]}
            onSelect={() => handleSelect(profile.id)}
            onDelete={() => handleDelete(profile)}
            onRename={(name) => handleRename(profile.id, name)}
            onChangeProto={(t) => handleChangeProto(profile.id, t)}
            onChangeSsMethod={(m) => handleChangeSsMethod(profile.id, m)}
            onTestLatency={() => testLatency(profile)}
          />
        ))}

        <View style={styles.addRow}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); createBlankProfile(); }}
            style={({ pressed }) => [styles.addBtn, { borderColor: colors.primary, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="plus-circle" size={16} color={colors.primary} />
            <Text style={[styles.addBtnText, { color: colors.primary }]}>New profile</Text>
          </Pressable>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); saveAsNewProfile(); }}
            style={({ pressed }) => [styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="copy" size={16} color={colors.mutedForeground} />
            <Text style={[styles.addBtnText, { color: colors.mutedForeground }]}>Duplicate</Text>
          </Pressable>
        </View>

        <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginTop: 1 }} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Tap the link icon (↗) in the header to import a proxy URI.{"\n"}
            Session stats are tracked per profile and preserved on rename or delete.
          </Text>
        </View>
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
  importIconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  headerCenter: { alignItems: "center", flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  importPanel: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  importTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  importSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  uriInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  importBtns: { flexDirection: "row", gap: 10 },
  importCancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  importCancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  importConfirmBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  importConfirmText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  overviewCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12, marginBottom: 4 },
  overviewTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  overviewRow: { flexDirection: "row", alignItems: "center" },
  overviewStat: { flex: 1, alignItems: "center", gap: 3 },
  overviewValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  overviewLabel: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  overviewDivider: { width: 1, height: 32 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.2 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardLeft: { flex: 1, gap: 5 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  activePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100, gap: 4 },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activePillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  miniProtoBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  miniProtoText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  renameInput: {
    fontSize: 14, fontFamily: "Inter_600SemiBold", borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, minWidth: 120,
  },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardServer: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  latencyBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  latencyText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  iconBtn: { padding: 4 },
  expandedSection: { borderTopWidth: 1, paddingTop: 12, gap: 12 },
  expandedLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  protoRow: { flexDirection: "row", gap: 8 },
  protoBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  protoBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  ssMethodWrap: { gap: 6 },
  ssMethodLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  ssMethodScroll: { gap: 6, paddingRight: 4 },
  ssMethodBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  ssMethodText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  pingBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  pingBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pingResult: { marginLeft: "auto" as any, fontSize: 13, fontFamily: "Inter_700Bold" },
  divider: { height: 1 },
  statsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  statPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, borderWidth: 1, gap: 4 },
  statPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noStatsText: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  addRow: { flexDirection: "row", gap: 10 },
  addBtn: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoBox: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
