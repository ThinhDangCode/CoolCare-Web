// Debt is the negative settlement balance, measured in VND.
// 300,000-499,999: warn; 500,000-999,999: reduce ranking;
// >= 1,000,000: block acceptance. 10-minute booking timeout is unchanged.
export const DEBT_WARNING_VND = 300_000
export const DEBT_DEMOTION_VND = 500_000
export const DEBT_BLOCK_VND = 1_000_000
export const debtFromBalance = value => Math.max(0, -Number(value || 0))
export const debtTier = value => {
  const debt = debtFromBalance(value)
  if (debt >= DEBT_BLOCK_VND) return 'BLOCKED'
  if (debt >= DEBT_DEMOTION_VND) return 'DEMOTED'
  if (debt >= DEBT_WARNING_VND) return 'WARNING'
  return 'NORMAL'
}
