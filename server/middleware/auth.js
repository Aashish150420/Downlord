function ensureAuthenticated(req, res, next) {
  if (req.user) {
    return next();
  }

  return res.status(401).json({
    error: "Authentication required. Please sign in with Google.",
  });
}

module.exports = {
  ensureAuthenticated,
};
