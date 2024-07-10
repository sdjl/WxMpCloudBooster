'use strict'
// 对app进行初始化，以后会在这里添加更多的初始化代码

import utils from 'utils'

/* 初始化运行环境(很重要，决定了后续操作测试数据库还是正式数据库)
*/
const initRunning = (app) => {

  const platform = wx.getDeviceInfo().platform

  app.globalData.running ??= {}
  app.globalData.running.is_local = platform === 'devtools'
  app.globalData.running.is_windows = platform === 'windows'
  app.globalData.running.is_mac = platform === 'mac'

}


/* 这里需要显示传入app, 因为在app.js的App()注册函数执行完成之前, 调用getApp()可能会返回undefined 
*/
export default function (app) {

  initRunning(app)

}
