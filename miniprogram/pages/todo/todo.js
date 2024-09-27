'use strict'

import utils from '../../utils/utils'
const COLL = 'aaa_todo'

Page({

  behaviors: utils.behaviors(),

  data: {
    todo_list: [], // 未完成事项列表
    done_list: [], // 已完成事项列表
    new_title: '', // 新增待办事项的内容，与输入框绑定
  },

  async onLoad (options) {
    const _ = this
    console.log('onLoad', '云环境准备中')
    // 代码运行到这里时，云环境可能还没有准备好，因此需要把调用云环境API的代码放到cloudReadyOnLoad函数中
    utils.cloudReady().then(() => { _.cloudReadyOnLoad(options) })

  },

  /* 云环境准备好后会执行这个函数。
     注意，请在app.js文件的onLaunch方法中使用如下的代码初始化云环境对象，否则此函数不会执行：
     this.cloud.init().then(() => {
        _.globalData.running._set_cloud_ready = _.globalData.running.is_cloud_ready = true
     })
  */
  cloudReadyOnLoad(options){
    const _ = this
    console.log('cloudReadyOnLoad', '云环境已准备好')
    _.updateTodoList()
  },

  async addTodo (e) {
    const _ = this
    const new_title = _.data.new_title.trim()

    if (!new_title) {
      utils.showTip({ text: '请输入内容' })
      return
    }

    utils.addDoc(COLL, {title: new_title, status: '未完成'})
      .then(new_todo_id => {
        _.updateTodoList()
        _.setData({
          new_title: '' // 清空输入框
        })
      })
  },

  async completeTodo (e) {
    const _ = this
    const { id } = e.currentTarget.dataset
    utils.updateMyDoc(COLL, id, { status: '已完成' })
      .then(() => {
        _.updateTodoList()
      })
  },

  async updateTodoList () {
    const _ = this

    _.setData({
      todo_list: await utils.myDocs({c: COLL, w: {status: '未完成'} }),
      done_list: await utils.myDocs({c: COLL, w: {status: '已完成'} }),
    })

  },

  async deleteTodo (e) {
    const _ = this
    const { id } = e.currentTarget.dataset
    utils.removeMyDoc(COLL, id).then(_.updateTodoList)
  },

})
