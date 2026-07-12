const CREDIT_PATTERN = /充值|获得|赠送|奖励|退款|返还|订阅到账|credit|grant|refund|topup|recharge/i

function formatEntry(entry, index) {
  const rawAmount = Number(entry.suanli) || 0
  const title = entry.reason || entry.kind || '算力变动'
  const isCredit = rawAmount > 0 && CREDIT_PATTERN.test(`${entry.reason || ''} ${entry.kind || ''}`)
  const displayAmount = isCredit ? Math.abs(rawAmount) : -Math.abs(rawAmount)
  const prefix = displayAmount > 0 ? '+' : ''

  return Object.assign({}, entry, {
    id: entry.id || entry.ts || `${title}-${index}`,
    title,
    timeText: formatTime(entry.ts || entry.created_at || entry.createdAt),
    amountText: `${prefix}${formatAmount(displayAmount)}`,
    amountClass: isCredit ? 'amount-positive' : 'amount-negative'
  })
}

function formatAmount(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 10) / 10)
}

function formatSummaryRow(row, kind, index) {
  const title = row.reason || row.reason_code || '算力变动'
  const grant = kind === 'grant'
  return {
    id: `${row.reason_code || title}-${kind}-${index}`,
    title,
    countText: Number(row.count) > 1 ? `${Number(row.count)} 笔` : '',
    amountText: `${grant ? '+' : '−'}${formatAmount(Math.abs(Number(row.suanli) || 0))}`,
    amountClass: grant ? 'amount-positive' : 'amount-negative'
  }
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US')
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}年${month}月${day}日 ${hour}:${minute}`
}

module.exports = {
  formatEntry,
  formatSummaryRow,
  formatNumber
}
