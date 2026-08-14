function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      method: options.method || 'GET',
      url: options.url,
      data: options.data,
      header: options.header || {},
      timeout: options.timeout,
      success: (res) => resolve(res),
      fail: (error) => reject(requestError(error, options))
    })
  })
}

function requestError(error, options) {
  const message = error && (error.errMsg || error.message) || 'request failed'
  const url = options && options.url || ''
  const detail = url ? `${message}: ${url}` : message
  const err = new Error(detail)
  err.cause = error
  err.url = url
  return err
}

function authHeader(token, extra) {
  return Object.assign(
    token ? { Authorization: `Bearer ${token}` } : {},
    { 'X-VD-Platform': 'miniapp' },
    extra || {}
  )
}

async function get(url, token, options) {
  return request({
    url,
    header: authHeader(token, options && options.header),
    timeout: options && options.timeout
  })
}

async function postJson(url, token, data, options) {
  return request({
    method: 'POST',
    url,
    data: data || {},
    header: authHeader(token, { 'content-type': 'application/json' }),
    timeout: options && options.timeout
  })
}

async function putJson(url, token, data) {
  return request({
    method: 'PUT',
    url,
    data: data || {},
    header: authHeader(token, { 'content-type': 'application/json' })
  })
}

async function patchJson(url, token, data) {
  return request({
    method: 'PATCH',
    url,
    data: data || {},
    header: authHeader(token, { 'content-type': 'application/json' })
  })
}

async function del(url, token) {
  return request({ method: 'DELETE', url, header: authHeader(token) })
}

module.exports = {
  request,
  get,
  postJson,
  putJson,
  patchJson,
  del,
  authHeader,
  requestError
}
