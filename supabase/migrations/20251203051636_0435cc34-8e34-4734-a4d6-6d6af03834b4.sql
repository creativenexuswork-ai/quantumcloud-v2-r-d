-- Add session_status column to paper_config for proper state management
ALTER TABLE public.paper_config 
ADD COLUMN IF NOT EXISTS session_status text DEFAULT 'idle' 
CHECK (session_status IN ('idle', 'running', 'paused', 'stopped'));