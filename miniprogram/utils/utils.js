'use strict'

const APP = getApp // 不要在这里执行getApp()，因为可能会返回undefined
const PAGE_BEHAVIORS = require('page_behaviors')

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

  /* 返回page.js中使用的behaviors
  */
  behaviors(){
    return [ PAGE_BEHAVIORS, ]
  },


  // === 数据库 ===

  /* 请使用coll()代替默认的collection函数，以免误操作生产环境的数据
  */
  coll (c) {
    const _ = this
    return _._db().collection(_._collName(c)) // 此文件中只有这里可以写collection
  },

  /* 向集合c中添加文档d
    用法1：
      utils.addDoc('todo', {title: '我要学习'})
           .then(id => {
             console.log('插入的新数据id:', id)
           })
    用法2：
      const id = await utils.addDoc('todo', {title: '我真的要学习'})
      console.log('插入的新数据id:', id)
      */ 
  addDoc(c, d) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).add({ data: d })
        .then(res => {
          resolve(res._id)
        })
        .catch(e => {
          reject(e)
        })
    })
  },

  /* 读取20条数据
     使用方法：
       const docs = await utils.docs({c: 'todo'})

     参数说明：
       c: 集合名称，当运行在生产环境时会自动添加p_前缀
       w: 查询条件，如：{status: '未完成'} 或 { 'people[0].name': '张三' }
       page_num: 读取的页码，从0开始
       page_size: 每页读取的数据量，最大为20（微信限制每次最多读取20条数据）
       only: 仅返回的字段，如：'title, content'（_id默认会返回）
       except: 不返回的字段，如：'_openid, created'
       created: 是否给数据添加创建时间字段，共有4个字段 created、created_str、yymmdd、hhmmss
       order_by: 排序字段
         当仅需根据某个字段升序排序时，可以直接写字段名，如：'rank'
         当需要使用多个字段或降序时，需用有序对象，
             如：{a: 'asc', b: 'desc', 'c.d.e': 1}
             表示先按a升序，再按b降序，最后按c.d.e升序
         升序可以写：'asc'、1 或 true
         降序可以写：'desc'、0 或 false
       mine: 是否读取自己的数据，当使用了“自定义安全规则”且有"auth.openid == doc._openid"规则时，mine必须为true
       */ 
  docs ({c, w = {}, page_num = 0, page_size = 20, only = '', except = '', created = false, order_by = {}, mine = false } = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      let query = _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .skip(page_num * page_size)
        .limit(page_size)
        .field(_._makeField(only, except))

      if (!_.isEmpty(order_by)) {
        order_by = _._prepareOrderBy(order_by)
        for (let k in order_by) {
          query = query.orderBy(k, order_by[k])
        }
      }

      query.get().then(res => {
        if (res.data.length > 0) {

          // 根据_id获得创建时间created
          if (created) {
            for (let d of res.data) {
              d.created = _.getTimeFromId(d._id)
              d.created_str = _.dateToString(d.created)
              d.yymmdd = _.yymmdd(d.created)
              d.hhmmss = _.hhmmss(d.created)
            }
          }

          resolve(res.data)
        } else {
          resolve([])
        }
      })
        .catch(reject)
    })
  },

  /* 用于读取用户自己的数据，传入参数和docs一样，只是mine默认为true
  */
  myDocs (args) {
    args.mine = true
    return this.docs(args)
  },

  /* 更新文档，返回是否更新了文档
         若文档存在且更新了则触发 .then(true)
         文档不存在或内容未发生变化时触发 .then(false)

     使用方法：
         const success = await utils.updateDoc('todo', _id, {status: '已完成'})

     第三个参数是要更新的数据，且支持点表示法，如：{'a.b.c': 1}
     {_openid, _id, ...d}中，_openid和_id的目的是防止更新这两个字段

     mine: 是否更新自己的数据，当使用了“自定义安全规则”且有"auth.openid == doc._openid"规则时，mine必须为true
     */ 
  updateDoc (c, id, {_openid, _id, ...d}, {mine = false} = {}) {
    const _ = this
    const w = {_id: id}
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .limit(1)
        .update({data: d})
        .then(res => {
          if(res.stats.updated > 0){
            resolve(true)
          } else {
            resolve(false)
          }
        })
        .catch(reject)
    })
  },

  /* 更新自己的数据
  */
  updateMyDoc (c, id, d) {
    return this.updateDoc(c, id, d, {mine: true})
  },

  /* 删除文档，返回是否删除成功
     使用方法：
         const success = await utils.removeDoc('todo', doc._id)

     mine: 是否删除自己的数据，当使用了“自定义安全规则”且有"auth.openid == doc._openid"规则时，mine必须为true
     */ 
  removeDoc (c, id, {mine = false} = {}) {
    const _ = this
    const w = {_id: id}
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .limit(1)
        .remove()
        .then(async res => {
          if(res.stats.removed > 0){
            resolve(true)
          } else {
            resolve(false)
          }
        })
        .catch(e => {
          resolve(false)
        })
    })
  },

  /* 删除自己的数据
  */
  removeMyDoc (c, id) {
    return this.removeDoc(c, id, {mine: true})
  },


  /* === 对象 === */

  /* 判断值是否为undefined或null
  */ 
  isNone (i) {
    return i === undefined || i === null
  },

  /* 判断值是否为空对象{}、空数组[]、空字符串''、空内容串'  '、undefined、null
  */
  isEmpty (i) {
    const _ = this
    return (
      _.isNone(i) 
      || (_.isArray(i) && i.length === 0)
      || (_.isString(i) && i.trim().length === 0)
      || (_.isObject(i) && Object.keys(i).length === 0)
    );
  },

  /* 判断值是否为数组
  */
  isArray(i){
    return Array.isArray(i)
  },

  /* 判断值是object但不是数组、null、undefined
    （在js中，数组和null的typeof也是object）
    */ 
  isObject(i){
    const _ = this
    return typeof i === 'object' && !_.isArray(i) && !_.isNone(i)
  },

  /* 判断值是否为字符串
  */
  isString(i){
    return typeof i === 'string' || i instanceof String
  },


  /* === 字符串 === */

  /* 拆分字符串，返回数组
     函数会过滤掉空字符串，并去除两边的空白
     */ 
  split (s, char = ' ') {
    return s.split(char).map(i => i.trim()).filter(i => i.length > 0)
  },


  /*  === 数组、列表  === */

  /* 判断某个元素是否在数组中
     arr也支持对象，此时判断元素是否在对象的keys中
     arr也支持字符串，此时判断子串是否在字符串arr中
     */
  in (item, arr) {
    const _ = this
    if (_.isArray(arr)) {
      return arr.indexOf(item) !== -1
    } else if (_.isObject(arr)) {
      return _.in(item, Object.keys(arr))
    } else if (_.isString(arr)) {
      return arr.indexOf(item) !== -1
    } else {
      return false
    }
  },


  /* === 时间 === */

  /* 从数据_id中获取时间，返回Date对象
     系统使用什么时区，就返回什么时区的时间（以插入数据时的时区决定）
     建议在云函数中把时区转换为上海时区，即添加 TZ=Asia/Shanghai 配置
     */
  getTimeFromId (id) {
    let t = parseInt(id.substring(8, 16), 16) * 1000
    return new Date(t)
  },

  /* 返回时间的年月日字符串，如：'2023-07-01'
  */ 
  yymmdd (t) {
    let y = t.getFullYear()
    let m = (t.getMonth() + 1).toString().padStart(2, '0')
    let d = t.getDate().toString().padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  /* 返回时间的时分秒字符串，如：'01:02:03'
  */ 
  hhmmss (t) {
    let h = t.getHours().toString().padStart(2, '0')
    let m = t.getMinutes().toString().padStart(2, '0')
    let s = t.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  },

  /* 返回时间的完整字符串，如：'2023-07-01 01:02:03'
     未传入参数时，返回当前时间
     */
  dateToString (t) {
    if (t === undefined) { t = new Date() }
    if (!t) { return '' }
    return this.yymmdd(t) + ' ' + this.hhmmss(t)
  },


  /* === 辅助 === */

  /* 返回数据库访问对象
  */
  _db () {
    return APP().cloud.database()
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

  /* 用于创建数据查询需要返回或排除的字段
     only和except是用逗号分隔的字符串，如：'_id, content'
     */ 
  _makeField(only = '', except = '') {
    const _ = this
    let field = {}
    if (only){
      _.split(only, ',').forEach(f => { field[f] = true })
    }
    if (except){
      _.split(except, ',').forEach(f => { field[f] = false })
    }
    return field
  },

  /* 把order_by参数转换为晕数据库需要的格式
     若order_by是字符串，则视为按此字段升序排序，返回 {[order_by]: 'asc'}
     若order_by是object，则value可以是asc, desc, 1, -1, true, false
     */
  _prepareOrderBy (order_by) {
    const _ = this
    if (_.isString(order_by)) {
      return {[order_by]: 'asc'}
    } else if(_.isObject(order_by)) {
      const ret = {}
      for (let k in order_by) {
        ret[k] = _.in(order_by[k], ['asc', 1, true]) ? 'asc' : 'desc'
      }
      return ret
    } else {
      throw new Error(`order_by must be string or object, but got ${order_by}`)
    }
  },

}

export default utils
