function getSetting(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.getSetting !== 'function') {
      resolve({})
      return
    }
    wxApi.getSetting({
      success: (result) => resolve(result && result.authSetting || {}),
      fail: () => resolve({})
    })
  })
}

function authorize(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.authorize !== 'function') {
      resolve(false)
      return
    }
    wxApi.authorize({
      scope: 'scope.record',
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

function openSettings(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.showModal !== 'function') {
      resolve(false)
      return
    }
    wxApi.showModal({
      title: '需要录音权限',
      content: '请允许使用麦克风进行录音和语音处理',
      confirmText: '去设置',
      success: (modalResult) => {
        if (!modalResult || !modalResult.confirm || typeof wxApi.openSetting !== 'function') {
          resolve(false)
          return
        }
        wxApi.openSetting({
          success: (settingResult) => resolve(Boolean(
            settingResult && settingResult.authSetting && settingResult.authSetting['scope.record']
          )),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

async function ensure(wxApi) {
  const settings = await getSetting(wxApi)
  if (settings['scope.record'] === true) return true
  if (await authorize(wxApi)) return true
  return openSettings(wxApi)
}

module.exports = {
  ensure
}
