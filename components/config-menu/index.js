const uiConfig = require('../../utils/ui-config')

Component({
  properties: {
    open: { type: Boolean, value: false },
    menu: { type: Object, value: null },
    anchor: { type: Object, value: null },
    anchorType: { type: String, value: '' },
    localRows: { type: Array, value: [] }
  },
  data: {
    groups: [],
    fixedNodes: [],
    customNodes: [],
    rootScrollHeight: 0,
    submenuScrollHeight: 0,
    openNode: null
  },
  observers: {
    'open,menu,anchor,localRows': function (open, menu, anchor, localRows) {
      if (!open) return
      const groups = uiConfig.renderableGroups(menu)
      const nodes = groups.flat()
      const fixedNodes = nodes.filter((node) => node.origin === 'system')
      const customNodes = nodes.filter((node) => node.origin !== 'system')
      const maxHeight = Math.max(48, Number(anchor && anchor.menuMaxHeight) || 320)
      const fixedHeight = fixedNodes.length * 48 + (localRows || []).length * 48
      const boundaryHeight = customNodes.length && (localRows || []).length ? 1 : 0
      const rootScrollHeight = Math.min(customNodes.length * 48,
        Math.max(0, maxHeight - fixedHeight - boundaryHeight))
      this.setData({ groups, fixedNodes, customNodes, rootScrollHeight, submenuScrollHeight: 0, openNode: null })
      try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
    }
  },
  methods: {
    close() { this.triggerEvent('close') },
    stop() {},
    openSubmenu(event) {
      const dataset = event.currentTarget.dataset
      const source = dataset.zone === 'custom' ? this.data.customNodes : this.data.fixedNodes
      const node = source && source[Number(dataset.index)]
      if (node && node.type === 'submenu' && node.children.length) {
        const maxHeight = Math.max(48, Number(this.properties.anchor && this.properties.anchor.menuMaxHeight) || 320)
        this.setData({
          openNode: node,
          submenuScrollHeight: Math.min(node.children.length * 48, Math.max(48, maxHeight - 48))
        })
      }
    },
    back() { this.setData({ openNode: null }) },
    pickChild(event) {
      const node = this.data.openNode && this.data.openNode.children[Number(event.currentTarget.dataset.index)]
      if (!node || !node.instruction) return
      this.triggerEvent('pick', { node })
    },
    pickRoot(event) {
      const dataset = event.currentTarget.dataset
      const source = dataset.zone === 'custom' ? this.data.customNodes : this.data.fixedNodes
      const node = source && source[Number(dataset.index)]
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
