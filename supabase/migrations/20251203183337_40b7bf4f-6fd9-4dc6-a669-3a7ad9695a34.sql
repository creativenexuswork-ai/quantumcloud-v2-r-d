-- Step 1: Change batch_id in paper_positions from uuid to text
ALTER TABLE paper_positions 
ALTER COLUMN batch_id TYPE text USING batch_id::text;

-- Step 2: Change batch_id in paper_trades from uuid to text
ALTER TABLE paper_trades 
ALTER COLUMN batch_id TYPE text USING batch_id::text;