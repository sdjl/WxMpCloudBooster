'use strict'

const APP = getApp // 不要在这里执行getApp()，因为可能会返回undefined
const PAGE_BEHAVIORS = [require('page_behaviors'), ] // 所有小程序都使用的Behavior
const WINDOW_INFO = wx.getWindowInfo()

const utils = {

  /* === 运行环境 === */

  /**
   * 调用云函数。
   * 
   * @param {object} [options] - 可选参数
   * @param {string} [options.name] - 云函数的名称
   * @param {string} [options.action=''] - 云函数的动作
   * @param {object} [options.data={}] - 传给云函数的数据
   * @param {boolean|null} [options.force_online=null] - 是否强制使用线上环境
   * @param {number|null} [options.timeout=null] - 超时时间
   * @returns {Promise} 返回一个 Promise，resolve 时返回云函数的结果
   */
  call ({ name, action = '', data = {}, force_online = null, timeout = null } = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      let is_local = typeof force_online === 'boolean' ? !force_online : _.isLocal()
      let timeout_id, timeout_done = false;

      // 设置超时（timeout为null时会使用全局超时时间）
      if (timeout !== null) {
        timeout_id = setTimeout(() => {
          timeout_done = true // 超时了，防止后续回调函数继续执行
          reject({ errno: 'TIMEOUT', errMsg: `云函数调用超时(${timeout}ms)` })
        }, timeout)
      }

      _._cloud().callFunction({
        name: name,
        // 把当前运行环境告知云函数
        data: { ...data, ...{is_local, action}},
        // callFunction并不支持设置一个超时时间
      })
        .then(res => {
          // 清除超时逻辑
          if (timeout_id) clearTimeout(timeout_id);
          if (timeout_done) return;

          // 本地开发运行环境访问了正式环境的云函数,被云函数拒绝
          if (res.result === 'ENV_ERROR') {
            if (force_online === null) {
              reject({errno: 'ENV_ERROR', errMsg: `请打开本地云函数(${name})的调试`})
            } else {
              reject({errno: 'ENV_ERROR', errMsg: `请把 force_online 设置为 ${!force_online}`})
            }

          } else if (res.result === 'APP_ERROR') {

            // 云函数要求仅部分小程序可以访问
            reject({errno: 'APP_ERROR', errMsg: `云函数已禁止${_.getConfig('app_name')}访问`})

          } else if (res.result === 'NOT_ADMIN') {
            resolve({})
          } else {
            resolve(res.result)
          }

        })
        .catch(e => {
          if (timeout_id) clearTimeout(timeout_id);
          if (timeout_done) return;
          reject(e)
        })
    })
  },

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
   * 根据点分路径获取小程序配置项的值。
   * @param {string} key - 配置项的键，支持'a.b.c'形式的路径。
   * @returns {*} 返回配置项的值，如果路径不存在，则返回undefined。
   */
  getConfig(key){
    const _ = this
    return _.pickValue(_.globalData().config, key)
  },

  /**
   * 判断当前小程序是否为admin项目，需在app.js文件中的globalData.running.is_first_app中设置。
   * 通常，一个云环境会共享给多个小程序，WxMpCloudBooster默认第一个小程序会绑定云环境ID，然后共享给其他小程序使用。
   * 而这个第一个小程序作为其他被共享的所有小程序的admin管理后台使用。
   * 因此第一个小程序也也称之为后台管理小程序，需在app.js中设置为true。
   * 而其他被共享的小程序需在app.js中设置为false。
   * @returns {boolean} 如果当前运行的项目是后台admin，则返回true
   */
  isFirstApp () {
    return this.running().is_first_app
  },

  /**
   * 异步请求云函数获取openid
   * @return {Promise<string|null>} 返回openid或null
   * 
   * @example
   * const openid = await utils.openid()
   *
   * 注意：
   *   1. 此函数会使用缓存，多次调用不会重复触发网络请求。
   *   2. 从第二次调用开始不再消耗“调用次数”。
   *   3. 并不能保证一定能获取到openid，可能会返回null（如网络异常时）。
   */
  openid () {
    const _ = this
    return new Promise(async (resolve, reject) => {
      const cached_openid = _.getCache('my_openid') || ''
      if (!_.isEmpty(cached_openid)) {
        resolve(cached_openid)
      } else {
        _.call({
          name: 'all_user',
          action: 'GetMyOpenid',
          data: {},
        }).then(({ openid }) => {
          if (!_.isEmpty(openid)) {
            _.setCache('my_openid', openid)
          } else {
            _.error({title: '云端返回openid为空', openid})
          }
          resolve(openid || null)
        })
          .catch(e => {
            reject({errno: 'openid Failed', errMsg: `访问云函数获取openid错误`, e})
          })
      }
    })
  },

  /**
   * 将小程序的cloudID转换为云函数可用的敏感数据。
   * 此方法主要用于处理通过小程序端传递的敏感信息。
   * @param {string} cloud_id - 小程序端传递的cloudID。
   * @returns {Object} 返回云函数可接受的敏感数据对象。
   */
  cloudID (cloud_id) {
    const _ = this
    return _._cloud().CloudID(cloud_id)
  },

  /**
   * 等待wx.cloud初始化完成后再执行后续操作。
   * @returns {Promise<void>} 返回一个Promise，当cloud初始化完成时resolve。
   *
   * @example
   *   // 通常在Page.onLoad()中使用，确保云服务已准备就绪
   *   onLoad(options){
   *     utils.cloudReady().then(() => {
   *       console.log('Cloud is ready!')
   *     })
   *   },
   *
   * @example
   *   onLoad(options){
   *     utils.cloudReady().then(() => { this.cloudReadyOnLoad(options) })
   *   },
   *   
   *   cloudReadyOnLoad(options){
   *     // 此时wx.cloud已经完成初始化，可以使用云服务API
   *   },
   *     
   */
  cloudReady(){
    const _ = this
    return new Promise((resolve, reject) => {
      const running = _.globalData().running
      if (running.is_cloud_ready) {
        resolve()
      } else {
        running._cloud_ready_promises ??= []
        running._cloud_ready_promises.push(resolve)
        // 下面这个语句只会执行一次，但在cloud准备好之前可能会多次调用cloudReady
        // 所以要把resolve放在列表中，cloud准备好后一并执行
        Object.defineProperty(running, '_set_cloud_ready', {
          configurable: true,
          enumerable: false,
          set(value) {
            if (value === true) {
              delete running._set_cloud_ready
              running.is_cloud_ready = true
              running._cloud_ready_promises.forEach(p => p())
              delete running._cloud_ready_promises
            }
          }
        })
      }
    })
  },

  /**
   * 检查云服务是否已经准备就绪，需要调用过cloudReady方法后才能使用。
   * @returns {boolean} 如果云服务已准备就绪，返回true，否则返回false。
   */
  isCloudReady(){
    return this.globalData().running.is_cloud_ready
  },

  /**
   * 返回两组Behavior，一组是所有小程序通用的，一组是当前小程序使用的。
   * 
   * @returns {Array} 返回行为数组
   */
  behaviors(){
    const _ = this
    const this_app_behaviors = _.globalData().behaviors ?? []
    return [...PAGE_BEHAVIORS, ...this_app_behaviors]
  },


  /* === 日志 === */

  /**
   * 打印日志信息。
   * 此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj - 要记录的消息对象。
   *
   * 注意：
   *   当你使用console.log打印时对象时，打印的输出结果可能不是你调用console.log时的值，因为console.log是异步的。
   *   举个例子，如果有对象obj的属性abc=1，即obj.abc=1，然后使用console.log(obj)打印obj对象，然后立即调用了obj.abc=2
   *   那么你在控制台看到的obj对象的abc属性可能是2，而不是1。
   *   因此，总是建议使用utils.log方法来打印对象日志（字符串、数字等非对象变量可使用console.log）
   */
  log(obj) {
    const _ = this
    obj = _._logToObj(_.jsonDeepcopy(obj))
    _._logger().log(obj) 
  },

  /**
   * 打印信息级别的日志。与log方法类似，确保消息数据在打印前进行深拷贝，以保证数据的准确性。
   * @param {Object} obj - 要记录的信息级别的消息对象。
   */
  info(obj) {
    const _ = this
    obj = _._logToObj(_.jsonDeepcopy(obj))
    _._logger().info(obj)
  },

  /**
   * 打印警告级别的日志。此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj - 要记录的警告级别的消息对象。
   */
  warn(obj) {
    const _ = this
    obj = _._logToObj(_.jsonDeepcopy(obj))
    _._logger().warn(obj) 
  },

  /**
   * 打印错误级别的日志。此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj - 要记录的错误级别的消息对象。
   */
  error(obj) {
    const _ = this
    obj = _._logToObj(_.jsonDeepcopy(obj))
    _._logger().error(obj) 
  },

  /**
   * 将日志数据记录到数据库的特定集合中。这通常用于持久化重要的日志信息。
   * 使用此函数请先创建log和p_log两个集合，以便存储日志信息。
   * @param {string} title - 日志标题，用于标识或简单描述这条日志信息。
   * @param {Object} obj - 日志内容对象，将被深拷贝以保持数据在写入前的完整性。
   */
  logToColl (title, obj) {
    const _ = this
    const coll = 'log'
    obj = _.deepCopy(obj)
    _.addDoc(coll, {title, obj, time: _.dateToString()})
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
   * 判断值是否为对象（不包括数组、null和undefined、时间对象）
   * 
   * 在JavaScript中，数组和null的typeof也是'object'，但此函数会排除这些情况。
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为对象（不包括数组、null和undefined），返回true；否则返回false
   */
  isObject(i){
    const _ = this
    return typeof i === 'object' && !_.isArray(i) && !_.isNone(i) && !_.isDate(i)
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
   * 判断是否是Set。
   * 
   * @param {any} i - 被判断的值
   * @returns {boolean} 如果值是Set，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isSet(new Set([1, 2, 3])) // true
   */
  isSet(i){
    return i instanceof Set
  },

  /**
   * 判断是否是函数。
   * 
   * @param {any} i - 被判断的值
   * @returns {boolean} 如果值是函数，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isFunction(function () {}) // true
   */
  isFunction(i){
    return typeof i === 'function'
  },

  /**
   * 判断值是否为布尔值。
   * 
   * @param {any} i - 被判断的值
   * @returns {boolean} 如果值是布尔值，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isBoolean(true) // true
   */
  isBoolean(i){
    return typeof i === 'boolean'
  },

  /** 
   * 判断是否是时间对象。
   * 
   * @param {any} i - 被判断的值
   * @returns {boolean} 如果值是时间对象，返回 `true`；否则返回 `false`。
   */
  isDate(i){
    return i instanceof Date
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
   * 将一个对象的所有属性按路径添加到另一个对象中。
   * @param {Object} obj - 目标对象。
   * @param {Object} obj_value - 要添加的属性对象，键支持'a.b.c'形式的路径。
   * @param {Object} [options={}] - 可选参数。
   *   - {boolean} remove_undefined - 如果为true且value为undefined，则删除该属性。
   * @throws {Error} 如果obj为null或undefined，或路径不合法（如中间非对象）则抛出异常。
   *
   * @example
   *   const obj = {a: 1}
   *   const obj_value = {'b.c.d': 2, b: {e: 3}}
   *   utils.putObj(obj, obj_value)
   *   console.log(obj) // { a: 1, b: { c: { d: 2 }, e: 3 } }
   * 
   * 注意
   *   若obj_value中出现重复路径，则后者会覆盖前者。
   *   如 obj_value = {a: {b: 1}, 'a.b': 2}，则结果为 {a: {b: 2}}
   */
  putObj(obj, obj_value, { remove_undefined = true} = {}) {
    const _ = this
    function _put(pre_path, o_value) {
      for (let key in o_value) {
        const value = o_value[key]
        if (_.isObject(value)) {
          _put(`${pre_path}${key}.`, value)
        } else {
          _.putValue(obj, `${pre_path}${key}`, value, { remove_undefined })
        }
      }
    }
    _put('', obj_value)
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
   * 从对象中挑选指定的属性，构造一个新对象。
   * @param {Object|Array} obj - 源对象或数组。
   * @param {Array<string>} keys - 要挑选的属性列表，支持'a.b.c'形式。
   * @returns {Object|Array} 新对象或其数组，只包含指定的属性。
   */
  pickObj(obj, keys){
    const _ = this
    if (_.isArray(obj)) {
      return obj.map(o => _.pickObj(o, keys))
    } else {
      let new_obj = {}
      keys.forEach(key => {
        new_obj[key] = _.pickValue(obj, key)
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

  /**
   * 判断多个值是否有任意一个为空。
   * 
   * @param {...any} args - 被判断的值
   * @returns {boolean} 如果任意一个值为空，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isAnyEmpty('', '123') // true
   */
  isAnyEmpty (...args) {
    const _ = this
    return args.some(_.isEmpty.bind(_))
  },

  /**
   * 判断两个对象是否完全相等，需递归比较每一个属性值，包括null、undefined也要相等。
   * 
   * @param {any} a - 第一个对象
   * @param {any} b - 第二个对象
   * @returns {boolean} 如果两个对象完全相等，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isEqual({ a: 1, b: 2 }, { b: 2, a: 1 }) // true
   */
  isEqual (a, b) {
    const _ = this
    if (a === b) return true
    if (_.isNone(a) || _.isNone(b)) return false
    if (_.isArray(a) && _.isArray(b)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!_.isEqual(a[i], b[i])) return false
      }
      return true
    }
    if (_.isObject(a) && _.isObject(b)) {
      if (Object.keys(a).length !== Object.keys(b).length) return false
      for (let k in a) {
        if (!_.isEqual(a[k], b[k])) return false
      }
      return true
    }
    if (_.isSet(a) && _.isSet(b)) {
      if (a.size !== b.size) { return false }
      for (let i of a) {
        if (!b.has(i)) { return false }
        return true
      }
    }
    return false
  },

  /**
   * 判断对象是否有某个属性，可以传入多个key。
   * 
   * @param {Object} obj - 被判断的对象
   * @param {...string} keys - 要判断的属性名
   * @returns {boolean} 如果对象有任意一个属性名，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.hasAnyKey({ a: 1, b: 2 }, 'a', 'c') // true
   */
  hasAnyKey (obj, ...keys) {
    return keys.some(key => obj.hasOwnProperty(key)) // hasOwnProperty不检查原型链，而in会检查原型链
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
   * 深度拷贝，会忽略undefined、null。
   * 此函数会先把对象转为json字符串，再转回对象
   * 
   * @param {any} i - 被复制的值
   * @returns {any} 返回复制后的值。
   * 
   * @example
   * utils.jsonDeepcopy({ a: 1, b: null }) // { a: 1 }
   */
  jsonDeepcopy (i) {
    return JSON.parse(JSON.stringify(i))
  },

  /**
   * 把对象转为json字符串。
   * 
   * @param {any} i - 被转换的对象
   * @returns {string} 返回对象转换后的json字符串。
   * 
   * @example
   * utils.toJsonString({ a: 1, b: 2 }) // '{"a":1,"b":2}'
   */
  toJsonString (i) {
    return JSON.stringify(i)
  },

  /**
   * 把json字符串转为对象。
   * 
   * @param {string} i - 被转换的json字符串
   * @returns {any} 返回json字符串转换后的对象。
   * 
   * @example
   * utils.fromJsonString('{"a":1,"b":2}') // { a: 1, b: 2 }
   */
  fromJsonString (i) {
    return JSON.parse(i)
  },

  /**
   * 传入obj和del_key, 递归删除obj中所有名字为del_key的属性。obj可能是数组或对象。
   * 注意：在原对象上修改。
   * 
   * @param {Object|Array} obj - 要删除属性的对象或数组
   * @param {string} del_key - 要删除的属性名
   * 
   * @example
   *   let obj = { a: 1, b: { a: 2, c: 3 } }
   *   utils.deleteAllKey(obj, 'a') 
   *   console.log(obj) // { b: { c: 3 } }
   */
  deleteAllKey (obj, del_key) {
    const _ = this
    if (_.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        _.deleteAllKey(obj[i], del_key)
      }
    } else if (_.isObject(obj)) {
      for (let key in obj) {
        if (key === del_key) {
          delete obj[key]
        } else if (typeof obj[key] === 'object') {
          _.deleteAllKey(obj[key], del_key)
        }
      }
    }
  },

  /**
   * 递归遍历obj中的所有属性，并对每个属性值执行fn函数，在原来的位置保存fn函数的返回值。
   * fn返回undefined时不会删除属性，而是赋值为null。
   * fn = (v, obj) => {}，其中obj是当前属性所在的对象。
   * 
   * @param {Object|Array} obj - 要遍历的对象或数组
   * @param {string} key - 要匹配的属性名
   * @param {Function} fn - 对匹配的属性值执行的函数
   * @param {Object} [options]
   *   - {boolean} [options.over_write=true] - 是否覆盖原来的值
   * @param {boolean} [options.over_write=true] - 是否覆盖原来的值
   *
   * 注意
   *   1. 若over_write为true，则会覆盖key属性原来的值。
   *   2. 当不希望覆盖key属性值，只是想要对key属性值进行操作时，可以设置over_write为false。
   *   3. 在fn函数中，obj是根据key匹配到的属性值。举个例子，若在下面的例子中，key为'b'，则obj是{ a: 2, c: 3 }。
   * 
   * @example
   *   let obj = { a: 1, b: { a: 2, c: 3 } }
   *   utils.allKeyMap(obj, 'a', (v, obj) => v * 2)
   *   console.log(obj) // { a: 2, b: { a: 4, c: 3 } }
   */
  allKeyMap (obj, key, fn, {over_write = true} = {}) {
    const _ = this
    if (_.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        _.allKeyMap(obj[i], key, fn, {over_write})
      }
    } else if (_.isObject(obj)) {
      for (let k in obj) {
        if (k === key) {
          let result = fn(obj[k], obj)
          if (over_write) {
            obj[k] = result === undefined ? null : result
          }
        } else if (typeof obj[k] === 'object') {
          _.allKeyMap(obj[k], key, fn, {over_write})
        }
      }
    }
  },

  /**
   * 给数组对象设置默认值，支持a.b.c这种格式。
   * 第一个参数是一个数组，第二个参数是一个对象。
   * obj的key是数组对象的key，value是默认值。
   * 
   * @param {Array} arr - 要设置默认值的数组
   * @param {Object} obj - 默认值对象，key 是数组对象的 key，value 是默认值
   * @throws {Error} 如果 arr 不是数组，将抛出异常
   *
   * 注意
   *   1. 如果数组的值是undefined或null，则不会设置默认值
   *   2. 需要为一个obj设置时，可以使用[{}]这种格式
   *   3. 当数组中对应值存在时，不会修改其值
   *   4. 当你从数据库中读取一个列表数据，需要给每一个数据设置多个默认值时，可以使用此函数
   * 
   * @example
   *   utils.setDefault([{ a: 1, b: {} }], { a: 0, 'b.c': 2 }) // [{ a: 1, b: {c: 2} }]
   */
  setDefault (arr, obj) {
    const _ = this

    // 如果arr不是数组，抛出异常
    if (!_.isArray(arr)) {
      throw new Error('传给utils.setDefault的arr必须是数组')
    }

    let keys = Object.keys(obj)

    for (let i = 0; i < arr.length; i++) {

      if (_.isNone(arr[i])) { continue }

      for (let j = 0; j < keys.length; j++) {

        let key = keys[j]
        let value = obj[key]

        // 注意，这里不能用putValue代替，因为putValue会覆盖已存在的值，而setDefault不会
        if (key.includes('.')) {

          let ks = key.split('.')
          let current, pre, ki

          for (ki = 0; ki < ks.length; ki++) {

            if(ki === 0){
              pre = null
              current = arr[i]
            } else {
              pre = current
              current = current[ks[ki-1]]
            }

            if (_.isNone(current)) {
              if(ki === 0){
                current = arr[i] = {}
              } else {
                current = pre[ks[ki-1]] = {}
              }
            } else if(!_.isObject(current)) {
              break
            }

          }

          if (ki=== ks.length && _.isNone(current[ks[ki-1]])) {
            current[ks[ki-1]] = value
          }

        } else if(_.isNone(arr[i][key])) {
          arr[i][key] = value
        }

      }
    }
  },

  /**
   * 把obj对象转成为字符串，用于格式化打印对象。每个key，value对显示在一行。
   * 例如：
   *   {a: 1, b: {c: 2, e: [1,2,3]}, d: 'haha'}
   *   会转成
   *   a: 1
   *   b: 
   *    c: 2
   *    e: 1,2,3
   *   d: haha
   * 
   * @param {any} obj - 要转换的对象
   * @param {number} indent - 缩进的空格数，默认为 0
   * @returns {string} 返回转换后的字符串
   */
  obj2str (obj, indent = 0) {
    const _ = this
    let str = ''
    let indent_str = '  '.repeat(indent)
    if (_.isNone(obj)) { return 'null' }
    let keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      let value = obj[key]
      if (_.isObject(value)) {
        str += `${indent_str}${key}: \n${_.obj2str(value, indent + 1)}\n`
      } else if (_.isArray(value)) {
        str += `${indent_str}${key}:\n`
        // 遇到数组，每个元素显示在一行
        let arr_str = []
        for (let j = 0; j < value.length; j++) {
          arr_str.push(`${indent_str}  [${j}]`)
          arr_str.push(_.obj2str(value[j], indent + 2))
        }
        str += arr_str.join('\n')
      } else {
        str += `${indent_str}${key}: ${value}\n`
      }
    }
    // 去掉右边的空字符
    return str.trimEnd()
  },

  /**
   * 传入一个obj或arr，递归检查所有key，如果value的类型是字符串，则去掉首尾空格。
   * 在原对象上修改。
   * 
   * @param {Object|Array} obj - 要处理的对象或数组
   * 
   * @example
   *   let obj = { a: ' 1 ', b: { a: ' 2 ', c: ' 3 ' } }
   *   utils.trimAllKey(obj)
   *   console.log(obj) // { a: '1', b: { a: '2', c: '3' } }
   */
  trimAllKey(obj){
    const _ = this
    if (_.isObject(obj)) {
      for (let key in obj) {
        if (_.isString(obj[key])) {
          obj[key] = obj[key].trim()
        } else if (_.isObjectOrArray(obj[key])) {
          _.trimAllKey(obj[key])
        }
      }
    } else if (_.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (_.isString(obj[i])) {
          obj[i] = obj[i].trim()
        } else if (_.isObjectOrArray(obj[i])) {
          _.trimAllKey(obj[i])
        }
      }
    }
  },

  /**
   * 获得一个obj有多少个key。
   * 
   * @param {Object} obj - 要计算属性数量的对象
   * @returns {number} 返回对象的属性数量
   * 
   * @example
   * utils.objLength({ a: 1, b: 2, c: 3 }) // 3
   */
  objLength(obj){
    return Object.keys(obj).length
  },

  /**
   * 把一个obj转为可用于cache的key字符串。
   * 当obj的内容相同（但顺序不同）时总是返回相同的字符串。
   * 
   * @param {any} obj - 要序列化的对象
   * @returns {string} 返回序列化后的字符串
   * 
   * @example
   *   const obj1 = { a: 1, b: 2 }
   *   const obj2 = { b: 2, a: 1 }
   *   utils.serializeObj(obj1) === utils.serializeObj(obj2) // true
   */
  serializeObj(obj) {
    const _ = this
    const sort = (obj) => {
      if (_.isArray(obj)) {
        return obj.map(sort)
      }
      if (!_.isObject(obj)) {
        return obj
      }
      // 此时obj是对象，按key的顺序重新赋值一个新的对象
      const sorted_keys = Object.keys(obj).sort()
      return sorted_keys.reduce((result, key) => {
        result[key] = sort(obj[key])
        return result
      }, {})
    }
    return JSON.stringify(sort(obj))
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

  /**
   * 将字符串按照第一个指定字符分割为三部分。
   * 
   * @param {string} s - 要分割的字符串
   * @param {string} [char=' '] - 作为分割标记的字符
   * @returns {Array<string>} 返回一个包含三个字符串的数组。原字符串中从头开始到第一个匹配标记之前的部分，匹配标记，以及第一个匹配标记之后的部分。如果没有找到匹配标记，返回的数组将包含原字符串，后两个字符串将为空。
   * 
   * @example
   *   utils.partition('hello world') // ['hello', ' ', 'world']
   */
  partition (s, char = ' ') {
    if(s.includes(char)){
      let i = s.indexOf(char)
      return [s.substring(0, i), char, s.substring(i+char.length, s.length)]
    }else{
      return [s, '', '']
    }
  },

  /**
   * 类似于 `partition`，但是从右边开始查找。
   * 
   * @param {string} s - 要分割的字符串
   * @param {string} [char=' '] - 作为分割标记的字符
   * @returns {Array<string>} 返回一个包含三个字符串的数组。
   * 
   * @example
   *   utils.rpartition('hello world', 'o) // ['hello w', 'o', 'rld']
   */
  rpartition (s, char = ' ') {
    if (s.includes(char)) {
      let i = s.lastIndexOf(char)
      return [s.substring(0, i), char, s.substring(i+char.length, s.length)]
    } else {
      return ['', '', s]
    }
  },

  /**
   * 判断字符串是否仅包含字母。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串仅包含字母，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isAlpha('abc') // true
   */
  isAlpha (s) {
    return /^([a-zA-Z])+$/.test(s)
  },

  /**
   * 判断字符串是否仅包含数字或字母。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串仅包含数字或字母，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isAlnum('abc123') // true
   */
  isAlnum (s) {
    return /^([\da-zA-Z])+$/.test(this)
  },

  /**
   * 判断一个字符串是否包含中文字符。
   * 
   * @param {string} str - 被判断的字符串
   * @returns {boolean} 如果字符串包含中文字符，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isContainChinese('你好abc') // true
   */
  isContainChinese (str) {
    return /[\u4e00-\u9fff]/.test(str)
  },

  /**
   * 获得字符串的最后n个字符。
   * 
   * @param {string} s - 原字符串
   * @param {number} n - 要获取的字符数
   * @returns {string} 返回字符串的最后n个字符。
   * 
   * @example
   *   utils.lastStr('hello', 2) // 'lo'
   */
  lastStr (s, n) {
    return s.substr(s.length - n)
  },

  /**
   * 移除字符串中所有的空白字符，包含空格、制表符、换行符等。
   * 
   * @param {string} s - 原字符串
   * @returns {string} 返回没有空白字符的字符串。
   * 
   * @example
   * utils.removeAllSpace('h e l l o') // 'hello'
   */
  removeAllSpace (s) {
    return s.replace(/\s/g, '')
  },

  /**
   * 将字符串转换为PascalCase形式。
   * 
   * @param {string} str - 原字符串
   * @returns {string} 返回PascalCase形式的字符串。
   * 
   * @example
   * utils.toPascalCase('hello_world') // 'HelloWorld'
   */
  toPascalCase(str) {
    return str.split('_').map(i => { return i === '' ? '' : i.charAt(0).toUpperCase() + i.slice(1) }).join('')
  },


  /* === 数值、数字、价格、金额 === */

  /**
   * 判断值是否为数字字面量或Number对象（不能是NaN、null、undefined）。
   * 
   * @param {number|string} i - 被判断的值
   * @param {Object} [options] - 包含以下属性的对象:
   *   - {boolean} [is_positive=false] - 判断是否为正数（可为0）
   *   - {boolean} [is_integer=false] - 判断是否为整数（可为0）
   *   - {boolean} [allow_string=true] - 默认允许数字字符串，如'123'
   * @returns {boolean} 如果值为数字字面量或Number对象，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isNumber(123) // true
   *   utils.isNumber('123') // true
   */
  isNumber(i, {
    is_positive = false, // 判断是否为正数（可为0）
    is_integer = false,  // 判断是否为整数（可为0）
    allow_string = true, // 默认允许数字字符串
  } = {}){
    if (i === '') return false;
    if (allow_string && typeof i === "string") {
      i = Number(i)
    }
    if (typeof i !== "number" || isNaN(i)) return false;
    if (is_positive && i < 0) return false;
    if (is_integer && !Number.isInteger(i)) return false;
    return true;
  },

  /**
   * 判断值是否为大于0的正整数，不接受字符串。
   * 
   * @param {number} i - 被判断的值
   * @returns {boolean} 如果值为大于0的正整数，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isPositiveInt(123) // true
   *   utils.isPositiveInt('123') // false
   *   utils.isPositiveInt(123.4) // false
   */
  isPositiveInt(i) {
    const _ = this
    return _.isNumber(i, {is_positive: true, is_integer: true, allow_string: false}) && i > 0
  },

  /**
   * 判断是否是合法的rank值，可以是小数、负数、字符串。
   * 
   * @param {number|string} i - 被判断的值
   * @returns {boolean} 如果值是合法的rank值，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isRank(123.45) // true
   */
  isRank(i) {
    return this.isNumber(i, { is_positive: false, is_integer: false, allow_string: true })
  },

  /**
   * 判断字符串是否仅包含数字，不含负数、小数。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串仅包含数字，返回 `true`；否则返回 `false`。
   * 
   * @example
   * utils.isDigit('123') // true
   */
  isDigit (s) {
    return /^\d+$/.test(s)
  },

  /**
   * 判断是否为价格，可以有两位小数，不能为负数，不能以0开头，但可以以0.开头。
   * isNumber相比，此函数支持数字字符串。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串是合法的价格，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isPrice('123.45') // true
   */
  isPrice (s) {
    return /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(s)
  },

  /**
   * 判断是否为整数价格，不能有小数，不能为负数，不能以0开头。
   * 和isNumber相比，此函数支持数字字符串。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串是合法的整数价格，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isIntPrice('123') // true
   */
  isIntPrice (s) {
    return /^(0|[1-9][0-9]*)$/.test(s)
  },

  /**
   * 判断是否为合法的11位手机号码。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串是合法的11位手机号码，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isPhoneNumber('12345678901') // true
   */
  isPhoneNumber (s) {
    return /^1[3-9]\d{9}$/.test(s)
  },

  /**
   * 判断是否是133****1234格式的手机号码，中间4位是*字符。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串是133****1234格式的手机号码，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isMaskedPhoneNumber('133****1234') // true
   */
  isMaskedPhoneNumber(s) {
    return /^1[3-9]\d\*{4}\d{4}$/.test(s)
  },

  /**
   * 判断是否为英文小写的name（不能以数字开头，可以有下划线）。
   * 
   * @param {string} s - 被判断的字符串
   * @returns {boolean} 如果字符串是英文小写的name，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isName('abc') // true
   */
  isName (s) {
    return /^[a-z][a-z0-9_]*$/.test(s)
  },

  /**
   * 判断是否是合法的doc._id。参数支持数组，任何一个不合法都返回false。
   * 
   * @param {...string} s - 被判断的值
   * @returns {boolean} 如果所有值都是合法的doc._id，返回 `true`；否则返回 `false`。
   * 
   * @example
   *   utils.isID('1234567890abcdef1234567890abcdef') // true
   *   utils.isID(id1, id2, ...) // 任何一个不合法都返回false
   */
  isID (...s) {
    return s.every(i => /^[0-9a-z]{32}$/.test(i))
  },

  /**
   * 把价格由分转为元，返回float格式。支持空字符串。
   * 
   * @param {string} p - 被转换的价格（单位：分）
   * @returns {number|string} 返回转换后的价格（单位：元）。如果输入为空字符串，则返回空字符串。否则，如果输入是非法的价格，则返回NaN。
   * 
   * @example
   *   utils.centsToPrice('12345') // 123.45
   */
  centsToPrice(p) {
    const _ = this
    // 空字符串返回空字符串
    if (_.isString(p) && _.isEmpty(p)) {
      return ''
    } else if (_.isIntPrice(p)) {
      return Number(p) / 100
    } else {
      return NaN
    }
  },

  /**
   * 把价格由元转为分。支持空字符串。
   * 
   * @param {string} p - 被转换的价格（单位：元）
   * @returns {number|string} 返回转换后的价格（单位：分）。如果输入为空字符串，则返回空字符串。否则，如果输入是非法的价格，则返回NaN。
   * 
   * @example
   *   utils.priceToCents('123.45') // 12345
   */
  priceToCents(p) {
    const _ = this
    // 空字符串返回空字符串
    if (_.isString(p) && _.isEmpty(p)) {
      return ''
    } else if (_.isPrice(p)) {
      return Math.round(Number(p) * 100)
    } else {
      return NaN
    }
  },

  /**
   * 把价格转为显示给用户的字符串（传入分）。若传入的参数不是数值，则返回其字符串。
   * 
   * @param {...number} price - 被转换的价格（单位：分）
   * @returns {string|array<string>} 返回格式化后的价格字符串。如果只传入一个价格，返回字符串；如果传入多个价格，返回字符串数组。
   * 
   * @example
   * utils.priceFormat(12345) // '123.45'
   */
  priceFormat(...price) {
    const _ = this
    function format(p) {
      if (_.isIntPrice(p)) {
        return (Math.round(p * 100) / 100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')
      } else {
        return String(p)
      }
    }
    price = price.map(format)
    return (price.length === 1) ? price[0] : price
  },

  /**
   * 把数字除以100再转为str格式，用于积分、单量、价格等字段的显示【传入分】。
   * 
   * @param {...number} numbers - 被转换的数字（单位：分）
   * @returns {string|array<string>} 返回格式化后的数字字符串。如果只传入一个数字，返回字符串；如果传入多个数字，返回字符串数组。
   * 
   * @example
   * utils.df(12345) // '123.45'
   */
  df(...numbers) {
    const _ = this
    if (numbers.length === 1) {
      return _.priceFormat(_.centsToPrice(numbers[0]))
    } else {
      return _.priceFormat(..._.centsToPrice(...numbers))
    }
  },

  /**
   * 给货币数据增加逗号，方便阅读，返回字符串（传入分）。
   * 
   * @param {number} price - 被格式化的价格（单位：分）
   * @returns {string} 返回格式化后的价格字符串。
   * 
   * @example
   * utils.formatCurrency(12345) // '123.45'
   */
  formatCurrency(price) {
    return parseFloat(price).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  /**
   * 用于显示价格的整数部分，返回字符串（传入分）。
   * 
   * @param {number} price - 被格式化的价格（单位：分）
   * @returns {string} 返回价格的整数部分。
   * 
   * @example
   * utils.roundPrice(12345) // '123'
   */
  roundPrice (price) {
    const _ = this
    price = _.centsToPrice(price)
    return (price < 0 ? '-' : '') + Math.abs(Math.trunc(price)).toString()
  },

  /**
   * 用于显示价格的小数部分，返回字符串（传入分）。
   * 会返回 .2 不会返回.20。
   * 
   * @param {number} price - 被格式化的价格（单位：分）
   * @returns {string} 返回价格的小数部分。
   * 
   * @example
   * utils.fractionPrice(12345) // '.45'
   */
  fractionPrice (price) {
    const _ = this
    price = _.centsToPrice(price)
    if (price === parseInt(price)) {
      return ''
    } else {
      return '.' + _.partition(parseFloat(price).toFixed(2).trimEnd('0'), '.')[2]
    }
  },

  /**
   * 把小数保留小数点后2位，返回实数类型。
   * 
   * @param {number} n - 被四舍五入的数
   * @returns {number} 返回四舍五入后的数。
   * 
   * @example
   * utils.round2(123.456) // 123.46
   */
  round2 (n) {
    return Math.round(n * 100) / 100
  },

  /**
   * 限制一个值的范围，注意这不是worklet函数，不能给worklet使用。
   * 
   * @param {number} i - 被限制的值
   * @param {number} min - 值的最小边界
   * @param {number} max - 值的最大边界
   * @returns {number} 返回在限定范围内的值。
   * 
   * @example
   * utils.clamp(10, 0, 5) // 5
   */
  clamp (i, min, max) {
    return Math.min(Math.max(val, min), max)
  },

  /**
   * 把阿拉伯数字转为中文数字，最大支持5位数（万）。
   * 
   * @param {number} n - 被转换的阿拉伯数字
   * @returns {string} 返回转换后的中文数字。如果数字太大或太小，抛出异常。
   * 
   * @example
   * utils.numberToChinese(12345) // '一万二千三百四十五'
   */
  numberToChinese (n) {
    const _ = this
    let units = '个十百千万'
    let chars = '零一二三四五六七八九'
    n = n.toString()
    let s = []

    _.assert(n.length <= 5, '数字太大，不能解析')
    _.assert(n.length > 0, '数字不能是空字符串')
    _.assert(n[0] != '0', '数字不能以0开头')

    for (let i = 0; i < n.length; i++) {
      let num = n[i]
      let unit = units[n.length - i - 1]
      let char = chars[num]
      if (num === '0') {
        if (i === n.length - 1 || n[i + 1] !== '0') {
          s.push('零')
        }
      } else {
        s.push(char)
        s.push(unit)
      }
    }

    // 需要删除的末尾字符
    const del_chars = ['零', '个']

    // 用while删除末尾的字符
    while (del_chars.includes(s[s.length - 1])) {
      s.pop()
    }

    let ret = s.join('')

    // 如果是"一十"开头，则删除"一"
    if (ret.startsWith('一十')) {
      ret = ret.substr(1)
    }

    return ret
  }, // numberToChinese


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

  /**
   * 传入数组 arr 和属性名 key，key 对应一个子数组，把所有子数组合并成一个数组。
   * 
   * @param {Array} arr - 输入的数组，该数组中的对象应含有子数组
   * @param {string} key - 对应子数组的属性名
   * @returns {Array} 返回合并后的数组
   * 
   * @example
   * utils.extractNestedArrays([{a: [1,2]}, {a: [3,4]}, {a: null}, {b: [5, 6]}], 'a') // [1,2,3,4]
   */
  extractNestedArrays (arr, key) {
    const _ = this
    let result = []
    for (let i = 0; i < arr.length; i++) {
      if (_.isArray(arr[i][key])) {
        result = result.concat(arr[i][key])
      }
    }
    return result
  },

  /**
   * 把一个数据分成多个数组，每个数组的长度为 size。
   * 
   * @param {Array} arr - 要被分割的数组
   * @param {number} size - 每个子数组的长度
   * @returns {Array} 返回包含多个子数组的数组
   * 
   * @example
   * utils.splitArray([1, 2, 3, 4, 5, 6], 2) // [[1, 2], [3, 4], [5, 6]]
   */
  splitArray (arr, size) {
    const _ = this
    let result = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  },

  /**
   * 给出一个数组和多个字段名，返回一个新数组，新数组的每个元素是原数组的每个元素的这些字段的值。
   * 
   * @param {Array} arr - 输入的数组
   * @param {...string} fields - 要提取的字段名
   * @returns {Array} 返回包含新对象的数组，每个对象包含指定字段的值
   * 
   * @example
   * utils.extractFields([{ a: 1, b: 2 }, { a: 3, b: 4 }], 'a') // [{ a: 1 }, { a: 3 }]
   */
  extractFields (arr, ...fields) {
    const _ = this
    let result = []
    for (let i = 0; i < arr.length; i++) {
      let obj = {}
      for (let j = 0; j < fields.length; j++) {
        obj[fields[j]] = arr[i][fields[j]]
      }
      result.push(obj)
    }
    return result
  },

  /**
   * 通过 _id 判断一个 doc 是否在数组中。
   * 
   * @param {Array} arr - 搜索的数组
   * @param {Object} doc - 输入的对象，该对象应含有 `_id` 属性
   * @returns {boolean} 如果数组中包含 doc，则返回 true，否则返回 false
   * 
   * @example
   * utils.includesDoc([{ _id: 1, name: 'Tom' }, { _id: 2, name: 'Jerry' }], { _id: 1 }) // true
   */
  includesDoc (arr, doc) {
    const _ = this
    return arr.some(item => item._id === doc._id)
  },

  /**
   * 通过 _id 找到数组中的元素的索引。
   * 
   * @param {Array} arr - 输入的数组
   * @param {Object} doc - 输入的对象，该对象应含有 `_id` 属性
   * @returns {number} 返回 doc 在数组中的索引，如果数组中不包含 doc，则返回 -1
   * 
   * @example
   * utils.docIndexOf([{ _id: 1, name: 'Tom' }, { _id: 2, name: 'Jerry' }], { _id: 1 }) // 0
   */
  docIndexOf (arr, doc) {
    const _ = this
    return arr.findIndex(item => item._id === doc._id)
  },

  /**
   * 把数组中某个值的元素全部替换为新元素。
   * 
   * @param {Array} array - 输入的数组
   * @param {any} target - 需要被替换的元素
   * @param {any} replacement - 用于替换的新元素
   * @returns {Array} 返回包含替换后的元素的数组
   * 
   * @example
   * utils.replaceAll([1, 2, 3, 2, 4, 2], 2, 'two') // [1, 'two', 3, 'two', 4, 'two']
   */
  replaceAll(array, target, replacement) {
    return array.map((element) => {
      return element === target ? replacement : element
    })
  },

  /**
   * 传入一个数组 arr，以及 keys，根据 keys 对 arr 进行排序。
   * 
   * @param {Array} arr - 输入的数组
   * @param {Object} keys - 一个对象，键为排序的字段，值为 'asc' 或 'desc'，表示升序或降序
   * @returns {Array} 返回排序后的新数组
   *
   * 注意
   *   1. keys是有序的，若希望先按a排序，再按b排序，应该传入 {a: 'asc', b: 'asc'}
   *   2. keys是支持点表示法的，如 { 'a.b.c': 'asc' }
   *   3. 任何属性取值为 null 或 undefined 的元素将被过滤掉
   * 
   * @example
   * utils.sortByKeys([{ a: 1, b: 2 }, { a: 2, b: 1 }], { a: 'asc' }) // [{ a: 1, b: 2 }, { a: 2, b: 1 }]
   */
  sortByKeys (arr, keys) {
    const _ = this

    // 比较函数
    function compare(a, b) {
      for (const key in keys) {
        const value_a = _.pickValue(a, key)
        const value_b = _.pickValue(b, key)

        let c = value_a > value_b ? 1 : value_a < value_b ? -1 : 0

        if (keys[key] === 'desc') {
          c *= -1
        } else if (keys[key] !== 'asc') {
          throw new Error(`排序参数错误，必须是asc或desc，不能是${keys[key]}`)
        }

        if (c !== 0) return c;
      }
      return 0
    }

    // 过滤掉任何属性取值为null或undefined的元素
    arr = arr.filter(item => Object.keys(keys).every(key => !_.isNone(_.pickValue(item, key))))

    return arr.sort(compare)
  },

  /**
   * 过滤掉数组中的 null 和 undefined。
   * 
   * @param {Array} arr - 输入的数组
   * @returns {Array} 返回过滤后的数组
   * 
   * @example
   * utils.filterNone([1, null, 2, undefined, 3]) // [1, 2, 3]
   */
  filterNone (arr) {
    const _ = this
    return arr.filter(item => !_.isNone(item))
  },

  /**
   * 删除数组中的重复元素（用于排除重复数字、字符串）。
   * 函数会保持原数组的顺序。
   * 
   * @param {Array} arr - 输入的数组
   * @returns {Array} 返回删除重复元素后的数组
   * 
   * @example
   * utils.uniqueArray([1, 1, 2, 2, 3, 3]) // [1, 2, 3]
   */
  uniqueArray (arr) {
    const unique_arr = []
    const existing_set = new Set()
    for (const item of arr) {
      if (!existing_set.has(item)) {
        unique_arr.push(item)
        existing_set.add(item)
      }
    }
    return unique_arr
  },

  /**
   * 根据 _id 删除数组中的元素。
   * 
   * @param {Array} arr - 输入的数组，数组中的元素应包含 `_id` 属性
   * @param {string | number} id - `_id` 的值
   * @returns {Array} 返回删除指定元素后的数组
   * 
   * @example
   * utils.removeById([{ _id: 1, name: 'Tom' }, { _id: 2, name: 'Jerry' }], 1) // [{ _id: 2, name: 'Jerry' }]
   */
  removeById (arr, id) {
    return arr.filter(item => item._id !== id)
  },

  /**
   * 判断数组中是否有重复元素。
   * 
   * @param {Array} arr - 输入的数组
   * @returns {boolean} 如果数组中有重复元素，则返回 true，否则返回 false
   * 
   * @example
   * utils.hasDuplicate([1, 2, 3, 2]) // true
   */
  hasDuplicate (arr) {
    return new Set(arr).size !== arr.length
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

  /**
   * 获取云数据库的当前日期和时间，可以指定秒、分钟和天数的偏移量。
   * 
   * @param {Object} offsetObject - 包含偏移量的对象
   *   - seconds - 秒偏移量，正数表示未来时间，负数表示过去时间，下同
   *   - minutes - 分钟偏移量
   *   - days - 天数偏移量
   * @returns {Object} 返回云数据库的当前日期和时间
   */
  serverDate ({seconds = 0, minutes = 0, days = 0} = {}) {
    const _ = this
    const offset = (seconds + minutes * 60 + days * 24 * 60 * 60) * 1000
    return _._db().serverDate({offset})
  },

  /**
   * 获取日期和时间。
   * 
   * @returns {Date}
   */
  now () {
    return new Date()
  },

  /**
   * 传入一个整数或字符串，表示月份或天数，如果小于10，前面补0。
   * 
   * @param {number|string} n - 一个整数或字符串，表示月份或天数
   * @returns {string} 返回补零后的字符串
   *
   * @example
   * utils.padDateZero(1) // '01'
   */
  padDateZero (n) {
    return n.toString().padStart(2, '0')
  },

  /**
   * 把字符串转换成日期和时间（不能自己使用 new Date 转换，以免时区错误）。
   * 支持的格式：（当前时区）
   *     2023-02-12
   *     2023-02-12 12:34:56
   * 
   * @param {string} s - 日期和时间的字符串表示
   * @returns {Date} 返回转换得到的日期和时间
   */
  dateFromString (s) {
    // 如果s是YYYY-MM-DD格式
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(s + ' 00:00:00') // 必须加上时分秒，否则会使用UTC时区，加上时分秒后会被当成本地时间
      // 如果s是YYYY-MM-DD HH:MM:SS格式
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
      return new Date(s)
    } else {
      throw new Error(`不支持的日期格式：${s}`)
    }
  },

  /**
   * 返回日期和时间的时间戳，单位为毫秒，若参数 t 为 undefined，则返回当前时间。
   * 
   * @param {[Date]} t - 日期和时间
   * @returns {number} 返回时间戳
   */
  timestamp (t) {
    return t ? t.getTime() : new Date().getTime()
  },

  /**
   * 返回日期和时间的时间戳，单位为秒，若参数 t 为 undefined，则返回当前时间。
   * 
   * @param {[Date]} t - 日期和时间
   * @returns {number} 返回时间戳
   */
  timestampSeconds (t) {
    return Math.floor(this.timestamp(t) / 1000)
  },

  /**
   * 返回类似于 20230701123456 这样的日期和时间字符串。
   * 
   * @param {[Date]} t - 日期和时间
   * @returns {string} 返回格式化后的日期和时间字符串
   */
  timestampString(t=null) {
    t = t || new Date()
    let y = t.getFullYear()
    let m = (t.getMonth() + 1).toString().padStart(2, '0')
    let d = t.getDate().toString().padStart(2, '0')
    let h = t.getHours().toString().padStart(2, '0')
    let M = t.getMinutes().toString().padStart(2, '0')
    let s = t.getSeconds().toString().padStart(2, '0')
    return `${y}${m}${d}${h}${M}${s}`
  },

  /**
   * 获取昨天的日期字符串
   * 
   * @returns {string} 返回昨天的日期字符串
   */
  yesterday() {
    const _ = this
    return _.daysAgo(1)
  },

  /**
   * 返回今天的日期字符串
   * 
   * @returns {string} 返回今天的日期字符串
   */
  today() {
    const _ = this
    const date = new Date()
    return _.yymmdd(date)
  },

  /**
   * 获取明天的日期字符串
   * 
   * @returns {string} 返回明天的日期字符串
   */
  tomorrow() {
    const _ = this
    return _.daysAgo(-1)
  },

  /**
   * 获取后天的日期字符串
   * 
   * @returns {string} 返回后天的日期字符串
   */
  afterTomorrow() {
    const _ = this
    return _.daysAgo(-2)
  },

  /**
   * 返回本周周一的日期字符串。
   * 可传入一个数字，表示第几周，0表示本周，1表示下周，-1表示上周。
   * 
   * @param {number} n - 表示第几周
   * @returns {string} 返回周一的日期字符串
   */
  firstDayOfWeek (n = 0) {
    const _ = this
    const date = new Date()
    let day = date.getDay()
    if (day === 0) { day = 7 }
    date.setDate(date.getDate() - day + 1 + n * 7)
    return _.yymmdd(date)
  },

  /**
   * 返回本周周日的日期字符串。
   * 可传入一个数字，表示第几周，0表示本周，1表示下周，-1表示上周。
   * 
   * @param {number} n - 表示第几周
   * @returns {string} 返回周日的日期字符串
   */
  lastDayOfWeek (n = 0) {
    const _ = this
    const date = new Date()
    let day = date.getDay()
    if (day === 0) { day = 7 }
    date.setDate(date.getDate() - day + 7 + n * 7)
    return _.yymmdd(date)
  },

  /**
   * 返回本月第一天的日期字符串。
   * 可传入一个数字，表示第几月，0表示本月，1表示下月，-1表示上月。
   * 
   * @param {number} n - 表示第几月
   * @returns {string} 返回月初的日期字符串
   */
  firstDayOfMonth (n = 0) {
    const _ = this
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() + n)
    return _.yymmdd(date)
  },

  /**
   * 返回本月最后一天的日期字符串。
   * 可传入一个数字，表示第几月，0表示本月，1表示下月，-1表示上月。
   * 
   * @param {number} n - 表示第几月
   * @returns {string} 返回月末的日期字符串
   */
  lastDayOfMonth (n = 0) {
    const _ = this
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() + 1 + n)
    date.setDate(0)
    return _.yymmdd(date)
  },

  /**
   * 返回 n 天以前的日期。
   * 
   * @param {number} n - 天数
   * @returns {Date} 返回 n 天以前的日期
   */
  daysAgoDate(n) {
    const _ = this
    const date = new Date()
    date.setDate(date.getDate() - n)
    return date
  },

  /**
   * 返回 n 天以后的日期。
   * 
   * @param {number} n - 天数
   * @returns {Date} 返回 n 天以后的日期
   */
  daysLaterDate(n) {
    return this.daysAgoDate(-n)
  },

  /**
   * 返回 n 天以前的日期字符串。
   * 
   * @param {number} n - 天数
   * @returns {string} 返回 n 天以前的日期字符串
   */
  daysAgo(n) {
    const _ = this
    return _.yymmdd(_.daysAgoDate(n))
  },

  /**
   * 返回 n 天以后的日期字符串。
   * 
   * @param {number} n - 天数
   * @returns {string} 返回 n 天以后的日期字符串
   */
  daysLater(n) {
    return this.daysAgo(-n)
  },

  /**
   * 返回 n 个月以前的今天日期。
   * 
   * @param {number} n - 月数
   * @returns {Date} 返回 n 个月前的今天日期
   */
  monthsAgoDate(n) {
    const _ = this
    const date = new Date()
    date.setMonth(date.getMonth() - n)
    return date
  },

  /**
   * 返回 n 个月以后的今天日期。
   * 
   * @param {number} n - 月数
   * @returns {Date} 返回 n 个月以后的今天日期
   */
  monthsLaterDate(n) {
    return this.monthsAgoDate(-n)
  },

  /**
   * 返回 n 个月以前的今天日期字符串。
   * 
   * @param {number} n - 月数
   * @returns {string} 返回 n 个月以前的今天日期字符串
   */
  monthsAgo(n) {
    const _ = this
    return _.yymmdd(_.monthsAgoDate(n))
  },

  /**
   * 返回 n 个月以后的今天日期字符串。
   * 
   * @param {number} n - 月数
   * @returns {string} 返回 n 个月以后的今天日期字符串
   */
  monthsLater(n) {
    return this.monthsAgo(-n)
  },

  /**
   * 返回 n 分钟以前的时间
   * 
   * @param {number} n - 分钟数
   * @returns {Date} 返回 n 分钟以前的时间
   */
  minutesAgo(n) {
    const _ = this
    const date = new Date()
    date.setMinutes(date.getMinutes() - n)
    return date
  },

  /**
   * 返回 n 分钟以后的时间
   * 
   * @param {number} n - 分钟数
   * @returns {Date} 返回 n 分钟以后的时间
   */
  minutesLater(n) {
    return this.minutesAgo(-n)
  },

  /**
   * 返回 n 秒以前的时间
   * 
   * @param {number} n - 秒数
   * @returns {Date} 返回 n 秒以前的时间
   */
  secondsAgo(n) {
    const _ = this
    const date = new Date()
    date.setSeconds(date.getSeconds() - n)
    return date
  },

  /**
   * 返回 n 秒以后的时间
   * 
   * @param {number} n - 秒数
   * @returns {Date} 返回 n 秒以后的时间
   */
  secondsLater(n) {
    return this.secondsAgo(-n)
  },

  /**
   * 传入两个参数，第一个是时间 t，第二个是秒数 n，判断 t 是否在 n 秒以内。
   * t 可以是时间戳，也可以是 Date 对象。
   * 
   * @param {number|Date} t - 时间，可以是时间戳或 Date 对象
   * @param {number} n - 秒数
   * @returns {boolean} 如果 t 在 n 秒以内，返回 true，否则返回 false
   */
  withinSeconds(t, n) {
    const _ = this
    if (!_.isNumber(t)) {
      t = _.timestamp(t)
    }
    return _.timestamp(_.secondsAgo(n)) < t
  },

  /**
   * 判断时间参数 t 是否为今天，支持字符串和 Date 类型。
   * 
   * @param {string|Date} t - 时间，可以是字符串或 Date 对象
   * @returns {boolean} 如果 t 是今天，返回 true，否则返回 false
   */
  isToday (t) {
    const _ = this
    if (!t) return false
    if (_.isString(t)) t = _.dateFromString(t)
    return _.yymmdd(t) === _.today()
  },

  /**
   * 判断字符串是否是正确的日期格式。
   * 
   * @param {string} s - 日期字符串
   * @returns {boolean} 如果字符串是正确的日期格式，返回 true，否则返回 false
   */
  isDateString (s) {
    const _ = this
    if (!_.isString(s)) return false
    const reg = /^\d{4}-\d{2}-\d{2}$/
    if (!reg.test(s)) return false
    const date = _.dateFromString(s)
    return _.yymmdd(date) === s
  },

  /**
   * 比较两个日期字符串的大小。
   * 
   * @param {string} s1 - 第一个日期字符串
   * @param {string} s2 - 第二个日期字符串
   * @returns {number|null} 如果 s1 > s2，返回 1，如果 s1 == s2，返回 0，如果 s1 < s2，返回 -1，如果日期不正确，返回 null
   */
  compareDateString (s1, s2) {
    const _ = this
    if (!_.isDateString(s1) || !_.isDateString(s2)) return null
    const d1 = _.dateFromString(s1)
    const d2 = _.dateFromString(s2)
    return d1 > d2 ? 1 : (d1 < d2 ? -1 : 0)
  },

  /**
   * 返回 "2023年5月3日" 这样的格式。
   * 支持字符串和 Date 类型。
   * 
   * @param {string|Date} t - 时间，可以是字符串或 Date 对象
   * @returns {string} 返回日期的中文表示
   */
  dayCN(t) {
    const _ = this
    if (_.isString(t)) t = _.dateFromString(t)
    let y = t.getFullYear()
    let m = t.getMonth() + 1
    let d = t.getDate()
    return `${y}年${m}月${d}日`
  },

  /**
   * 返回时间是星期几，返回 "周一"、"周二"、"周日"。
   * 支持字符串和 Date 类型。
   * 
   * @param {string|Date} t - 时间，可以是字符串或 Date 对象
   * @returns {string} 返回星期的中文表示
   */
  weekdayCN (t) {
    const _ = this
    if (!t) return ''
    if (_.isString(t)) t = _.dateFromString(t)
    let w = t.getDay()
    return '周' + '日一二三四五六'[w]
  },

  /**
   * 输入时间 t，获得这个时间当月有多少天。
   * 支持字符串格式和 Date 格式。
   * 
   * @param {string|Date} t - 时间，可以是字符串或 Date 对象
   * @returns {number} 返回当月的天数
   */
  getDaysInMonth (t) {
    if (_.isString(t)) {
      t = new Date(t)
    }
    let year = t.getFullYear()
    let month = t.getMonth() + 1 // getMonth()从0开始的，加1表示下个月
    // Date()构造函数的月份从1开始计算，因此这里获得的是下个月初的上一天，第三个参数0表示上一天
    return new Date(year, month, 0).getDate()
  },

  /**
   * 等待指定的毫秒数。
   * 
   * @param {number} ms - 毫秒数
   * @returns {Promise} 返回一个 Promise，会在指定的毫秒数后 resolve
   * 
   * @example
   * await utils.sleep(1000) // 等待1秒，注意必须使用await
   */
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  /**
   * 返回 created 距离现在的时间字符串，如："刚刚"、"5分钟前"、"1小时前"、"1天前"、"1个月前"、"1年前"。
   * 常用语标识评论、文章的发布时间。
   * 
   * @param {Date} date - 创建日期
   * @returns {string} 返回距离现在的时间字符串
   */
  relativeTimeString(date) {
    const _ = this
    const now = new Date()
    const diff = now - date

    if (diff < 0) { return "未来" }

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const month = 30 * day
    const year = 365 * day

    if (diff < minute) {
      return "刚刚"
    } else if (diff < hour) {
      const minutes = Math.floor(diff / minute)
      return `${minutes}分钟前`
    } else if (diff < day) {
      const hours = Math.floor(diff / hour)
      return `${hours}小时前`
    } else if (diff < month) {
      const days = Math.floor(diff / day)
      return `${days}天前`
    } else if (diff < year) {
      const months = Math.floor(diff / month)
      return `${months}月前`
    } else {
      // 年需要精确到小数点后1位
      const years = (diff / year).toFixed(1)
      return `${years}年前`
    }
  },


  /* === 前端本地缓存 === */

  /**
   * 同步设置内存缓存。若给定的`value`为`undefined`，则删除对应的`key`。
   * @param {string} key - 缓存键名，支持使用'a.b.c'的形式访问嵌套属性。
   * @param {*} value - 要设置的缓存值。若为`undefined`，则执行删除操作。
   *
   * 注意
   *   1. 此函数不涉及数据库操作，不会消耗调用次数。
   */
  setCache (key, value) {
    const _ = this
    _.putValue(_.globalData().cache, key, value)
  },

  /**
   * 从内存中获取缓存值。
   * @param {string} key - 缓存键名，支持'a.b.c'形式访问嵌套属性。
   * @param {Object} options - 可选参数。
   *   - {any} default_value - 若缓存不存在时的默认值，默认为null。
   * @returns {*} 返回找到的缓存值，若未找到则返回`default_value`。
   *
   * 注意
   *   1. 此函数为同步执行，且不涉及数据库操作，不消耗调用次数。
   *   2. 不要用 utils.getCache(key) || xxx 的形式，因为getCache可能会返回0、false、空字符串等
   *   3. 需要默认值时请使用default_value参数
   *   4. 不能认为使用了setCache(key, value)后就一定能用相同的key获取到value，因为缓存可能会被清空，见app_init.js文件
   */
  getCache (key, {default_value = null} = {}) {
    const _ = this
    const v = _.pickValue(_.globalData().cache, key)
    return v !== undefined ? v : default_value
  },

  /**
   * 异步设置手机硬盘持久存储。
   * @param {string} key - 存储键名。
   * @param {*} value - 要存储的数据。
   * @param {boolean} encrypt - 是否对数据进行加密，默认为`false`。
   * @returns {Promise} 返回一个Promise，成功时无返回值，失败时返回错误信息。
   * 
   * 注意
   *   1. 单个键允许的最大数据长度为1MB（加密后约为0.7MB），总存储上限为10MB（加密后为7MB）。
   *   2. 用户拖动删除小程序时，硬盘持久存储也会被清除。
   */
  setStorage (key, value, encrypt = false) {
    return wx.setStorage({key, data: value, encrypt})
  },

  /**
   * 异步获取硬盘持久存储。
   * @param {string} key - 存储键名。
   * @param {boolean} encrypt - 是否对存储数据进行加密，默认为`false`。
   * @returns {Promise} 返回一个Promise，成功时返回存储的数据，失败时返回错误信息。
   */
  getStorage (key, encrypt = false) {
    const _ = this
    return new Promise((resolve, reject) => {
      wx.getStorage({key, encrypt})
        .then(res => {
          if (res.data) {
            resolve(res.data)
          } else {
            reject({errno: 'getStorage Failed', errMsg: `获取Storage数据失败`})
          }
        })
        .catch(e => { reject({errno: 'getStorage Failed', errMsg: `获取Storage数据失败`, e}) })
    })
  },

  /**
   * 移除指定key的本地持久存储的同步接口。
   * @param {string} key - 存储键名。
   */
  removeStorageSync (key) {
    return wx.removeStorageSync(key)
  },

  /**
   * 清空本地持久存储的同步接口。
   */
  clearStorageSync () {
    return wx.clearStorageSync()
  },

  /**
   * 在数据库和本地存储中写入用户配置数据
   * @param {string} c - 指定集合名称和本地存储键名，通常形式为{app}_user，如admin_user
   * @param {string} key - 用户配置项的键，支持点表示法，如'a.b.c'
   * @param {any} value - 配置项的值
   * @param {Object} options - 配置选项:
   *   - {boolean} skip_equal - 是否跳过相等值检查直接写入数据库，默认为false
   *   - {boolean} encrypt - 是否加密存储，默认为true
   * @returns {Promise<boolean>} 返回一个Promise对象，resolved值为true表示数据已更改，false表示数据未更改
   *
   * 说明
   *   1. 如果本地存储中有数据，则优先使用本地数据覆盖数据库
   *   2. 如果本地无数据，则以数据库数据为准
   *   3. 支持使用undefined值来删除数据项
   *   4. 必须确保c参数指定的集合存在，用于保存用户的私有数据
   *   5. 用户的value数据不能超过512K
   *   6. 用户配置只能在前端写入，以保证数据的同步
   *
   * 调用次数
   *   1. value变动时，会写1次数据库，会消耗1次调用次数
   *   2. value未变动时，不会写数据库，不消耗调用次数
   *   3. 指定skip_equal=true时会跳过判断值是否变动，直接写数据库，会消耗1次调用次数
   *   
   * @example
   *   utils.setUserConfig('admin_user', 'theme.color', 'light').then(changed => {
   *     if (changed) {
   *       console.log('设置成功')
   *     } else {
   *       console.log('设置未变动，原本就是light主题')
   *     }
   *   })
   */
  setUserConfig (c, key, value, {skip_equal = false, encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    return new Promise((resolve, reject) => {

      // 获得本地缓存数据
      _.getStorage(storage_key, encrypt)

      // 本地有缓存（以本地缓存为准）
        .then(data => {
          // 本地缓存与value不相等时，才更新数据库（减少次数）
          if (skip_equal || !_.isEqual(_.pickValue(data, key), value)) {
            _.putValue(data, key, value, {remove_undefined: false})
            _._saveUserConfigToStorageAndCloudDB(c, data, {encrypt}).then(() => {
              resolve(true)
            }).catch(reject)
          } else {
            resolve(false)
          }
        })

      // 本地没有缓存，先读一下数据库中是否有数据
        .catch(() => {
          _.getMyOne(c, {})
            .then(doc => {
              // 数据库没有数据时新建
              if (!doc) {
                doc = c.endsWith('_user') ? {is_admin: false} : {}
              }
              if (skip_equal || !_.isEqual(_.pickValue(doc, key), value)) {
                _.putValue(doc, key, value, {remove_undefined: false})
                _._saveUserConfigToStorageAndCloudDB(c, doc, {encrypt}).then(() => {
                  resolve(true)
                }).catch(reject)
              } else {
                _.putValue(doc, '_openid', undefined)
                _.putValue(doc, '_id', undefined)
                _.setStorage(storage_key, doc, encrypt)
                  .then(() => {
                    resolve(true)
                  })
                  .catch(e => { reject({errno: 'setUserConfig Failed', errMsg: `调用setStorage时失败`, e}) })
              }
            })
        })

    })
  },

  /**
   * 传入一个对象，设置多个用户配置。
   * 
   * @param {string} c 用户配置的key值
   * @param {Object} obj 用户配置对象
   * @param {Object} options 包含以下属性的对象:
   *   - {boolean} skip_equal - 默认为 `false`，当为 `true` 时，不对存储进行比较，直接写入数据库
   *   - {boolean} encrypt - 默认为 `true`，是否对存储进行加密处理
   * @returns {Promise<boolean>} 返回一个Promise，当成功时，返回 `true`；当失败时，返回 `false`。
   * 
   * 说明：
   * 1. `obj` 的 `value` 为 `undefined` 时，可以删除用户配置。
   * 2. 在 `onUnload` 中使用时记得添加await，如 `await utils.setUserConfigObj`。
   * 3. 当 `changed` 为 `true` 时，表示修改了本地存储或数据库。此函数 `obj` 参数的 `key` 的数量和调用次数无关。
   *
   * @example
   * await utils.setUserConfigObj('key', {subKey: 'value'})
   */
  setUserConfigObj (c, obj, {skip_equal = false, encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    const obj_keys = Object.keys(obj)
    return new Promise((resolve, reject) => {

      // 获得本地缓存数据
      _.getStorage(storage_key, encrypt)

      // 本地有缓存（以本地缓存为准）
        .then(data => {
          /* 本地缓存与obj不相等时，才更新数据库（减少次数） 
             不要使用整个对象比较，仅比较obj中的key，使用some判断当obj中某一个value与data不同时，才更新数据库
             */
          if (skip_equal || obj_keys.some(key => !_.isEqual(_.pickValue(data, key), obj[key]))) {
            for (let key in obj) {
              _.putValue(data, key, obj[key], {remove_undefined: false})
            }
            _._saveUserConfigToStorageAndCloudDB(c, data, {encrypt}).then(() => {
              resolve(true)
            }).catch(reject)
          } else {
            resolve(false)
          }
        })

      // 本地没有缓存，先读一下数据库中是否有数据
        .catch(() => {
          _.getMyOne(c, {})
            .then(doc => {
              // 数据库没有数据时新建
              if (!doc) {
                doc = c.endsWith('_user') ? {is_admin: false} : {}
              }
              _.putValue(doc, '_openid', undefined) // 需要先删除_openid再和obj比较
              _.putValue(doc, '_id', undefined)
              if (skip_equal || obj_keys.some(key => !_.isEqual(_.pickValue(doc, key), obj[key]))) {
                for (let key in obj) {
                  _.putValue(doc, key, obj[key], {remove_undefined: false})
                }
                _._saveUserConfigToStorageAndCloudDB(c, doc, {encrypt}).then(() => {
                  resolve(true)
                }).catch(reject)
              } else {
                _.setStorage(storage_key, doc, encrypt)
                  .then(() => {
                    resolve(true)
                  })
                  .catch(e => { reject({errno: 'setUserConfigObj Failed', errMsg: `调用setStorage时失败`, e}) })
              }
            })
        })

    })
  },

  /**
   * 把用户配置先放入缓冲区，用 `flushUserConfigBuffer` 函数一次性写入，以减少数据库调用次数。
   * 
   * @param {string} c 用户配置的key值
   * @param {string} key 配置项的键名，支持点表示法，如'a.b.c'
   * @param {any} value 配置项的值
   * 
   * 说明：
   *   1. 在设置页面，可先调用此函数，然后在 `onUnload` 事件中使用 `await utils.flushUserConfigBuffer()`。
   *   2. 此函数只会修改缓冲区，不会修改数据库，从而不消耗调用次数。
   *   3. 直至调用 `flushUserConfigBuffer` 函数后，才会修改本地存储和数据库。
   *
   * @example
   *   utils.setUserConfigBuffer('admin_user', 'a.b.c', 'value') // 将配置项放入缓冲区
   */
  setUserConfigBuffer (c, key, value) {
    const _ = this
    const buffer = _._user_config_buffer
    // 确保_user_config_buffer[c]存在，且是一个对象
    if (!_.isObject(buffer[c])) { buffer[c] = {} }
    /* 注意，这里不能使用_.putValue，当c是点表示法时需要逐一保存
       举例说明，若使用_.putValue，当key等于a.b时，buffer[c]会变成{a: {b: value}}
       此时当调用flushUserConfigBuffer时，data.a会被替换为{b: value}，导致a的其他数据丢失
       */
    buffer[c][key] = value // 这里不能使用_.putValue
  },

  /**
   * 把用户配置缓冲区中的数据一次性写入数据库。
   * 
   * @param {string} c 用户配置的key值
   * @param {Object} options 包含以下属性的对象:
   *   - {boolean} encrypt - 默认为 `true`，是否对存储进行加密处理
   * @returns {Promise} 返回一个Promise，当成功时，返回 `undefined`；当失败时，返回错误信息。
   *
   * 说明：
   *   1. 此函数没有 `skip_equal` 功能，总是会写入数据库。
   *   2. 次函数仅消耗1次调用次数，不管缓冲区中有多少数据。
   *   3. 当缓冲区没有数据时，不会消耗调用次数。
   * 
   * @example
   *   utils.flushUserConfigBuffer('admin_user') // 一次性将缓冲区中的数据写入数据库
   */
  flushUserConfigBuffer (c, {encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    const buffer = _._user_config_buffer[c]
    if (!_.isObject(buffer) || _.isEmpty(buffer)) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {

      // 获得本地缓存数据
      _.getStorage(storage_key, encrypt)

      // 本地有缓存（以本地缓存为准）
        .then(data => {
          // 把buffer的每一个值put到data中
          for (const key in buffer) {
            _.putValue(data, key, buffer[key], {remove_undefined: false})
          }
          _._saveUserConfigToStorageAndCloudDB(c, data, {encrypt}).then(() => {
            _.clearUserConfigBuffer(c)
            resolve()
          }).catch(reject)
        })

      // 本地没有缓存，先读一下数据库中是否有数据
        .catch(() => {
          _.getMyOne(c, {})
            .then(doc => {
              // 数据库没有数据时新建
              if (!doc) {
                doc = c.endsWith('_user') ? {is_admin: false} : {}
              }
              for (const key in buffer) {
                _.putValue(doc, key, buffer[key], {remove_undefined: false})
              }
              _._saveUserConfigToStorageAndCloudDB(c, doc, {encrypt}).then(() => {
                _.clearUserConfigBuffer(c)
                resolve()
              }).catch(reject)
            })
        })
    })
  },

  /**
   * 清空用户配置缓冲区。当 `c` 为 `null` 时，清空所有缓冲区。
   * 
   * @param {string|null} c - 用户配置的key值，当为 `null` 时，清空所有缓冲区
   * 
   * @example
   *   utils.clearUserConfigBuffer('admin_user') // 清空指定的缓冲区
   *   utils.clearUserConfigBuffer(null) // 清空所有缓冲区
   */
  clearUserConfigBuffer (c = null) {
    const _ = this
    if (c === null) {
      _._user_config_buffer = {}
    } else {
      delete _._user_config_buffer[c]
    }
  },

  /**
   * 从数据库中读取用户配置，如果没有本地缓存，则读取数据库。
   * 若数据库中也没有，则返回 `null`，并缓存到本地。
   * 
   * @param {string} c - 用户配置的key值
   * @param {string} key - 配置项的键名，支持 'a.b.c' 的形式。
   * @param {Object} options - 包含以下属性的对象:
   *   - {any} default_value - 默认值，当配置项不存在时，返回此值
   *   - {boolean} encrypt - 默认为 `true`，是否对存储进行加密处理
   * @returns {Promise<any>} 返回一个Promise，当成功时，返回配置项的值（可能为 `undefined`）；当失败时，返回错误信息。
   *
   * 注意:
   *   1. 一定要对返回结果进行判断，可能会出现 `undefined` 的情况。
   *   2. 如果有本地缓存对象，但读取的 `key` 不存在，则返回 `default_value`，且不读取数据库。
   *   3. 当你在云函数中修改用户配置时就可能出现情况2，因此请勿在云函数中修改用户配置。
   * 
   * @example
   *   utils.getUserConfig('key', 'subKey', {default_value: 'default', encrypt: true}) // 读取用户配置
   */
  getUserConfig (c, key, {default_value = null, encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    return new Promise((resolve, reject) => {
      // 添加app前缀是为了避免本地app名称变动时，用本地的错误缓存去更新数据库
      // 如本地app开发时应该是a，但设置成了b，可能会用本地缓存去更新数据库b_user

      function _loadFromCloud() {
        _.getMyOne(c, {})
          .then(doc => {
            // 数据库中有数据
            if (doc) {
              _.putValue(doc, '_openid', undefined)
              _.putValue(doc, '_id', undefined)
              // 保存到本地缓存
              _.setStorage(storage_key, doc, encrypt)
                .then(() => { resolve(_.pickValue(doc, key) ?? default_value) })
                .catch(e => { reject({errno: 'getUserConfig Failed', errMsg: `调用setStorage时失败`, e}) })
            } else {
              // 数据库中没有数据
              // 在本地缓存中写入空数据（避免反复读取数据库），此时数据库中没有对应的数据
              doc = c.endsWith('_user') ? {is_admin: false} : {}
              _.setStorage(storage_key, doc, encrypt)
                .then(() => { resolve(_.pickValue(doc, key) ?? default_value) })
                .catch(e => { reject({errno: 'getUserConfig Failed', errMsg: `调用setStorage时失败`, e}) })

            }
          })
          .catch(e => { reject({errno: 'getUserConfig Failed', errMsg: `调用getOne时失败`, e}) })
      }

      // 从本地缓存中读取
      _.getStorage(storage_key, encrypt)

      // 本地有缓存
        .then(data => {
          resolve(_.pickValue(data, key) ?? default_value)
        })

      // 本地没有缓存，从数据库中读取
        .catch(_loadFromCloud)

    })
  },

  /**
   * 传入一个对象根据key获得多个用户配置。
   * 返回的对象中，key为传入的对象的key，value为对应的用户配置，传入的obj的value是config不存在时的默认值。
   * 
   * @param {string} c - 用户配置的key值
   * @param {Object} obj - 用户配置对象，其中 `key` 是配置项的键名，`value` 是配置项不存在时的默认值
   * @param {Object} options - 包含以下属性的对象:
   *   - {boolean} encrypt - 默认为 `true`，是否对存储进行加密处理
   * @returns {Promise<Object>} 返回一个Promise，当成功时，返回一个对象，其中 `key` 是传入的对象的 `key`，`value` 是对应的用户配置；当失败时，返回错误信息。
   * 
   * 注意：
   *   1. 新用户调用时，数据库中没有数据，此时会在本地写入空 Storage，但不会在数据库中创建数据。
   *   2. 若 `obj` 中部分 `key` 在本地缓存中有值，部分 `key` 没有值，则不会读取数据库，会使用 `obj` 默认值。
   *   3. 同样的，之所以有情况2存在，可能是因为在云函数中修改用户配置，因此请勿在云函数中修改用户配置。
   *
   * @example
   *   const setting = await utils.getUserConfigObj('key', {'a.b.c': 'default', d: ''}) // 根据key获得多个用户配置
   *   console.log(setting.a.b.c)
   *   console.log(setting.d)
   */
  getUserConfigObj (c, obj, {encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    return new Promise(async (resolve, reject) => {

      function _getObjFromData (obj, data) {
        const result = {}
        for (const key in obj) {
          result[key] = _.pickValue(data, key) ?? obj[key]
        }
        return result
      }

      function _loadFromCloud() {
        _.getMyOne(c, {})
          .then(doc => {
            // 数据库中有数据
            if (doc) {
              _.putValue(doc, '_openid', undefined)
              _.putValue(doc, '_id', undefined)
              // 保存到本地缓存
              _.setStorage(storage_key, doc, encrypt)
                .then(() => { 
                  resolve(_getObjFromData(obj, doc))
                })
                .catch(e => { reject({errno: 'getUserConfigObj Failed', errMsg: `调用setStorage时失败`, e}) })
            } else {
              // 数据库中没有数据
              // 在本地缓存中写入空数据（避免反复读取数据库），此时数据库中没有对应的数据
              doc = c.endsWith('_user') ? {is_admin: false} : {}
              _.setStorage(storage_key, doc, encrypt)
                .then(() => {
                  resolve(_getObjFromData(obj, doc))
                })
                .catch(e => { reject({errno: 'getUserConfigObj Failed', errMsg: `调用setStorage时失败`, e}) })
            }
          })
          .catch(e => { reject({errno: 'getUserConfigObj Failed', errMsg: `调用getOne时失败`, e}) })
      }

      // 从本地缓存中读取
      _.getStorage(storage_key, encrypt)

      // 本地有缓存
        .then(data => {
          resolve(_getObjFromData(obj, data))
        })

      // 本地没有缓存，从数据库中读取
        .catch(_loadFromCloud)

    })
  },

  /**
   * 向用户配置数组末尾添加一个元素，返回一个Promise，成功时返回修改后的数组，失败时触发 `.catch()`。
   * 
   * @param {string} c - 用户配置的key值
   * @param {string} key - 配置项的键名，必须是数组或未定义，支持点表示法，如'a.b.c'
   * @param {any} value - 要添加的元素
   * @param {Object} options - 包含以下属性的对象:
   *   - {boolean} allow_repeat - 默认为 `true`，是否允许重复
   *   - {number|null} limit - 数组最大长度，超过该长度时，会删除前面的元素
   *   - {boolean} prepend - 默认为 `false`，是否添加到数组的最前面
   * @returns {Promise<Array>} 返回一个Promise，当成功时，返回修改后的数组；当失败时，返回错误信息
   * 
   * 注意
   *   1. 当 `allow_repeat` 为 `false` 时，若数组中已有该元素时，不会再添加
   *   2. `value` 是对象时，会根据 `_id` 去重复
   *   3. 当 `prepend` 为 `true` 且使用了 `limit` 时，数量超过 `limit` 时会删除最后的元素
   *
   * 调用次数
   *   此函数每次调用都会写入数据库，会消耗1次调用次数
   * 
   * @example
   *   utils.pushUserConfig('admin_user', 'arr_key_path', 'value')
   */
  pushUserConfig (c, key, value, {allow_repeat = true, limit = null, prepend = false} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.getUserConfig(c, key)
        .then(data => {
          if (_.isNone(data)) { data = [] }
          if (Array.isArray(data)) {
            if (!allow_repeat
              && ( (_.isObject(value) && _.includesDoc(data, value))
                || data.includes(value) )
            ) {
              resolve(data)
            } else {
              if (prepend) {
                data.unshift(value)
              } else {
                data.push(value)
              }
              if (limit && data.length > limit) {
                if (prepend) {
                  data = data.slice(0, limit)
                } else {
                  data = data.slice(data.length - limit)
                }
              }
              _.setUserConfig(c, key, data)
                .then(() => { resolve(data) })
                .catch(e => { reject({errno: 'pushUserConfig Failed', errMsg: `调用setUserConfig时失败`, e}) })
            }
          } else {
            reject({errno: 'pushUserConfig Failed', errMsg: `配置项${key}不是数组`})
          }
        })
        .catch(e => { reject({errno: 'pushUserConfig Failed', errMsg: `调用getUserConfig时失败`, e}) })
    })
  },

  /**
   * 从用户配置数组中删除一个或多个匹配的元素，返回一个Promise，成功时返回删除的元素个数。
   * 
   * @param {string} c - 用户配置的key值
   * @param {string} key - 配置项的键名，必须是数组或未定义，支持点表示法，如'a.b.c'
   * @param {any} value - 要删除的元素，当value是对象时，会根据 _id 删除
   * @returns {Promise<number>} 返回一个Promise，当成功时，返回删除的元素个数；当失败时，返回错误信息。
   * 
   * @example
   *   utils.pullUserConfig('admin_user', 'arr_key_path', 'value')
   */
  pullUserConfig (c, key, value) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.getUserConfig(c, key)
        .then(data => {
          if (_.isNone(data)) { data = [] }
          if (Array.isArray(data)) {
            const index = _.isObject(value) ? _.docIndexOf(data, value) : data.indexOf(value)
            if (index > -1) {
              data.splice(index, 1)
              _.setUserConfig(c, key, data)
                .then(() => { resolve(1) })
                .catch(e => { reject({errno: 'pullUserConfig Failed', errMsg: `调用setUserConfig时失败`, e}) })
            } else {
              resolve(0)
            }
          } else {
            reject({errno: 'pullUserConfig Failed', errMsg: `配置项${key}不是数组`})
          }
        })
        .catch(e => { reject({errno: 'pullUserConfig Failed', errMsg: `调用getUserConfig时失败`, e}) })
    })
  },

  /**
   * 从 app_setting 集合中获取网站设置。
   * 
   * @param {string} key - 设置的键名
   * @param {object} [options] - 可选参数
   * @param {string} [options.name='default'] - 应用设置的名称
   * @param {boolean} [options.use_cache=true] - 是否使用缓存
   * @returns {Promise} 返回一个 Promise，resolve 时返回键名对应的值
   */
  getAppSetting (key, { name = 'default', use_cache = true } = {}) {
    const _ = this
    const c = 'app_setting'
    const cache_key = `app_setting_${name}`
    const cache = _.getCache(cache_key)
    const app = _.appName()
    return new Promise((resolve, reject) => {
      // 从数据库获取最新版本
      function getFromDB () {
        _.getOne(c, {app, name})
          .then(doc => {
            if (doc) {
              _.setCache(cache_key, doc)
              resolve(_.pickValue(doc, key))
            } else {
              _.setCache(cache_key, {})
              resolve(null)
            }
          })
          .catch(reject)
      }
      if ( use_cache && !_.isNone(cache) && !_.isEmpty(cache) ) {
        const value = _.pickValue(cache, key)
        if (!_.isNone(value)) {
          resolve(value)
        } else {
          getFromDB()
        }
      } else {
        getFromDB()
      }
    })
  },


  /* === 环境值 === */

  /**
   * 获取状态栏高度。
   * 
   * @returns {number} 返回状态栏的高度
   */
  statusBarHeight () {
    return WINDOW_INFO.statusBarHeight
  },

  /**
   * 获取底部安全区域的高度。
   * 
   * @returns {number} 返回底部安全区域的高度
   */
  bottomSafeAreaHeight () {
    const _ = this
    const info = WINDOW_INFO
    if (info?.safeArea) {
      return info.screenHeight - info.safeArea.bottom
    } else {
      return 0
    }
  },

  /**
   * 获取整个可视区域的宽度。
   * 
   * @returns {number} 返回可视区域的宽度
   */
  getScreenWidth () {
    return WINDOW_INFO.windowWidth
  },

  /**
   * 获取整个可视区域的高度。
   * 
   * @returns {number} 返回可视区域的高度
   */
  getScreenHeight () {
    return WINDOW_INFO.windowHeight
  },


  /* === 页面组件 === */

  /**
   * 获取当前页面滚动的高度。
   * 
   * @returns {Promise} 返回一个 Promise，resolve 时返回滚动的高度
   */
  getPageScrollTop () {
    const _ = this
    return new Promise(async (resolve, reject) => {
      wx.createSelectorQuery().selectViewport().scrollOffset(function (res) {
        resolve(res.scrollTop)
      }).exec()
    })
  },

  /**
   * 获取指定元素的滚动高度（通常是 `<scroll-view>`）。
   * 
   * @param {string} selector - 选择器
   * @returns {Promise} 返回一个 Promise，resolve 时返回滚动的高度
   */
  getViewScrollTop (selector) {
    const _ = this
    return new Promise(async (resolve, reject) => {
      wx.createSelectorQuery().select(selector).scrollOffset(function (res) {
        _.log(res)
        resolve(res.scrollTop)
      }).exec()
    })
  },

  /**
   * 获取一个元素的宽度，元素不存在时触发 catch。
   * 
   * @param {string} selector - 选择器
   * @returns {Promise} 返回一个 Promise，resolve 时返回元素的宽度
   */
  getViewWidth (selector) {
    const _ = this
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().select(selector).boundingClientRect(function(rect) {
        if (rect) { resolve(rect.width) } else { reject() }
      }).exec()
    })
  },

  /**
   * 获取一个元素的高度，元素不存在时触发 catch。
   * 
   * @param {string} selector - 选择器
   * @returns {Promise} 返回一个 Promise，resolve 时返回元素的高度
   */
  getViewHeight (selector) {
    const _ = this
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().select(selector).boundingClientRect(function(rect) {
        if (rect) { resolve(rect.height) } else { reject() }
      }).exec()
    })
  },


  /* === 页面路由跳转 === */

  /**
   * 打开给定 URL 的页面（URL 为以 `/` 开头的绝对路径）。
   * 
   * @param {string} url - 要打开的页面的 URL
   * @returns {Promise} 返回一个 Promise，resolve 时表示页面已打开
   */
  openPage (url) {
    return wx.navigateTo({ url })
  },

  /**
   * 切换到给定 URL 的 tab 页面。
   * 
   * @param {string} url - 要切换到的 tab 页面的 URL
   * @returns {Promise} 返回一个 Promise，resolve 时表示已切换到 tab 页面
   */
  switchTab (url) {
    return wx.switchTab({ url })
  },

  /**
   * 关闭当前所有页面，并跳转到新页面（清空页面栈）。
   * 
   * @param {string} url - 要跳转到的新页面的 URL
   * @returns {Promise} 返回一个 Promise，resolve 时表示已跳转到新页面
   */
  reLaunch (url) {
    return wx.reLaunch({ url })
  },

  /**
   * 获取上一个页面。
   * 
   * @returns {object|null} 返回上一个页面，如果不存在，返回 null
   */
  prevPage () {
    return getCurrentPages().at(-2) ?? null
  },

  /**
   * 获取当前页面。
   * 
   * @returns {object} 返回当前页面
   */
  currPage () {
    return getCurrentPages().pop()
  },

  /**
   * 获取当前页面的路径。
   * 
   * @returns {string} 返回当前页面的路径
   */
  currPagePath () {
    return getCurrentPages().pop().route
  },

  /**
   * 查找并返回给定路径的页面对象（URL 为以 `/` 开头的绝对路径）。
   * 
   * @param {string} url - 要查找的页面的 URL
   * @returns {object|null} 返回给定路径的页面对象，如果不存在，返回 null
   */
  findPageByPath(url) {
    // 获取当前的页面栈
    const pages = getCurrentPages()

    if (url[0] !== '/') { throw new Error('url必须以/开头') }

    // 遍历页面栈，查找匹配的页面实例
    for (let i = 0; i < pages.length; i++) {
      if ('/' + pages[i].route === url) {
        return pages[i]
      }
    }

    return null
  },

  /**
   * 回到上一个页面，如果在回到上一个页面后需要显示提示信息，可以提供 `show_ok` 或 `show_tip` 参数。
   * 
   * @param {object} [options] - 可选参数
   * @param {string|null} [options.default_page=null] - 默认的页面
   * @param {string|null} [options.show_ok=null] - 成功时要显示的提示信息
   * @param {string|null} [options.show_tip=null] - 失败时要显示的提示信息
   * @returns {Promise} 返回一个 Promise，resolve 时表示已回到上一个页面
   * 
   * 注意
   *   1. 若想在back后显示提示信息，可以这样写：sh.back({show_ok = '提交成功', show_tip = '提交失败'})
   *   2. 使用此函数需在app.js文件中的 globalData.config.default_page 设置默认页面，表示回到上一个页面失败时跳转的页面
   */
  back ({default_page = null, show_ok = null, show_tip = null} = {}) {
    const _ = this
    if (_.isEmpty(_.getConfig('default_page'))) {
      throw new Error('请在 app.js 文件中的 globalData.config.default_page 设置默认页面')
    }
    return wx.navigateBack({
      delta: 1

    }).catch(() => {
      return wx.navigateTo({
        url: default_page ?? _.getConfig('default_page')
      })

    }).catch(e => {
      return wx.switchTab({
        url: default_page ?? _.getConfig('default_page')
      })

    }).then(() => {
      if (show_ok) {
        _.showOk({text: show_ok})
      } else if (show_tip) {
        _.showTip({text: show_tip})
      }
    })
  },

  /**
   * 获取上一个页面的名称（即 `abc.wxml` 中的 `abc`）。
   * 
   * @returns {string} 返回上一个页面的名称
   */
  prevPageName () {
    return this.prevPage()?.route.split('/').pop() ?? ''
  },


  /* === 网络 === */

  /**
   * 从云存储中下载图片，不支持网络url。
   * 
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} fileID - 文件ID
   *   - {string} [tip='图片下载中'] - 下载过程中显示的提示信息
   *   - {string} [ok='图片已保存'] - 下载完成后显示的提示信息
   * @returns {Promise} 返回一个Promise，当成功时，返回 `undefined`；当失败时，返回错误信息
   */
  downImage ({fileID, tip = '图片下载中', ok = '图片已保存'}) {
    const _ = this
    const showErrorTip = () => { _.showTip({text: '下载失败'}) }

    return new Promise((resolve, reject) => {

      // 查询权限需要时间，因此先显示loading，以免视觉卡顿
      wx.showLoading({ title: tip, mask: true })

      _.authorized({auth: 'scope.writePhotosAlbum'})
        .then(() => {

          _._cloud().downloadFile({
            fileID: fileID,
          })
            .then(res => {

              if (res.statusCode === 200) {
                wx.saveImageToPhotosAlbum({
                  filePath: res.tempFilePath,
                })
                  .then(() => {
                    wx.showToast({ title: ok, icon: 'success', duration: 1500 })
                    resolve()
                  })
                  .catch(e => {
                    _.showTip({text: '已取消下载'})
                  })
              } else {
                _.error({title: 'utils.downImage下载失败，res.statusCode不等于200', res})
                showErrorTip()
                reject({errno: 'downImage Failed', errMsg: 'res.statusCode不等于200'})
              }

            })
            .catch(e => {
              _.error({title: 'utils.downImage下载失败，_._cloud().downloadFile异常', e})
              showErrorTip()
              reject(e)
            })
          // 应该等 _._cloud().downloadFile 执行完后才隐藏loading
            .finally(wx.hideLoading)

        })
        .catch(e => {
          wx.hideLoading()
          _.showTip({text: '需开启相册权限，请点击右上角“...” -> “设置”，打开相册授权'})
          reject(e)
        })

    })

  },

  /**
   * 从网络URL下载图片。
   * 
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} url - 图片的URL
   *   - {string} [tip='图片下载中'] - 下载过程中显示的提示信息
   *   - {string} [ok='图片已保存'] - 下载完成后显示的提示信息
   * @returns {Promise} 返回一个Promise，当成功时，返回 `undefined`；当失败时，返回错误信息
   */
  downImageFromUrl ({url, tip = '图片下载中', ok = '图片已保存'}) {
    const _ = this
    const showErrorTip = () => { _.showTip({text: '下载失败'}) }

    return new Promise((resolve, reject) => {

      // 查询权限需要时间，因此先显示loading，以免视觉卡顿
      wx.showLoading({ title: tip, mask: true })

      _.authorized({auth: 'scope.writePhotosAlbum'})
        .then(() => {

          wx.downloadFile({
            url,
            success: (res) => {
              if (res.statusCode === 200) {
                wx.saveImageToPhotosAlbum({
                  filePath: res.tempFilePath,
                  success: () => {
                    wx.showToast({ title: ok, icon: 'success', duration: 1500 })
                    resolve()
                  },
                  fail: () => {
                    _.showTip({text: '已取消下载'})
                    reject()
                  }
                })
              } else {
                _.error({title: 'utils.downImageFromUrl下载失败，res.statusCode不等于200', res})
                showErrorTip()
                reject({errno: 'downImageFromUrl Failed', errMsg: 'res.statusCode不等于200'})
              }
            },
            fail: (e) => {
              _.error({title: 'utils.downImageFromUrl下载失败，wx.downloadFile异常', e})
              showErrorTip()
              reject(e)
            },
            complete: () => {
              wx.hideLoading()
            }
          })

        })
        .catch(e => {
          wx.hideLoading()
          _.showTip({text: '需开启相册权限，请点击右上角"..." -> "设置"，打开相册授权'})
          reject(e)
        })

    })

  },

  /**
   * 获得image.js中的图片。
   * 
   * @param {string} image_name - 图片名称
   * @returns {string|null} 返回图片的URL，如果找不到，返回 `null`
   */
  globalImage (image_name){
    const _ = this
    const global_image = _.globalData().image
    return global_image?.[image_name] ?? null
  },


  /* === 文件 === */

  /**
   * 预加载图片文件。
   * @param {Object} obj - 包含图片URL的对象或数组。
   * @param {string} url_key - 对象中包含URL的键名。
   *
   * 根据对象中的URL键值，使用 `wx.downloadFile` 方法下载图片到本地临时路径。
   * 注意使用时需先调用 `preloadFiles` 下载图片，然后再使用 `setData` 更新数据，
   * 并确保在wxml中使用 `tempFilePath || url` 来引用图片。
   */
  preloadFiles (obj, url_key) {
    const _ = this
    _.allKeyMap(obj, url_key, (url, o) => {
      if (url && !o.tempFilePath) {
        wx.downloadFile({
          url,
          success: (res) => {
            o.tempFilePath = res.tempFilePath
          },
        })
      }
    }, { over_write: false }) // over_write: false, 不修改已有的url_key
  },

  /**
   * 清理无效的预加载图片文件。
   * @param {Object} obj - 包含 `tempFilePath` 的对象或数组。
   * 
   * 针对已保存到本地的图片，如果根据 `tempFilePath` 找不到图片，则删除该路径。
   */
  clearRemovedPreloadFiles (obj) {
    const _ = this
    _.allKeyMap(obj, 'tempFilePath', (path, o) => {
      // 判断文件是否存在
      wx.getFileSystemManager().access({
        path: path,
        fail: () => {
          // 文件不存在
          delete o.tempFilePath
        },
      })
    }, { over_write: false }) // over_write: false, 让回调函数自己决定是否删除tempFilePath
  },

  /**
   * 同步检查文件是否存在。
   * @param {string} path - 检查的文件路径。
   * @returns {boolean} 文件存在返回true，否则返回false。
   */
  tempFileExistsSync (path) {
    try {
      wx.getFileSystemManager().accessSync(path)
      return true
    } catch(e) {
      return false
    }
  },

  /**
   * 获取文件的临时URL，优先使用本地缓存。
   * @param {Array} file_list - 包含文件ID的数组，每个元素形式为 {file_id}。
   * @returns {Promise<Array>} 返回一个包含文件临时URL的Promise对象。
   *
   * 注意：
   *   1、临时URL有效时间仅10分钟，获取后要尽快加载图片
   *   2、已经加载成功的，就算超过10分钟，也不影响图片的显示
   *   3、临时URL如果已经超过5分钟，就会重新获取，而不是使用缓存
   *   4、尽量一次性获取多个临时URL，减少调用次数，但每次最多50张图
   *   5、此函数会调用all_user云函数，因为前端无法调用wx.cloud.getTempFileURL
   *   6、图片被删除时deleted=true,temp_file_url=''（需在缓存过期下次获取时更新）
   * 
   * @example
   * const fileList = [
   *   { file_id: 'cloud://example-12345.abcdefgh/file1.jpg' },
   *   { file_id: 'cloud://example-12345.abcdefgh/file2.jpg' }
   * ];
   *
   * getTempFileURL(fileList).then(result => {
   *   for (let i in result) {
   *     console.log(result[i].temp_file_url) // 临时URL
   *     console.log(result[i].deleted) // 是否已被删除
   *     console.log(result[i].file_id) // 对应的file_id
   *   }
   * })
   */
  getTempFileURL (file_list) {
    const _ = this
    const cache_key = 'temp_file_urls'
    return new Promise(async (resolve, reject) => {
      const cache = _.getCache(cache_key, {default_value: {}})
      const len = _.objLength(file_list)
      if (len > 50) {
        reject({errno: 'getTempFileURL Failed', errMsg: 'wx.cloud.getTempFileURL接口限制最多50个文件', len})
      }
      const urls = {} // 临时URL字典
      const expired_file_ids = [] // 过期需要查询的file_id
      const now = _.now()    // 要用用户的本地时间判断
      for (let i in file_list) {
        const file_id = file_list[i].file_id
        const c = cache[file_id]
        // 如果缓存地址在有效期内（确定已删除的图片不需要再次获取URL）
        if (c?.deleted || (c?.expire_time && now < c.expire_time)) {
          urls[file_id] = cache[file_id].temp_file_url
        } else {
          expired_file_ids.push(file_id)
        }
      }
      // 若有过期图片，去云端获得新的临时URL
      if (expired_file_ids.length > 0) {
        let res
        try {
          res = await _.call({
            name: 'all_user',
            action: 'GetTempFileUrl',
            data: {
              file_ids: expired_file_ids,
            }
          })
        } catch (e) {
          reject({errno: 'getTempFileURL Failed', errMsg: '发起wx.cloud.getTempFileURL失败', e})
          return
        }
        if (!res.success) {
          reject({errno: 'getTempFileURL Failed', errMsg: res.errMsg})
          return
        }
        const expire_time = _.minutesAgo(-5)
        for (let i in res.file_list) {
          const { file_id, temp_file_url } = res.file_list[i]
          const deleted = _.isEmpty(temp_file_url)
          cache[file_id] = {temp_file_url, expire_time, deleted}
          urls[file_id] = temp_file_url
        }
      }
      try {
        _.assert(_.objLength(urls) === len)
      } catch (e) {
        reject({errno: 'getTempFileURL Failed', errMsg: '返回的临时URL数量不对', len, urls})
        return
      }
      _.setCache(cache_key, cache)
      return resolve(file_list.map(o => ({
        file_id: o.file_id,
        temp_file_url: urls[o.file_id],
        deleted: _.isEmpty(urls[o.file_id]),
      })))
    })
  },


  /* === Promise === */

  /**
   * 等待并判断promise列表是否全部成功。只关心是否全部成功, 不关心返回值。
   * 
   * @param {Array<Promise>} promises - Promise列表
   * @returns {Promise<boolean>} 返回一个Promise，当所有Promise都成功时，返回 `true`；否则，返回 `false`。
   * 
   * @example
   *   const success = await utils.allResolved([p1, p2, p3]) // 等待并判断promise列表是否全部成功
   */
  allResolved (promises) {
    const _ = this
    return new Promise((resolve, reject) => {
      Promise.all(promises)
        .then(() => {
          resolve(true)
        })
        .catch(e => {
          resolve(false)
        })
    })
  },

  /**
   * 把Array转换成Promise列表，并等待全部完成。
   * 当你有一个组数列表，你需要对每个元素执行相同的异步操作，然后等待所有操作完成时，可以使用此函数。
   * 
   * @param {Array<any>} arr - 需要转换的数组
   * @param {function} pro_func - 函数，接收两个参数，分别是arr数组的元素和index, 返回一个promise
   * @returns {Promise<boolean>} 返回一个Promise，当所有Promise都成功时，返回 `true`；否则，返回 `false`。
   * 
   * @example
   *   // 把Array转换成Promise列表，并等待全部完成
   *   utils.awaitAll([1,2,3], (v, i) => {
   *     return new Promise((resolve, reject) => {
   *       setTimeout(() => {
   *         console.log(v)
   *         resolve()
   *       }, 1000)
   *     })
   *   })
   *   // 上面代码中，先把数组[1,2,3]转换成Promise列表，然后等待全部完成
   */
  awaitAll (arr, pro_func) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.allResolved(arr.map(pro_func)).then(resolve).catch(reject)
    })
  },

  /**
   * 把一个Promise函数添加到顺序执行的队列中。
   * 
   * @param {function} promise_func - Promise函数，应返回一个Promise对象
   *
   * 注意
   *   1. `promise_func` 必须返回Promise
   *   2. `promise_func` 会按顺序执行，不会并发执行，即使 `addPromiseToQueue` 被并发调用。
   *   3. 此函数在整个小程序的所有页面中共享同一个队列
   *   4. 若被添加的Promise执行时出现异常，不会影响后续Promise的执行
   * 
   * @example
   *   utils.addPromiseToQueue(p1) // 把一个Promise函数添加到队列中，假设这个p1需要执行2秒钟
   *   utils.addPromiseToQueue(p2) // 立即把另一个Promise添加到队列中，p2会在p1执行完后再执行
   *   // 继续向队列中添加更多Promise，它们会按添加顺序逐一执行
   */
  addPromiseToQueue (promise_func) {
    const _ = this
    _._promise_queue = _._promise_queue.then(() => promise_func()).catch(e => {})
  },


  /* === first app admin === */

  /**
   * 判断当前用户是否为管理员，用于显示隐藏的功能等。
   * 
   * @param {string} app - 应用名称
   * @returns {boolean} 如果用户是管理员，返回 true，否则返回 false
   */
  isAdmin (app) {
    const _ = this
    _.assert(app, 'isAdmin函数的app不能为空')
    const c = `${app}_user`
    return _.getUserConfig(c, 'is_admin')
  },

  /**
   * 仅管理员可使用，设置应用setting。
   * 
   * @param {string} key - 设置的键名
   * @param {any} value - 设置的值
   * @param {object} [options] - 可选参数
   *   - name='default' - 应用设置的名称
   */
  setAppSetting (key, value, { name = 'default' } = {}) {
    const _ = this
    const c = 'app_setting'
    const cache_key = `app_setting_${name}`
    const app = _.appName()
    _.getOne(c, {app, name})
      .then(doc => {
        if (doc) {
          _.updateDoc(c, doc._id, {[key]: value})
          _.putValue(doc, key, value)
          _.setCache(cache_key, doc)
        } else {
          _.addDoc(c, {app, name, [key]: value, })
          _.setCache(cache_key, {[key]: value})
        }
      })
  },

  /**
   * 仅管理员可使用，向应用setting数组中添加值。
   * 
   * @param {string} key - 设置的键名
   * @param {any} value - 设置的值
   * @param {object} [options] - 可选参数
   *   - name='default' - 应用设置的名称
   */
  pushAppSetting (key, value, { name = 'default' } = {}) {
    const _ = this
    const $ = _.command()
    const c = 'app_setting'
    const cache_key = `app_setting_${name}`
    const app = _.appName()
    _.getOne(c, {app, name})
      .then(doc => {
        if (doc) {
          _.updateDoc(c, doc._id, {[key]: $.push(value)})
          _.pushValue(doc, key, new_value)
          _.setCache(cache_key, doc)
        } else {
          _.addDoc(c, {app, name, [key]: [value], })
          _.setCache(cache_key, {[key]: [value]})
        }
      })
  },


  /* === 其他函数 === */

  /**
   * 获取当前小程序的名称name
   * 需在app.js的globalData.config.app_name处设置app_name(请使用小写字母)
   * @returns {string} 返回配置中设置的小程序名称
   */
  appName(){
    const _ = this
    const app_name = _.getConfig('app_name')
    if (_.isEmpty(app_name)) {
      throw new Error('请在app.js文件的globalData.config.app_name处设置app_name(请使用小写字母)')
    }
    return app_name
  },

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

  /**
   * 在给定的延迟后显示成功的提示。
   * 
   * @param {object} [options] - 可选参数
   * @param {string} [options.text='ok'] - 要显示的文本
   * @param {number} [options.duration=1500] - 提示显示的持续时间（毫秒）
   * @param {number} [options.delay=0] - 显示提示前的延迟时间（毫秒）
   */
  showOk ({text = 'ok', duration = 1500, delay = 0} = {}) {
    const _ = this
    _.assert(_.isString(text), `传给showOk的参数必须是字符串: typeof text = ${typeof text}`)
    function run () {
      return wx.showToast({ title: text, icon: 'success', duration: duration })
    }
    if (delay === 0) {
      return run()
    } else {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          run().then(resolve).catch(reject)
        }, delay)
      })
    }
  },

  /**
   * 在给定的延迟后显示提示信息。
   * 
   * @param {object} [options] - 可选参数
   * @param {string} options.text - 要显示的文本
   * @param {number} [options.duration=1500] - 提示显示的持续时间（毫秒）
   * @param {number} [options.delay=0] - 显示提示前的延迟时间（毫秒）
   * @returns {Promise} 返回一个 Promise，resolve 时返回提示信息
   */
  showTip ({text, duration = 1500, delay = 0} = {}) {
    const _ = this
    _.assert(_.isString(text), `传给showTip的参数必须是字符串: typeof text = ${typeof text}`)
    function run () {
      return wx.showToast({ title: text.toString(), icon: 'none', duration })
    }
    if (delay === 0) {
      return run()
    } else {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          run().then(resolve).catch(reject)
        }, delay)
      })
    }
  },

  /**
   * 在给定的延迟后显示错误信息。
   * 
   * @param {object} [options] - 可选参数
   * @param {string} options.text - 要显示的错误信息
   * @param {number} [options.duration=2000] - 提示显示的持续时间（毫秒）
   * @param {number} [options.delay=0] - 显示提示前的延迟时间（毫秒）
   * @returns {Promise} 返回一个 Promise，resolve 时返回错误信息
   */
  showError ({text, duration = 2000, delay = 0} = {}) {
    const _ = this
    _.assert(_.isString(text), `传给showError的参数必须是字符串: typeof text = ${typeof text}`)
    function run () {
      return wx.showToast({ title: text.toString(), icon: 'error', duration })
    }
    if (delay === 0) {
      return run()
    } else {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          run().then(resolve).catch(reject)
        }, delay)
      })
    }
  },

  /**
   * 请求权限后执行某项操作。
   * 
   * @param {object} options - 参数对象
   * @param {string} options.auth - 请求的权限
   * @returns {Promise} 返回一个 Promise，resolve 时表示用户已授权
   */
  authorized ({auth} = {}) {
    return new Promise((resolve, reject) => {
      if (auth){
        wx.getSetting()
          .then(res => {
            if (res.authSetting[auth]) {
              resolve()
            } else {
              wx.authorize({ scope: auth }).then(resolve).catch(reject)
            }
          })
          .catch(reject)
      }else{
        reject({errno: 'auth Failed', errMsg: '缺少auth参数'})
      }
    })
  },

  /**
   * 返回大于等于 0，小于 max 的随机整数。
   * 
   * @param {number} max - 最大值
   * @returns {number} 返回随机整数
   */
  randomInt (max) {
    return Math.floor(Math.random() * max)
  },

  /**
   * 返回长度为 size 的随机字符串。
   * 
   * @param {number} size - 字符串长度
   * @param {object} [options] - 可选参数
   * @param {boolean} [options.only_lowercase=false] - 是否只包含小写字母
   * @returns {string} 返回随机字符串
   */
  randomString(size, {only_lowercase = false} = {}) {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lower = 'abcdefghijklmnopqrstuvwxyz'
    const digits = '0123456789'
    let s = only_lowercase ? lower : upper + lower + digits
    let result = ''
    for (let i = 0; i < size; i++) {
      result += s.charAt(Math.floor(Math.random() * s.length))
    }
    return result
  },

  /**
   * 返回长度为 size 的随机数字字符串，可能以 0 开头。
   * 
   * @param {number} size - 字符串长度
   * @returns {string} 返回随机数字字符串
   */
  randomNumber(size) {
    const digits = '0123456789'
    let result = ''
    for (let i = 0; i < size; i++) {
      result += digits.charAt(Math.floor(Math.random() * digits.length))
    }
    return result
  },

  /**
   * 从数组中随机选择几个元素的函数。
   * 
   * @param {Array} l - 原数组
   * @param {number} [count=1] - 选择的元素个数
   * @returns {Array} 返回随机选择的元素数组
   */
  randomChoose(l, count = 1) {
    const l2 = Array.from(l)
    if (l2.length > 0) {
      if (count === 1) {
        return l2[Math.floor(Math.random() * l2.length)]
      } else {
        const shuffled = l2.slice().sort(() => Math.random() - 0.5)
        return shuffled.slice(0, count)
      }
    } else {
      return (count === 1) ? null : []
    }
  },

  /**
   * 断言函数，如果条件不满足，抛出错误。
   * 
   * @param {boolean} condition - 断言的条件
   * @param {string} [message=''] - 如果断言失败，抛出的错误信息
   */
  assert (condition, message = '') {
    if (!condition) {
      throw new Error(message || 'Assertion failed')
    }
  },

  /**
   * 比较两个版本号的大小。
   * 
   * @param {string} v1 - 第一个版本号
   * @param {string} v2 - 第二个版本号
   * @returns {number} 如果 v1 > v2，返回 1，如果 v1 < v2，返回 -1，如果 v1 = v2，返回 0
   */
  compareVersion(v1, v2) {
    v1 = v1.split('.')
    v2 = v2.split('.')

    const len = Math.max(v1.length, v2.length)

    while (v1.length < len) {
      v1.push('0')
    }
    while (v2.length < len) {
      v2.push('0')
    }

    for (let i = 0; i < len; i++) {
      const num1 = parseInt(v1[i])
      const num2 = parseInt(v2[i])

      if (num1 > num2) {
        return 1
      } else if (num1 < num2) {
        return -1
      }
    }

    return 0
  },

  /**
   * 复制内容到剪贴板。
   * 
   * @param {string} text - 要复制到剪贴板的文本
   */
  copyToClipboard(text) {
    wx.setClipboardData({
      data: text
    })
  },

  /**
   * 从剪贴板中获取内容（前端）。
   * 
   * @returns {Promise} 返回一个 Promise，resolve 时返回剪贴板的内容
   */
  getClipboardData() {
    const _ = this
    return new Promise((resolve, reject) => {
      wx.getClipboardData()
        .then(res => {
          resolve(res.data)
        })
        .catch(reject)
    })
  },

  /**
   * 预览对象。
   * 
   * @param {object} options - 参数对象
   * @param {object} options.obj - 要预览的对象
   */
  previewObject({obj}) {
    const _ = this
    _.globalData().temp.preview_obj = obj
    _.openPage(`/utils/dev_tools/preview_obj/preview_obj?data_from=temp`)
  },

  /**
   * 发送文件给朋友(pdf、word等）。
   * 注意：
   *    1. 此函数不能在utils.call中使用(通常需要用call获得file_url)，要提前获得file_url
   *       也不能和utils.call放在同一个函数中，否则看不见分享效果
   *       需要使用两个按钮来分享文件，第一个是创建文件，第二个是调用shareFileToFriend分享
   *    2. 需在小程序后台->开发->开发设置->服务器域名的 downloadFile合法域名 中添加 https://xxxxxxxxx.qcloud.la 域名
   *    3. 微信开发者工具中看不到分享效果，电脑端可用浏览器下载后预览
   * 
   * @param {string} file_url - 文件的网络地址
   * @param {string} file_name - 文件名，带后缀
   * @returns {Promise} 返回一个Promise，当成功时，返回 `undefined`；当失败时，返回错误信息
   */
  shareFileToFriend (file_url, file_name) {
    const _ = this
    return new Promise((resolve, reject) => {

      // 这里需要保存到用户本地目录，否则Android分享没有文件icon
      const filePath = `${wx.env.USER_DATA_PATH}/${file_name}`

      wx.downloadFile({
        url: file_url,
        filePath,
        success: ({statusCode, tempFilePath}) => {
          if (statusCode === 200) {
            wx.shareFileMessage({
              filePath, // 这里要使用上面的路径，而不是tempFilePath
              fileName: file_name,
            })
            resolve()
          } else {
            reject()
          }
        },
        fail: reject,
      })
    })
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

  /**
   * 获取云服务实例。
   * @returns {Object} 返回云服务的实例对象。
   */
  _cloud(){
    return APP().cloud
  },

  /**
   * 将用户配置数据保存到本地存储和云数据库中
   * @param {string} c - 集合名称，用于指定云数据库的集合和本地存储的键名
   * @param {Object} doc - 包含用户配置的对象，必须已经设置了value
   * @param {Object} options - 配置选项:
   *   - {boolean} encrypt - 是否加密存储，默认为true
   * @returns {Promise} 返回一个Promise对象，成功时无返回值，失败时返回错误信息
   * 说明
   *   1. 函数内部首先会清除doc对象中的_openid和_id字段，以避免数据库更新失败
   *   2. 本地存储更新后，将尝试更新云数据库中的记录
   *   3. 如果云数据库中没有相应记录，则会添加新记录
   *   4. 如果数据库更新操作影响的记录数多于一个，会记录错误信息
   * @example
   *   // 调用示例
   *   _saveUserConfigToStorageAndCloudDB('user_config', {theme: 'dark'}, {encrypt: false}).then(() => {
   *     console.log('Configuration saved successfully')
   *   }).catch(error => {
   *     console.error('Error saving configuration', error)
   *   })
   */
  _saveUserConfigToStorageAndCloudDB (c, doc, {encrypt = true} = {}) {
    const _ = this
    const storage_key = 's_' + c
    return new Promise(async (resolve, reject) => {
      // doc中不能有_openid、_id，否则数据库会更新失败
      _.putValue(doc, '_openid', undefined)
      _.putValue(doc, '_id', undefined)

      // 更新本地缓存
      _.setStorage(storage_key, doc, encrypt)
        .then(() => {

          // 更新数据库（需要检查数据库中是否有记录）
          _.updateMyMatch(c, {}, doc)
            .then(updated => {

              // 数据库中有记录，且更新成功
              if (updated > 0) {
                resolve()
              } else {

                // 不知道数据库中是否有记录。可能是doc与数据库中数据相同，也可能没有数据。需判断
                _.getMyOne(c, {})
                  .then(exists => {
                    // 数据库中没有数据时，写入新数据
                    if (!exists) {
                      _.addDoc(c, doc)
                        .then(resolve)
                        .catch(e => { reject({errno: '_saveUserConfigToStorageAndCloudDB Failed', errMsg: `向数据库${c}中插入数据时失败`, e}) })
                    } else {
                      resolve()
                    }
                  })
                  .catch(e => { reject({errno: '_saveUserConfigToStorageAndCloudDB Failed', errMsg: `从数据库${c}中获取数据时失败`, e}) })
              }

              if (updated > 1) { _.error({title: '_saveUserConfigToStorageAndCloudDB', msg: `数据库${c}中有多条记录，请确保_openid是唯一主键`}) }

            })
            .catch(e => {
              reject({errno: '_saveUserConfigToStorageAndCloudDB Failed', errMsg: `调用updateMatch时失败`, e})
            })

        })
        .catch(e => {
          reject({errno: '_saveUserConfigToStorageAndCloudDB Failed', errMsg: `调用setStorage时失败`, e, value_k: _.getKLen(value)})
        })

    })
  },

  /**
   * 获取日志记录器实例。根据环境不同，返回不同的日志处理器。
   * - 在本地环境或管理员模式下，返回console。
   * - 在正式运行环境下，返回云端日志管理器。若不支持getRealtimeLogManager，返回一个具备基本日志方法的空实现。
   * @returns {Object} 日志记录器实例，具有info, log, warn, 和 error方法。
   */
  _logger ()  {
    const _ = this
    if (_.isLocal() || _.isFirstApp()) {
      return console
    }else{
      if (wx.getRealtimeLogManager) {
        let ret = wx.getRealtimeLogManager()
        ret.log = ret.info // getRealtimeLogManager没有log方法
        return ret
      } else {
        // 返回一个info、log、warn、error方法都是空函数的对象
        return { info() {}, log() {}, warn() {}, error() {} }
      }
    }
  },

  /**
   * 将输入参数转换为对象形式。如果参数已经是对象，则直接返回；否则，转换为包含原始数据的对象。
   * @param {any} o - 要转换的原始数据。
   * @returns {Object} 转换后的对象。
   */
  _logToObj (o) {
    return this.isObject(o) ? o : { obj: o }
  },

  _user_config_buffer: {}, // 用于缓存用户配置
  _characters: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  _promise_queue: Promise.resolve(), // 用于串行执行异步任务

}

export default utils
