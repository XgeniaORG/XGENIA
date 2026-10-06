// ed25519 public key for live-engine manifests. The private half is the GitHub secret
// ENGINE_SIGNING_KEY (XgeniaORG/XGENIA). Rotating it means a new app build. (2026-10-03)
module.exports = {
  ENGINE_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAkX7GW69VwYFhpU8d/aOO0pLjYOW0qzeL31/0cZdYyYA=\n-----END PUBLIC KEY-----\n"
};
