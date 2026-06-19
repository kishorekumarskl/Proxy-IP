import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type SessionStatus = "completed" | "error" | "active";

export type SessionRecord = {
  id: string;
  profileId: string;
  profileName: string;
  serverIp: string;
  port: string;
  connectedAt: number;
  disconnectedAt?: number;
  durationSeconds?: number;
  status: SessionStatus;
  errorMessage?: string;
};

export type ProfileStats = {
  sessionCount: number;
  totalDurationSeconds: number;
  lastConnectedAt: number | null;
};

type HistoryContextType = {
  sessions: SessionRecord[];
  getProfileStats: (profileId: string) => ProfileStats;
  clearHistory: () => void;
  totalSessions: number;
  lastConnectedAt: number | null;
};

const HISTORY_KEY = "vpn_session_history_v2";
const MAX_SESSIONS = 100;

const HistoryContext = createContext<HistoryContextType | null>(null);

function makeSessionId() {
  return "s_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

export function HistoryProvider({
  children,
  vpnState,
  activeIp,
  activeProfileId,
  activeProfileName,
  activePort,
  errorMessage,
}: {
  children: React.ReactNode;
  vpnState: "disconnected" | "connecting" | "connected" | "error";
  activeIp: string;
  activeProfileId: string;
  activeProfileName: string;
  activePort: string;
  errorMessage: string;
}) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const prevStateRef = useRef<string>(vpnState);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed: SessionRecord[] = JSON.parse(raw);
          const cleaned = parsed.map((s) =>
            s.status === "active"
              ? { ...s, status: "completed" as SessionStatus, disconnectedAt: s.connectedAt + 1000 }
              : s
          );
          setSessions(cleaned);
        } catch {}
      }
    });
  }, []);

  const persist = useCallback((next: SessionRecord[]) => {
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = vpnState;

    if (prev !== "connected" && vpnState === "connected") {
      const newSession: SessionRecord = {
        id: makeSessionId(),
        profileId: activeProfileId,
        profileName: activeProfileName,
        serverIp: activeIp,
        port: activePort,
        connectedAt: Date.now(),
        status: "active",
      };
      activeSessionIdRef.current = newSession.id;
      setSessions((prev) => {
        const next = [newSession, ...prev].slice(0, MAX_SESSIONS);
        persist(next);
        return next;
      });
    }

    if (prev === "connected" && (vpnState === "disconnected" || vpnState === "error")) {
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      activeSessionIdRef.current = null;
      const now = Date.now();
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== sid) return s;
          const durationSeconds = Math.max(1, Math.round((now - s.connectedAt) / 1000));
          return {
            ...s,
            status: vpnState === "error" ? ("error" as SessionStatus) : ("completed" as SessionStatus),
            disconnectedAt: now,
            durationSeconds,
            errorMessage: vpnState === "error" ? errorMessage : undefined,
          };
        });
        persist(next);
        return next;
      });
    }
  }, [vpnState, activeIp, activeProfileId, activeProfileName, activePort, errorMessage, persist]);

  const clearHistory = useCallback(() => {
    setSessions([]);
    AsyncStorage.removeItem(HISTORY_KEY);
  }, []);

  const getProfileStats = useCallback(
    (profileId: string): ProfileStats => {
      const matching = sessions.filter(
        (s) => s.profileId === profileId && s.status !== "active"
      );
      const sessionCount = matching.length;
      const totalDurationSeconds = matching.reduce(
        (acc, s) => acc + (s.durationSeconds ?? 0),
        0
      );
      const lastConnectedAt =
        matching.length > 0
          ? Math.max(...matching.map((s) => s.connectedAt))
          : null;
      return { sessionCount, totalDurationSeconds, lastConnectedAt };
    },
    [sessions]
  );

  const lastConnectedAt =
    sessions.length > 0 ? sessions[0].connectedAt : null;

  return (
    <HistoryContext.Provider
      value={{
        sessions,
        getProfileStats,
        clearHistory,
        totalSessions: sessions.length,
        lastConnectedAt,
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}
