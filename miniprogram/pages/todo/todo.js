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
