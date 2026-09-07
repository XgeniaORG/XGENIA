-- XGENIA Authentication Database Schema
--
-- ⚠️ HISTORICAL DESIGN DOC — NOT THE LIVE SCHEMA. DO NOT APPLY. ⚠️
--
-- The live account backend (Supabase project pcrghrjikkcmelflwiys, shared with
-- the primora.xgenia.ai site) was rebuilt on 2026-08-04 and its `profiles`
-- table no longer matches the definition below. Columns is_active,
-- subscription_status, last_seen, full_name and avatar_url DO NOT EXIST on
-- the live table — selecting them 400s.
--
-- Live profiles columns as of 2026-08-19 (verified against the deployed API):
--   id uuid PK, email, name, first_name, last_name, surname,
--   role ('user'|...), status ('active'|...),
--   membership_level  -- ENUM: 'free' | 'premium' | 'enterprise' (no 'pro'!)
--   plan              -- display label / Stripe product slug
--                     -- ('Enterprise', 'creator', 'stake_pro', 'xgenia_pro', ...)
--   is_alpha_tester, alpha_tester, expires_at, trial_hours,
--   organization_id, current_organization_id, invited_by,
--   stripe_customer_id, created_at, updated_at
--
-- Subscription state additionally lives in user_subscriptions /
-- subscription_plans (Stripe-backed, written by the site's check-subscription
-- edge function).
--
-- NOTE: the RLS policies at the bottom of this file (own-row-only SELECT and
-- UPDATE) are what the live table SHOULD enforce but currently does not — as
-- of 2026-08-19 any authenticated user can read AND update every profiles
-- row. Kept here as the reference design.

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table to store user profile information (ORIGINAL DESIGN — superseded, see header)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,

  -- Authentication and licensing fields
  is_active BOOLEAN DEFAULT true NOT NULL,
  subscription_status TEXT DEFAULT 'free' CHECK (subscription_status IN ('free', 'pro', 'enterprise', 'suspended')),
  subscription_expires_at TIMESTAMPTZ,

  -- Activity tracking
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  login_count INTEGER DEFAULT 0,
  last_login TIMESTAMPTZ,

  -- Account management
  email_verified BOOLEAN DEFAULT false,
  account_created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- User sessions table for tracking active sessions (optional - for enhanced security)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  device_info JSONB,
  ip_address INET,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- User activity log for audit purposes
CREATE TABLE IF NOT EXISTS user_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL, -- 'login', 'logout', 'validation_success', 'validation_failure', etc.
  description TEXT,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen ON profiles(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON user_activity_log(created_at);

-- RLS (Row Level Security) policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- User sessions policies
CREATE POLICY "Users can view own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own sessions" ON user_sessions
  FOR ALL USING (auth.uid() = user_id);

-- Activity log policies (read-only for users)
CREATE POLICY "Users can view own activity" ON user_activity_log
  FOR SELECT USING (auth.uid() = user_id);

-- Functions for automatic timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updating updated_at on profiles
CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON profiles 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION create_profile_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, email_verified)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.email_confirmed_at IS NOT NULL, false));
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_profile_for_new_user();

-- Function to log user activity
CREATE OR REPLACE FUNCTION log_user_activity(
  p_user_id UUID,
  p_activity_type TEXT,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  activity_id UUID;
BEGIN
  INSERT INTO user_activity_log (
    user_id, 
    activity_type, 
    description, 
    metadata
  )
  VALUES (
    p_user_id, 
    p_activity_type, 
    p_description, 
    p_metadata
  )
  RETURNING id INTO activity_id;
  
  RETURN activity_id;
END;
$$ language 'plpgsql';

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_sessions 
  WHERE expires_at < NOW() OR is_active = false;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';

-- Function to update user last seen timestamp
CREATE OR REPLACE FUNCTION update_user_last_seen(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles 
  SET last_seen = NOW()
  WHERE id = p_user_id;
END;
$$ language 'plpgsql'; 