const uiConfig = require('../../utils/ui-config')

Component({
  properties: {
    open: { type: Boolean, value: false },
    menu: { type: Object, value: null },
    anchor: { type: Object, value: null },
    anchorType: { type: String, value: '' },
    localRows: { type: Array, value: [] }
  },
  data: { groups: [], openNode: null },
  observers: {
    'open,menu': function (open, menu) {
      if (!open) return
      this.setData({ groups: uiConfig.renderableGroups(menu), openNode: null })
      try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
    }
  },
  methods: {
    close() { this.triggerEvent('close') },
    stop() {},
    openSubmenu(event) {
      const dataset = event.currentTarget.dataset
      const node = this.data.groups[Number(dataset.group)] && this.data.groups[Number(dataset.group)][Number(dataset.index)]
      if (node && node.type === 'submenu' && node.children.length) this.setData({ openNode: node })
    },
    back() { this.setData({ openNode: null }) },
    pickChild(event) {
      const node = this.data.openNode && this.data.openNode.children[Number(event.currentTarget.dataset.index)]
      if (!node || !node.instruction) return
      this.triggerEvent('pick', { node })
    },
    pickRoot(event) {
      const dataset = event.currentTarget.dataset
      const node = this.data.groups[Number(dataset.group)] && this.data.groups[Number(dataset.group)][Number(dataset.index)]
      if (!node || !node.instruction) return
      this.triggerEvent('pick', { node })
    },
    pickLocal(event) {
      const row = this.properties.localRows[Number(event.currentTarget.dataset.index)]
      if (!row) return
      this.triggerEvent('localpick', { id: row.id })
    }
  }
})
