const express = require("express");
const passport = require("passport");

const router = express.Router();

function hasGoogleConfig() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL,
  );
}

router.get("/google", (req, res, next) => {
  if (!hasGoogleConfig()) {
    return res.status(503).json({
      error:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.",
    });
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })(req, res, next);
});

router.get("/google/callback", (req, res, next) => {
  if (!hasGoogleConfig()) {
    return res.redirect("/auth/failure?reason=google-not-configured");
  }

  return passport.authenticate("google", {
    failureRedirect: "/auth/failure",
    session: true,
  })(req, res, () => {
    const redirectTo = process.env.AUTH_SUCCESS_REDIRECT || "/";
    res.redirect(redirectTo);
  });
});

router.get("/failure", (req, res) => {
  res.status(401).json({ error: "Google authentication failed" });
});

router.post("/logout", (req, res) => {
  req.logout((logoutErr) => {
    if (logoutErr) {
      return res.status(500).json({ error: "Could not log out" });
    }

    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        return res.status(500).json({ error: "Could not clear session" });
      }
      res.clearCookie("fluxdl.sid");
      return res.json({ ok: true });
    });
  });
});

module.exports = router;
