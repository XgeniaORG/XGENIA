-- Plugin Registry: maps subscription tiers to available plugin bundles.
-- The server uses this table to decide which plugin URLs a user can access.

CREATE TABLE IF NOT EXISTS plugin_registry (
  id TEXT PRIMARY KEY,                -- e.g. 'ai-chat', 'maths-rgs', 'pixi-engine'
  display_name TEXT NOT NULL,
  description TEXT,
  min_tier TEXT NOT NULL DEFAULT 'pro'
    CHECK (min_tier IN ('free', 'pro', 'enterprise')),
  bundle_url TEXT NOT NULL,           -- URL to the built plugin (Supabase Storage)
  version TEXT NOT NULL DEFAULT '0.0.1',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: read-only for authenticated users
ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active plugins"
  ON plugin_registry FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Trigger for updated_at
CREATE TRIGGER update_plugin_registry_updated_at
  BEFORE UPDATE ON plugin_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: per-user overrides for beta access or revocations
CREATE TABLE IF NOT EXISTS user_plugin_overrides (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_id TEXT REFERENCES plugin_registry(id) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT true,  -- true = force grant, false = revoke
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, plugin_id)
);

ALTER TABLE user_plugin_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own overrides"
  ON user_plugin_overrides FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Seed initial plugin entries
INSERT INTO plugin_registry (id, display_name, description, min_tier, bundle_url, version)
VALUES
  ('ai-chat', 'AI Chat', 'AI-powered design assistant with node creation, editing, and deployment', 'pro', 'http://localhost:3001', '0.1.0'),
  ('maths-rgs', 'Maths RGS', 'Remote Gaming Server mathematics engine for slot games', 'enterprise', 'http://localhost:3002', '0.1.0'),
  ('pixi-engine', 'PixiJS Engine', 'PixiJS rendering engine with particle systems and reel controllers', 'pro', 'http://localhost:3003', '0.1.0')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  bundle_url = EXCLUDED.bundle_url,
  version = EXCLUDED.version,
  updated_at = NOW();
