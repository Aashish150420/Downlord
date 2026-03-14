/**
 * Video Downloader — Express server
 * API mounted at /api (handled first); static + SPA after
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const path = require("path");
const fs = require("fs");

const apiRouter = require("./routes/api");
const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "./downloads";

// Ensure downloads directory exists
const downloadPath = path.resolve(DOWNLOAD_DIR);
if (!fs.existsSync(downloadPath)) {
  fs.mkdirSync(downloadPath, { recursive: true });
}

// Rate limiting for API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || "30", 10),
  message: { error: "Too many requests, please try again later" },
});

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.set("trust proxy", 1);
app.use(
  session({
    name: "fluxdl.sid",
    secret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

if (
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CALLBACK_URL
) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          provider: "google",
          displayName: profile.displayName || null,
          email:
            Array.isArray(profile.emails) && profile.emails[0]
              ? profile.emails[0].value
              : null,
          photo:
            Array.isArray(profile.photos) && profile.photos[0]
              ? profile.photos[0].value
              : null,
        };
        done(null, user);
      },
    ),
  );
}

app.use(passport.initialize());
app.use(passport.session());

// #region agent log
const LOG_PATH = path.resolve(__dirname, "..", "debug-9b862e.log");
const log = (loc, msg, data) => {
  const line =
    JSON.stringify({
      sessionId: "9b862e",
      location: loc,
      message: msg,
      data,
      timestamp: Date.now(),
    }) + "\n";
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) {}
  console.log("[DEBUG]", loc, msg, JSON.stringify(data));
};
app.use((req, res, next) => {
  const p = req.path || req.url?.split("?")[0] || "";
  log("index.js:first-middleware", "request received", {
    method: req.method,
    path: p,
    url: req.url,
    startsWithApi: p.startsWith("/api"),
  });
  next();
});
// #endregion

// API — mounted at /api, handles ALL /api/* before static
app.use("/api", apiLimiter, apiRouter);
app.use("/auth", authRouter);

// #region agent log
app.use((req, res, next) => {
  const p = req.path || req.url?.split("?")[0] || "";
  log("index.js:before-static", "reached static layer", {
    method: req.method,
    path: p,
  });
  next();
});
// #endregion

// Static files (public/)
app.use(express.static(path.join(__dirname, "..", "public")));

// SPA fallback — root only
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// #region agent log
process.on("beforeExit", (code) => {
  log("index.js:process", "beforeExit", { code, pid: process.pid });
});
process.on("exit", (code) => {
  try {
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        sessionId: "9b862e",
        location: "index.js:process",
        message: "exit",
        data: { code, pid: process.pid },
        timestamp: Date.now(),
      }) + "\n",
    );
  } catch (_) {}
});
process.on("uncaughtException", (err) => {
  log("index.js:process", "uncaughtException", {
    message: err?.message,
    name: err?.name,
  });
});
process.on("unhandledRejection", (err) => {
  log("index.js:process", "unhandledRejection", {
    message: err?.message || String(err),
  });
});

const server = app.listen(PORT, () => {
  try {
    fs.writeFileSync(
      LOG_PATH,
      JSON.stringify({
        message: "server started",
        cwd: process.cwd(),
        logPath: LOG_PATH,
        port: PORT,
        pid: process.pid,
        time: Date.now(),
      }) + "\n",
    );
  } catch (e) {}
  log("index.js:listen", "server listening", {
    port: PORT,
    pid: process.pid,
    address: server.address(),
  });
  console.log(`Server running at http://localhost:${PORT}`);
});

server.on("error", (err) => {
  log("index.js:server", "listen error", {
    code: err?.code,
    message: err?.message,
  });
});
server.on("close", () => {
  log("index.js:server", "server closed", { pid: process.pid });
});
// #endregion
