const SCOPE = 'scope.writePhotosAlbum'

function getSetting(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.getSetting !== 'function') return resolve({})
    wxApi.getSetting({
      success: (result) => resolve(result && result.authSetting || {}),
      fail: () => resolve({})
    })
  })
}

function authorize(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.authorize !== 'function') return resolve(false)
    wxApi.authorize({ scope: SCOPE, success: () => resolve(true), fail: () => resolve(false) })
  })
}

function openSettings(wxApi) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.showModal !== 'function') return resolve(false)
    wxApi.showModal({
      title: '需要相册权限',
      content: '请允许保存小红书图片到相册',
      confirmText: '去设置',
      success: (modalResult) => {
        if (!modalResult || !modalResult.confirm || typeof wxApi.openSetting !== 'function') return resolve(false)
        wxApi.openSetting({
          success: (settingResult) => resolve(Boolean(
            settingResult && settingResult.authSetting && settingResult.authSetting[SCOPE]
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
  if (settings[SCOPE] === true) return true
  if (await authorize(wxApi)) return true
  return openSettings(wxApi)
}

module.exports = { SCOPE, ensure }
