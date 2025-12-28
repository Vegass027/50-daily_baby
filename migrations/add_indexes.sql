-- Add indexes for Order table performance
CREATE INDEX IF NOT EXISTS "idx_order_user_status" ON "Order" ("userId", "status");
CREATE INDEX IF NOT EXISTS "idx_order_token_status" ON "Order" ("tokenMint", "status");
CREATE INDEX IF NOT EXISTS "idx_order_status_created" ON "Order" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_order_created" ON "Order" ("createdAt");

-- Add indexes for Position table performance (Note: Position table doesn't have status column)
CREATE INDEX IF NOT EXISTS "idx_position_user" ON "Position" ("userId");
CREATE INDEX IF NOT EXISTS "idx_position_token" ON "Position" ("tokenAddress");

-- Add indexes for LinkedOrder table performance
CREATE INDEX IF NOT EXISTS "idx_linked_tp" ON "LinkedOrder" ("tpOrderId");
CREATE INDEX IF NOT EXISTS "idx_linked_sl" ON "LinkedOrder" ("slOrderId");
