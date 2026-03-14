import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import htm from "https://esm.sh/htm@3.1.1";
import Chart from "https://esm.sh/chart.js@4.4.3/auto";

const html = htm.bind(React.createElement);

const URL_PATTERN =
  /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vm\.tiktok|twitter\.com|x\.com|facebook\.com|fb\.watch|fb\.com|soundcloud\.com|spotify\.com)\S+/gi;

const SITE_LABELS = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X",
  facebook: "Facebook",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  unknown: "Unknown",
};

const AUDIO_FORMATS = new Set(["mp3", "m4a", "wav", "flac", "ogg", "opus"]);
const DEFAULT_THUMBNAIL =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180' fill='%23171717'><rect width='320' height='180'/></svg>";

const isValidUrl = (value) =>
  value && new RegExp(URL_PATTERN.source, "i").test(value);
const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(
  window.location.hostname,
);
const isWindowsClient = /Windows/i.test(navigator.userAgent || "");

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFileSize(bytes) {
  if (!bytes || Number.isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatLogTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function matchesMediaSearch(item, query) {
  const normalizedQuery = String(query || "")
    .trim()
    .toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [item?.title, item?.uploader, item?.status]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function parseSpeedToMbps(speedText) {
  const text = String(speedText || "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  const match = text.match(/([0-9]*\.?[0-9]+)\s*([kmg]?i?b)\/s/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();

  if (unit.startsWith("gb") || unit.startsWith("gib")) return value * 1024;
  if (unit.startsWith("mb") || unit.startsWith("mib")) return value;
  if (unit.startsWith("kb") || unit.startsWith("kib")) return value / 1024;
  return value / (1024 * 1024);
}

function suggestContentPreset(info) {
  const title = String(info?.title || "").toLowerCase();
  if (!title) return null;

  if (/podcast|episode|talk show|interview|lecture/.test(title)) {
    return {
      id: "podcast",
      reason: "Detected podcast/lecture style title",
      message: "Suggested: MP3 128 kbps for spoken content.",
    };
  }

  if (/tutorial|how to|guide|course|lesson|walkthrough/.test(title)) {
    return {
      id: "movie-archive",
      reason: "Detected tutorial/guide content",
      message: "Suggested: MP4 workflow for tutorials.",
    };
  }

  if (/official music video|music video|audio|song|feat\.|album/.test(title)) {
    return {
      id: "music-collector",
      reason: "Detected music-related title",
      message: "Suggested: MP3 music collector workflow.",
    };
  }

  return null;
}

function pickPreferredSubtitleSelection(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return "";
  const preferred = ["en", "en-us", "en-gb"];
  const found = preferred
    .map((lang) => languages.find((item) => item.toLowerCase() === lang))
    .find(Boolean);
  return found || languages[0] || "";
}

function makeToast(message, type = "info", link) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    type,
    link,
  };
}

function parseBatchUrls(input) {
  const text = String(input || "");
  if (!text.trim()) return [];

  const matcher = new RegExp(URL_PATTERN.source, "gi");
  const urls = [];

  text.split(/\r?\n/).forEach((line) => {
    const matches = line.match(matcher);
    if (matches && matches.length) {
      matches.forEach((item) => urls.push(item.trim()));
      return;
    }

    const candidate = line.trim();
    if (candidate && isValidUrl(candidate)) {
      urls.push(candidate);
    }
  });

  return [...new Set(urls.filter(Boolean))];
}

const PREFERENCES_KEY = "fluxdl.preferences.v1";
const CUSTOM_PRESETS_KEY = "fluxdl.custom-presets.v1";
const PRESET_OVERRIDES_KEY = "fluxdl.preset-overrides.v1";

const BUILTIN_PRESET_CARDS = [
  {
    id: "podcast",
    icon: "🎧",
    name: "Podcast Mode",
    description:
      "MP3 audio-first workflow with lighter bitrate and clean naming.",
    bullets: ["MP3 · 128 kbps", "Podcast-style naming", "Easy archive folders"],
    settings: {
      format: "mp3",
      quality: "best",
      audioBitrate: "128",
      subtitles: false,
      subtitleMode: "separate",
      filenameTemplate: "Music/Podcasts/%(title)s - %(uploader)s.%(ext)s",
      removeWatermark: false,
      batchMode: false,
      isPlaylist: false,
      limitRate: "",
    },
  },
  {
    id: "movie-archive",
    icon: "🎬",
    name: "Movie Archive",
    description: "Best-quality MP4 with subtitles ready for long-term saving.",
    bullets: ["MP4 · best available", "Soft subtitles on", "Archive naming"],
    settings: {
      format: "mp4",
      quality: "best",
      audioBitrate: "",
      subtitles: true,
      subtitleMode: "soft",
      filenameTemplate: "%(title)s (%(upload_date>%Y)s).%(ext)s",
      removeWatermark: false,
      batchMode: false,
      isPlaylist: false,
      limitRate: "",
    },
  },
  {
    id: "tiktok-batch",
    icon: "📱",
    name: "TikTok Batch",
    description:
      "Batch-first workflow for short clips with TikTok cleanup enabled.",
    bullets: ["MP4 · best available", "Batch mode on", "No watermark option"],
    settings: {
      format: "mp4",
      quality: "best",
      audioBitrate: "",
      subtitles: false,
      subtitleMode: "separate",
      filenameTemplate: "Clips/%(uploader)s/%(title)s.%(ext)s",
      removeWatermark: true,
      batchMode: true,
      isPlaylist: false,
      limitRate: "",
    },
  },
  {
    id: "music-collector",
    icon: "🎵",
    name: "Music Collector",
    description: "High-bitrate MP3 workflow for music libraries and album art.",
    bullets: ["MP3 · 320 kbps", "Metadata-friendly", "Music folder layout"],
    settings: {
      format: "mp3",
      quality: "best",
      audioBitrate: "320",
      subtitles: false,
      subtitleMode: "separate",
      filenameTemplate: "Music/%(uploader)s/%(title)s.%(ext)s",
      removeWatermark: false,
      batchMode: false,
      isPlaylist: false,
      limitRate: "",
    },
  },
];

function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const prefs = useMemo(loadPreferences, []);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [tab, setTab] = useState("download");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [profilePhotoErrored, setProfilePhotoErrored] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [info, setInfo] = useState(null);
  const [activePresetId, setActivePresetId] = useState("");
  const [customPresets, setCustomPresets] = useState(() =>
    loadJsonStorage(CUSTOM_PRESETS_KEY, []),
  );
  const [presetOverrides, setPresetOverrides] = useState(() =>
    loadJsonStorage(PRESET_OVERRIDES_KEY, {}),
  );
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [presetEditorMode, setPresetEditorMode] = useState("create");
  const [presetDraft, setPresetDraft] = useState(null);

  const [format, setFormat] = useState(prefs.format || "mp4");
  const [quality, setQuality] = useState(prefs.quality || "best");
  const [audioBitrate, setAudioBitrate] = useState(prefs.audioBitrate || "");
  const [subtitleLangs, setSubtitleLangs] = useState(
    prefs.subtitleLangs || "all",
  );
  const [subtitleMode, setSubtitleMode] = useState(
    prefs.subtitleMode || "soft",
  );
  const [filenameTemplate, setFilenameTemplate] = useState(
    prefs.filenameTemplate || "",
  );
  const [subtitles, setSubtitles] = useState(prefs.subtitles ?? true);
  const [embedSubtitles, setEmbedSubtitles] = useState(
    (prefs.subtitleMode || "soft") !== "separate",
  );
  const [smartDefaults, setSmartDefaults] = useState(
    prefs.smartDefaults !== false,
  );
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [limitRate, setLimitRate] = useState(prefs.limitRate || "");

  const [batchMode, setBatchMode] = useState(false);
  const [batchInput, setBatchInput] = useState("");
  const [playlistItems, setPlaylistItems] = useState([]);
  const [playlistSelected, setPlaylistSelected] = useState({});
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [autoFolderMode, setAutoFolderMode] = useState(
    prefs.autoFolderMode || "none",
  );
  const [outputMode, setOutputMode] = useState(prefs.outputMode || "normal");
  const [gifFps, setGifFps] = useState(prefs.gifFps || "15");
  const [gifResolution, setGifResolution] = useState(
    prefs.gifResolution || "480",
  );
  const [compressCrf, setCompressCrf] = useState(prefs.compressCrf || "28");
  const [contentSuggestion, setContentSuggestion] = useState(null);

  const [spotifyCandidates, setSpotifyCandidates] = useState([]);
  const [spotifyCandidateUrl, setSpotifyCandidateUrl] = useState("");
  const [spotifyCustomUrl, setSpotifyCustomUrl] = useState("");
  const [spotifyCandidatesLoading, setSpotifyCandidatesLoading] =
    useState(false);
  const [spotifyCandidatesLoaded, setSpotifyCandidatesLoaded] = useState(false);
  const [spotifyShowCount, setSpotifyShowCount] = useState(10);

  const [downloadState, setDownloadState] = useState({
    running: false,
    percent: 0,
    itemPercent: 0,
    itemIndex: 0,
    itemTotal: 0,
    speed: null,
    eta: null,
    statusText: "Ready",
    done: false,
  });

  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [queueSearch, setQueueSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [logEntries, setLogEntries] = useState([]);
  const [logsUpdatedAt, setLogsUpdatedAt] = useState("");
  const [batchPreviewItems, setBatchPreviewItems] = useState([]);
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);
  const [batchPreviewError, setBatchPreviewError] = useState("");
  const [batchPreviewProgress, setBatchPreviewProgress] = useState({
    done: 0,
    total: 0,
  });
  const [toasts, setToasts] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [queueContextMenu, setQueueContextMenu] = useState(null);
  const [queueConcurrency, setQueueConcurrency] = useState(2);
  const [queueConcurrencySaving, setQueueConcurrencySaving] = useState(false);
  const [speedSamples, setSpeedSamples] = useState([]);
  const activeDownloadControllerRef = useRef(null);
  const accountMenuRef = useRef(null);
  const batchPreviewRequestRef = useRef(0);
  const queueMenuRef = useRef(null);
  const dailyChartRef = useRef(null);
  const siteChartRef = useRef(null);
  const speedChartRef = useRef(null);
  const dailyChartInstanceRef = useRef(null);
  const siteChartInstanceRef = useRef(null);
  const speedChartInstanceRef = useRef(null);
  const userTweaksRef = useRef({
    format: false,
    quality: false,
    subtitles: false,
    playlist: false,
  });

  const site = info?.site || "unknown";
  const audioOnly = site === "spotify" || site === "soundcloud";
  const spotifyMode = site === "spotify";
  const subtitlesSupported = site === "youtube";
  const embeddableSubtitles = subtitlesSupported && format === "mp4";
  const showNoWatermarkOption = batchMode || site === "tiktok";
  const canOpenDownloads = isLocalHost && isWindowsClient;
  const isAuthenticated = Boolean(authUser);
  const accountLabel =
    authUser?.displayName || authUser?.email || "Signed in account";
  const showProfilePhoto = Boolean(authUser?.photo) && !profilePhotoErrored;
  const accountInitials = accountLabel
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  const queueStats = useMemo(() => {
    const active = queue.filter(
      (item) => item.status === "pending" || item.status === "downloading",
    ).length;
    const done = queue.filter((item) => item.status === "done").length;
    const failed = queue.filter((item) => item.status === "error").length;
    return { active, done, failed };
  }, [queue]);

  const historyStats = useMemo(() => {
    const total = history.length;
    const audio = history.filter((item) =>
      AUDIO_FORMATS.has((item.format || "").toLowerCase()),
    ).length;
    return { total, audio, video: Math.max(0, total - audio) };
  }, [history]);
  const batchPreviewMap = useMemo(
    () => new Map(batchPreviewItems.map((item) => [item.url, item])),
    [batchPreviewItems],
  );
  const filteredQueue = useMemo(
    () => queue.filter((item) => matchesMediaSearch(item, queueSearch)),
    [queue, queueSearch],
  );
  const filteredHistory = useMemo(
    () => history.filter((item) => matchesMediaSearch(item, historySearch)),
    [history, historySearch],
  );
  const allPresetCards = useMemo(() => {
    const mergedBuiltIns = BUILTIN_PRESET_CARDS.map((preset) => {
      const override = presetOverrides?.[preset.id];
      if (!override) return preset;
      return {
        ...preset,
        ...override,
        settings: {
          ...preset.settings,
          ...(override.settings || {}),
        },
      };
    });
    return [...mergedBuiltIns, ...customPresets];
  }, [customPresets, presetOverrides]);
  const allPresetMap = useMemo(
    () =>
      Object.fromEntries(allPresetCards.map((preset) => [preset.id, preset])),
    [allPresetCards],
  );
  const activePreset = activePresetId ? allPresetMap[activePresetId] : null;
  const selectedPlaylistItems = useMemo(
    () =>
      playlistItems.filter((item) =>
        Object.prototype.hasOwnProperty.call(playlistSelected, item.url)
          ? Boolean(playlistSelected[item.url])
          : true,
      ),
    [playlistItems, playlistSelected],
  );
  const playlistItemMap = useMemo(
    () => new Map(playlistItems.map((item) => [item.url, item])),
    [playlistItems],
  );
  const analytics = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const monthEntries = history.filter((entry) => {
      if (!entry?.date) return false;
      const d = new Date(entry.date);
      return `${d.getFullYear()}-${d.getMonth()}` === monthKey;
    });
    const totalMonthBytes = monthEntries.reduce(
      (sum, entry) => sum + (Number(entry.fileSize) || 0),
      0,
    );

    const byDay = new Map();
    monthEntries.forEach((entry) => {
      if (!entry?.date) return;
      const key = new Date(entry.date).toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + (Number(entry.fileSize) || 0));
    });

    const bySite = new Map();
    monthEntries.forEach((entry) => {
      const key = SITE_LABELS[entry.site] || SITE_LABELS.unknown;
      bySite.set(key, (bySite.get(key) || 0) + (Number(entry.fileSize) || 0));
    });

    return {
      totalMonthGb: totalMonthBytes / (1024 * 1024 * 1024),
      byDay,
      bySite,
      avgFileSizeMb:
        monthEntries.length > 0
          ? totalMonthBytes / monthEntries.length / (1024 * 1024)
          : 0,
      count: monthEntries.length,
    };
  }, [history]);

  const queueBadge = queueStats.active;
  const recommendedSpotifyCandidate = spotifyCandidates.find(
    (candidate) => candidate.recommended,
  );
  const selectedSpotifyCandidate = spotifyCandidates.find(
    (candidate) => candidate.url === spotifyCandidateUrl,
  );
  const qualityOptions =
    Array.isArray(info?.availableQualities) && info.availableQualities.length
      ? info.availableQualities
      : ["best", "1440", "1080", "720", "360"];
  const batchParsedUrls = useMemo(
    () => (batchMode ? parseBatchUrls(batchInput) : []),
    [batchMode, batchInput],
  );
  const spotifySourceReady =
    !spotifyMode ||
    spotifyCandidatesLoading ||
    Boolean(spotifyCustomUrl.trim() || spotifyCandidateUrl);
  const downloadDisabled =
    downloadState.running ||
    authLoading ||
    !isAuthenticated ||
    isFetching ||
    (batchMode ? batchParsedUrls.length === 0 : !info) ||
    !spotifySourceReady;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const data = {
      format,
      quality,
      audioBitrate,
      subtitleLangs,
      subtitleMode,
      subtitles,
      smartDefaults,
      filenameTemplate,
      limitRate,
      autoFolderMode,
      outputMode,
      gifFps,
      gifResolution,
      compressCrf,
    };
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(data));
  }, [
    format,
    quality,
    audioBitrate,
    subtitleLangs,
    subtitleMode,
    subtitles,
    smartDefaults,
    filenameTemplate,
    limitRate,
    autoFolderMode,
    outputMode,
    gifFps,
    gifResolution,
    compressCrf,
  ]);

  useEffect(() => {
    let timer;
    if (!batchMode && isAuthenticated && isValidUrl(url.trim())) {
      timer = setTimeout(() => {
        fetchInfo(url.trim());
      }, 850);
    }
    return () => clearTimeout(timer);
  }, [url, batchMode, isAuthenticated]);

  useEffect(() => {
    if (!subtitlesSupported) {
      setSubtitles(false);
      setEmbedSubtitles(false);
      setSubtitleMode("separate");
    }
  }, [subtitlesSupported]);

  useEffect(() => {
    setProfilePhotoErrored(false);
  }, [authUser?.photo]);

  useEffect(() => {
    if (!embeddableSubtitles) {
      setEmbedSubtitles(false);
      setSubtitleMode("separate");
    }
  }, [embeddableSubtitles]);

  useEffect(() => {
    if (!subtitles) {
      setEmbedSubtitles(false);
      setSubtitleMode("separate");
    }
  }, [subtitles]);

  useEffect(() => {
    setEmbedSubtitles(subtitleMode !== "separate");
  }, [subtitleMode]);

  useEffect(() => {
    loadAuthSession();
    tryPasteFromClipboard();
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const handoffUrl = (
        params.get("extUrl") ||
        params.get("url") ||
        ""
      ).trim();
      if (!handoffUrl || !isValidUrl(handoffUrl)) return;
      setTab("download");
      setBatchMode(false);
      setUrl(handoffUrl);
      params.delete("extUrl");
      params.delete("url");
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${
        nextQuery ? `?${nextQuery}` : ""
      }`;
      window.history.replaceState({}, "", nextUrl);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccountMenuOpen(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setAccountMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (tab === "history" && isAuthenticated) loadHistory();
  }, [tab, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !logsExpanded) return;
    refreshLogs();
  }, [isAuthenticated, logsExpanded]);

  useEffect(() => {
    if (!isAuthenticated || !logsExpanded || !logsAutoRefresh) return;
    const timer = setInterval(() => {
      refreshLogs(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [isAuthenticated, logsExpanded, logsAutoRefresh]);

  useEffect(() => {
    if (!batchMode || !isAuthenticated || batchParsedUrls.length === 0) {
      batchPreviewRequestRef.current += 1;
      setBatchPreviewItems([]);
      setBatchPreviewError("");
      setBatchPreviewLoading(false);
      setBatchPreviewProgress({ done: 0, total: 0 });
      return;
    }

    const requestId = batchPreviewRequestRef.current + 1;
    batchPreviewRequestRef.current = requestId;
    const timer = setTimeout(() => {
      loadBatchPreview(batchParsedUrls, requestId);
    }, 450);

    return () => clearTimeout(timer);
  }, [batchMode, batchParsedUrls, isAuthenticated]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        if (tab === "download" && !downloadDisabled) {
          event.preventDefault();
          startDownload();
        }
      }

      if (event.key === "Escape") {
        setUrlError("");
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tab, downloadDisabled, batchMode, batchInput, info, format, quality]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(customPresets));
  }, [customPresets]);

  useEffect(() => {
    localStorage.setItem(PRESET_OVERRIDES_KEY, JSON.stringify(presetOverrides));
  }, [presetOverrides]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadQueueSettings();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!queueContextMenu) return;

    const onDown = (event) => {
      if (
        queueMenuRef.current &&
        !queueMenuRef.current.contains(event.target)
      ) {
        setQueueContextMenu(null);
      }
    };

    const onEsc = (event) => {
      if (event.key === "Escape") {
        setQueueContextMenu(null);
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [queueContextMenu]);

  useEffect(() => {
    if (tab !== "history" || !dailyChartRef.current) return;

    dailyChartInstanceRef.current?.destroy();
    const labels = [...analytics.byDay.keys()].sort();
    const values = labels.map(
      (label) => (analytics.byDay.get(label) || 0) / (1024 * 1024),
    );

    dailyChartInstanceRef.current = new Chart(dailyChartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "MB per day",
            data: values,
            borderColor: "#ff4f4f",
            backgroundColor: "rgba(255,79,79,0.2)",
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });

    return () => dailyChartInstanceRef.current?.destroy();
  }, [tab, analytics.byDay]);

  useEffect(() => {
    if (tab !== "history" || !siteChartRef.current) return;

    siteChartInstanceRef.current?.destroy();
    const labels = [...analytics.bySite.keys()];
    const values = labels.map(
      (label) => (analytics.bySite.get(label) || 0) / (1024 * 1024),
    );

    siteChartInstanceRef.current = new Chart(siteChartRef.current, {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: [
              "#ff4f4f",
              "#f97316",
              "#10b981",
              "#0ea5e9",
              "#a855f7",
              "#f43f5e",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1" } } },
      },
    });

    return () => siteChartInstanceRef.current?.destroy();
  }, [tab, analytics.bySite]);

  useEffect(() => {
    if (!speedChartRef.current) return;

    speedChartInstanceRef.current?.destroy();
    speedChartInstanceRef.current = new Chart(speedChartRef.current, {
      type: "line",
      data: {
        labels: speedSamples.map((item) => item.t),
        datasets: [
          {
            label: "MB/s",
            data: speedSamples.map((item) => item.v),
            borderColor: "#22d3ee",
            backgroundColor: "rgba(34,211,238,0.15)",
            fill: true,
            pointRadius: 0,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#94a3b8" } },
          y: { ticks: { color: "#94a3b8" } },
        },
      },
    });

    return () => speedChartInstanceRef.current?.destroy();
  }, [speedSamples]);

  function pushToast(message, type = "info", link) {
    const toast = makeToast(message, type, link);
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, 5000);
  }

  function notifyDesktop(title, body) {
    if (!("Notification" in window)) return;

    const show = () => {
      try {
        new Notification(title, { body });
      } catch (_) {}
    };

    if (Notification.permission === "granted") {
      show();
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission()
        .then((result) => {
          if (result === "granted") show();
        })
        .catch(() => {});
    }
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  async function loadAuthSession() {
    setAuthLoading(true);
    try {
      const response = await fetch("/api/me");
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.authenticated && data.user) {
        setAuthUser(data.user);
        try {
          const claimResponse = await fetch("/api/history/claim-legacy", {
            method: "POST",
          });
          const claimData = await claimResponse.json().catch(() => ({}));
          if (claimResponse.ok && claimData.claimed > 0) {
            pushToast(
              `Imported ${claimData.claimed} legacy history item${claimData.claimed === 1 ? "" : "s"}.`,
              "success",
            );
          }
        } catch (_) {}
        await loadHistory(true);
      } else {
        setAuthUser(null);
      }
    } catch {
      setAuthUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  function signInWithGoogle() {
    window.location.href = "/auth/google";
  }

  async function signOut() {
    try {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out");
      setAccountMenuOpen(false);
      setAuthUser(null);
      setHistory([]);
      pushToast("Signed out", "info");
    } catch (error) {
      pushToast(error.message || "Could not sign out", "error");
    }
  }

  async function tryPasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(URL_PATTERN);
      if (match && !url.trim()) {
        setUrl(match[0]);
      }
    } catch (_) {}
  }

  async function fetchInfo(explicitUrl) {
    if (!isAuthenticated) {
      pushToast("Sign in with Google to fetch media info.", "error");
      return;
    }
    const targetUrl = (explicitUrl || url).trim();
    if (!targetUrl) {
      setUrlError("Enter a URL to continue");
      return;
    }

    setUrlError("");
    setIsFetching(true);

    try {
      const data = await requestInfo(targetUrl);

      setInfo(data);
      setContentSuggestion(suggestContentPreset(data));
      setPlaylistItems([]);
      setPlaylistSelected({});
      if (smartDefaults) {
        if (!userTweaksRef.current.format) setFormat("mp4");
        if (!userTweaksRef.current.quality && data.site !== "spotify") {
          setQuality("best");
        }
        if (!userTweaksRef.current.playlist) {
          setIsPlaylist(Boolean(data.isPlaylist));
        }
        if (
          !userTweaksRef.current.subtitles &&
          data.site === "youtube" &&
          data.hasSubtitles
        ) {
          setSubtitles(true);
          setSubtitleMode("soft");
          setSubtitleLangs(
            pickPreferredSubtitleSelection(data.subtitleLanguages),
          );
        }
      }
      if (data.approxSize) {
        const sizeMb = data.approxSize / (1024 * 1024);
        pushToast(`Approx size: ~${sizeMb.toFixed(1)} MB`);
      }

      if (data.site === "spotify") {
        setFormat("mp3");
        setSubtitles(false);
        setSubtitleMode("separate");
        setSpotifyShowCount(10);
        await loadSpotifyCandidates(targetUrl);
      } else {
        setSpotifyCandidates([]);
        setSpotifyCandidateUrl("");
        setSpotifyCustomUrl("");
        setSpotifyCandidatesLoaded(false);
        setSpotifyCandidatesLoading(false);
      }
    } catch (error) {
      setInfo(null);
      setContentSuggestion(null);
      setPlaylistItems([]);
      setPlaylistSelected({});
      setSpotifyCandidates([]);
      setSpotifyCandidateUrl("");
      setSpotifyCandidatesLoaded(false);
      setSpotifyCandidatesLoading(false);
      setUrlError(error.message || "Could not load video info");
      pushToast(error.message || "Could not load video info", "error");
    } finally {
      setIsFetching(false);
    }
  }

  async function loadPlaylistItems(urlToLoad = url) {
    const target = String(urlToLoad || "").trim();
    if (!target) return;
    setPlaylistLoading(true);
    try {
      const response = await fetch("/api/info/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, limit: 200 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not load playlist items");
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setPlaylistItems(items);
      setPlaylistSelected(
        Object.fromEntries(items.map((item) => [item.url, true])),
      );
      pushToast(`Loaded ${items.length} playlist items`, "success");
    } catch (error) {
      pushToast(error.message || "Could not load playlist items", "error");
      setPlaylistItems([]);
      setPlaylistSelected({});
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function requestInfo(targetUrl) {
    const response = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (response.status === 401) {
      setAuthUser(null);
      throw new Error("Sign in with Google to continue.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load video info");
    }
    return data;
  }

  async function loadBatchPreview(urls = batchParsedUrls, requestId) {
    if (!isAuthenticated) return;

    const activeRequestId = requestId || batchPreviewRequestRef.current + 1;
    if (!requestId) {
      batchPreviewRequestRef.current = activeRequestId;
    }

    setBatchPreviewLoading(true);
    setBatchPreviewError("");
    setBatchPreviewItems([]);
    setBatchPreviewProgress({ done: 0, total: urls.length });

    const results = [];
    let failed = 0;

    for (let index = 0; index < urls.length; index++) {
      const itemUrl = urls[index];
      if (activeRequestId !== batchPreviewRequestRef.current) {
        return;
      }

      try {
        const data = await requestInfo(itemUrl);
        results.push({
          url: itemUrl,
          title: data.title || `Item ${index + 1}`,
          uploader: data.uploader || "",
          thumbnail: data.thumbnail || "",
          duration: data.duration || null,
          site: data.site || "unknown",
          status: "ready",
          isPlaylist: Boolean(data.isPlaylist),
        });
      } catch (error) {
        failed += 1;
        results.push({
          url: itemUrl,
          title: `Item ${index + 1}`,
          uploader: "",
          thumbnail: "",
          duration: null,
          site: "unknown",
          status: "error",
          error: error.message || "Could not load preview",
        });
      }

      if (activeRequestId !== batchPreviewRequestRef.current) {
        return;
      }

      setBatchPreviewItems([...results]);
      setBatchPreviewProgress({ done: index + 1, total: urls.length });
    }

    if (activeRequestId !== batchPreviewRequestRef.current) {
      return;
    }

    setBatchPreviewLoading(false);
    if (failed > 0) {
      setBatchPreviewError(
        `${failed} preview item${failed === 1 ? "" : "s"} could not be loaded.`,
      );
    }
  }

  async function refreshLogs(silent = false) {
    if (!isAuthenticated) return;
    if (!silent) {
      setLogsLoading(true);
    }

    try {
      const response = await fetch("/api/logs/recent?limit=150");
      if (response.status === 401) {
        setAuthUser(null);
        throw new Error("Sign in with Google to continue.");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not load logs");
      }
      setLogEntries(Array.isArray(data.entries) ? data.entries : []);
      setLogsUpdatedAt(data.updatedAt || new Date().toISOString());
      setLogsError("");
    } catch (error) {
      setLogsError(error.message || "Could not load logs");
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadSpotifyCandidates(trackUrl) {
    if (!isAuthenticated) return;
    setSpotifyCandidatesLoading(true);
    setSpotifyCandidatesLoaded(false);
    try {
      const response = await fetch("/api/spotify/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trackUrl }),
      });
      if (response.status === 401) {
        setAuthUser(null);
        throw new Error("Sign in with Google to continue.");
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load matches");
      }
      const list = Array.isArray(data.candidates) ? data.candidates : [];
      setSpotifyCandidates(list);
      setSpotifyCandidateUrl(
        (list.find((candidate) => candidate.recommended) || list[0] || {})
          .url || "",
      );
      setSpotifyCandidatesLoaded(true);
    } catch (error) {
      pushToast(error.message || "Could not load matches", "error");
      setSpotifyCandidates([]);
      setSpotifyCandidateUrl("");
      setSpotifyCandidatesLoaded(true);
    } finally {
      setSpotifyCandidatesLoading(false);
    }
  }

  async function openDownloadsFolder() {
    try {
      const response = await fetch("/api/open-downloads", { method: "POST" });
      if (response.status === 401) {
        setAuthUser(null);
        throw new Error("Sign in with Google to continue.");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Could not open downloads folder");
      pushToast(data.message || "Downloads folder opened", "success");
    } catch (error) {
      pushToast(error.message || "Could not open downloads folder", "error");
    }
  }

  function exportLogs() {
    const anchor = document.createElement("a");
    anchor.href = "/api/logs/export";
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  async function loadQueueSettings() {
    try {
      const response = await fetch("/api/queue/settings");
      if (response.status === 401) {
        setAuthUser(null);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok && Number.isFinite(data.maxConcurrent)) {
        setQueueConcurrency(Math.max(1, Math.min(8, data.maxConcurrent)));
      }
    } catch (_) {}
  }

  async function saveQueueConcurrency(nextValue) {
    const parsed = Math.max(1, Math.min(8, Number(nextValue) || 1));
    setQueueConcurrency(parsed);
    setQueueConcurrencySaving(true);
    try {
      const response = await fetch("/api/queue/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: parsed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save queue limit");
      }
      pushToast(`Parallel download limit set to ${parsed}`, "success");
    } catch (error) {
      pushToast(error.message || "Could not save queue limit", "error");
    } finally {
      setQueueConcurrencySaving(false);
    }
  }

  function buildPresetDraftFromSettings({
    id = "",
    icon = "⚙️",
    name = "",
    description = "",
    bullets,
    settings,
  }) {
    const source = settings || {};
    return {
      id,
      icon,
      name,
      description,
      bulletsText: Array.isArray(bullets) ? bullets.join(" | ") : "",
      settings: {
        format: source.format || format || "mp4",
        quality: source.quality || quality || "best",
        audioBitrate: source.audioBitrate || audioBitrate || "",
        subtitles:
          source.subtitles !== undefined
            ? Boolean(source.subtitles)
            : subtitles,
        subtitleMode: source.subtitleMode || subtitleMode || "separate",
        filenameTemplate:
          source.filenameTemplate !== undefined
            ? source.filenameTemplate
            : filenameTemplate,
        removeWatermark:
          source.removeWatermark !== undefined
            ? Boolean(source.removeWatermark)
            : removeWatermark,
        batchMode:
          source.batchMode !== undefined
            ? Boolean(source.batchMode)
            : batchMode,
        isPlaylist:
          source.isPlaylist !== undefined
            ? Boolean(source.isPlaylist)
            : isPlaylist,
        limitRate:
          source.limitRate !== undefined ? source.limitRate : limitRate,
      },
    };
  }

  function openPresetCreateFromCurrent() {
    setPresetEditorMode("create");
    setPresetDraft(
      buildPresetDraftFromSettings({
        id: `custom-${Date.now()}`,
        icon: "✨",
        name: "",
        description: "",
        settings: {},
      }),
    );
    setPresetEditorOpen(true);
  }

  function openPresetEditor(preset) {
    if (!preset) return;
    setPresetEditorMode("edit");
    setPresetDraft(
      buildPresetDraftFromSettings({
        id: preset.id,
        icon: preset.icon || "⚙️",
        name: preset.name || "",
        description: preset.description || "",
        bullets: preset.bullets || [],
        settings: preset.settings || {},
      }),
    );
    setPresetEditorOpen(true);
  }

  function closePresetEditor() {
    setPresetEditorOpen(false);
    setPresetDraft(null);
  }

  function savePresetDraft() {
    if (!presetDraft) return;
    const trimmedName = String(presetDraft.name || "").trim();
    if (!trimmedName) {
      pushToast("Preset name is required", "error");
      return;
    }

    const normalized = {
      id: presetDraft.id,
      icon: String(presetDraft.icon || "⚙️").trim() || "⚙️",
      name: trimmedName,
      description: String(presetDraft.description || "").trim(),
      bullets: String(presetDraft.bulletsText || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4),
      settings: {
        ...presetDraft.settings,
        format: presetDraft.settings?.format || "mp4",
        quality: presetDraft.settings?.quality || "best",
        subtitleMode: presetDraft.settings?.subtitleMode || "separate",
      },
    };

    const isBuiltIn = BUILTIN_PRESET_CARDS.some(
      (preset) => preset.id === normalized.id,
    );

    if (presetEditorMode === "create" && !isBuiltIn) {
      setCustomPresets((prev) => [normalized, ...prev]);
      setActivePresetId(normalized.id);
      pushToast(`Custom preset created: ${normalized.name}`, "success");
      closePresetEditor();
      return;
    }

    if (isBuiltIn) {
      setPresetOverrides((prev) => ({
        ...prev,
        [normalized.id]: {
          icon: normalized.icon,
          name: normalized.name,
          description: normalized.description,
          bullets: normalized.bullets,
          settings: normalized.settings,
        },
      }));
    } else {
      setCustomPresets((prev) =>
        prev.map((preset) =>
          preset.id === normalized.id ? { ...preset, ...normalized } : preset,
        ),
      );
    }

    setActivePresetId(normalized.id);
    pushToast(`Preset updated: ${normalized.name}`, "success");
    closePresetEditor();
  }

  function deleteEditingPreset() {
    if (!presetDraft?.id) return;
    const id = presetDraft.id;
    const isBuiltIn = BUILTIN_PRESET_CARDS.some((preset) => preset.id === id);

    if (isBuiltIn) {
      setPresetOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activePresetId === id) {
        setActivePresetId("");
      }
      pushToast("Built-in preset reset to defaults", "info");
      closePresetEditor();
      return;
    }

    setCustomPresets((prev) => prev.filter((preset) => preset.id !== id));
    if (activePresetId === id) {
      setActivePresetId("");
    }
    pushToast("Custom preset deleted", "info");
    closePresetEditor();
  }

  function applyPreset(presetId, options = {}) {
    const preset = allPresetMap[presetId];
    if (!preset) return;

    const { announce = true } = options;
    const settings = preset.settings || {};

    userTweaksRef.current = {
      format: true,
      quality: true,
      subtitles: true,
      playlist: true,
    };

    setActivePresetId(preset.id);
    setSmartDefaults(false);
    setFormat(settings.format || "mp4");
    setQuality(settings.quality || "best");
    setAudioBitrate(settings.audioBitrate || "");
    setSubtitles(Boolean(settings.subtitles));
    setSubtitleLangs(settings.subtitleLangs || "all");
    setSubtitleMode(settings.subtitleMode || "separate");
    setEmbedSubtitles((settings.subtitleMode || "separate") !== "separate");
    setFilenameTemplate(settings.filenameTemplate || "");
    setRemoveWatermark(Boolean(settings.removeWatermark));
    setIsPlaylist(Boolean(settings.isPlaylist));
    setLimitRate(settings.limitRate || "");
    setStartTime("");
    setEndTime("");

    if (settings.batchMode) {
      const currentUrl = url.trim();
      setBatchMode(true);
      if (currentUrl) {
        setBatchInput((prev) => {
          const combined = [prev, currentUrl].filter(Boolean).join("\n");
          return parseBatchUrls(combined).join("\n");
        });
      }
      setUrl("");
      setUrlError("");
      setInfo(null);
    } else {
      setBatchMode(false);
    }

    if (announce) {
      pushToast(
        `${preset.name} applied. You can still tweak settings below.`,
        "success",
      );
    }
  }

  function clearPresetSelection() {
    setActivePresetId("");
  }

  function toggleSubtitleLanguage(lang) {
    if (!lang) return;
    if (lang === "all") {
      setSubtitleLangs("all");
      return;
    }

    const current = subtitleLangs
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => item !== "all");

    const next = current.includes(lang)
      ? current.filter((item) => item !== lang)
      : [...current, lang];

    setSubtitleLangs(next.length ? next.join(",") : "all");
  }

  function showReadyToast(filename, autoStarted = false) {
    const message = isLocalHost
      ? `Saved to the app downloads folder: ${filename}`
      : autoStarted
        ? `Download started: ${filename}`
        : `Download ready: ${filename}`;

    pushToast(message, "success", {
      href: `/api/files/${encodeURIComponent(filename)}`,
      label: isLocalHost
        ? "Download a browser copy"
        : "Click here if it didn't start",
      download: filename,
    });
  }

  async function triggerFileDownload(filename) {
    if (!filename) return;
    const fileUrl = `/api/files/${encodeURIComponent(filename)}`;
    try {
      const probe = await fetch(fileUrl, { method: "HEAD" });
      if (!probe.ok) {
        throw new Error(`Download file not found on server (${probe.status})`);
      }

      const anchor = document.createElement("a");
      anchor.href = fileUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      showReadyToast(filename, true);
    } catch (error) {
      pushToast(error.message || "Could not reach download endpoint", "error");
    }
  }

  function buildAutoFolderTemplate(siteName, resolvedPreset, targetFormat) {
    if (autoFolderMode === "none") return "";
    const safeFormat = targetFormat || "mp4";
    if (autoFolderMode === "site") {
      const siteLabel = SITE_LABELS[siteName] || "Other";
      return `${siteLabel}/%(title)s - %(uploader)s.%(ext)s`;
    }

    const presetName = String(resolvedPreset?.name || "").toLowerCase();
    if (presetName.includes("podcast")) {
      return `Podcasts/%(title)s - %(uploader)s.%(ext)s`;
    }
    if (safeFormat === "mp3") {
      return `Music/%(uploader)s/%(title)s.%(ext)s`;
    }
    return `Videos/%(uploader)s/%(title)s.%(ext)s`;
  }

  function buildQueueRetryOverrides(item, extra = {}) {
    return {
      urls: [item.url],
      titles: [item.title || "Unknown"],
      uploaders: [item.uploader || ""],
      thumbnails: [item.thumbnail || ""],
      format: item.format || format,
      quality: item.quality || quality,
      audioBitrate: item.audioBitrate || "",
      subtitleLangs: item.subtitleLangs || "all",
      subtitleMode: item.subtitleMode || "separate",
      filenameTemplate: item.filenameTemplate || "",
      subtitles: Boolean(item.subtitles),
      removeWatermark: Boolean(item.removeWatermark),
      isPlaylist: Boolean(item.isPlaylist),
      limitRate: item.limitRate || "",
      presetId: item.presetId || undefined,
      presetName: item.presetName || undefined,
      ...extra,
    };
  }

  async function retryQueueItem(item, extra = {}) {
    if (!item?.url) return;
    setQueueContextMenu(null);
    await startDownload(buildQueueRetryOverrides(item, extra));
  }

  function openQueueItemMenu(event, item) {
    event.preventDefault();
    setQueueContextMenu({
      x: event.clientX,
      y: event.clientY,
      item,
    });
  }

  async function changeQueueItemPreset(item) {
    const choices = allPresetCards.map(
      (preset) => `${preset.id}: ${preset.name}`,
    );
    const selected = window
      .prompt(
        `Enter preset id to apply to this item:\n${choices.join("\n")}`,
        item.presetId || activePresetId || "",
      )
      ?.trim();
    if (!selected) {
      setQueueContextMenu(null);
      return;
    }

    const preset = allPresetMap[selected];
    if (!preset) {
      pushToast("Preset not found", "error");
      return;
    }

    setQueue((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              presetId: preset.id,
              presetName: preset.name,
              format: preset.settings?.format || entry.format,
              quality: preset.settings?.quality || entry.quality,
              audioBitrate:
                preset.settings?.audioBitrate !== undefined
                  ? preset.settings.audioBitrate
                  : entry.audioBitrate,
              subtitles:
                preset.settings?.subtitles !== undefined
                  ? Boolean(preset.settings.subtitles)
                  : entry.subtitles,
              subtitleMode: preset.settings?.subtitleMode || entry.subtitleMode,
              filenameTemplate:
                preset.settings?.filenameTemplate !== undefined
                  ? preset.settings.filenameTemplate
                  : entry.filenameTemplate,
              removeWatermark:
                preset.settings?.removeWatermark !== undefined
                  ? Boolean(preset.settings.removeWatermark)
                  : entry.removeWatermark,
              isPlaylist:
                preset.settings?.isPlaylist !== undefined
                  ? Boolean(preset.settings.isPlaylist)
                  : entry.isPlaylist,
              limitRate:
                preset.settings?.limitRate !== undefined
                  ? preset.settings.limitRate
                  : entry.limitRate,
            }
          : entry,
      ),
    );

    setQueueContextMenu(null);
    pushToast(`Preset changed to ${preset.name}`, "success");
  }

  function openQueueItemOutput(item) {
    setQueueContextMenu(null);
    if (item?.filename) {
      triggerFileDownload(item.filename);
      return;
    }
    openDownloadsFolder();
  }

  async function startDownload(overrides = {}) {
    if (!isAuthenticated) {
      pushToast("Sign in with Google to start downloads.", "error");
      return;
    }
    const resolvedUrls = overrides.urls
      ? overrides.urls
      : batchMode
        ? parseBatchUrls(batchInput)
        : info?.isPlaylist && selectedPlaylistItems.length > 0
          ? selectedPlaylistItems.map((item) => item.url)
          : [url.trim()].filter(Boolean);
    const previewMetadata = resolvedUrls.map(
      (item) => batchPreviewMap.get(item) || playlistItemMap.get(item) || null,
    );
    const titles =
      overrides.titles ||
      (resolvedUrls.length > 1
        ? previewMetadata.map(
            (item, index) => item?.title || `Item ${index + 1}`,
          )
        : [info?.title || previewMetadata[0]?.title || "Unknown"]);

    if (
      info?.isPlaylist &&
      playlistItems.length > 0 &&
      resolvedUrls.length === 0
    ) {
      pushToast("Select at least one playlist item", "error");
      return;
    }
    const uploaders =
      overrides.uploaders ||
      (resolvedUrls.length > 1
        ? previewMetadata.map((item) => item?.uploader || "")
        : [
            overrides.uploader ||
              info?.uploader ||
              previewMetadata[0]?.uploader ||
              "",
          ]);
    const thumbnails =
      overrides.thumbnails ||
      (resolvedUrls.length > 1
        ? previewMetadata.map((item) => item?.thumbnail || "")
        : [
            overrides.thumbnail ||
              info?.thumbnail ||
              previewMetadata[0]?.thumbnail ||
              "",
          ]);

    if (resolvedUrls.length === 0) {
      setUrlError("Enter at least one URL");
      pushToast("Enter at least one URL", "error");
      return;
    }

    if (!batchMode && !overrides.urls && !info && resolvedUrls.length === 1) {
      setUrlError("Fetch info first or use batch mode");
      pushToast("Fetch video info first", "error");
      return;
    }

    if (site === "spotify" && !overrides.urls && spotifyCandidatesLoading) {
      pushToast("Still matching Spotify source. Please wait a moment.", "info");
      return;
    }

    if (
      site === "spotify" &&
      !overrides.urls &&
      !spotifyCustomUrl.trim() &&
      !spotifyCandidateUrl
    ) {
      pushToast("Pick a Spotify source match before downloading.", "error");
      return;
    }

    const resolvedPreset = overrides.presetId
      ? allPresetMap[overrides.presetId] || {
          id: overrides.presetId,
          name: overrides.presetName || "Custom preset",
        }
      : activePreset;
    const resolvedFormat = spotifyMode ? "mp3" : overrides.format || format;
    const resolvedQuality = overrides.quality || quality;
    const resolvedAudioBitrate =
      overrides.audioBitrate !== undefined
        ? overrides.audioBitrate
        : audioBitrate;
    const resolvedSubtitleLangs = spotifyMode
      ? undefined
      : overrides.subtitleLangs ||
        subtitleLangs ||
        pickPreferredSubtitleSelection(info?.subtitleLanguages);
    const resolvedSubtitleMode = spotifyMode
      ? "separate"
      : overrides.subtitleMode !== undefined
        ? overrides.subtitleMode
        : subtitleMode;
    let resolvedFilenameTemplate =
      overrides.filenameTemplate !== undefined
        ? overrides.filenameTemplate
        : filenameTemplate;
    const resolvedSubtitles = spotifyMode
      ? false
      : overrides.subtitles !== undefined
        ? overrides.subtitles
        : subtitles;
    const resolvedRemoveWatermark =
      overrides.removeWatermark !== undefined
        ? overrides.removeWatermark
        : removeWatermark;
    const resolvedIsPlaylist =
      overrides.isPlaylist !== undefined ? overrides.isPlaylist : isPlaylist;
    const resolvedEmbedSubtitles = spotifyMode
      ? false
      : overrides.embedSubtitles !== undefined
        ? overrides.embedSubtitles
        : resolvedSubtitleMode !== "separate";
    const resolvedStartTime =
      overrides.startTime !== undefined ? overrides.startTime : startTime;
    const resolvedEndTime =
      overrides.endTime !== undefined ? overrides.endTime : endTime;
    const resolvedLimitRate =
      overrides.limitRate !== undefined ? overrides.limitRate : limitRate;
    const resolvedSpotifyYoutubeUrl =
      overrides.spotifyYoutubeUrl !== undefined
        ? overrides.spotifyYoutubeUrl
        : site === "spotify"
          ? spotifyCustomUrl.trim() || spotifyCandidateUrl || undefined
          : undefined;

    if (!resolvedFilenameTemplate && autoFolderMode !== "none") {
      resolvedFilenameTemplate = buildAutoFolderTemplate(
        info?.site || site,
        resolvedPreset,
        resolvedFormat,
      );
    }

    const normalizedUrls = resolvedUrls.filter((item) => isValidUrl(item));
    const invalidUrlCount = Math.max(
      0,
      resolvedUrls.length - normalizedUrls.length,
    );
    if (normalizedUrls.length === 0) {
      setUrlError("No valid URLs found.");
      pushToast("No valid URLs found.", "error");
      return;
    }

    if (batchMode && invalidUrlCount > 0) {
      pushToast(
        `Skipped ${invalidUrlCount} invalid line${invalidUrlCount > 1 ? "s" : ""} in batch input.`,
        "info",
      );
    }

    const payload = {
      urls: normalizedUrls.length > 1 ? normalizedUrls : undefined,
      url: normalizedUrls[0],
      format: resolvedFormat,
      quality: resolvedQuality,
      audioBitrate: resolvedAudioBitrate || undefined,
      subtitleLangs: resolvedSubtitleLangs,
      subtitleMode: resolvedSubtitleMode,
      filenameTemplate: resolvedFilenameTemplate || undefined,
      subtitles: resolvedSubtitles,
      removeWatermark: resolvedRemoveWatermark,
      isPlaylist: resolvedIsPlaylist,
      title: titles[0],
      titles: normalizedUrls.length > 1 ? titles : undefined,
      uploader: uploaders[0] || undefined,
      uploaders: normalizedUrls.length > 1 ? uploaders : undefined,
      thumbnail: thumbnails[0] || undefined,
      thumbnails: normalizedUrls.length > 1 ? thumbnails : undefined,
      presetId: resolvedPreset?.id || undefined,
      presetName: resolvedPreset?.name || undefined,
      outputMode,
      gifFps: Number(gifFps) || 15,
      gifResolution: Number(gifResolution) || 480,
      compressCrf: Number(compressCrf) || 28,
      spotifyYoutubeUrl: resolvedSpotifyYoutubeUrl,
      embedSubtitles: resolvedEmbedSubtitles,
      startTime: resolvedStartTime || undefined,
      endTime: resolvedEndTime || undefined,
      limitRate: resolvedLimitRate || undefined,
    };

    let queueLocal = normalizedUrls.map((_, index) => ({
      id: Date.now() + index,
      title: titles[index] || "Unknown",
      uploader: uploaders[index] || "",
      thumbnail: thumbnails[index] || "",
      presetId: resolvedPreset?.id || "",
      presetName: resolvedPreset?.name || "",
      url: normalizedUrls[index],
      format: resolvedFormat,
      quality: resolvedQuality,
      audioBitrate: resolvedAudioBitrate || "",
      subtitleLangs: resolvedSubtitleLangs || "all",
      subtitleMode: resolvedSubtitleMode,
      filenameTemplate: resolvedFilenameTemplate || "",
      subtitles: Boolean(resolvedSubtitles),
      removeWatermark: Boolean(resolvedRemoveWatermark),
      isPlaylist: Boolean(resolvedIsPlaylist),
      limitRate: resolvedLimitRate || "",
      status: index === 0 ? "downloading" : "pending",
      percent: 0,
    }));

    setQueue(queueLocal);
    setSpeedSamples([]);
    setDownloadState({
      running: true,
      percent: 0,
      itemPercent: 0,
      itemIndex: 0,
      itemTotal: normalizedUrls.length,
      speed: null,
      eta: null,
      statusText:
        normalizedUrls.length > 1
          ? `Processing 1 of ${normalizedUrls.length}`
          : "Processing…",
      done: false,
    });

    let currentIndex = 0;
    const doneFiles = [];
    let failedItems = 0;
    let batchSummary = null;

    const processSingleItemStream = async (singlePayload, itemIndex) => {
      const controller = new AbortController();
      activeDownloadControllerRef.current = controller;

      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(singlePayload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Download failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let itemCompleted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const payloadStr = chunk.slice(6);

          let event;
          try {
            event = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          if (event.type === "progress") {
            const mbps = parseSpeedToMbps(event.speed);
            if (mbps != null) {
              setSpeedSamples((prev) => {
                const next = [
                  ...prev,
                  {
                    t: new Date().toLocaleTimeString(),
                    v: Number(mbps.toFixed(3)),
                  },
                ];
                return next.slice(-45);
              });
            }
            const itemPct = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  event.itemPercent != null
                    ? event.itemPercent
                    : event.percent || 0,
                ),
              ),
            );
            const overallPct = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  ((itemIndex + itemPct / 100) / normalizedUrls.length) * 100,
                ),
              ),
            );

            setDownloadState((prev) => ({
              ...prev,
              percent: overallPct,
              itemPercent: itemPct,
              itemIndex,
              itemTotal: normalizedUrls.length,
              speed: event.speed || null,
              eta: event.eta || null,
              statusText:
                normalizedUrls.length > 1
                  ? `Processing ${itemIndex + 1} of ${normalizedUrls.length}`
                  : "Processing…",
            }));

            if (queueLocal[itemIndex]) {
              queueLocal[itemIndex] = {
                ...queueLocal[itemIndex],
                status: "downloading",
                percent: itemPct,
                speed: event.speed || null,
                eta: event.eta || null,
              };
              setQueue([...queueLocal]);
            }
          } else if (event.type === "done") {
            itemCompleted = true;
            doneFiles.push(event.filename);
            notifyDesktop("Download finished", event.filename || "File ready");

            if (event.checksum) {
              pushToast(
                `Checksum verified (SHA-256): ${String(event.checksum).slice(0, 12)}…`,
                "info",
              );
            }

            if (isLocalHost) {
              showReadyToast(event.filename, false);
            } else {
              await triggerFileDownload(event.filename);
            }

            if (queueLocal[itemIndex]) {
              queueLocal[itemIndex] = {
                ...queueLocal[itemIndex],
                status: "done",
                filename: event.filename || queueLocal[itemIndex]?.filename,
                percent: 100,
                speed: null,
                eta: null,
              };
              setQueue([...queueLocal]);
            }
          } else if (event.type === "item-error") {
            throw new Error(event.message || "Download failed");
          } else if (event.type === "error") {
            throw new Error(event.message || "Download failed");
          }
        }
      }

      if (!itemCompleted) {
        throw new Error(
          "Download finished without a completed output file event.",
        );
      }
    };

    if (batchMode && normalizedUrls.length > 1 && !overrides.urls) {
      try {
        for (
          let itemIndex = 0;
          itemIndex < normalizedUrls.length;
          itemIndex++
        ) {
          if (queueLocal[itemIndex]) {
            queueLocal[itemIndex] = {
              ...queueLocal[itemIndex],
              status: "downloading",
              percent: 0,
              speed: null,
              eta: null,
            };
            setQueue([...queueLocal]);
          }

          setDownloadState((prev) => ({
            ...prev,
            itemIndex,
            itemTotal: normalizedUrls.length,
            itemPercent: 0,
            speed: null,
            eta: null,
            statusText: `Processing ${itemIndex + 1} of ${normalizedUrls.length}`,
          }));

          const singlePayload = {
            ...payload,
            urls: undefined,
            url: normalizedUrls[itemIndex],
            title: titles[itemIndex] || "Unknown",
            titles: undefined,
          };

          let succeeded = false;
          for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
            try {
              await processSingleItemStream(singlePayload, itemIndex);
              succeeded = true;
            } catch (itemError) {
              const message = String(itemError?.message || "Download failed");
              const looksNetworkRelated = /network|failed to fetch|fetch/i.test(
                message,
              );
              const canRetry = attempt === 0 && looksNetworkRelated;

              if (canRetry) {
                await new Promise((resolve) => setTimeout(resolve, 900));
                continue;
              }

              failedItems += 1;
              if (queueLocal[itemIndex]) {
                queueLocal[itemIndex] = {
                  ...queueLocal[itemIndex],
                  status: "error",
                  speed: null,
                  eta: null,
                };
                setQueue([...queueLocal]);
              }
              pushToast(`Item ${itemIndex + 1} failed: ${message}`, "error");
              break;
            }
          }

          const completedItems = queueLocal.filter(
            (item) => item.status === "done",
          ).length;
          const overallPct = Math.round(
            ((completedItems + failedItems) / normalizedUrls.length) * 100,
          );
          setDownloadState((prev) => ({
            ...prev,
            percent: Math.max(prev.percent, Math.min(100, overallPct)),
          }));
        }

        setDownloadState({
          running: false,
          percent: 100,
          itemPercent: 100,
          itemIndex: Math.max(0, normalizedUrls.length - 1),
          itemTotal: normalizedUrls.length,
          speed: null,
          eta: null,
          statusText: "Done",
          done: true,
        });

        if (doneFiles.length === 0 && failedItems > 0) {
          pushToast(
            `Batch finished with ${failedItems} failed item${failedItems === 1 ? "" : "s"}.`,
            "error",
          );
        } else if (failedItems > 0) {
          pushToast(
            `Batch finished: ${doneFiles.length} done, ${failedItems} failed.`,
            "info",
          );
        } else if (doneFiles.length === 0) {
          pushToast(
            "Download finished but no file was returned by the server.",
            "error",
          );
        } else {
          pushToast("All downloads complete", "success");
          notifyDesktop(
            "All downloads complete",
            `${doneFiles.length} files finished`,
          );
        }

        await loadHistory();
        setTimeout(() => {
          setDownloadState({
            running: false,
            percent: 0,
            itemPercent: 0,
            itemIndex: 0,
            itemTotal: 0,
            speed: null,
            eta: null,
            statusText: "Ready",
            done: false,
          });
        }, 2400);
      } catch (error) {
        if (error?.name === "AbortError") {
          setDownloadState({
            running: false,
            percent: 0,
            itemPercent: 0,
            itemIndex: 0,
            itemTotal: 0,
            speed: null,
            eta: null,
            statusText: "Canceled",
            done: false,
          });
          pushToast(
            "Batch was canceled in UI. Current request may still finish on server.",
            "info",
          );
          return;
        }

        setDownloadState({
          running: false,
          percent: 0,
          itemPercent: 0,
          itemIndex: 0,
          itemTotal: 0,
          speed: null,
          eta: null,
          statusText: "Failed",
          done: false,
        });
        pushToast(error.message || "Batch download failed", "error");
      } finally {
        activeDownloadControllerRef.current = null;
      }
      return;
    }

    try {
      const controller = new AbortController();
      activeDownloadControllerRef.current = controller;

      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 401) {
        setAuthUser(null);
        throw new Error("Sign in with Google to continue.");
      }

      if (!response.ok || !response.body) {
        throw new Error("Download failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const payloadStr = chunk.slice(6);

          let event;
          try {
            event = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          if (event.type === "progress") {
            const mbps = parseSpeedToMbps(event.speed);
            if (mbps != null) {
              setSpeedSamples((prev) => {
                const next = [
                  ...prev,
                  {
                    t: new Date().toLocaleTimeString(),
                    v: Number(mbps.toFixed(3)),
                  },
                ];
                return next.slice(-45);
              });
            }
            const pct = Math.max(
              0,
              Math.min(100, Math.round(event.percent || 0)),
            );
            const activeItemIndex =
              Number.isInteger(event.itemIndex) && event.itemIndex >= 0
                ? event.itemIndex
                : currentIndex;
            const itemPct = Math.max(
              0,
              Math.min(100, Math.round(event.itemPercent || 0)),
            );
            setDownloadState((prev) => ({
              ...prev,
              percent: pct,
              itemPercent: itemPct,
              itemIndex: activeItemIndex,
              itemTotal: event.itemTotal || normalizedUrls.length,
              speed: event.speed || null,
              eta: event.eta || null,
              statusText:
                normalizedUrls.length > 1
                  ? `Processing ${activeItemIndex + 1} of ${normalizedUrls.length}`
                  : "Processing…",
            }));

            if (queueLocal[activeItemIndex]) {
              queueLocal[activeItemIndex] = {
                ...queueLocal[activeItemIndex],
                status: "downloading",
                percent: itemPct,
                speed: event.speed || null,
                eta: event.eta || null,
              };
              setQueue([...queueLocal]);
            }
          } else if (event.type === "done") {
            const doneItemIndex =
              Number.isInteger(event.itemIndex) && event.itemIndex >= 0
                ? event.itemIndex
                : currentIndex;
            doneFiles.push(event.filename);
            notifyDesktop("Download finished", event.filename || "File ready");

            if (event.checksum) {
              pushToast(
                `Checksum verified (SHA-256): ${String(event.checksum).slice(0, 12)}…`,
                "info",
              );
            }

            if (isLocalHost) {
              showReadyToast(event.filename, false);
            } else {
              await triggerFileDownload(event.filename);
            }

            if (queueLocal[doneItemIndex]) {
              queueLocal[doneItemIndex] = {
                ...queueLocal[doneItemIndex],
                status: "done",
                filename: event.filename || queueLocal[doneItemIndex]?.filename,
                percent: 100,
                speed: null,
                eta: null,
              };
            }

            currentIndex = Math.max(currentIndex, doneItemIndex + 1);
            if (currentIndex < queueLocal.length) {
              queueLocal[currentIndex] = {
                ...queueLocal[currentIndex],
                status: "downloading",
                percent: 0,
              };
              setDownloadState((prev) => ({
                ...prev,
                percent: 0,
                itemPercent: 0,
                itemIndex: currentIndex,
                speed: null,
                eta: null,
                statusText: `Processing ${currentIndex + 1} of ${normalizedUrls.length}`,
              }));
            }

            setQueue([...queueLocal]);
          } else if (event.type === "item-error") {
            const failedItemIndex =
              Number.isInteger(event.itemIndex) && event.itemIndex >= 0
                ? event.itemIndex
                : currentIndex;
            failedItems += 1;

            if (queueLocal[failedItemIndex]) {
              queueLocal[failedItemIndex] = {
                ...queueLocal[failedItemIndex],
                status: "error",
                speed: null,
                eta: null,
              };
              setQueue([...queueLocal]);
            }

            pushToast(
              `Item ${failedItemIndex + 1} failed: ${event.message || "Download failed"}`,
              "error",
            );

            if (failedItemIndex >= currentIndex) {
              currentIndex = failedItemIndex + 1;
            }

            if (currentIndex < queueLocal.length) {
              queueLocal[currentIndex] = {
                ...queueLocal[currentIndex],
                status: "downloading",
                percent: 0,
              };
              setQueue([...queueLocal]);
              setDownloadState((prev) => ({
                ...prev,
                itemIndex: currentIndex,
                itemTotal: event.itemTotal || normalizedUrls.length,
                itemPercent: 0,
                speed: null,
                eta: null,
                statusText:
                  normalizedUrls.length > 1
                    ? `Processing ${currentIndex + 1} of ${normalizedUrls.length}`
                    : "Processing…",
              }));
            }
          } else if (event.type === "batch-complete") {
            batchSummary = event;
          } else if (event.type === "error") {
            if (!event.fatal && Number.isInteger(event.itemIndex)) {
              continue;
            }
            throw new Error(event.message || "Download failed");
          }
        }
      }

      setDownloadState({
        running: false,
        percent: 100,
        itemPercent: 100,
        itemIndex: Math.max(0, normalizedUrls.length - 1),
        itemTotal: normalizedUrls.length,
        speed: null,
        eta: null,
        statusText: "Done",
        done: true,
      });

      if (doneFiles.length === 0 && failedItems > 0) {
        pushToast(
          batchSummary
            ? `Batch finished with ${batchSummary.failed} failed item${batchSummary.failed === 1 ? "" : "s"}.`
            : `Batch finished with ${failedItems} failed item${failedItems === 1 ? "" : "s"}.`,
          "error",
        );
      } else if (failedItems > 0) {
        pushToast(
          batchSummary
            ? `Batch finished: ${batchSummary.completed} done, ${batchSummary.failed} failed.`
            : `Batch finished: ${doneFiles.length} done, ${failedItems} failed.`,
          "info",
        );
      } else if (doneFiles.length === 0) {
        pushToast(
          "Download finished but no file was returned by the server.",
          "error",
        );
      } else {
        pushToast(
          queueLocal.length > 1
            ? "All downloads complete"
            : "Download complete",
          "success",
        );
        notifyDesktop(
          queueLocal.length > 1
            ? "All downloads complete"
            : "Download complete",
          queueLocal.length > 1
            ? `${queueLocal.length} files finished`
            : doneFiles[0] || "Your file is ready",
        );
      }

      await loadHistory();
      setTimeout(() => {
        setDownloadState({
          running: false,
          percent: 0,
          itemPercent: 0,
          itemIndex: 0,
          itemTotal: 0,
          speed: null,
          eta: null,
          statusText: "Ready",
          done: false,
        });
      }, 2400);
    } catch (error) {
      if (error?.name === "AbortError") {
        setDownloadState({
          running: false,
          percent: 0,
          itemPercent: 0,
          itemIndex: 0,
          itemTotal: 0,
          speed: null,
          eta: null,
          statusText: "Canceled",
          done: false,
        });
        pushToast(
          "Download stream canceled in UI. Server may continue processing the current item.",
          "info",
        );
        return;
      }

      if (queueLocal[currentIndex]) {
        queueLocal[currentIndex] = {
          ...queueLocal[currentIndex],
          status: "error",
        };
        setQueue([...queueLocal]);
      }

      setDownloadState({
        running: false,
        percent: 0,
        itemPercent: 0,
        itemIndex: 0,
        itemTotal: 0,
        speed: null,
        eta: null,
        statusText: "Failed",
        done: false,
      });
      if (!batchMode) {
        setUrlError(error.message || "Download failed");
      }
      pushToast(error.message || "Download failed", "error");
    } finally {
      activeDownloadControllerRef.current = null;
    }
  }

  function cancelDownload() {
    if (activeDownloadControllerRef.current) {
      activeDownloadControllerRef.current.abort();
    }
  }

  async function loadHistory(force = false) {
    if (!force && !isAuthenticated) {
      setHistory([]);
      return;
    }
    try {
      const response = await fetch("/api/history");
      if (response.status === 401) {
        setAuthUser(null);
        setHistory([]);
        return;
      }
      const entries = await response.json();
      setHistory(Array.isArray(entries) ? entries : []);
    } catch (_) {
      pushToast("Could not load history", "error");
      setHistory([]);
    }
  }

  async function deleteHistoryEntry(id) {
    try {
      await fetch(`/api/history/${id}`, { method: "DELETE" });
      await loadHistory();
      pushToast("Removed from history", "success");
    } catch {
      pushToast("Could not delete", "error");
    }
  }

  async function clearHistory() {
    if (!window.confirm("Clear all history? This cannot be undone.")) return;
    try {
      await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      await loadHistory();
      pushToast("History cleared", "success");
    } catch {
      pushToast("Could not clear history", "error");
    }
  }

  async function redownloadFromHistory(entry) {
    setTab("download");
    setActivePresetId(entry.presetId || "");
    setUrl(entry.url || "");
    setFormat(entry.format || "mp4");
    setQuality(entry.quality || "best");
    setAudioBitrate(entry.audioBitrate || "");
    setSubtitleLangs(entry.subtitleLangs || "all");
    setSubtitleMode(entry.subtitleMode || "separate");
    setFilenameTemplate(entry.filenameTemplate || "");
    setSubtitles(Boolean(entry.subtitles));
    setRemoveWatermark(Boolean(entry.removeWatermark));
    setIsPlaylist(Boolean(entry.isPlaylist));
    setInfo({
      title: entry.title,
      site: entry.site || "unknown",
      uploader: entry.uploader || "",
      thumbnail: entry.thumbnail || "",
    });

    await startDownload({
      urls: [entry.url],
      titles: [entry.title || "Unknown"],
      uploaders: [entry.uploader || ""],
      thumbnails: [entry.thumbnail || ""],
      presetId: entry.presetId || undefined,
      presetName: entry.presetName || undefined,
      format: entry.format || "mp4",
      quality: entry.quality || "best",
      audioBitrate: entry.audioBitrate || "",
      subtitleLangs: entry.subtitleLangs || "all",
      subtitleMode: entry.subtitleMode || "separate",
      filenameTemplate: entry.filenameTemplate || "",
      subtitles: Boolean(entry.subtitles),
      removeWatermark: Boolean(entry.removeWatermark),
      isPlaylist: Boolean(entry.isPlaylist),
      embedSubtitles: false,
      startTime: "",
      endTime: "",
      limitRate: "",
    });
  }

  const subtitleNote = !subtitlesSupported
    ? "Subtitle download is available for YouTube only."
    : format === "mp3"
      ? "Switch to MP4 if you want subtitles embedded into the final file."
      : subtitleLangs === "all"
        ? "FluxDL will auto-detect and download every available subtitle language."
        : info?.hasSubtitles
          ? "Uploaded subtitles or automatic captions will be downloaded when available."
          : "This video may only have automatic captions. FluxDL will try those too.";

  const subtitleLanguageList = Array.isArray(info?.subtitleLanguages)
    ? info.subtitleLanguages
    : [];
  const selectedSubtitleLanguages = subtitleLangs
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== "all");

  return html`
    <div className="min-h-screen text-zinc-100 dark:text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
        <header
          className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-panel backdrop-blur"
        >
          <div
            className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
          >
            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-full border border-flux-500/40 bg-flux-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-flux-100"
                >Production workflow</span
              >
              <span
                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-200"
                >Windows-friendly MP4</span
              >
              <span
                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-200"
                >Subtitle-safe workflow</span
              >
            </div>

            <div
              className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto"
            >
              ${authLoading
                ? html`<span
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400"
                  >
                    Checking session...
                  </span>`
                : isAuthenticated
                  ? html`<div ref=${accountMenuRef} className="relative">
                      <button
                        onClick=${() => setAccountMenuOpen((prev) => !prev)}
                        className="flex max-w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-500"
                        aria-expanded=${accountMenuOpen}
                        aria-label="Open profile menu"
                      >
                        ${showProfilePhoto
                          ? html`<img
                              src=${authUser.photo}
                              alt=${accountLabel}
                              onError=${() => setProfilePhotoErrored(true)}
                              referrerpolicy="no-referrer"
                              loading="lazy"
                              className="h-8 w-8 rounded-full border border-zinc-700 object-cover"
                            />`
                          : html`<span
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200"
                            >
                              ${accountInitials || "U"}
                            </span>`}
                        <div className="min-w-0">
                          <p
                            className="max-w-[150px] truncate text-sm font-medium text-zinc-100 sm:max-w-[180px]"
                          >
                            ${accountLabel}
                          </p>
                          <p
                            className="max-w-[150px] truncate text-xs text-zinc-400 sm:max-w-[180px]"
                          >
                            ${authUser?.email || "Google account"}
                          </p>
                        </div>
                        <span
                          className="text-xs text-zinc-500"
                          aria-hidden="true"
                          >▾</span
                        >
                      </button>
                      ${accountMenuOpen
                        ? html`<div
                            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-64 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur"
                          >
                            <p
                              className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                            >
                              Signed in
                            </p>
                            <p
                              className="mt-2 truncate text-sm font-semibold text-zinc-100"
                            >
                              ${accountLabel}
                            </p>
                            <p className="truncate text-xs text-zinc-400">
                              ${authUser?.email || "Google account"}
                            </p>
                            <button
                              onClick=${() => {
                                setAccountMenuOpen(false);
                                signOut();
                              }}
                              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
                            >
                              Sign out
                            </button>
                          </div>`
                        : null}
                    </div>`
                  : html`<button
                      onClick=${signInWithGoogle}
                      className="rounded-xl bg-flux-500 px-3 py-2 text-sm font-semibold text-white hover:bg-flux-400"
                    >
                      Sign in with Google
                    </button>`}
              <button
                onClick=${() =>
                  setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                title=${theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"}
                aria-label=${theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-200 hover:border-zinc-500"
              >
                <span aria-hidden="true"
                  >${theme === "dark" ? "☀️" : "🌙"}</span
                >
              </button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500"
              >
                Professional media toolkit
              </p>
              <h1
                className="mb-3 font-mono text-4xl font-semibold uppercase tracking-[0.18em] text-white sm:text-6xl"
              >
                FluxDL
              </h1>
              <p className="max-w-2xl text-sm text-zinc-300 sm:text-base">
                Download video, audio and subtitles with cleaner defaults, queue
                tracking, and a real product-grade workflow.
              </p>
            </div>

            <div className="grid gap-3">
              <div
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
              >
                <p
                  className="mb-1 text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Optimized for
                </p>
                <strong className="text-zinc-100"
                  >YouTube, Spotify, TikTok</strong
                >
              </div>
              <div
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
              >
                <p
                  className="mb-1 text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Output
                </p>
                <strong className="text-zinc-100">AAC-ready MP4 and MP3</strong>
              </div>
              <div
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
              >
                <p
                  className="mb-1 text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Runtime
                </p>
                <strong className="text-zinc-100"
                  >Local + cloud deployment ready</strong
                >
              </div>
            </div>
          </div>

          ${isAuthenticated
            ? html`<div className="mt-4 flex flex-wrap justify-end gap-2">
                ${canOpenDownloads
                  ? html`<button
                      onClick=${openDownloadsFolder}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
                    >
                      Open downloads folder
                    </button>`
                  : null}
                <button
                  onClick=${() => {
                    if (!logsExpanded) {
                      refreshLogs();
                    }
                    setLogsExpanded((prev) => !prev);
                  }}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
                >
                  ${logsExpanded ? "Hide live logs" : "Live logs"}
                </button>
              </div>`
            : null}
        </header>

        <nav className="mb-5 flex gap-2 overflow-x-auto pb-1">
          ${[
            { id: "download", label: "Download" },
            {
              id: "queue",
              label: `Queue${queueBadge ? ` (${queueBadge})` : ""}`,
            },
            { id: "history", label: "History" },
          ].map(
            (item) =>
              html`<button
                key=${item.id}
                onClick=${() => setTab(item.id)}
                className=${`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  tab === item.id
                    ? "border-flux-500 bg-flux-500/20 text-flux-100"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                ${item.label}
              </button>`,
          )}
        </nav>

        ${!authLoading && !isAuthenticated
          ? html`<div
              className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"
            >
              <p className="text-sm text-amber-200">
                Sign in with Google to use downloads, queue, history, and synced
                workflow features.
              </p>
            </div>`
          : null}
        ${tab === "download" &&
        html`<section className="mx-auto flex max-w-[660px] flex-col gap-4">
          <div className="space-y-5">
            <div
              className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-panel"
            >
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
              >
                Start a new download
              </p>
              <h2 className="text-xl font-semibold text-zinc-100">
                Paste a link and shape the output
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                Fast link detection, better subtitle controls and cleaner MP4
                defaults.
              </p>

              <div
                className=${`mt-5 space-y-3 rounded-2xl border p-3 transition ${
                  dragActive
                    ? "border-flux-500 bg-flux-500/10"
                    : "border-transparent"
                }`}
                onDrop=${(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  const text = event.dataTransfer?.getData("text") || "";
                  const match = text.match(URL_PATTERN);
                  if (!match) return;
                  if (batchMode) {
                    setBatchInput((prev) => `${prev}\n${match[0]}`.trim());
                  } else {
                    setUrl(match[0]);
                    fetchInfo(match[0]);
                  }
                }}
                onDragOver=${(event) => {
                  event.preventDefault();
                  if (!dragActive) setDragActive(true);
                }}
                onDragLeave=${() => setDragActive(false)}
              >
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value=${url}
                    onInput=${(event) => setUrl(event.target.value)}
                    onKeyDown=${(event) =>
                      !batchMode && event.key === "Enter" && fetchInfo()}
                    placeholder=${batchMode
                      ? "Batch mode enabled — add URLs in the batch list"
                      : "Paste video or playlist URL..."}
                    disabled=${batchMode}
                    className="h-12 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none ring-flux-500 placeholder:text-zinc-500 focus:ring-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick=${() => fetchInfo()}
                      disabled=${isFetching || batchMode}
                      className="h-12 rounded-xl bg-flux-500 px-5 text-sm font-semibold uppercase tracking-wider text-white hover:bg-flux-400 disabled:opacity-60"
                    >
                      ${isFetching ? "Loading…" : "Fetch"}
                    </button>
                  </div>
                </div>
                ${batchMode
                  ? html`<p className="text-xs text-zinc-500">
                      Batch mode active · ${batchParsedUrls.length}
                      URL${batchParsedUrls.length === 1 ? "" : "s"} ready.
                    </p>`
                  : urlError
                    ? html`<p className="text-sm text-rose-400">${urlError}</p>`
                    : html`<p className="text-xs text-zinc-500">
                        Drag a link here or paste with Ctrl+V · Enter to fetch
                      </p>`}
              </div>
            </div>

            ${batchMode
              ? html`<section
                  className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
                >
                  <div
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p
                        className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
                      >
                        Batch preview
                      </p>
                      <h3 className="text-lg font-semibold text-zinc-100">
                        Review items before starting
                      </h3>
                      <p className="mt-1 text-sm text-zinc-400">
                        Titles, uploaders, thumbnails and basic metadata are
                        loaded before download.
                      </p>
                    </div>
                    <button
                      onClick=${() => loadBatchPreview(batchParsedUrls)}
                      disabled=${batchParsedUrls.length === 0 ||
                      batchPreviewLoading}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
                    >
                      ${batchPreviewLoading
                        ? "Refreshing..."
                        : "Refresh preview"}
                    </button>
                  </div>

                  <div
                    className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500"
                  >
                    <span>
                      ${batchParsedUrls.length}
                      item${batchParsedUrls.length === 1 ? "" : "s"} in batch
                    </span>
                    ${batchPreviewProgress.total > 0
                      ? html`<span>
                          Previewed
                          ${batchPreviewProgress.done}/${batchPreviewProgress.total}
                        </span>`
                      : null}
                  </div>

                  ${batchPreviewError
                    ? html`<p className="mt-3 text-sm text-amber-300">
                        ${batchPreviewError}
                      </p>`
                    : null}
                  ${batchParsedUrls.length === 0
                    ? html`<p
                        className="mt-4 rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-500"
                      >
                        Add URLs in batch mode to generate a preview list.
                      </p>`
                    : batchPreviewItems.length === 0 && batchPreviewLoading
                      ? html`<p className="mt-4 text-sm text-zinc-400">
                          Building preview list...
                        </p>`
                      : html`<div className="mt-4 space-y-3">
                          ${batchPreviewItems.map(
                            (item, index) =>
                              html`<article
                                key=${item.url}
                                className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 sm:flex-row"
                              >
                                <img
                                  src=${item.thumbnail || DEFAULT_THUMBNAIL}
                                  alt=${item.title || `Preview ${index + 1}`}
                                  className="h-28 w-full rounded-xl object-cover sm:h-20 sm:w-32"
                                />
                                <div className="min-w-0 flex-1">
                                  <div
                                    className="mb-1 flex flex-wrap items-center gap-2"
                                  >
                                    <span
                                      className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300"
                                    >
                                      ${SITE_LABELS[item.site] ||
                                      SITE_LABELS.unknown}
                                    </span>
                                    <span
                                      className=${`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                                        item.status === "error"
                                          ? "bg-rose-500/15 text-rose-300"
                                          : "bg-emerald-500/15 text-emerald-300"
                                      }`}
                                    >
                                      ${item.status}
                                    </span>
                                  </div>
                                  <h4
                                    className="line-clamp-2 text-sm font-semibold text-zinc-100 sm:text-base"
                                  >
                                    ${item.title || `Item ${index + 1}`}
                                  </h4>
                                  <p className="mt-1 text-sm text-zinc-400">
                                    ${item.uploader || "Unknown uploader"}
                                    ${item.duration != null
                                      ? ` · ${formatDuration(item.duration)}`
                                      : ""}
                                  </p>
                                  ${item.error
                                    ? html`<p
                                        className="mt-1 text-xs text-rose-400"
                                      >
                                        ${item.error}
                                      </p>`
                                    : html`<p
                                        className="mt-1 truncate text-xs text-zinc-500"
                                      >
                                        ${item.url}
                                      </p>`}
                                </div>
                              </article>`,
                          )}
                        </div>`}
                </section>`
              : null}
            ${info &&
            html`<article
              className="flex flex-col gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel sm:flex-row"
            >
              <img
                src=${info.thumbnail || DEFAULT_THUMBNAIL}
                alt=${info.title || "Media thumbnail"}
                className="h-36 w-full rounded-2xl object-cover sm:h-24 sm:w-44"
              />
              <div className="min-w-0 flex-1">
                <p
                  className="mb-1 inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-300"
                >
                  ${SITE_LABELS[info.site] || SITE_LABELS.unknown}
                </p>
                <h3
                  className="line-clamp-2 text-sm font-semibold text-zinc-100 sm:text-base"
                >
                  ${info.title || "Unknown"}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  ${info.uploader || "—"} · ${formatDuration(info.duration)}
                </p>
              </div>
            </article>`}
            ${contentSuggestion && !activePreset
              ? html`<section
                  className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"
                >
                  <div
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-emerald-200">
                        Smart content suggestion
                      </p>
                      <p className="text-xs text-emerald-100/90">
                        ${contentSuggestion.message}
                      </p>
                    </div>
                    <button
                      onClick=${() => applyPreset(contentSuggestion.id)}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-emerald-400"
                    >
                      Apply suggestion
                    </button>
                  </div>
                </section>`
              : null}
            ${info?.isPlaylist
              ? html`<section
                  className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
                >
                  <div
                    className="mb-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <p
                        className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500"
                      >
                        Playlist smart filter
                      </p>
                      <p className="text-sm text-zinc-300">
                        Load items, uncheck what you don't want, and download
                        only selected videos.
                      </p>
                    </div>
                    <button
                      onClick=${() => loadPlaylistItems(url)}
                      disabled=${playlistLoading}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
                    >
                      ${playlistLoading ? "Loading..." : "Load playlist items"}
                    </button>
                  </div>

                  ${playlistItems.length > 0
                    ? html`<div>
                        <div
                          className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"
                        >
                          <span
                            >${selectedPlaylistItems.length}/${playlistItems.length}
                            selected</span
                          >
                          <div className="flex gap-2">
                            <button
                              onClick=${() =>
                                setPlaylistSelected(
                                  Object.fromEntries(
                                    playlistItems.map((item) => [
                                      item.url,
                                      true,
                                    ]),
                                  ),
                                )}
                              className="rounded border border-zinc-700 px-2 py-1 hover:border-zinc-500"
                            >
                              Select all
                            </button>
                            <button
                              onClick=${() =>
                                setPlaylistSelected(
                                  Object.fromEntries(
                                    playlistItems.map((item) => [
                                      item.url,
                                      false,
                                    ]),
                                  ),
                                )}
                              className="rounded border border-zinc-700 px-2 py-1 hover:border-zinc-500"
                            >
                              Deselect all
                            </button>
                          </div>
                        </div>
                        <div
                          className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-2"
                        >
                          ${playlistItems.map(
                            (item) =>
                              html`<label
                                key=${item.url}
                                className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked=${Object.prototype.hasOwnProperty.call(
                                    playlistSelected,
                                    item.url,
                                  )
                                    ? Boolean(playlistSelected[item.url])
                                    : true}
                                  onChange=${(event) =>
                                    setPlaylistSelected((prev) => ({
                                      ...prev,
                                      [item.url]: event.target.checked,
                                    }))}
                                  className="mt-1 h-4 w-4 accent-flux-500"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-zinc-200">
                                    ${item.title || "Untitled"}
                                  </p>
                                  <p className="truncate text-xs text-zinc-500">
                                    ${item.uploader || "Unknown uploader"}
                                  </p>
                                </div>
                              </label>`,
                          )}
                        </div>
                      </div>`
                    : html`<p className="text-xs text-zinc-500">
                        Works for YouTube playlists and TikTok profile URLs
                        (e.g. tiktok.com/@username).
                      </p>`}
                </section>`
              : null}
            ${spotifyMode
              ? html`<section
                  className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-300"
                    >
                      Spotify match
                    </span>
                    <p className="text-xs text-zinc-400">
                      Pick the best YouTube source before download.
                    </p>
                  </div>

                  ${spotifyCandidatesLoading
                    ? html`<p className="text-sm text-zinc-400">
                        Finding best matches for this Spotify track...
                      </p>`
                    : spotifyCandidates.length === 0 && spotifyCandidatesLoaded
                      ? html`<p className="text-sm text-amber-300">
                          No auto matches found. Paste a YouTube URL below to
                          continue.
                        </p>`
                      : null}
                  ${spotifyCandidates.length > 0
                    ? html`<div className="space-y-2">
                          ${spotifyCandidates
                            .slice(0, spotifyShowCount)
                            .map((candidate) => {
                              const active =
                                spotifyCandidateUrl === candidate.url;
                              const confidence = String(
                                candidate.confidence || "low",
                              );
                              const confidenceClass =
                                confidence === "high"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : confidence === "medium"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                    : "border-zinc-700 bg-zinc-900/60 text-zinc-300";
                              return html`<button
                                key=${candidate.url}
                                onClick=${() =>
                                  setSpotifyCandidateUrl(candidate.url)}
                                className=${`w-full rounded-xl border p-3 text-left transition ${
                                  active
                                    ? "border-flux-500 bg-flux-500/10"
                                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                                }`}
                              >
                                <div
                                  className="mb-1 flex flex-wrap items-center gap-2"
                                >
                                  <span
                                    className="truncate text-sm font-semibold text-zinc-100"
                                  >
                                    ${candidate.title || "Untitled"}
                                  </span>
                                  ${candidate.recommended
                                    ? html`<span
                                        className="rounded-full border border-flux-500/40 bg-flux-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-flux-100"
                                        >recommended</span
                                      >`
                                    : null}
                                  <span
                                    className=${`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${confidenceClass}`}
                                  >
                                    ${confidence}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-400">
                                  ${candidate.uploader || "Unknown"} ·
                                  ${formatDuration(candidate.duration)} · score
                                  ${candidate.score ?? "—"}
                                  ${candidate.durationDiff != null
                                    ? ` · Δ ${candidate.durationDiff}s`
                                    : ""}
                                </p>
                              </button>`;
                            })}
                        </div>
                        ${spotifyShowCount < spotifyCandidates.length
                          ? html`<button
                              onClick=${() =>
                                setSpotifyShowCount((prev) =>
                                  Math.min(prev + 10, spotifyCandidates.length),
                                )}
                              className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-zinc-500"
                            >
                              Show more matches
                              (${spotifyCandidates.length - spotifyShowCount}
                              left)
                            </button>`
                          : null}`
                    : null}

                  <div className="mt-3">
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                      >Manual YouTube URL override</label
                    >
                    <input
                      value=${spotifyCustomUrl}
                      onInput=${(event) =>
                        setSpotifyCustomUrl(event.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    />
                  </div>
                </section>`
              : null}
          </div>

          <aside
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-panel"
          >
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
            >
              Output setup
            </p>
            <h3 className="text-lg font-semibold text-zinc-100">
              Format, quality and advanced controls
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              Professional defaults for speed, with deeper control when needed.
            </p>

            <div className="mt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p
                  className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500"
                >
                  Workflow presets
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick=${openPresetCreateFromCurrent}
                    className="text-xs font-semibold uppercase tracking-wide text-flux-200 hover:text-flux-100"
                  >
                    + Custom preset
                  </button>
                  ${activePreset
                    ? html`<button
                        onClick=${clearPresetSelection}
                        className="text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
                      >
                        Clear preset
                      </button>`
                    : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                ${allPresetCards.map(
                  (preset) =>
                    html`<button
                      key=${preset.id}
                      onClick=${() => applyPreset(preset.id)}
                      onContextMenu=${(event) => {
                        event.preventDefault();
                        openPresetEditor(preset);
                      }}
                      className=${`rounded-2xl border p-4 text-left transition ${
                        activePresetId === preset.id
                          ? "border-flux-500 bg-flux-500/10 shadow-lg shadow-flux-500/10"
                          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                      }`}
                    >
                      <div className="mb-3 flex items-start gap-3">
                        <span className="text-2xl" aria-hidden="true"
                          >${preset.icon}</span
                        >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="text-sm font-semibold text-zinc-100"
                            >
                              ${preset.name}
                            </span>
                            ${activePresetId === preset.id
                              ? html`<span
                                  className="rounded-full border border-flux-500/40 bg-flux-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-flux-100"
                                >
                                  active
                                </span>`
                              : null}
                          </div>
                          <p className="mt-1 text-xs text-zinc-400">
                            ${preset.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        ${preset.bullets.map(
                          (bullet) =>
                            html`<span
                              key=${bullet}
                              className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300"
                            >
                              ${bullet}
                            </span>`,
                        )}
                      </div>
                    </button>`,
                )}
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Tip: right-click any preset card to edit its defaults.
              </p>
            </div>

            ${activePreset
              ? html`<div
                  className="mt-4 rounded-2xl border border-flux-500/30 bg-flux-500/10 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-flux-100">
                      ${activePreset.icon} ${activePreset.name} applied
                    </span>
                    <span
                      className="rounded-full border border-flux-500/30 bg-flux-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-flux-100"
                    >
                      editable below
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-flux-50/90">
                    This workflow filled the form for you. You can still
                    customize any option below before downloading.
                  </p>
                </div>`
              : null}
            ${presetEditorOpen && presetDraft
              ? html`<div
                  className="mt-4 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4"
                >
                  <div
                    className="mb-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <p className="text-sm font-semibold text-zinc-100">
                      ${presetEditorMode === "create"
                        ? "Create custom preset"
                        : "Edit preset defaults"}
                    </p>
                    <div className="flex items-center gap-2">
                      ${presetEditorMode === "edit"
                        ? html`<button
                            onClick=${deleteEditingPreset}
                            className="rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300 hover:border-rose-400 hover:text-rose-300"
                          >
                            ${BUILTIN_PRESET_CARDS.some(
                              (preset) => preset.id === presetDraft.id,
                            )
                              ? "Reset"
                              : "Delete"}
                          </button>`
                        : null}
                      <button
                        onClick=${closePresetEditor}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value=${presetDraft.name}
                      onInput=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))}
                      placeholder="Preset name"
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    />
                    <input
                      value=${presetDraft.icon}
                      onInput=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          icon: event.target.value,
                        }))}
                      placeholder="Icon (emoji)"
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    />
                    <input
                      value=${presetDraft.description}
                      onInput=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))}
                      placeholder="Short description"
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 sm:col-span-2"
                    />
                    <input
                      value=${presetDraft.bulletsText}
                      onInput=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          bulletsText: event.target.value,
                        }))}
                      placeholder="Bullets (use | separator)"
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 sm:col-span-2"
                    />
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <select
                      value=${presetDraft.settings.format}
                      onChange=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            format: event.target.value,
                          },
                        }))}
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="mp4">MP4</option>
                      <option value="mp3">MP3</option>
                    </select>
                    <select
                      value=${presetDraft.settings.audioBitrate || ""}
                      onChange=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            audioBitrate: event.target.value,
                          },
                        }))}
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="">Best bitrate</option>
                      <option value="320">320 kbps</option>
                      <option value="256">256 kbps</option>
                      <option value="192">192 kbps</option>
                      <option value="128">128 kbps</option>
                    </select>
                    <input
                      value=${presetDraft.settings.filenameTemplate || ""}
                      onInput=${(event) =>
                        setPresetDraft((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            filenameTemplate: event.target.value,
                          },
                        }))}
                      placeholder="Filename template"
                      className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 sm:col-span-2"
                    />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    ${[
                      ["subtitles", "Enable subtitles"],
                      ["batchMode", "Enable batch mode"],
                      ["removeWatermark", "Enable no watermark"],
                      ["isPlaylist", "Enable playlist mode"],
                    ].map(
                      ([field, label]) =>
                        html`<label
                          key=${field}
                          className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"
                        >
                          <input
                            type="checkbox"
                            checked=${Boolean(presetDraft.settings?.[field])}
                            onChange=${(event) =>
                              setPresetDraft((prev) => ({
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  [field]: event.target.checked,
                                },
                              }))}
                            className="h-4 w-4 accent-flux-500"
                          />
                          ${label}
                        </label>`,
                    )}
                  </div>

                  <button
                    onClick=${savePresetDraft}
                    className="mt-4 w-full rounded-xl bg-flux-500 px-4 py-2 text-sm font-semibold text-white hover:bg-flux-400"
                  >
                    Save preset
                  </button>
                </div>`
              : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3"
              >
                <label
                  className="mb-2 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                  >Format</label
                >
                <div className="grid grid-cols-2 gap-2">
                  ${(spotifyMode ? ["mp3"] : ["mp4", "mp3"]).map(
                    (item) =>
                      html`<button
                        key=${item}
                        onClick=${() => {
                          userTweaksRef.current.format = true;
                          setFormat(item);
                        }}
                        className=${`rounded-lg border px-3 py-2 text-sm font-semibold uppercase ${
                          format === item
                            ? "border-flux-500 bg-flux-500/20 text-flux-100"
                            : "border-zinc-700 bg-zinc-900 text-zinc-300"
                        }`}
                      >
                        ${item}
                      </button>`,
                  )}
                </div>
                ${spotifyMode
                  ? html`<p className="mt-2 text-xs text-zinc-500">
                      Spotify is audio-only here. We resolve the track to a
                      matching YouTube audio source.
                    </p>`
                  : null}
              </div>

              ${!audioOnly &&
              html`<div
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3"
              >
                <label
                  className="mb-2 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                  >Quality</label
                >
                <select
                  value=${quality}
                  onChange=${(event) => {
                    userTweaksRef.current.quality = true;
                    setQuality(event.target.value);
                  }}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                >
                  ${qualityOptions.map(
                    (item) =>
                      html`<option key=${item} value=${item}>
                        ${item === "best" ? "Best available" : `${item}p`}
                      </option>`,
                  )}
                </select>
              </div>`}
            </div>

            <details
              className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3"
            >
              <summary
                className="cursor-pointer text-sm font-semibold text-zinc-200"
              >
                Advanced controls
              </summary>
              <div className="mt-4 space-y-4">
                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                >
                  <label
                    className="mb-3 flex items-center gap-2 text-sm text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked=${smartDefaults}
                      onChange=${(event) =>
                        setSmartDefaults(event.target.checked)}
                      className="h-4 w-4 accent-flux-500"
                    />
                    Smart defaults
                  </label>
                  <label
                    className="flex items-center gap-2 text-sm text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked=${batchMode}
                      onChange=${(event) => {
                        setBatchMode(event.target.checked);
                        if (event.target.checked) {
                          setUrlError("");
                          setUrl("");
                          setInfo(null);
                        }
                      }}
                      className="h-4 w-4 accent-flux-500"
                    />
                    Batch mode (one URL per line)
                  </label>
                  ${batchMode &&
                  html`<textarea
                    value=${batchInput}
                    onInput=${(event) => setBatchInput(event.target.value)}
                    rows="4"
                    placeholder="Paste multiple URLs, one per line..."
                    className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                  ></textarea>`}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  ${format === "mp3" &&
                  html`<div>
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                      >Bitrate</label
                    >
                    <select
                      value=${audioBitrate}
                      onChange=${(event) => setAudioBitrate(event.target.value)}
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="">Best</option>
                      <option value="320">320 kbps</option>
                      <option value="256">256 kbps</option>
                      <option value="192">192 kbps</option>
                      <option value="128">128 kbps</option>
                    </select>
                  </div>`}

                  <div>
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                      >Speed limit</label
                    >
                    <select
                      value=${limitRate}
                      onChange=${(event) => setLimitRate(event.target.value)}
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="">Unlimited</option>
                      <option value="1M">1 MB/s</option>
                      <option value="2M">2 MB/s</option>
                      <option value="5M">5 MB/s</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                    >Filename template</label
                  >
                  <input
                    value=${filenameTemplate}
                    onInput=${(event) =>
                      setFilenameTemplate(event.target.value)}
                    placeholder="%(title)s - %(uploader)s.%(ext)s"
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                      >Output mode</label
                    >
                    <select
                      value=${outputMode}
                      onChange=${(event) => setOutputMode(event.target.value)}
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="normal">Normal</option>
                      <option value="gif">Convert to GIF</option>
                      <option value="compress">Compress MP4</option>
                    </select>
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                      >Smart auto-folder</label
                    >
                    <select
                      value=${autoFolderMode}
                      onChange=${(event) =>
                        setAutoFolderMode(event.target.value)}
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                    >
                      <option value="off">Off</option>
                      <option value="site">By site</option>
                      <option value="type">By media type</option>
                      <option value="site_type">By site + type</option>
                    </select>
                  </div>
                </div>

                ${outputMode === "gif"
                  ? html`<div
                      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"
                    >
                      <div>
                        <label
                          className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                          >GIF FPS</label
                        >
                        <input
                          type="number"
                          min="5"
                          max="30"
                          value=${gifFps}
                          onInput=${(event) => setGifFps(event.target.value)}
                          className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                        />
                      </div>
                      <div>
                        <label
                          className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                          >GIF scale width</label
                        >
                        <input
                          type="number"
                          min="120"
                          max="1920"
                          value=${gifResolution}
                          onInput=${(event) =>
                            setGifResolution(event.target.value)}
                          className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                        />
                      </div>
                    </div>`
                  : null}
                ${outputMode === "compress"
                  ? html`<div>
                      <label
                        className="mb-1 block text-xs uppercase tracking-[0.15em] text-zinc-500"
                        >Compression CRF</label
                      >
                      <input
                        type="number"
                        min="18"
                        max="35"
                        value=${compressCrf}
                        onInput=${(event) => setCompressCrf(event.target.value)}
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                      />
                      <p className="mt-1 text-xs text-zinc-500">
                        Lower CRF = larger file with higher quality.
                      </p>
                    </div>`
                  : null}

                <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
                  <input
                    value=${startTime}
                    onInput=${(event) => setStartTime(event.target.value)}
                    placeholder="Start (0:30)"
                    className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  />
                  <span className="self-center text-xs text-zinc-500">to</span>
                  <input
                    value=${endTime}
                    onInput=${(event) => setEndTime(event.target.value)}
                    placeholder="End (3:45)"
                    className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  />
                </div>

                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                >
                  <p
                    className="mb-2 text-xs uppercase tracking-[0.15em] text-zinc-500"
                  >
                    Subtitles and extras
                  </p>
                  <p className="mb-3 text-xs text-zinc-500">${subtitleNote}</p>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    ${subtitlesSupported &&
                    html`<label
                      className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        checked=${subtitles}
                        onChange=${(event) => {
                          userTweaksRef.current.subtitles = true;
                          setSubtitles(event.target.checked);
                          setSubtitleLangs(
                            event.target.checked
                              ? pickPreferredSubtitleSelection(
                                  subtitleLanguageList,
                                )
                              : "",
                          );
                        }}
                        className="h-4 w-4 accent-flux-500"
                      />
                      Download subtitles
                    </label>`}
                    ${subtitlesSupported &&
                    subtitles &&
                    (subtitleLanguageList.length === 0
                      ? html`<p className="text-xs text-zinc-500">
                          No subtitle languages were exposed by the source for
                          this video.
                        </p>`
                      : html`<div
                          className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400"
                        >
                          Selected:
                          ${selectedSubtitleLanguages.join(", ") || "none"}
                        </div>`)}
                    ${subtitlesSupported &&
                    subtitles &&
                    subtitleLanguageList.length > 0 &&
                    html`<div
                      className="max-h-44 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2"
                    >
                      <div className="flex flex-wrap gap-2">
                        ${subtitleLanguageList.map(
                          (lang) =>
                            html`<button
                              key=${lang}
                              onClick=${() => toggleSubtitleLanguage(lang)}
                              className=${`rounded-full border px-3 py-1 text-xs font-semibold ${
                                selectedSubtitleLanguages.includes(lang)
                                  ? "border-flux-500 bg-flux-500/20 text-flux-100"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
                              }`}
                            >
                              ${lang}
                            </button>`,
                        )}
                      </div>
                    </div>`}
                    ${subtitlesSupported &&
                    subtitles &&
                    embeddableSubtitles &&
                    html`<div className="grid gap-2">
                      <label
                        className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                        >Subtitle mode</label
                      >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        ${[
                          ["separate", "Separate files"],
                          ["soft", "Soft embed"],
                          ["hard", "Hard burn-in"],
                        ].map(
                          ([value, label]) =>
                            html`<button
                              key=${value}
                              onClick=${() => setSubtitleMode(value)}
                              className=${`h-12 rounded-lg border px-3 text-center text-sm font-semibold ${
                                subtitleMode === value
                                  ? "border-flux-500 bg-flux-500/20 text-flux-100"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
                              }`}
                            >
                              ${label}
                            </button>`,
                        )}
                      </div>
                    </div>`}
                    ${showNoWatermarkOption &&
                    html`<label
                      className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        checked=${removeWatermark}
                        onChange=${(event) =>
                          setRemoveWatermark(event.target.checked)}
                        className="h-4 w-4 accent-flux-500"
                      />
                      ${batchMode
                        ? "No watermark (TikTok links only)"
                        : "No watermark"}
                    </label>`}
                    ${(site === "youtube" || site === "spotify") &&
                    html`<label
                      className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        checked=${isPlaylist}
                        onChange=${(event) => {
                          userTweaksRef.current.playlist = true;
                          setIsPlaylist(event.target.checked);
                        }}
                        className="h-4 w-4 accent-flux-500"
                      />
                      Full playlist / channel uploads
                    </label>`}
                  </div>
                </div>
              </div>
            </details>
          </aside>

          <button
            onClick=${() => startDownload()}
            disabled=${downloadDisabled}
            className=${`relative h-14 w-full overflow-hidden rounded-2xl border text-sm font-bold uppercase tracking-[0.15em] transition ${
              downloadState.done
                ? "border-emerald-500/40 bg-emerald-600 text-white"
                : "border-zinc-700 bg-zinc-900 text-white"
            } ${downloadDisabled ? "opacity-60" : "hover:border-zinc-500"}`}
          >
            ${downloadState.running &&
            html`<span
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-flux-700 via-flux-500 to-flux-500"
              style=${{ width: `${downloadState.percent}%` }}
            ></span>`}
            <span
              className="relative z-10 flex items-center justify-center gap-3"
            >
              ${downloadState.running
                ? html`<span>${downloadState.statusText}</span>
                    <span>${downloadState.itemPercent}%</span>`
                : downloadState.done
                  ? "Done"
                  : spotifyMode && spotifyCandidatesLoading
                    ? "Matching source..."
                    : spotifyMode &&
                        !spotifyCustomUrl.trim() &&
                        !spotifyCandidateUrl
                      ? "Select source first"
                      : "Start download"}
            </span>
          </button>

          ${downloadState.running
            ? html`<div
                className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-3"
              >
                <span>
                  Item:
                  ${downloadState.itemTotal
                    ? `${downloadState.itemIndex + 1}/${downloadState.itemTotal}`
                    : "—"}
                </span>
                <span>Speed: ${downloadState.speed || "—"}</span>
                <span>ETA: ${downloadState.eta || "—"}</span>
              </div>`
            : null}
          ${downloadState.running
            ? html`<button
                onClick=${cancelDownload}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
              >
                Cancel stream
              </button>`
            : null}
        </section>`}
        ${tab === "queue" &&
        html` <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
          >
            <h2 className="text-lg font-semibold text-zinc-100">
              Queue dashboard
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Track active items, completions and failures in one place.
            </p>
            <div
              className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
            >
              <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">
                Parallel limit
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value=${String(queueConcurrency)}
                  onChange=${(event) =>
                    saveQueueConcurrency(Number(event.target.value))}
                  disabled=${queueConcurrencySaving}
                  className="h-10 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                >
                  ${[1, 2, 3, 4, 5, 6, 7, 8].map(
                    (value) =>
                      html`<option key=${value} value=${String(value)}>
                        ${value} concurrent downloads
                      </option>`,
                  )}
                </select>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Active
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${queueStats.active}</strong
                >
              </div>
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Completed
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${queueStats.done}</strong
                >
              </div>
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Failed
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${queueStats.failed}</strong
                >
              </div>
            </div>
          </aside>

          <div
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
          >
            <div
              className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <h2 className="text-lg font-semibold text-zinc-100">
                Download queue
              </h2>
              <input
                value=${queueSearch}
                onInput=${(event) => setQueueSearch(event.target.value)}
                placeholder="Search title, uploader, or status"
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-flux-500 sm:max-w-xs"
              />
            </div>
            <div
              className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-200">
                  Real-time speed (Mbps)
                </p>
                <span className="text-xs text-zinc-500">
                  ${downloadState.speed || "Waiting for stream..."}
                </span>
              </div>
              <div className="h-32 w-full">
                <canvas ref=${speedChartRef}></canvas>
              </div>
            </div>
            ${queue.length === 0
              ? html`<p
                  className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                >
                  No downloads in queue. Start one from the Download tab.
                </p>`
              : filteredQueue.length === 0
                ? html`<p
                    className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                  >
                    No queue items match your search.
                  </p>`
                : html`<ul className="space-y-2">
                    ${filteredQueue.map(
                      (item) =>
                        html`<li
                          key=${item.id}
                          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                          onContextMenu=${(event) =>
                            openQueueItemMenu(event, item)}
                        >
                          <div
                            className="flex flex-col gap-3 sm:flex-row sm:items-start"
                          >
                            <img
                              src=${item.thumbnail || DEFAULT_THUMBNAIL}
                              alt=${item.title || "Queue item"}
                              className="h-20 w-full rounded-xl object-cover sm:w-32"
                            />
                            <div className="min-w-0 flex-1">
                              <div
                                className="mb-2 flex flex-wrap items-center gap-2"
                              >
                                <span
                                  className=${`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                                    item.status === "done"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : item.status === "error"
                                        ? "bg-rose-500/20 text-rose-300"
                                        : item.status === "downloading"
                                          ? "bg-flux-500/20 text-flux-200"
                                          : "bg-zinc-800 text-zinc-400"
                                  }`}
                                  >${item.status}</span
                                >
                                <p
                                  className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200"
                                >
                                  ${item.title}
                                </p>
                                <button
                                  onClick=${(event) =>
                                    openQueueItemMenu(event, item)}
                                  className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                                  title="Queue item actions"
                                >
                                  ⋮
                                </button>
                                <span className="text-xs text-zinc-400"
                                  >${Math.round(item.percent || 0)}%</span
                                >
                              </div>
                              <p className="mb-2 text-xs text-zinc-400">
                                ${item.uploader || "Unknown uploader"}
                              </p>
                              ${item.presetName
                                ? html`<div className="mb-2">
                                    <span
                                      className="rounded-full border border-flux-500/30 bg-flux-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-flux-100"
                                    >
                                      ${item.presetName}
                                    </span>
                                  </div>`
                                : null}
                              <div
                                className="mb-2 grid gap-1 text-xs text-zinc-500 sm:grid-cols-2"
                              >
                                <span>Speed: ${item.speed || "—"}</span>
                                <span>ETA: ${item.eta || "—"}</span>
                              </div>
                              ${(item.status === "downloading" ||
                                item.status === "pending") &&
                              html`<div
                                className="h-2 overflow-hidden rounded-full bg-zinc-800"
                              >
                                <div
                                  className="h-full bg-gradient-to-r from-flux-400 to-flux-500"
                                  style=${{ width: `${item.percent || 0}%` }}
                                ></div>
                              </div>`}
                            </div>
                          </div>
                        </li>`,
                    )}
                  </ul>`}
          </div>
        </section>`}
        ${tab === "history" &&
        html` <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
          >
            <h2 className="text-lg font-semibold text-zinc-100">
              History dashboard
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Review what was downloaded and run it again fast.
            </p>
            <div className="mt-4 grid gap-2">
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Total
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${historyStats.total}</strong
                >
              </div>
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Video
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${historyStats.video}</strong
                >
              </div>
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <p
                  className="text-xs uppercase tracking-[0.15em] text-zinc-500"
                >
                  Audio
                </p>
                <strong className="text-2xl text-zinc-100"
                  >${historyStats.audio}</strong
                >
              </div>
            </div>
          </aside>

          <div
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel"
          >
            <div
              className="mb-3 flex flex-wrap items-center justify-between gap-2"
            >
              <h2 className="text-lg font-semibold text-zinc-100">History</h2>
              <div className="flex flex-wrap gap-2">
                <input
                  value=${historySearch}
                  onInput=${(event) => setHistorySearch(event.target.value)}
                  placeholder="Search title, uploader, or status"
                  className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-flux-500 sm:w-72"
                />
                ${canOpenDownloads
                  ? html`<button
                      onClick=${openDownloadsFolder}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Open downloads folder
                    </button>`
                  : null}
                <button
                  onClick=${clearHistory}
                  className="rounded-xl border border-zinc-700 bg-transparent px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-500"
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-2">
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <p className="mb-2 text-sm font-semibold text-zinc-200">
                  Daily bandwidth (last 30 days)
                </p>
                <div className="h-52 w-full">
                  <canvas ref=${dailyChartRef}></canvas>
                </div>
              </div>
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <p className="mb-2 text-sm font-semibold text-zinc-200">
                  Source breakdown
                </p>
                <div className="h-52 w-full">
                  <canvas ref=${siteChartRef}></canvas>
                </div>
              </div>
            </div>

            ${history.length === 0
              ? html`<p
                  className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                >
                  No downloads yet.
                </p>`
              : filteredHistory.length === 0
                ? html`<p
                    className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                  >
                    No history items match your search.
                  </p>`
                : html`<ul className="space-y-2">
                    ${filteredHistory.map(
                      (entry) =>
                        html`<li
                          key=${entry.id}
                          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                        >
                          <div
                            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 flex-1 gap-3">
                              <img
                                src=${entry.thumbnail || DEFAULT_THUMBNAIL}
                                alt=${entry.title || "History item"}
                                className="h-20 w-28 rounded-xl object-cover"
                              />
                              <div className="min-w-0">
                                <p
                                  className="truncate text-sm font-semibold text-zinc-100"
                                >
                                  ${entry.title || "Unknown"}
                                </p>
                                <p className="mt-1 text-xs text-zinc-400">
                                  ${entry.uploader || "Unknown uploader"}
                                </p>
                                ${entry.presetName
                                  ? html`<div className="mt-1">
                                      <span
                                        className="rounded-full border border-flux-500/30 bg-flux-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-flux-100"
                                      >
                                        ${entry.presetName}
                                      </span>
                                    </div>`
                                  : null}
                                <p className="mt-1 text-xs text-zinc-400">
                                  ${SITE_LABELS[entry.site] ||
                                  SITE_LABELS.unknown}
                                  · ${(entry.format || "—").toUpperCase()} ·
                                  ${formatDate(entry.date)}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  ${formatFileSize(entry.fileSize)} ·
                                  ${entry.subtitleMode || "separate"} subtitles
                                  · ${entry.status || "completed"}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick=${() => redownloadFromHistory(entry)}
                                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
                              >
                                Re-download
                              </button>
                              <button
                                onClick=${() => deleteHistoryEntry(entry.id)}
                                className="rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-rose-400 hover:text-rose-300"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </li>`,
                    )}
                  </ul>`}
          </div>
        </section>`}
        ${queueContextMenu
          ? html`<div
              ref=${queueMenuRef}
              className="fixed z-[70] w-56 rounded-xl border border-zinc-700 bg-zinc-950/95 p-2 shadow-2xl"
              style=${{
                left: `${Math.max(8, Math.min(window.innerWidth - 240, queueContextMenu.x))}px`,
                top: `${Math.max(8, Math.min(window.innerHeight - 250, queueContextMenu.y))}px`,
              }}
            >
              <button
                onClick=${() => retryQueueItem(queueContextMenu.item)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Retry item
              </button>
              <button
                onClick=${() =>
                  retryQueueItem(queueContextMenu.item, { format: "mp3" })}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Convert as MP3
              </button>
              <button
                onClick=${() =>
                  retryQueueItem(queueContextMenu.item, { format: "mp4" })}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Convert as MP4
              </button>
              <button
                onClick=${() => changeQueueItemPreset(queueContextMenu.item)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Change preset
              </button>
              <button
                onClick=${() => openQueueItemOutput(queueContextMenu.item)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Open folder/file
              </button>
            </div>`
          : null}
        ${isAuthenticated && logsExpanded
          ? html`<div
              className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-16"
              onClick=${() => setLogsExpanded(false)}
            >
              <section
                className="w-full max-w-4xl rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-panel"
                onClick=${(event) => event.stopPropagation()}
              >
                <div
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p
                      className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
                    >
                      Debug logs
                    </p>
                    <h2 className="text-lg font-semibold text-zinc-100">
                      Live logs
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick=${() => refreshLogs()}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Refresh
                    </button>
                    <button
                      onClick=${exportLogs}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick=${() => setLogsExpanded(false)}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div
                    className="flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span>
                      ${logsLoading
                        ? "Loading logs..."
                        : `Showing ${logEntries.length} recent event${logEntries.length === 1 ? "" : "s"}`}
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        className="inline-flex items-center gap-2 text-zinc-400"
                      >
                        <input
                          type="checkbox"
                          checked=${logsAutoRefresh}
                          onChange=${(event) =>
                            setLogsAutoRefresh(event.target.checked)}
                          className="h-4 w-4 accent-flux-500"
                        />
                        Auto-refresh
                      </label>
                      <span>Updated ${formatLogTime(logsUpdatedAt)}</span>
                    </div>
                  </div>
                  ${logsError
                    ? html`<p className="text-sm text-rose-400">
                        ${logsError}
                      </p>`
                    : null}
                  <div
                    className="max-h-[28rem] space-y-2 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-xs"
                  >
                    ${logEntries.length === 0 && !logsLoading
                      ? html`<p className="text-zinc-500">
                          No log entries yet.
                        </p>`
                      : logEntries.map(
                          (entry, index) =>
                            html`<div
                              key=${`${entry.timestamp || "log"}-${index}`}
                              className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                            >
                              <div
                                className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500"
                              >
                                <span>${formatLogTime(entry.timestamp)}</span>
                                <span>${entry.location || "server"}</span>
                              </div>
                              <p className="break-words text-zinc-200">
                                ${entry.message || entry.raw}
                              </p>
                              ${entry.data
                                ? html`<pre
                                    className="mt-2 overflow-x-auto whitespace-pre-wrap text-zinc-500"
                                  >
${JSON.stringify(entry.data, null, 2)}</pre
                                  >`
                                : null}
                            </div>`,
                        )}
                  </div>
                </div>
              </section>
            </div>`
          : null}

        <footer
          className="mt-8 flex flex-col gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>FluxDL · Secure account-based media workflow</span>
          <span>
            ${isAuthenticated
              ? `Signed in as ${authUser?.email || accountLabel}`
              : "Sign in to access sync-ready workflow features"}
          </span>
        </footer>
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 mx-auto flex w-full max-w-sm flex-col gap-2 px-3"
      >
        ${toasts.map(
          (toast) =>
            html`<div
              key=${toast.id}
              className=${`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
                toast.type === "error"
                  ? "border-rose-500/50 bg-rose-950/80 text-rose-200"
                  : toast.type === "success"
                    ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-100"
                    : "border-zinc-700 bg-zinc-900/90 text-zinc-100"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="pr-2">${toast.message}</p>
                <button
                  onClick=${() => dismissToast(toast.id)}
                  className="pointer-events-auto rounded-md px-1 text-xs opacity-70 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
              ${toast.link
                ? html`<a
                    href=${toast.link.href}
                    download=${toast.link.download || ""}
                    className="mt-1 inline-block text-xs font-semibold underline"
                    >${toast.link.label}</a
                  >`
                : null}
            </div>`,
        )}
      </div>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
