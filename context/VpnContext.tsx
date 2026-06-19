import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { NativeEventEmitter, NativeModules, Platform, Share } from "react-native";
import { useSettings } from "./SettingsContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProxyType = "socks5" | "http" | "shadowsocks";

export const SS_METHODS = [
  "chacha20-ietf-poly1305",
  "aes-256-gcm",
  "aes-128-gcm",
  "aes-256-cfb",
  "rc4-md5",
] as const;

export type SsMethod = (typeof SS_METHODS)[number];

export type ProxyProfile = {
  id: string;
  profileName: string;
  proxyType: ProxyType;
  serverIp: string;
  port: string;
  username: string;
  password: string;
  ssMethod: SsMethod;
  ssPassword: string;
};

export type VpnState = "disconnected" | "connecting" | "connected" | "error";

export type VpnStatus = {
  state: VpnState;
  activeIp: string;
  message: string;
  connectedAt: number | null;
};

export type TrafficStats = {
  bytesIn: number;
  bytesOut: number;
};

type VpnContextType = {
  profiles: ProxyProfile[];
  activeProfile: ProxyProfile;
  status: VpnStatus;
  trafficStats: TrafficStats;
  latencies: Record<string, number | null>;
  updateActiveProfile: (updates: Partial<Omit<ProxyProfile, "id">>) => void;
  selectProfile: (id: string) => void;
  saveAsNewProfile: () => void;
  createBlankProfile: () => void;
  deleteProfile: (id: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  testLatency: (profile: ProxyProfile) => Promise<void>;
  importFromUri: (uri: string) => ProxyProfile | null;
  exportProfilesJson: () => Promise<void>;
  importProfilesJson: (json: string) => { ok: boolean; count: number; error?: string };
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

const PROFILES_KEY = "proxy_profiles_v3";
const ACTIVE_ID_KEY = "proxy_active_id_v3";

// ─── Native bridge ────────────────────────────────────────────────────────────

const NativeVpn =
  Platform.OS === "android" && NativeModules.ProxyVpn
    ? (NativeModules.ProxyVpn as {
        startVpn(profile: {
          profileName: string;
          proxyType: string;
          serverIp: string;
          port: number;
          username: string;
          password: string;
          ssMethod: string;
          ssPassword: string;
          killSwitch: boolean;
          autoReconnect: boolean;
          dnsMode: string;
          customDns: string;
        }): Promise<boolean>;
        stopVpn(): Promise<boolean>;
        getStatus(): Promise<{ state: string; activeIp: string; message: string }>;
        testLatency(host: string, port: number): Promise<number>;
        getTrafficStats(): Promise<{ bytesIn: number; bytesOut: number }>;
      })
    : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
export { formatBytes };

const defaultProfile: ProxyProfile = {
  id: "default",
  profileName: "My Private Proxy",
  proxyType: "socks5",
  serverIp: "",
  port: "1080",
  username: "",
  password: "",
  ssMethod: "chacha20-ietf-poly1305",
  ssPassword: "",
};

const defaultStatus: VpnStatus = {
  state: "disconnected",
  activeIp: "",
  message: "VPN is not active",
  connectedAt: null,
};

const defaultTraffic: TrafficStats = { bytesIn: 0, bytesOut: 0 };

// ─── URI parser ───────────────────────────────────────────────────────────────

export function parseProxyUri(rawUri: string): Omit<ProxyProfile, "id"> | null {
  try {
    const uri = rawUri.trim();

    // ── Shadowsocks: ss://base64(method:password)@host:port#name ──────────
    if (uri.toLowerCase().startsWith("ss://")) {
      const withoutScheme = uri.slice(5);
      const hashIdx = withoutScheme.indexOf("#");
      const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : "Imported SS";
      const main = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

      let method = "chacha20-ietf-poly1305";
      let ssPassword = "";
      let host = "";
      let port = "1080";

      if (main.includes("@")) {
        // Format: base64(method:password)@host:port  OR  method:password@host:port
        const atIdx = main.lastIndexOf("@");
        const creds = main.slice(0, atIdx);
        const hostPort = main.slice(atIdx + 1);

        let decoded = creds;
        try { decoded = atob(creds); } catch { decoded = creds; }

        const colonIdx = decoded.indexOf(":");
        if (colonIdx >= 0) {
          method = decoded.slice(0, colonIdx);
          ssPassword = decoded.slice(colonIdx + 1);
        }
        const colonPort = hostPort.lastIndexOf(":");
        host = hostPort.slice(0, colonPort);
        port = hostPort.slice(colonPort + 1);
      } else {
        // Old format: ss://base64(method:password:host:port)
        let decoded = "";
        try { decoded = atob(main); } catch { return null; }
        const parts = decoded.split(":");
        if (parts.length < 4) return null;
        method = parts[0];
        ssPassword = parts[1];
        host = parts.slice(2, parts.length - 1).join(":");
        port = parts[parts.length - 1];
      }

      return {
        profileName: name,
        proxyType: "shadowsocks",
        serverIp: host,
        port,
        username: "",
        password: "",
        ssMethod: (SS_METHODS as readonly string[]).includes(method)
          ? (method as SsMethod)
          : "chacha20-ietf-poly1305",
        ssPassword,
      };
    }

    // ── SOCKS5 / HTTP ──────────────────────────────────────────────────────
    const url = new URL(uri);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    const proxyType: ProxyType =
      scheme === "socks5" ? "socks5" : scheme === "socks4" ? "socks5" : "http";
    const name = url.hash
      ? decodeURIComponent(url.hash.slice(1))
      : url.hostname || "Imported Proxy";
    const port = url.port || (scheme === "socks5" ? "1080" : "8080");

    return {
      profileName: name,
      proxyType,
      serverIp: url.hostname,
      port,
      username: url.username ? decodeURIComponent(url.username) : "",
      password: url.password ? decodeURIComponent(url.password) : "",
      ssMethod: "chacha20-ietf-poly1305",
      ssPassword: "",
    };
  } catch {
    return null;
  }
}

// ─── Migrate old profiles ─────────────────────────────────────────────────────

function migrateProfile(raw: Record<string, unknown>): ProxyProfile {
  return {
    id: String(raw.id ?? makeId()),
    profileName: String(raw.profileName ?? "Proxy"),
    proxyType: (["socks5", "http", "shadowsocks"].includes(raw.proxyType as string)
      ? raw.proxyType
      : "socks5") as ProxyType,
    serverIp: String(raw.serverIp ?? ""),
    port: String(raw.port ?? "1080"),
    username: String(raw.username ?? ""),
    password: String(raw.password ?? ""),
    ssMethod: (SS_METHODS as readonly string[]).includes(raw.ssMethod as string)
      ? (raw.ssMethod as SsMethod)
      : "chacha20-ietf-poly1305",
    ssPassword: String(raw.ssPassword ?? ""),
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const VpnContext = createContext<VpnContextType | null>(null);

export function VpnProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  const [profiles, setProfiles] = useState<ProxyProfile[]>([defaultProfile]);
  const [activeId, setActiveId] = useState<string>("default");
  const [status, setStatus] = useState<VpnStatus>(defaultStatus);
  const [trafficStats, setTrafficStats] = useState<TrafficStats>(defaultTraffic);
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});

  const simTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef = useRef<number | null>(null);

  const activeProfile =
    profiles.find((p) => p.id === activeId) ?? profiles[0] ?? defaultProfile;

  // ── Load persisted data ──────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const [rawProfiles, rawActiveId] = await Promise.all([
        AsyncStorage.getItem(PROFILES_KEY),
        AsyncStorage.getItem(ACTIVE_ID_KEY),
      ]);

      // Also check old key to migrate
      let profiles: ProxyProfile[] = [];
      if (rawProfiles) {
        try {
          const parsed = JSON.parse(rawProfiles);
          if (Array.isArray(parsed) && parsed.length > 0) {
            profiles = parsed.map(migrateProfile);
          }
        } catch {}
      }
      if (profiles.length === 0) {
        // Try migrating from old key
        try {
          const oldRaw = await AsyncStorage.getItem("proxy_profiles_v2");
          if (oldRaw) {
            const old = JSON.parse(oldRaw);
            if (Array.isArray(old) && old.length > 0) {
              profiles = old.map(migrateProfile);
            }
          }
        } catch {}
      }

      if (profiles.length > 0) {
        setProfiles(profiles);
        if (rawActiveId && profiles.find((p) => p.id === rawActiveId)) {
          setActiveId(rawActiveId);
        } else {
          setActiveId(profiles[0].id);
        }
      }

      if (NativeVpn) {
        try {
          const s = await NativeVpn.getStatus();
          setStatus({
            state: s.state as VpnState,
            activeIp: s.activeIp,
            message: s.message,
            connectedAt: s.state === "connected" ? Date.now() : null,
          });
        } catch {}
      }
    })();
  }, []);

  // ── Native event listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (!NativeVpn) return;
    const emitter = new NativeEventEmitter(NativeModules.ProxyVpn);

    const statusSub = emitter.addListener(
      "ProxyVpnStatus",
      (event: { state: string; activeIp: string; message: string }) => {
        const state = event.state as VpnState;
        if (state === "connected" && !connectedAtRef.current) {
          connectedAtRef.current = Date.now();
        } else if (state !== "connected") {
          connectedAtRef.current = null;
        }
        setStatus({
          state,
          activeIp: event.activeIp,
          message: event.message,
          connectedAt: state === "connected" ? connectedAtRef.current : null,
        });
        if (state !== "connected" && state !== "connecting") {
          setTrafficStats(defaultTraffic);
        }
      }
    );

    const trafficSub = emitter.addListener(
      "ProxyVpnTraffic",
      (event: { bytesIn: number; bytesOut: number }) => {
        setTrafficStats({ bytesIn: event.bytesIn, bytesOut: event.bytesOut });
      }
    );

    return () => {
      statusSub.remove();
      trafficSub.remove();
    };
  }, []);

  useEffect(() => () => {
    if (simTimeoutRef.current) clearTimeout(simTimeoutRef.current);
  }, []);

  // ── Persistence ──────────────────────────────────────────────────────────

  const persistProfiles = useCallback(
    async (nextProfiles: ProxyProfile[], nextActiveId: string) => {
      await Promise.all([
        AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(nextProfiles)),
        AsyncStorage.setItem(ACTIVE_ID_KEY, nextActiveId),
      ]);
    },
    []
  );

  // ── Profile mutations ────────────────────────────────────────────────────

  const updateActiveProfile = useCallback(
    (updates: Partial<Omit<ProxyProfile, "id">>) => {
      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === activeId ? { ...p, ...updates } : p));
        persistProfiles(next, activeId);
        return next;
      });
    },
    [activeId, persistProfiles]
  );

  const selectProfile = useCallback(
    (id: string) => {
      setActiveId(id);
      AsyncStorage.setItem(ACTIVE_ID_KEY, id);
      setStatus(defaultStatus);
      setTrafficStats(defaultTraffic);
      if (simTimeoutRef.current) { clearTimeout(simTimeoutRef.current); simTimeoutRef.current = null; }
    },
    []
  );

  const saveAsNewProfile = useCallback(() => {
    const newId = makeId();
    const next = [...profiles, { ...activeProfile, id: newId, profileName: `${activeProfile.profileName} (copy)` }];
    setProfiles(next);
    setActiveId(newId);
    persistProfiles(next, newId);
  }, [activeProfile, profiles, persistProfiles]);

  const createBlankProfile = useCallback(() => {
    const newId = makeId();
    const blank: ProxyProfile = { ...defaultProfile, id: newId, profileName: `Profile ${profiles.length + 1}` };
    const next = [...profiles, blank];
    setProfiles(next);
    setActiveId(newId);
    persistProfiles(next, newId);
  }, [profiles, persistProfiles]);

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles((prev) => {
        const next = prev.filter((p) => p.id !== id);
        const safe = next.length > 0 ? next : [{ ...defaultProfile, id: makeId() }];
        const nextActive = id === activeId ? safe[0].id : activeId;
        setActiveId(nextActive);
        persistProfiles(safe, nextActive);
        return safe;
      });
    },
    [activeId, persistProfiles]
  );

  // ── Connect / Disconnect ─────────────────────────────────────────────────

  const connect = useCallback(async () => {
    const trimmedIp = activeProfile.serverIp.trim();
    const portNum = parseInt(activeProfile.port, 10);

    if (!trimmedIp || trimmedIp.length < 3) {
      setStatus({ state: "error", activeIp: "", message: "Enter a valid proxy IP or hostname", connectedAt: null });
      return;
    }
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setStatus({ state: "error", activeIp: "", message: "Port must be between 1 and 65535", connectedAt: null });
      return;
    }
    if (activeProfile.proxyType === "shadowsocks" && !activeProfile.ssPassword) {
      setStatus({ state: "error", activeIp: "", message: "Shadowsocks password is required", connectedAt: null });
      return;
    }

    if (NativeVpn) {
      setStatus({ state: "connecting", activeIp: trimmedIp, message: "Requesting Android VPN permission…", connectedAt: null });
      try {
        await NativeVpn.startVpn({
          profileName: activeProfile.profileName,
          proxyType: activeProfile.proxyType,
          serverIp: trimmedIp,
          port: portNum,
          username: activeProfile.username,
          password: activeProfile.password,
          ssMethod: activeProfile.ssMethod,
          ssPassword: activeProfile.ssPassword,
          killSwitch: settings.killSwitch,
          autoReconnect: settings.autoReconnect,
          dnsMode: settings.dnsMode,
          customDns: settings.customDns,
        });
      } catch (error) {
        setStatus({
          state: "error",
          activeIp: "",
          message: error instanceof Error ? error.message : "VPN start failed",
          connectedAt: null,
        });
      }
      return;
    }

    // ── Simulation (web / Expo Go) ──────────────────────────────────────
    setStatus({ state: "connecting", activeIp: trimmedIp, message: "Requesting VPN permission…", connectedAt: null });
    simTimeoutRef.current = setTimeout(() => {
      setStatus({ state: "connecting", activeIp: trimmedIp, message: "Testing proxy connectivity…", connectedAt: null });
      simTimeoutRef.current = setTimeout(() => {
        const now = Date.now();
        connectedAtRef.current = now;
        setStatus({
          state: "connected",
          activeIp: trimmedIp,
          message: `${activeProfile.proxyType.toUpperCase()} tunnel active · ${trimmedIp}:${portNum}`,
          connectedAt: now,
        });
        // Simulate traffic
        let bytes = 0;
        const ti = setInterval(() => {
          bytes += Math.floor(Math.random() * 50000);
          setTrafficStats({ bytesIn: bytes, bytesOut: Math.floor(bytes * 0.3) });
        }, 2000);
        (simTimeoutRef as any)._trafficInterval = ti;
      }, 1500);
    }, 1200);
  }, [activeProfile, settings]);

  const disconnect = useCallback(async () => {
    if (simTimeoutRef.current) { clearTimeout(simTimeoutRef.current); simTimeoutRef.current = null; }
    const ti = (simTimeoutRef as any)._trafficInterval;
    if (ti) { clearInterval(ti); (simTimeoutRef as any)._trafficInterval = null; }
    connectedAtRef.current = null;
    setTrafficStats(defaultTraffic);
    if (NativeVpn) {
      try { await NativeVpn.stopVpn(); } catch {}
      return;
    }
    setStatus(defaultStatus);
  }, []);

  // ── Latency test ─────────────────────────────────────────────────────────

  const testLatency = useCallback(async (profile: ProxyProfile) => {
    const host = profile.serverIp.trim();
    const port = parseInt(profile.port, 10);
    if (!host || isNaN(port)) return;

    setLatencies((prev) => ({ ...prev, [profile.id]: null }));
    try {
      let ms: number;
      if (NativeVpn) {
        ms = await NativeVpn.testLatency(host, port);
      } else {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
        ms = Math.floor(30 + Math.random() * 200);
      }
      setLatencies((prev) => ({ ...prev, [profile.id]: ms }));
    } catch {
      setLatencies((prev) => ({ ...prev, [profile.id]: -1 }));
    }
  }, []);

  // ── Import / Export ──────────────────────────────────────────────────────

  const importFromUri = useCallback((uri: string): ProxyProfile | null => {
    const parsed = parseProxyUri(uri);
    if (!parsed) return null;
    const newId = makeId();
    const newProfile: ProxyProfile = { ...parsed, id: newId };
    const next = [...profiles, newProfile];
    setProfiles(next);
    setActiveId(newId);
    persistProfiles(next, newId);
    return newProfile;
  }, [profiles, persistProfiles]);

  const exportProfilesJson = useCallback(async () => {
    const json = JSON.stringify(profiles, null, 2);
    await Share.share({
      title: "Private Proxy Profiles",
      message: json,
    });
  }, [profiles]);

  const importProfilesJson = useCallback(
    (json: string): { ok: boolean; count: number; error?: string } => {
      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return { ok: false, count: 0, error: "Expected a JSON array" };
        const imported = parsed.map(migrateProfile);
        if (imported.length === 0) return { ok: false, count: 0, error: "No profiles found" };
        const next = [...profiles, ...imported.filter((p) => !profiles.find((e) => e.id === p.id))];
        setProfiles(next);
        persistProfiles(next, activeId);
        return { ok: true, count: imported.length };
      } catch (e) {
        return { ok: false, count: 0, error: e instanceof Error ? e.message : "Invalid JSON" };
      }
    },
    [profiles, activeId, persistProfiles]
  );

  return (
    <VpnContext.Provider
      value={{
        profiles,
        activeProfile,
        status,
        trafficStats,
        latencies,
        updateActiveProfile,
        selectProfile,
        saveAsNewProfile,
        createBlankProfile,
        deleteProfile,
        connect,
        disconnect,
        testLatency,
        importFromUri,
        exportProfilesJson,
        importProfilesJson,
      }}
    >
      {children}
    </VpnContext.Provider>
  );
}

export function useVpn() {
  const ctx = useContext(VpnContext);
  if (!ctx) throw new Error("useVpn must be used within VpnProvider");
  return ctx;
}
