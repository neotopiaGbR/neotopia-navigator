-- User Roles Security Migration (NON-DESTRUCTIVE VERSION)
-- Fixes privilege escalation risk by moving roles to dedicated table
-- Strategy: Overwrite existing functions instead of dropping them to preserve dependencies.
-- Run in Cloud View > Run SQL
--
-- IMPORTANT: After running this migration:
-- 1. AuthContext.tsx will query user_roles via get_user_role() function
-- 2. Test admin functionality before removing old profiles.role column

-- 1. CREATE ROLE ENUM TYPE (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'kommune', 'user');
  END IF;
END $$;

-- 2. CREATE user_roles TABLE
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

COMMENT ON TABLE public.user_roles IS 'Stores user role assignments. A user can have multiple roles.';

-- 3. ENABLE RLS ON user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. MIGRATE EXISTING ROLES FROM profiles (Data Migration)
-- We do this BEFORE updating the function so admins don't get locked out
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'role'
  ) THEN
    -- Insert existing roles into user_roles table
    INSERT INTO public.user_roles (user_id, role)
    SELECT id, role::text::app_role
    FROM public.profiles
    WHERE role IS NOT NULL
    ON CONFLICT (user_id, role) DO NOTHING;
    
    RAISE NOTICE 'Migrated existing roles from profiles table';
  END IF;
END $$;

-- 5. OVERWRITE EXISTING FUNCTION (The Critical Fix)
-- We replace the body of 'has_role(uuid, text)' to use the new table.
-- This keeps existing RLS policies working without needing DROP CASCADE.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      -- We explicitly cast the text input to the enum type
      AND role = _role::app_role
  )
$$;

-- 6. CREATE TYPED OVERLOAD (Better Safety)
-- We also add the strict version for future use
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;

-- 7. CREATE RLS POLICIES FOR user_roles
-- Users can read their own roles
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all roles (Using the updated function)
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only service role can manage roles
DROP POLICY IF EXISTS "Service role manages roles" ON public.user_roles;
CREATE POLICY "Service role manages roles" ON public.user_roles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 8. HELPER FUNCTION: Get user's primary role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role 
      WHEN 'admin' THEN 1 
      WHEN 'moderator' THEN 2 
      WHEN 'kommune' THEN 3 
      ELSE 4 
    END
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO service_role;

-- 9. UPDATE handle_new_user TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  
  -- Assign default role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

-- 10. INDEX FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- 11. VERIFICATION QUERY (run after migration to verify)
-- SELECT u.email, array_agg(ur.role) as roles
-- FROM auth.users u
-- LEFT JOIN public.user_roles ur ON u.id = ur.user_id
-- GROUP BY u.id, u.email
-- ORDER BY u.email;
