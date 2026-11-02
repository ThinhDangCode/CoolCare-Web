-- Keep existing payment history unchanged. PostgreSQL enforces a NOT VALID
-- constraint on every new or updated payment while leaving old rows intact.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'payments'::regclass
      AND conname = 'payments_voucher_margin_guard'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_voucher_margin_guard
      CHECK (
        platform_discount_amount IS NULL
        OR platform_discount_amount = 0
        OR (
          commission_base_amount IS NOT NULL
          AND commission_amount IS NOT NULL
          AND platform_discount_amount >= 0
          AND platform_discount_amount <= 50000
          AND platform_discount_amount <= round(commission_base_amount * 0.20, 2)
          AND platform_discount_amount <= commission_amount
        )
      ) NOT VALID;
  END IF;
END
$migration$;

-- Existing unredeemed promotions outside the new policy must not continue to
-- appear active. Keep their records and usage history for the admin audit UI.
UPDATE vouchers v
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE v.is_active = true
  AND (
    (v.discount_type = 0 AND v.discount_value > 20)
    OR (v.discount_type = 1 AND (
      v.discount_value > 50000
      OR v.minimum_order_amount < v.discount_value * 5
    ))
    OR v.maximum_discount > 50000
  )
  AND NOT EXISTS (
    SELECT 1 FROM voucher_usages vu
    WHERE vu.voucher_id = v.id AND vu.status = 'RESERVED'
  );
