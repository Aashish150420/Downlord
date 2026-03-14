import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import htm from "https://esm.sh/htm@3.1.1";

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

const PREFERENCES_KEY = "fluxdl.preferences.v1";

function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function App() {
  const prefs = useMemo(loadPreferences, []);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [tab, setTab] = useState("download");

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [info, setInfo] = useState(null);

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
  const [toasts, setToasts] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const activeDownloadControllerRef = useRef(null);
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
  const canOpenDownloads = isLocalHost && isWindowsClient;

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
  const spotifySourceReady =
    !spotifyMode ||
    spotifyCandidatesLoading ||
    Boolean(spotifyCustomUrl.trim() || spotifyCandidateUrl);
  const downloadDisabled =
    downloadState.running ||
    isFetching ||
    (batchMode ? !batchInput.trim() : !info) ||
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
  ]);

  useEffect(() => {
    let timer;
    if (!batchMode && isValidUrl(url.trim())) {
      timer = setTimeout(() => {
        fetchInfo(url.trim());
      }, 850);
    }
    return () => clearTimeout(timer);
  }, [url, batchMode]);

  useEffect(() => {
    if (!subtitlesSupported) {
      setSubtitles(false);
      setEmbedSubtitles(false);
      setSubtitleMode("separate");
    }
  }, [subtitlesSupported]);

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
    loadHistory();
    tryPasteFromClipboard();
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

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
    const targetUrl = (explicitUrl || url).trim();
    if (!targetUrl) {
      setUrlError("Enter a URL to continue");
      return;
    }

    setUrlError("");
    setIsFetching(true);

    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load video info");
      }

      setInfo(data);
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

  async function loadSpotifyCandidates(trackUrl) {
    setSpotifyCandidatesLoading(true);
    setSpotifyCandidatesLoaded(false);
    try {
      const response = await fetch("/api/spotify/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trackUrl }),
      });
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

  async function startDownload(overrides = {}) {
    const resolvedUrls = overrides.urls
      ? overrides.urls
      : batchMode
        ? batchInput
            .split(/\n/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [url.trim()].filter(Boolean);

    const titles =
      overrides.titles ||
      (info ? [info.title] : resolvedUrls.map(() => "Unknown"));

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
    const resolvedFilenameTemplate =
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

    const normalizedUrls = resolvedUrls.filter((item) => isValidUrl(item));
    if (normalizedUrls.length === 0) {
      setUrlError("No valid URLs found.");
      pushToast("No valid URLs found.", "error");
      return;
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
      spotifyYoutubeUrl: resolvedSpotifyYoutubeUrl,
      embedSubtitles: resolvedEmbedSubtitles,
      startTime: resolvedStartTime || undefined,
      endTime: resolvedEndTime || undefined,
      limitRate: resolvedLimitRate || undefined,
    };

    let queueLocal = normalizedUrls.map((_, index) => ({
      id: Date.now() + index,
      title: titles[index] || "Unknown",
      status: index === 0 ? "downloading" : "pending",
      percent: 0,
    }));

    setQueue(queueLocal);
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

    try {
      const controller = new AbortController();
      activeDownloadControllerRef.current = controller;

      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

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

            if (queueLocal[currentIndex]) {
              queueLocal[currentIndex] = {
                ...queueLocal[currentIndex],
                status: "done",
                percent: 100,
                speed: null,
                eta: null,
              };
            }

            currentIndex += 1;
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
          } else if (event.type === "error") {
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

      if (doneFiles.length === 0) {
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
      setUrlError(error.message || "Download failed");
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

  async function loadHistory() {
    try {
      const response = await fetch("/api/history");
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
    setInfo({ title: entry.title, site: entry.site || "unknown" });

    await startDownload({
      urls: [entry.url],
      titles: [entry.title || "Unknown"],
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
          <div className="mb-4 flex flex-wrap gap-2">
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

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick=${() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            >
              ${theme === "dark" ? "☀️ Light" : "🌙 Dark"} theme
            </button>
            ${canOpenDownloads
              ? html`<button
                  onClick=${openDownloadsFolder}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
                >
                  Open downloads folder
                </button>`
              : null}
            <button
              onClick=${exportLogs}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            >
              Export logs
            </button>
          </div>
        </header>

        <nav className="mb-5 flex flex-wrap gap-2">
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

        ${tab === "download" &&
        html`<section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
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
                    onKeyDown=${(event) => event.key === "Enter" && fetchInfo()}
                    placeholder="Paste video or playlist URL..."
                    className="h-12 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none ring-flux-500 placeholder:text-zinc-500 focus:ring-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick=${tryPasteFromClipboard}
                      className="h-12 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Paste
                    </button>
                    <button
                      onClick=${() => fetchInfo()}
                      disabled=${isFetching}
                      className="h-12 rounded-xl bg-flux-500 px-5 text-sm font-semibold uppercase tracking-wider text-white hover:bg-flux-400 disabled:opacity-60"
                    >
                      ${isFetching ? "Loading…" : "Fetch"}
                    </button>
                  </div>
                </div>
                ${urlError
                  ? html`<p className="text-sm text-rose-400">${urlError}</p>`
                  : html`<p className="text-xs text-zinc-500">
                      Drag a link here or paste with Ctrl+V · Enter to fetch
                    </p>`}
              </div>
            </div>

            ${info &&
            html`<article
              className="flex flex-col gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-panel sm:flex-row"
            >
              <img
                src=${info.thumbnail ||
                "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180' fill='%23171717'><rect width='320' height='180'/></svg>"}
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
                    ${site === "tiktok" &&
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
                      No watermark
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
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">
              Download queue
            </h2>
            ${queue.length === 0
              ? html`<p
                  className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                >
                  No downloads in queue. Start one from the Download tab.
                </p>`
              : html`<ul className="space-y-2">
                  ${queue.map(
                    (item) =>
                      html`<li
                        key=${item.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
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
                            className="min-w-0 flex-1 truncate text-sm text-zinc-200"
                          >
                            ${item.title}
                          </p>
                          <span className="text-xs text-zinc-400"
                            >${Math.round(item.percent || 0)}%</span
                          >
                        </div>
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
                ${canOpenDownloads
                  ? html`<button
                      onClick=${openDownloadsFolder}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Open downloads folder
                    </button>`
                  : null}
                <button
                  onClick=${exportLogs}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Export logs
                </button>
                <button
                  onClick=${clearHistory}
                  className="rounded-xl border border-zinc-700 bg-transparent px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-500"
                >
                  Clear all
                </button>
              </div>
            </div>

            ${history.length === 0
              ? html`<p
                  className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
                >
                  No downloads yet.
                </p>`
              : html`<ul className="space-y-2">
                  ${history.map(
                    (entry) =>
                      html`<li
                        key=${entry.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                      >
                        <div
                          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-semibold text-zinc-100"
                            >
                              ${entry.title || "Unknown"}
                            </p>
                            <p className="mt-1 text-xs text-zinc-400">
                              ${SITE_LABELS[entry.site] || SITE_LABELS.unknown}
                              · ${(entry.format || "—").toUpperCase()} ·
                              ${formatDate(entry.date)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              ${formatFileSize(entry.fileSize)} ·
                              ${entry.subtitleMode || "separate"} subtitles
                            </p>
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
