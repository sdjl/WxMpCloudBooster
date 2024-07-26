'use strict'

/* Page的通用函数
  此文件中的this指向引用函数的Page
  若参数为e，表示此函数可直接与tag绑定(如bind:tap)，否则此函数应该被Page调用。
  */

import utils from './utils.js'

module.exports = Behavior({

  methods: {

    // === input ===

    /* 自动更新data.form_data中对应的值，支持input、textarea

    page.js:
      data: {
        form_data: {name: ''},
      }

      inputChange (e) {
        const _ = this
        _._inputChange(e)
      },

    page.wxml:
      <input bind:input="inputChange" data-field="form_data.name" class="weui-input" placeholder="输入姓名" />

    提示：
      1、page.js中的inputChange不能是async
      2、你也可以直接在wxml中使用_inputChange，不用在page.js中定义inputChange
      */
    _inputChange(e) {
			const { field } = e.currentTarget.dataset
      this.setData({
        [`${field}`]: e.detail.value
      })
    },

  }, // methods end

})
