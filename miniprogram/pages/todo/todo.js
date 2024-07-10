'use strict'

import utils from '../../utils/utils'

Page({

  data: {
  },

  onLoad(options) {
  },

  async test1 (e) {

    utils.coll('todo').add({
      data: {
        title: '学习云数据库',
        created: new Date(),
      }
    })
    .then(res => {
      wx.showToast({
        title: '新增记录成功',
      })
      console.log(res)
    })

  },

})
