import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SessionRecord, useHistory } from "@/context/HistoryContext";
import { useColors } from "@/hooks/useColors";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function groupByDate(sessions: SessionRecord[]): { label: string; items: SessionRecord[] }[] {
  const map = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const label = formatDateLabel(s.connectedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

function SessionCard({ session }: { session: SessionRecord }) {
  const colors = useColors();

  const statusColor =
    session.status === "completed"
      ? colors.statusConnected
      : session.status === "error"
      ? colors.statusError
      : colors.statusConnecting;

  const statusLabel =
    session.status === "completed"
      ? "Completed"
      : session.status === "error"
      ? "Error"
      : "Active";

  const statusIcon =
    session.status === "completed"
      ? "check-circle"
      : session.status === "error"
      ? "alert-circle"
      : "activity";

  return (
    <View
      style={[
        styles.sessionCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.sessionTop}>
        <View style={styles.sessionLeft}>
          <Text style={[styles.sessionProfile, { color: colors.foreground }]} numberOfLines={1}>
            {session.profileName}
          </Text>
          <View style={styles.sessionMeta}>
            <Feather name="server" size={11} color={colors.mutedForeground} />
            <Text style={[styles.sessionServer, { color: colors.mutedForeground }]} numberOfLines={1}>
              {session.serverIp}:{session.port}
            </Text>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: statusColor + "18", borderColor: statusColor + "44" }]}>
          <Feather name={statusIcon as any} size={11} color={statusColor} />
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={[styles.sessionDivider, { backgroundColor: colors.border }]} />

      <View style={styles.sessionBottom}>
        <View style={styles.sessionStat}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.sessionStatText, { color: colors.mutedForeground }]}>
            {formatTime(session.connectedAt)}
            {session.disconnectedAt
              ? ` – ${formatTime(session.disconnectedAt)}`
              : " (ongoing)"}
          </Text>
        </View>

        {session.durationSeconds != null && (
          <View style={styles.sessionStat}>
            <Feather name="zap" size={12} color={colors.mutedForeground} />
            <Text style={[styles.sessionStatText, { color: colors.mutedForeground }]}>
              {formatDuration(session.durationSeconds)}
            </Text>
          </View>
        )}
      </View>

      {session.errorMessage ? (
        <View style={[styles.errorBox, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "33" }]}>
          <Text style={[styles.errorText, { color: colors.statusError }]} numberOfLines={2}>
            {session.errorMessage}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function EmptyState() {
  const colors = useColors();
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name="clock" size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text>
      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
        Your VPN sessions will appear here after your first connection.
      </Text>
    </View>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, clearHistory, totalSessions } = useHistory();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const grouped = groupByDate(sessions);

  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const totalDuration = sessions.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0);

  const handleClear = () => {
    Alert.alert(
      "Clear History",
      "This will permanently delete all session records.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            clearHistory();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
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
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Connection History
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {totalSessions} session{totalSessions !== 1 ? "s" : ""}
          </Text>
        </View>
        {totalSessions > 0 ? (
          <Pressable
            onPress={handleClear}
            hitSlop={12}
            style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="trash-2" size={18} color={colors.destructive} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {totalSessions === 0 ? (
          <EmptyState />
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="check-circle" size={16} color={colors.statusConnected} />
                <Text style={[styles.statValue, { color: colors.foreground }]}>{completedCount}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Completed</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="zap" size={16} color={colors.primary} />
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {formatDuration(totalDuration)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total time</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="layers" size={16} color={colors.mutedForeground} />
                <Text style={[styles.statValue, { color: colors.foreground }]}>{totalSessions}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>All sessions</Text>
              </View>
            </View>

            {grouped.map(({ label, items }) => (
              <View key={label} style={styles.group}>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
                {items.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </View>
            ))}
          </>
        )}
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
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { alignItems: "center", flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  clearBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 20,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 5,
  },
  statValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  group: { gap: 10 },
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sessionCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sessionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  sessionLeft: { flex: 1, gap: 4 },
  sessionProfile: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sessionMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  sessionServer: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 1,
    gap: 4,
  },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sessionDivider: { height: 1 },
  sessionBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  sessionStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  sessionStatText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  errorBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  emptyWrap: {
    alignItems: "center",
    paddingTop: 60,
    gap: 14,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  emptySub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 280,
  },
});
