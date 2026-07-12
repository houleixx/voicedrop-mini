const usage = require('../../services/usage')
const usageFormat = require('../../utils/usage-format')
const formatEntry = usageFormat.formatEntry

Page({
  data: {
    loading: false,
    balance: null,
    balanceDisplay: '0',
    earnedDisplay: '0',
    spentDisplay: '0',
    capacity: 0,
    sources: [],
    spendSummary: [],
    hasSources: false,
    hasSpendSummary: false,
    hasEntries: false,
    entries: []
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const [balanceResult, summaryResult, ledgerResult] = await Promise.allSettled([
        usage.balance(),
        usage.summary(),
        usage.ledger()
      ])

      if (balanceResult.status === 'fulfilled') {
        const balance = balanceResult.value
        const spent = Number(balance.spent_suanli) || 0
        const remaining = Number(balance.suanli) || 0
        this.setData({
          balance,
          balanceDisplay: usageFormat.formatNumber(remaining),
          earnedDisplay: usageFormat.formatNumber(remaining + spent),
          spentDisplay: usageFormat.formatNumber(spent),
          capacity: usage.articleCapacity(remaining)
        })
      } else {
        wx.showToast({ title: '加载失败', icon: 'error' })
      }

      if (summaryResult.status === 'fulfilled') {
        const sources = summaryResult.value.granted.map((row, index) =>
          usageFormat.formatSummaryRow(row, 'grant', index)
        )
        const spendSummary = summaryResult.value.spent.map((row, index) =>
          usageFormat.formatSummaryRow(row, 'spent', index)
        )
        this.setData({
          sources,
          spendSummary,
          hasSources: sources.length > 0,
          hasSpendSummary: spendSummary.length > 0
        })
      }

      if (ledgerResult.status === 'fulfilled') {
        const entries = ledgerResult.value.map(formatEntry)
        this.setData({
          entries,
          hasEntries: entries.length > 0
        })
      }
    } finally {
      this.setData({ loading: false })
    }
  }
})
