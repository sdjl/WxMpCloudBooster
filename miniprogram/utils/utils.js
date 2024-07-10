'use strict'

const APP = getApp // 不要在这里执行getApp()，因为可能会返回undefined

const utils = {

  /* === 运行环境 === */

  running () {
    return this.globalData().running
  },

  globalData () {
    return APP().globalData
  },

  /* 判断是否是本地开发环境，当代码在微信开发者工具中运行时返回true，否则返回false
  */
  isLocal () {
    return this.running().is_local
  },

  isWindows () {
    return this.running().is_windows
  },

  isMac () {
    return this.running().is_mac
  },

  /* 判断是否是电脑，包含Windows和Mac
     注意，本地开发环境会返回false
     */
  isPC () {
    const r = this.running()
    return r.is_windows || r.is_mac
  },


  // === 数据库 ===

  /* 返回数据库访问对象
  */
  _db () {
    return APP().cloud.database()
  },

  /* 请使用coll()代替默认的collection函数，以免误操作生产环境的数据
  */
  coll (c) {
    const _ = this
    return _._db().collection(_._collName(c)) // 此文件中只有这里可以写collection
  },

  /* 生产环境下添加p_前缀(all_前缀的集合除外) 
  */
  _collName(c){
    const _ = this
    if( !_.isLocal() && !c.startsWith('all_') ){
      c = 'p_' + c
    }
    return c
  },

}

export default utils
