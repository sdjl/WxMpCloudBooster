'use strict'

import utils from '../../utils/utils'

Page({

  behaviors: utils.behaviors(),

  data: {
    page: {
      big_font: false, // 是否使用大字体
      show_completed: true, // 是否显示已完成todo
    },
  },

  async onLoad(options) {
    const _ = this
    const page = await utils.getUserConfig('aaa_user', 'page', {encrypt: false})
    _.setData({ page })
  },

  async checkboxChange (e) {
    const _ = this
    const { value } = e.detail

    // 判断big_font是否被选中（开启）
    const big_font = utils.in('big_font', value)

    // 判断show_completed是否被选中（开启）
    const show_completed = utils.in('show_completed', value)

    await utils.setUserConfig('aaa_user', 'page.big_font', big_font, {encrypt: false})
    await utils.setUserConfig('aaa_user', 'page.show_completed', show_completed, {encrypt: false})
  },

})
