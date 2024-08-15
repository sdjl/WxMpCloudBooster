'use strict'

const APP = getApp // 不要在这里执行getApp()，因为可能会返回undefined
const PAGE_BEHAVIORS = require('page_behaviors')

const utils = {

  /* === 运行环境 === */

  /**
   * 获取当前运行环境的状态
   * @returns {Object} 当前环境状态
   */
  running () {
    return this.globalData().running // 小程序初始化时，app_init.js 文件中会修改这个值
  },

  /**
   * 获取全局数据对象，用于存储页面间共享的数据、缓存数据
   * @returns {Object} 全局数据
   */
  globalData () {
    return APP().globalData
  },

  /**
   * 判断当前是否在本地开发环境中
   * @returns {boolean} 如果在本地开发环境中返回true，否则返回false
   */
  isLocal () {
    return this.running().is_local
  },

  /**
   * 判断当前运行环境是否为Windows系统
   * @returns {boolean} 如果是Windows系统返回true，否则返回false
   */
  isWindows () {
    return this.running().is_windows
  },

  /**
   * 判断当前运行环境是否为Mac系统
   * @returns {boolean} 如果是Mac系统返回true，否则返回false
   */
  isMac () {
    return this.running().is_mac
  },

  /**
   * 判断当前设备是否为个人电脑，包括Windows和Mac
   * @returns {boolean} 如果是个人电脑返回true，否则返回false
   */
  isPC () {
    const r = this.running()
    return r.is_windows || r.is_mac
  },

  /**
   * 获取页面Behavior数组
   * @returns {Array} 包含页面行为模式的数组
   */
  behaviors(){
    return [ PAGE_BEHAVIORS, ]
  },

  /**
   * 根据点分路径获取小程序配置项的值。
   * @param {string} key - 配置项的键，支持'a.b.c'形式的路径。
   * @returns {*} 返回配置项的值，如果路径不存在，则返回undefined。
   */
  getConfig(key){
    const _ = this
    return _.pickValue(_.globalData().config, key)
  },


  // === 数据库 ===

  /**
   * 获取指定集合的引用，建议使用此方法代替默认的collection方法以避免误操作线上数据库
   * @param {string} c - 集合的名称
   * @returns {CollectionReference} 指定集合的引用
   */
  coll (c) {
    const _ = this
    return _._db().collection(_._collName(c))
  },

  /**
   * 获取数据库查询指令。
   * 返回一个对象，该对象包含用于构建数据库查询的各种方法。
   * 
   * @returns {Object} 数据库查询指令对象。
   */
  command () {
    return this._db().command
  },

  /**
   * 获取聚合查询指令。
   * 返回一个对象，该对象提供了进行复杂聚合查询的方法。
   * 
   * @returns {Object} 聚合查询指令对象。
   */
  aggregate () {
    return this._db().command.aggregate
  },

  /**
   * 返回聚合查询对象。
   * 便于对指定的集合执行聚合查询。
   * 
   * @param {string} c - 集合名称。
   * @returns {Object} 聚合查询对象。
   */
  agg (c) {
    const _ = this
    return _.coll(c).aggregate()
  },

  /**
   * 根据id获取数据
   * 
   * 如果文档不存在或文档超过1M大小，则返回null。
   * 此函数可以设置只返回特定字段或排除某些字段。
   * 
   * @param {string} c - 集合名称。
   * @param {string} id - 文档的ID。
   * @param {Object} options 包含以下属性的对象:
   *   - {string} only - 仅返回的字段，多个字段用逗号分隔，如：'title, content'。
   *   - {string} except - 不返回的字段。
   *   - {boolean} mine - 是否只读取用户自己的数据。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   * 
   * 注意：
   *   1. 当数据库权限设置为“自定义安全规则”且有“auth.openid == doc._openid”规则时，请使用getMyDoc代替，否则会返回null。
   *   2. 即使only中不包含_id字段，也会返回_id字段。若需排除_id字段，请使用except参数。
   *   3. only与except可以同时使用，但仅在需要排除_id字段时才有必要。
   * 
   * @example
   *   utils.getDoc('todo', 'id12345').then(doc => {
   *     console.log('Document:', doc)
   *   })
   */
  getDoc(c, id, {only = '', except = '', mine = false} = {}) {
    const _ = this
    const w = {_id: id}
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .limit(1)
        .field(_._makeField(only, except))
        .get()
        .then(res => {
          if (res.data.length > 0){
            resolve(res.data[0])
          } else {
            resolve(null)
          }
        })
        .catch(e => {
          resolve(null)
        })
    })
  },

  /**
   * 获取当前用户指定ID的文档。
   * 类似 `getDoc`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   * 
   * @param {string} c - 集合名称。
   * @param {string} id - 文档的ID。
   * @param {Object} options 包含以下属性的对象:
   *   - {string} only - 仅返回的字段。
   *   - {string} except - 不返回的字段。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getMyDoc(c, id, {only = '', except = ''} = {}) {
    return this.getDoc(c, id, {only, except, mine: true})
  },

  /**
   * 通过查询条件获取第一个匹配的文档
   * 
   * 如果启用last选项，则返回按index字段降序排列的最新文档。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * @param {Object} options 包含以下属性的对象:
   *   - {string} only - 仅返回的字段。
   *   - {string} except - 不返回的字段。
   *   - {boolean} mine - 是否只读取用户自己的数据。
   *   - {Object|string} order_by - 排序规则，与其他函数相同。
   *   - {boolean} last - 是否根据index字段获取index值最大的文档。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getOne(c, w, {only = '', except = '', mine = false, order_by = {}, last = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      let query = _.coll(c).where({...w, ...(mine ? {_openid: '{openid}'} : {})})

      if (last) {
        query = query.orderBy('index', 'desc')
      }else if (!_.isEmpty(order_by)) {
        order_by = _._prepareOrderBy(order_by)
        for (let k in order_by) {
          query = query.orderBy(k, order_by[k])
        }
      }

      query.limit(1)
        .field(_._makeField(only, except))
        .get()
        .then(res => {
          if(res.data.length > 0){
            resolve(res.data[0])
          } else {
            resolve(null)
          }
        })
        .catch(e => {
          reject({errno: 'utils.getOne Failed', errMsg: `coll:${c}, where:${w}`, e})
        })
    })
  },

  /**
   * 获取当前用户条件下的第一个文档。
   * 类似 `getOne`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * @param {Object} options - 传递给getOne的选项，包括only、except等。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getMyOne(c, w, options) {
    return this.getOne(c, w, {...options, mine: true})
  },

  /**
   * 获取当前用户在指定集合中最新创建的文档。
   * 集合中需有index字段，函数返回的是index值最大的文档。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件，默认为空。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getMyLastOne(c, w = {}) {
    return this.getOne(c, w, {mine: true, last: true})
  },

  /**
   * 获取当前用户在集合中唯一的一条数据，此集合的_openid字段为唯一索引。
   * 当集合中用户最多只有一条数据时（如用户的配置数据），可使用此函数。
   * 
   * @param {string} c - 集合名称。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getMyUniqueOne(c) {
    return this.getOne(c, {}, {mine: true})
  },

  /**
   * 向指定集合中添加一个文档
   * 
   * @param {string} c - 集合的名称
   * @param {Object} d - 要添加的文档数据
   * @returns {Promise<string>} Promise对象，解析返回新文档的ID
   * 
   * @example
   * // 用法1：使用 then 的方式获取返回的文档ID
   * utils.addDoc('todo', {title: '我要学习'})
   *      .then(id => {
   *        console.log('插入的新数据id:', id)
   *      })
   * 
   * @example
   * // 用法2：使用 async/await 的方式获取返回的文档ID
   * const id = await utils.addDoc('todo', {title: '我真的要学习'})
   * console.log('插入的新数据id:', id)
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

  /**
   * 从数据库中读取数据（最多返回20条数据）
   * 
   * 此函数支持多种查询和排序选项，可以针对特定的集合进行数据读取，支持分页和字段选择。
   * 
   * @param {Object} options 包含以下属性的对象:
   *   - {string} c - 集合名称，当运行在生产环境时会自动添加p_前缀
   *   - {Object} w - 查询条件，如：{status: '未完成'} 或 { 'people[0].name': '张三' }
   *   - {number} page_num - 页码，从0开始
   *   - {number} page_size - 每页大小，最大为20（微信限制每次最多读取20条数据）
   *   - {string} only - 仅返回的字段，如：'title, content'（_id默认会返回）
   *   - {string} except - 不返回的字段，如：'_openid, created'
   *   - {boolean} created - 是否添加创建时间，会添加4个字段：created、created_str、yymmdd、hhmmss
   *   - {Object|string} order_by - 排序规则。可以是简单的字符串或复杂的有序对象。
   *     - 当仅需根据某个字段升序排序时，可以直接写字段名，如：'rank'
   *     - 当需要使用多个字段或降序时，需用有序对象，如：{a: 'asc', b: 'desc', 'c.d.e': 1}
   *       - 升序可以写为：'asc'、1 或 true
   *       - 降序可以写为：'desc'、0 或 false
   *   - {boolean} mine - 是否只读取用户自己的数据，当使用了“自定义安全规则”且有"auth.openid == doc._openid"规则时，mine必须为true
   * 
   * @returns {Promise<Array>} Promise对象，解析返回文档数组
   * 
   * @example
   *   utils.docs({c: 'todo'}).then(todos => {
   *     console.log('读取的数据:', todos)
   *   })
   * 
   * @example
   *   const todos = await utils.docs({c: 'todo'})
   * 
   * 示例参数：
   *   const options = {
   *     c: 'todo',
   *     w: {status: '未完成'},
   *     page_num: 0,
   *     page_size: 20,
   *     only: 'title, content',
   *     except: '_id',
   *     created: true,
   *     order_by: {a: 'asc', b: 'desc', 'c.d.e': 1},
   *     mine: true
   *   };
   *   const docs = await utils.docs(options);
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

  /**
   * 读取用户自己的数据（与docs功能一样，只是mine参数默认为true）
   * @param {Object} options - 传递给docs函数的参数
   * @returns {Promise<Array>} Promise对象，解析返回用户文档数组
   */
  myDocs (options) {
    options.mine = true
    return this.docs(options)
  },

  /**
   * 获取某集合中所有文档数据。
   * 此函数使用聚合查询从数据库中连续多次读取数据，直到没有更多数据为止。一般用于数据量不大且不需要实现分页的场景。
   * 若每个文档的平均大小较大，可适当减小 page_size 的值，因为前端单次读取超过 5MB 会报错。
   * 为减少单次读取的数据量，建议尽量使用 only 或 except 参数。
   * 查询过程中会先执行 project，再执行 sort。
   * 
   * @param {Object} options - 配置参数，包括:
   *   - {string} c - 集合名称。
   *   - {Object} match - 匹配条件，默认为空对象。
   *   - {Object} project - 映射阶段 （参考：https://developers.weixin.qq.com/minigame/dev/wxcloud/reference-sdk-api/database/aggregate/Aggregate.project.html）
   *   - {Object} sort - 排序条件，默认按 _id 升序。
   *   - {boolean} mine - 是否仅查询用户自己的数据，默认为 false。
   *   - {number} page_size - 每次查询读取的文档数量，默认为 1000，暂无上限。
   *   - {boolean} show_loading - 是否显示加载动画，默认为 false。
   *   - {string} only - 仅包含指定字段。
   *   - {string} except - 排除指定字段。
   *   - {number} limit - 限制读取的文档数量。
   * @returns {Promise<Array>} 返回一个包含查询结果的数组。
   */
  allDocs ({c, match = {}, project = {}, sort = {_id: 1}, mine = false, page_size = 1000, show_loading = false, only = '', except = '', limit = null } = {}) {
    const _ = this
    let total = 0
    match = {...match, ...(mine ? {_openid: '{openid}'} : {})}
    if (!_.isEmpty(sort)) {
      sort = _._prepareSort(sort)
    }
    if (show_loading) {
      _.showLoading()
    }
    return new Promise(async (resolve, reject) => {
      let result = []
      let has_more = true
      let page_num = 0

      while (has_more) {
        let query = _.agg(c).match(match)

        if (!_.isEmpty(project)) { query = query.project(project) }

        // 先执行project，再执行only、except
        if (only || except) {
          query = query.project(_._makeField(only, except))
        }

        // 计算本次最多读取的文档数量
        let current_page_size
        if (limit) {
          current_page_size = Math.min(page_size, limit - total)
        } else {
          current_page_size = page_size
        }

        query = query.sort(sort).skip(page_num * page_size).limit(current_page_size)

        try {
          let res = await query.end()
          result = result.concat(res.list)
          total += res.list.length
          has_more = res.list.length === page_size && (!limit || total < limit)
          page_num++
        } catch (e) {
          reject({errno: 'allDoc Failed', errMsg: `query查询出错`, e})
          return
        }

      }

      if (limit && total > limit) {
        result = result.slice(0, limit)
      }

      if (show_loading) {
        _.hideLoading()
      }
      resolve(result)

    })
  },

  /**
   * 获取所有属于当前用户的文档。
   * 类似 `allDocs` ，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   * 
   * @param {Object} options - 同 allDocs 函数的参数。
   * @returns {Promise<Array>} 返回一个包含查询结果的数组。
   */
  allMyDocs ({c, match = {}, project = {}, sort = {_id: 1},  page_size = 1000, only = '', except = '', limit = null } = {}) {
    return this.allDocs({c, match, sort, project, mine: true, page_size, only, except, limit})
  },

  /**
   * 更新指定的文档
   * 此函数检查指定的文档ID，并根据提供的数据进行更新。它返回一个布尔值，指示更新是否成功执行。
   * 如果文档存在并且内容更新，则返回true。如果文档不存在或内容未发生变化，则返回false。
   * 
   * @param {string} c - 集合名称
   * @param {string} id - 文档ID，用于定位需要更新的文档
   * @param {Object} d - 包含更新数据的对象，支持点表示法更新嵌套字段，如：{'a.b.c': 1}
   * @param {Object} options - 可选参数，包括:
   *   - {boolean} mine - 是否仅更新用户自己的数据。当使用自定义安全规则且有"auth.openid == doc._openid"规则时，必须设置为true
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功更新。true表示更新成功，false表示失败。
   * 
   * @example
   *   const success = await utils.updateDoc('todo', 'id123456', {status: '已完成'})
   *   if (success) {
   *     console.log('更新成功')
   *   } else {
   *     console.log('无法更新，可能是由于文档不存在或数据未变更')
   *   }
   * 
   * 注意：在更新中，_openid和_id字段被过滤（微信不允许更新这两个字段，若更新会抛出异常。本函数允许你在参数d中传入_id和_openid，但会过滤掉这两个字段，实际上并不更新）。
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

  /**
   * 更新用户自己的数据（与updateDoc功能一样，只是mine参数默认为true）
   * @param {string} c - 集合名称
   * @param {string} id - 文档ID
   * @param {Object} d - 更新的数据
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功更新
   */
  updateMyDoc (c, id, d) {
    return this.updateDoc(c, id, d, {mine: true})
  },

  /**
   * 批量更新文档。该操作允许更新超过20条文档，上限未知。如果mine为false，则w（where条件）不能为空。
   * 注意事项：
   *   - 此函数不支持使用 $.set() 替换整个对象。
   *   - 如果更新值为undefined，则对应字段会被删除。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 匹配被更新文档的条件。
   * @param {Object} d - 需要更新的数据，支持点表示法，如：{'a.b.c': 1}。
   * @param {Object} [options={mine: false}] - 可选配置参数。
   * @returns {Promise<Number>} 返回一个 Promise 对象，解析为更新的文档数量。
   */
  updateMatch(c, w, d, {mine = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (_.isEmpty(w) && !mine) {
        reject({errno: 'updateMatch Failed', errMsg: `mine为false时w不能为空`})
      } else {
        _.coll(c)
          .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
          .update({
            data: _.undefinedToRemove(d)
          })
          .then(res => {
            resolve(res.stats.updated)
          })
          .catch(reject)
      }
    })
  },

  /**
   * 批量更新用户自己的文档。
   * 类似 `updateMatch`，但自动设置 `mine` 参数为 true，以确保只更新当前用户的数据。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 更新条件。
   * @param {Object} d - 需要更新的数据。
   * @returns {Promise<Number>} 返回一个 Promise 对象，解析为更新的文档数量。
   */
  updateMyMatch(c, w, d) {
    return this.updateMatch(c, w, d, {mine: true})
  },

  /**
   * 替换指定ID的文档为新的文档
   * @param {string} c - 集合名称。
   * @param {string} id - 文档的ID。
   * @param {Object} d - 新的文档数据。
   * @returns {Promise<Object>} 返回一个包含创建和更新状态的Promise对象。
   * @description 此操作与update不同，update仅使用文档d中的字段进行更新，不包含的字段不会删除。
   * 
   * 注意：
   *   1. 如果指定的id不存在，将创建一个新的文档。
   *   2. setDoc会删除现有文档中d中未包含的字段（重新设置），而updateDoc仅更新d中包含的字段。
   *   3. 用户必须拥有对数据的写权限。
   * 
   * @example
   *   utils.setDoc('todo', 'id123', { title: '重置任务', status: '未完成' })
   *     .then(({ created, updated }) => {
   *       if (created) {
   *         console.log('新文档已创建')
   *       } else if (updated) {
   *         console.log('文档已更新')
   *       }
   *     })
   */
  setDoc (c, id, d) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c)
        .doc(id)
        .set({
          data: d
        })
        .then(({stats}) => {
          resolve({created: stats.created === 1, updated: stats.updated === 1})
        })
        .catch(reject)
    })
  },

  /**
   * 删除指定的文档
   * 此函数用于删除集合中指定ID的文档。它返回一个布尔值，指示删除操作是否成功执行。
   * 如果文档存在并且被成功删除，则返回true。如果文档不存在或删除操作失败，则返回false。
   * 
   * @param {string} c - 集合名称，指明在哪个集合中执行删除操作
   * @param {string} id - 文档ID，用于定位需要删除的文档
   * @param {Object} options - 可选参数，包括:
   *   - {boolean} mine - 是否仅删除用户自己的数据。当使用自定义安全规则且有"auth.openid == doc._openid"规则时，必须设置为true
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功删除。true表示删除成功，false表示失败。
   * 
   * @example
   *   const success = await utils.removeDoc('todo', '123456', {mine: true});
   *   if (success) {
   *     console.log('文档删除成功');
   *   } else {
   *     console.log('删除失败，可能是由于文档不存在或其他原因');
   *   }
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

  /**
   * 删除用户自己的数据（与removeDoc功能一样，只是mine参数默认为true）
   * @param {string} c - 集合名称
   * @param {string} id - 文档ID
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功删除
   */
  removeMyDoc (c, id) {
    return this.removeDoc(c, id, {mine: true})
  },

  /**
   * 批量删除匹配条件的文档，可以删除超过20条文档（上限未知）。
   * @param {string} c - 集合名称。
   * @param {Object} w - 匹配被删除的文档的条件。
   * @param {Object} [options={mine: false}] - 可选参数，包括权限控制。
   * @returns {Promise<number>} 返回一个代表被删除文档数量的Promise对象。
   *
   * 注意：
   *   1. 如果mine为false，则w不能为空（{}）。
   *
   * @example
   *   utils.removeMatch('todo', { status: '已完成' })
   *     .then(removed => console.log(`删除了 ${removed} 个todo`));
   */
  removeMatch(c, w, {mine = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (_.isEmpty(w) && !mine) {
        reject({errno: 'removeMatch Failed', errMsg: `mine为false时w不能为空`})
      } else {
        _.coll(c)
          .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
          .remove()
          .then(res => {
            resolve(res.stats.removed)
          })
          .catch(reject)
      }
    })
  },

  /**
   * 删除当前用户匹配条件的文档。
   * @param {string} c - 集合名称。
   * @param {Object} w - 匹配被删除的文档的条件，可以为空或省略。
   * @returns {Promise<number>} 返回一个代表被删除文档数量的Promise对象。
   */
  removeMyMatch(c, w) {
    return this.removeMatch(c, w, {mine: true})
  },

  /**
   * 删除集合中的所有数据。建议此操作仅限前端管理员使用。
   * @param {string} c - 集合名称。
   * @returns {Promise<number>} 返回一个代表被删除文档数量的Promise对象。
   * @description 此操作极其危险，因此在云端不应存在此函数。函数执行前会显示一次确认对话框以防止误操作。
   * @example
   *   utils.removeAll('todo')
   *     .then(deletedCount => console.log(`删除了 ${deletedCount} 个todo`));
   */
  removeAll(c) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.confirm({
        title: '确认删除所有数据？',
        content: `集合：${c}`,
      })
        .then(() => {
          const $ = _.command()
          _.removeMatch(c, {_id: $.exists(true)}).then(resolve).catch(reject)
        })
        .catch(reject)
    })
  },

  /**
   * 删除当前用户的所有文档。
   * 类似 `removeMyAll`，但自动设置 `mine` 参数为 true，以确保只更新当前用户的数据。
   * @param {string} c - 集合名称。
   * @returns {Promise<number>} 返回一个代表被删除文档数量的Promise对象。
   */
  removeMyAll(c) {
    const _ = this
    const $ = _.command()
    const w = { _id: $.exists(true) }
    return _.removeMatch(c, w, {mine: true})
  },

  /**
   * 根据集合名和条件判断数据是否存在。
   * @param {string} c - 集合名称。
   * @param {string|Object} w_or_id - 查询条件或文档ID。
   * @param {Object} options
   *  - {boolean} mine - 是否只查询当前用户的数据。
   * @returns {Promise<boolean>} 返回一个布尔值的Promise，表示数据是否存在。
   */
  exists(c, w_or_id, {mine = false} = {}) {
    const _ = this
    const w = _.isString(w_or_id) ? {_id: w_or_id} : w_or_id
    return new Promise((resolve) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .limit(1)
        .get()
        .then(res => {
          if (res.data.length > 0) {
            resolve(true)
          } else {
            resolve(false)
          }
        })
    })
  },

  /**
   * 检查当前用户的数据是否存在。
   * 类似 `exists`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   * @param {string} c - 集合名称。
   * @param {string|Object} w_or_id - 查询条件或文档ID。
   * @returns {Promise<boolean>} 返回一个布尔值的Promise，表示数据是否存在。
   */
  myExists(c, w_or_id) {
    return this.exists(c, w_or_id, {mine: true})
  },

  /**
   * 获取集合中满足条件的文档数量。
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * @param {Object} options
   *  - {boolean} mine - 是否只查询当前用户的数据。
   * @returns {Promise<number>} 返回文档数量的Promise。
   */
  count (c, w = {}, {mine = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .count()
        .then(res => {
          resolve(res.total)
        })
        .catch(e => {
          reject(e)
        })
    })
  },

  /**
   * 获取当前用户集合中满足条件的文档数量。
   * 类似 `count`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * @returns {Promise<number>} 返回文档数量的Promise。
   */
  myCount (c, w = {}) {
    return this.count(c, w, {mine: true})
  },

  /**
   * 获取集合中某字段的最大值。
   * @param {string} c - 集合名称。
   * @param {string} feild - 字段名称，支持点表示法。
   * @param {Object} options
   *   - {Object} w - 查询条件，默认为空对象。
   *   - {boolean} mine - 是否只查询当前用户的数据。
   *   - {any} default_value - 如果没有符合条件的文档，返回的默认值，默认为null。
   *   - {string} _order_by - 排序方式，'asc'表示升序，'desc'表示降序，默认为'desc'。
   * @returns {Promise<any>} 如果有符合条件的文档，返回字段的最大值，否则返回默认值或null。
   * @example
   * let max_value = await utils.getMaxFeild(c, feild, {default_value: 0})
   */
  getMaxFeild (c, feild, {w = {}, mine = false, default_value = null, _order_by = 'desc'} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where({...w, ...(mine ? {_openid: '{openid}'} : {})})
        .orderBy(feild, _order_by) // orderBy支持点表示法
        .limit(1)
        .get()
        .then(res => {
          if (res.data.length > 0) {
            resolve(res.data[0][feild])
          } else {
            resolve(default_value)
          }
        })
        .catch(reject)
    })
  },

  /**
   * 获取集合中某字段的最小值。
   */
  getMinFeild (c, feild, {w = {}, mine = false, default_value = null} = {}) {
    return this.getMaxFeild(c, feild, {w, mine, default_value, _order_by: 'asc'})
  },

  /**
   * 获取当前用户集合中某字段的最大值。
   * 类似 `getMaxFeild`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   */
  getMaxMyFeild (c, feild, {w = {}, default_value = null} = {}) {
    return this.getMaxFeild(c, feild, {w, mine: true, default_value})
  },

  /**
   * 获取当前用户集合中某字段的最小值。
   * 类似 `getMinFeild`，但自动设置 `mine` 参数为 true，以确保只查询当前用户的数据。
   */
  getMinMyFeild (c, feild, {w = {}, default_value = null} = {}) {
    return this.getMinFeild(c, feild, {w, mine: true, default_value})
  },

  /**
   * 递归搜索，把obj对象中所有undefined设置为数据库删除命令。
   * `undefinedToRemove`函数通过递归检查对象或数组中的每个元素，将值为undefined的属性替换为数据库删除命令。
   * @param {Object|Array} obj - 需要处理的对象或数组。
   * @returns {Object|Array} 返回处理后的新对象或数组。
   *
   * @example
   *   // 把数据库中doc为undefined的属性删除（递归搜索所有undefined）
   *   doc2 = utils.undefinedToRemove(doc)
   *   utils.updateDoc('todo', 'id123', doc2)
   */
  undefinedToRemove(obj){
    const _ = this
    const $ = _.command()
    obj = _.deepCopy(obj) // 需要保留undefined值，所以不使用jsonDeepcopy

    function _remove(obj){
      if (_.isObject(obj)) {
        for (let key in obj) {
          if (obj[key] === undefined) {
            obj[key] = $.remove()
          } else if (_.isObjectOrArray(obj[key])) {
            _remove(obj[key])
          }
        }
      } else if (_.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          if (_.isObjectOrArray(obj[i])) {
            _remove(obj[i])
          }
        }
      }
    }

    _remove(obj)
    return obj
  },


  /* === 对象 === */

  /**
   * 判断值是否为undefined或null
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为undefined或null，返回true；否则返回false
   */
  isNone (i) {
    return i === undefined || i === null
  },

  /**
   * 判断值是否为空对象{}、空数组[]、空字符串''、空内容串'  '、undefined或null
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为空返回true；否则返回false
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

  /**
   * 判断值是否为数组
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为数组，返回true；否则返回false
   */
  isArray(i){
    return Array.isArray(i)
  },

  /**
   * 判断值是否为对象（不包括数组、null和undefined）
   * 
   * 在JavaScript中，数组和null的typeof也是'object'，但此函数会排除这些情况。
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为对象（不包括数组、null和undefined），返回true；否则返回false
   */
  isObject(i){
    const _ = this
    return typeof i === 'object' && !_.isArray(i) && !_.isNone(i)
  },

  /**
   * 判断输入是否为对象或数组。
   * @param {*} i - 待检查的输入。
   * @returns {boolean} 如果输入是对象或数组，则返回true，否则返回false。
   */
  isObjectOrArray(i){
    const _ = this
    return _.isObject(i) || _.isArray(i)
  },

  /**
   * 判断值是否为字符串
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为字符串，返回true；否则返回false
   */
  isString(i){
    return typeof i === 'string' || i instanceof String
  },

  /**
   * 深拷贝对象或数组，保留undefined和null值。
   * @param {Object|Array} obj - 要拷贝的对象或数组。
   * @returns {Object|Array} 深拷贝后的新对象或数组。
   */
  deepCopy(obj) {
    const _ = this
    if (typeof obj !== 'object' || obj === null || obj === undefined) {
      return obj
    } else if (_.isArray(obj)) {
      return obj.map(_.deepCopy.bind(_))
    } else {
      const ret = {}
      for (let key in obj) {
        ret[key] = _.deepCopy(obj[key])
      }
      return ret
    }
  },

  /**
   * 从对象中按照路径提取属性的值。
   * @param {Object} obj - 源对象。
   * @param {string} key - 属性路径，支持'a.b.c'形式。
   * @returns {*} 提取的值，如果路径不存在则返回undefined。
   */
  pickValue(obj, key){
    const _ = this
    if (key.includes('.')) {
      let ks = key.split('.')
      for (let i = 0; i < ks.length; i++) {
        obj = obj[ks[i]]
        if (_.isNone(obj)) {
          return obj
        }
      }
      return obj
    } else {
      return obj[key]
    }
  },

  /**
   * 向对象中按照路径赋值，如果路径上的中间对象不存在，则自动创建。
   * @param {Object} obj - 目标对象。
   * @param {string} key - 属性路径，支持'a.b.c'形式。
   * @param {*} value - 要设置的值。
   * @param {Object} [options={}] - 可选参数。
   *   - {boolean} remove_undefined - 如果为true且value为undefined，则删除该属性。
   * @throws {Error} 如果obj为null或undefined，或路径不合法（如中间非对象）则抛出异常。
   */
  putValue(obj, key, value, {remove_undefined = true} = {}){
    const _ = this

    if (key.includes('.')) {

      let ks = key.split('.')
      let current, pre, i

      for (i = 0; i < ks.length; i++) {

        if(i === 0){
          pre = null
          current = obj
        } else {
          pre = current
          current = current[ks[i-1]]
        }

        if (_.isNone(current)) {
          if(i === 0){
            throw new Error('传给utils.putValue的obj不能为null或undefined')
          } else {
            current = pre[ks[i-1]] = {}
          }
        } else if(!_.isObject(current)) {
          break
        }

      }

      if (i === ks.length) {
        if (value === undefined && remove_undefined) {
          delete current[ks[i-1]]
        } else {
          current[ks[i-1]] = value
        }
      } else {
        throw new Error(`传给utils.putValue的key ${key} 不合法，因为${ks[i-1]}不是对象`)
      }

    } else {
      if (_.isNone(obj)) {
        throw new Error('传给utils.putValue的obj不能为null或undefined')
      } else {
        if (value === undefined && remove_undefined) {
          delete obj[key]
        } else {
          obj[key] = value
        }
      }
    }
  },

  /**
   * 将值推入对象指定路径的数组中，若路径或数组不存在则自动创建。
   * @param {Object} obj - 目标对象。
   * @param {string} key - 数组属性的路径，支持'a.b.c'形式。
   * @param {*} value - 要推入的值。
   * @throws {Error} 如果路径不是数组，则抛出异常。
   */
  pushValue(obj, key, value){
    const _ = this
    const exists = _.pickValue(obj, key)
    if (_.isNone(exists)) {
      _.putValue(obj, key, [value])
    } else if (_.isArray(exists)) {
      exists.push(value)
    } else {
      throw new Error(`传给utils.pushValue的key ${key} 不合法，因为${key}不是数组`)
    }
  },

  /**
   * 从对象中挑选指定的属性，构造一个新对象。
   * @param {Object|Array} obj - 源对象或数组。
   * @param {Array<string>} keys - 要挑选的属性列表。
   * @returns {Object|Array} 新对象或其数组，只包含指定的属性。
   */
  pickObj(obj, keys){
    const _ = this
    if (_.isArray(obj)) {
      return obj.map(o => _.pickObj(o, keys))
    } else {
      let new_obj = {}
      keys.forEach(key => {
        if (obj.hasOwnProperty(key)) {
          new_obj[key] = obj[key]
        }
      })
      return new_obj
    }
  },

  /**
   * 返回一个字符串或对象的字节数（比特）。object转json后会增加几个字节。
   * 
   * @param {any} obj - 要计算字节长度的对象或字符串
   * @param {boolean} add_key_bytes - 是否添加 size_k 的字节数，默认为 `false`
   *   通常情况下，你需要把对象的字节数保存到一个 size_k 的字段中，这时需要把这个字段的字节数也计算在内。
   *   当 add_key_bytes 为true时，默认增加20个字节，用于增加 size_k 的字节数（估算值）。
   * @returns {number} 返回计算后的字节长度
   */
  getByteLen (obj, add_key_bytes = false) {
    // 如果obj不是字符串,则json化
    if (typeof obj !== 'string') {
      obj = JSON.stringify(obj)
    }
    let len = 0
    for (let i = 0; i < obj.length; i++) {
      len += obj.charAt(i).match(/[^\x00-\xff]/ig) !== null ? 2 : 1
    }
    return add_key_bytes ? len + 20 : len
  },

  /**
   * 返回一个字符串或对象有多少K（仅保留一位小数）。
   * 
   * @param {any} obj - 要计算 K 长度的对象或字符串
   * @returns {string} 返回计算后的 K 长度，保留一位小数
   */
  getKLen (obj, add_key_bytes = true) {
    return (this.getByteLen(obj, add_key_bytes) / 1024).toFixed(1)
  },

  /* === 字符串 === */

  /**
   * 按指定字符拆分字符串，返回拆分后的数组
   * 
   * 此函数会过滤掉拆分后的空字符串，并去除每个元素两边的空白。
   * 
   * @param {string} s - 要拆分的字符串
   * @param {string} [char=' '] - 用于拆分的字符，默认为空格
   * @returns {Array<string>} 拆分后的字符串数组，已过滤空字符串并去除元素两边空白
   */
  split (s, char = ' ') {
    return s.split(char).map(i => i.trim()).filter(i => i.length > 0)
  },


  /*  === 数组、列表  === */

  /**
   * 判断某个元素是否在数组、对象的键或字符串中
   * 
   * 如果arr是数组，判断item是否在数组arr中；
   * 如果arr是对象，判断item是否在对象arr的键中；
   * 如果arr是字符串，判断子串item是否在字符串arr中。
   * 
   * @param {*} item - 要查找的元素
   * @param {Array|Object|string} arr - 要查找的数组、对象或字符串
   * @returns {boolean} 如果item在arr中，返回true；否则返回false
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

  /**
   * 从数据_id中获取时间，返回Date对象
   * 
   * 系统使用什么时区，就返回什么时区的时间（以插入数据时的时区决定）。
   * 建议在云函数中把时区转换为上海时区，即添加 TZ=Asia/Shanghai 配置。
   * 
   * @param {string} id - 数据的_id
   * @returns {Date} 从_id中解析出的时间
   */
  getTimeFromId (id) {
    let t = parseInt(id.substring(8, 16), 16) * 1000
    return new Date(t)
  },

  /**
   * 返回时间的年月日字符串
   * 
   * @param {Date} t - 要格式化的时间
   * @returns {string} 格式为'yyyy-MM-dd'的日期字符串，如：'2023-07-01'
   */
  yymmdd (t) {
    let y = t.getFullYear()
    let m = (t.getMonth() + 1).toString().padStart(2, '0')
    let d = t.getDate().toString().padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  /**
   * 返回时间的时分秒字符串
   * 
   * @param {Date} t - 要格式化的时间
   * @returns {string} 格式为'HH:mm:ss'的时间字符串，如：'01:02:03'
   */
  hhmmss (t) {
    let h = t.getHours().toString().padStart(2, '0')
    let m = t.getMinutes().toString().padStart(2, '0')
    let s = t.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  },

  /**
   * 返回时间的完整字符串
   * 
   * 未传入参数时，返回当前时间的字符串。
   * 
   * @param {Date} [t] - 要格式化的时间，默认为当前时间
   * @returns {string} 格式为'yyyy-MM-dd HH:mm:ss'的完整时间字符串，如：'2023-07-01 01:02:03'
   */
  dateToString (t) {
    if (t === undefined) { t = new Date() }
    if (!t) { return '' }
    return this.yymmdd(t) + ' ' + this.hhmmss(t)
  },


  /* === 私有辅助 === */

  /**
   * 返回数据库访问对象
   * 
   * @returns {Object} 数据库访问对象
   */
  _db () {
    return APP().cloud.database()
  },

  /**
   * 生产环境下给集合名称添加p_前缀(all_前缀的集合除外)
   * 
   * @param {string} c - 集合名
   * @returns {string} 添加前缀后的集合名
   */
  _collName(c){
    const _ = this
    if( !_.isLocal() && !c.startsWith('all_') ){
      c = 'p_' + c
    }
    return c
  },

  /**
   * 用于创建数据查询需要返回或排除的字段
   * 
   * only和except是用逗号分隔的字符串，如：'_id, content'。
   * 
   * @param {string} [only=''] - 需要返回的字段，多个字段用逗号分隔
   * @param {string} [except=''] - 需要排除的字段，多个字段用逗号分隔
   * @returns {Object} 字段映射对象，需要返回的字段值为true，需要排除的字段值为false
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

  /**
   * 把order_by参数转换为云数据库需要的格式
   * 
   * 若order_by是字符串，则视为按此字段升序排序，返回 {[order_by]: 'asc'}；
   * 若order_by是对象，则value可以是asc, desc, 1, -1, true, false。
   * 
   * @param {string|Object} order_by - 排序参数
   * @returns {Object} 转换后的排序对象
   * @throws {Error} 当order_by不是字符串或对象时抛出错误
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

  /**
   * 准备排序参数。
   * @param {string|Object} sort - 排序字段或对象。
   * @returns {Object} 返回排序参数对象。
   * @throws {Error} 如果sort参数既不是字符串也不是对象，抛出异常。
   */
  _prepareSort (sort){
    const _ = this
    if (_.isString(sort)) {
      return {[sort]: 1}
    } else if(_.isObject(sort)) {
      const ret = {}
      for (let k in sort) {
        ret[k] = _.in(sort[k], ['asc', 1, true]) ? 1 : -1
      }
      return ret
    } else {
      // 抛出异常
      throw new Error(`sort must be string or object, but got ${sort}`)
    }
  },


  /* === 其他 === */

  /**
   * 显示加载提示框。
   * @param {Object} [options={title: '加载中...'}]
   * @returns {Promise} 返回一个Promise对象。
   */
  showLoading ({title = '加载中...'} = {}) {
    return wx.showLoading({ title, mask: true })
  },

  /**
   * 隐藏加载提示框。
   * @returns {Promise} 返回一个Promise对象。
   */
  hideLoading () {
    return wx.hideLoading()
  },

  /**
   * 显示确认对话框，并在用户点击确认后执行后续操作。
   * 点击取消时，如果设置`cancel_catch`为true，则触发Promise的reject。
   * @param {Object} options 包含以下属性的对象:
   *   - {string} title - 对话框标题。
   *   - {string} [content=''] - 对话框内容。
   *   - {string} [confirmText='好的'] - 确认按钮的文本。
   *   - {string|null} [confirmColor=null] - 确认按钮的颜色，未设置时基于`confirmText`自动选择。
   *   - {string} [cancelText='取消'] - 取消按钮的文本。
   *   - {boolean} [showCancel=true] - 是否显示取消按钮。
   *   - {boolean} [cancel_catch=false] - 点击取消时是否触发Promise的reject。
   * @returns {Promise} 根据用户的选择解决或拒绝Promise。
   */
  confirm ({title, content = '', confirmText = '好的', confirmColor = null, cancelText = '取消', showCancel = true, cancel_catch = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (confirmColor === null) {
        confirmColor = _.in('删除', confirmText) ? _.getConfig('color.danger') : _.getConfig('color.ok')
      }
      if (title){
        wx.showModal({
          title,
          content,
          showCancel: true,
          confirmText,
          confirmColor,
          cancelText,
          showCancel,
          cancelColor: _.getConfig('color.cancel'),
        }).then( res => {
          res.confirm ? resolve() : cancel_catch ? reject() : null
        })
      }else{
        reject({errno: 'confirm Failed', errMsg: '请传入title参数'})
      }
    })
  },


}

export default utils
