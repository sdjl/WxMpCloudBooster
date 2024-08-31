'use strict'

import utils from '../../utils/utils'

Page({

  behaviors: utils.behaviors(),

  data: {
    todo_list: [], // 未完成事项列表
    done_list: [], // 已完成事项列表
    new_title: '', // 新增待办事项的内容，与输入框绑定
  },

  async onLoad (options) {
    const _ = this

    /* 如果updateTodoList提示 “请先调用 wx.cloud.init() 完成初始化后再调用其他云 API” 的错误 
       表示在执行updateTodoList时，云环境还没有初始化完成，你可以删除下面这句代码
       然后在wxml中添加下面的代码，并通过点击按钮触发更新
       <button type="primary" bind:tap="updateTodoList">更新Todo列表</button>
    */
    _.updateTodoList()

  },

  async addTodo (e) {
    const _ = this
    const { new_title } = _.data

    utils.addDoc('todo', {title: new_title, status: '未完成'})
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
    utils.updateMyDoc('todo', id, { status: '已完成' })
      .then(() => {
        _.updateTodoList()
      })
  },

  async updateTodoList () {
    const _ = this

    _.setData({
      todo_list: await utils.myDocs({c: 'todo', w: {status: '未完成'} }),
      done_list: await utils.myDocs({c: 'todo', w: {status: '已完成'} }),
    })

  },

  async deleteTodo (e) {
    const _ = this
    const { id } = e.currentTarget.dataset
    utils.removeMyDoc('todo', id).then(_.updateTodoList)
  },

})
