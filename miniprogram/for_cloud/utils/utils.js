'use strict'

/**
 * 当创建新的云函数时, 需要遵循以下步骤:
 * 
 * 1. 运行 `npm i --save request uuid file-type` 安装必要的npm包。
 * 2. 在 `config.json` 中配置 `booster_cloud_env_id` 等值。
 * 3. 在 `package.json` 中设置 `"engines": { "node": "16.13" }` 来指定 Node.js 的版本为 v16.13。
 * 
 * 注意：这些步骤需要根据实际项目需求进行调整。
 */

const CLOUD = require('wx-server-sdk') // 不要对外暴露CLOUD,应该仅在sh内部使用
const CONFIG = require('config.json')
const PAGE_SIZE = 1000 // 每页的记录数
const FS = require('fs')
const PATH = require('path')
const REQUEST = require('request')
const UUID = require('uuid')

// 允许上传的图片类型
const ALLOWED_IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg', 'heif', 'heic', 'ico']

// 这里的init不需要await，用new创建的cloud在init时才需要await
CLOUD.init({ env:  CONFIG['booster_cloud_env_id']}) // 记得在config.json中配置环境ID
const DB = CLOUD.database() // 需要放在CLOUD.init()之后

const utils = {

  /* === 运行环境 === */

  /**
   * 判断是否为本地环境
   * @returns {boolean} 返回值为true则表示为本地环境，否则为云端环境
   */
  isLocal () {
    const _ = this
    if (_._is_local === null) {
      // 当ENV与预期环境ID不一致时，操作测试数据
      // 因为ENV每次调用都一致，所以可以缓存结果
      _._is_local = _.getWXContext().ENV !== CONFIG['booster_cloud_env_id']
    }
    return _._is_local
  },

  /**
   * 获取云函数运行环境
   * @returns {Object} 包含以下属性的对象:
   *   - {string} ENV - 云函数运行环境ID，本地运行时为local
   *   - {string} SOURCE - 云函数运行来源，本地调用时可能为wx_client，也可能为wx_devtools
   *
   * 说明：
   * 1. ENV在一个实例生命周期内,不会变化,可以缓存
   * 2. SOURCE会变化,不可以缓存
   * 3. 注意，SOURCE可能有多个值（用,分割）
   * 4. 文档 https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/utils/Cloud.getWXContext.html
   * @example
   * let context = utils.getWXContext();
   */
  getWXContext () {
    return this._cloud().getWXContext()
  },

  /**
   * 获取当前运行环境的详情
   * @returns {Object} 包含以下属性的对象:
     - {string} appid - 应用ID
     - {string|null} dev_appid - 开发环境的应用ID，可能为null
     - {string} openid - 用户的openid
     - {string} ip - 用户的IP地址，优先使用IPv6
   * 
   * 说明：
   *   1. 不能缓存running的结果，因为每次用户请求时context都不一样
   */
  running () {
    const _ = this
    const context = _._cloud().getWXContext()
    return {
      appid     : context.FROM_APPID || context.APPID,
      dev_appid : context.APPID || null, // dev环境的appid
      openid    : context.OPENID || context.FROM_OPENID,  // 被共享环境下OPENID为空，使用FROM_OPENID
      ip        : context.CLIENTIPV6 || context.CLIENTIP, // 优先使用IPv6
    }
  },

  /**
   * 获取调用云函数的应用程序 ID。注意同一个云函数是支持多个小程序调用的。
   * 
   * @returns {string} 返回应用程序 ID
   */
  appid () {
    return this.running().appid
  },

  /**
   * 获取admin环境的应用程序 ID（不是发起调用的小程序的应用程序 ID）。
   * 
   * @returns {string} 返回开发环境的应用程序 ID
   */
  devAppid () {
    return this.running().dev_appid
  },

  /**
   * 获取调用云函数的应用程序名称，需要在配置文件的 `booster_app_list` 中配置，如果未配置，将抛出异常。
   * 
   * @returns {string} 返回应用程序名称
   */
  appName () {
    const _ = this
    const appid = _.appid()
    const app = CONFIG['booster_app_list'][appid]
    if (!app) {
      throw new Error(`appid ${appid} not found in config booster_app_list`)
    }
    return app
  },

  /**
   * 获取 OpenID，但云端也不能保证总是能获取到 OpenID。
   * 
   * @returns {string} 返回 OpenID
   */
  openid () {
    return this.running().openid
  },

  /**
   * 异步获取 OpenID，当openid可会返回null时，可尝试使用 await utils.openidAsync()
   * 
   * @returns {Promise} 返回一个 Promise，resolve 时返回 OpenID
   */
  openidAsync () {
    const _ = this
    return new Promise(async (resolve, reject) => {
      // 网上有人说getWXContext需要await，但目前还没有证实云端openid会为空
      // 需要多测试看看getWXContext是否必须await
      const context = await _._cloud().getWXContext()
      if (_.isNone(context)) {
        _.error({title: 'openidAsync is none', context})
        _.addDoc('log', {title: 'openidAsync is none', context})
      } else if (_.isEmpty(context.OPENID) && _.isEmpty(context.FROM_OPENID)) {
        _.error({title: 'openidAsync is empty', context})
        _.addDoc('log', {title: 'openidAsync is empty', context})
      }
      resolve(context.OPENID || context.FROM_OPENID)
    })
  },

  /**
   * 获取用户端 IP 地址。
   * 
   * @returns {string} 返回 IP 地址
   */
  ip () {
    return this.running().ip
  },

  /**
   * 获取云函数的配置，支持使用 `a.b.c` 形式的键。
   * 
   * @param {string} key - 配置的键
   * @returns {any} 返回配置的值
   */
  getConfig(key){
    return this.pickValue(CONFIG, key)
  },

  /**
   * 从配置文件中获取当前云环境 ID。
   * 
   * @returns {string} 返回云环境 ID
   */
  envId () {
    return CONFIG['booster_cloud_env_id']
  },

  /**
   * 从配置文件中获取当前云函数的名称。
   * 
   * @returns {string} 返回云函数的名称
   */
  funcName () {
    return CONFIG['booster_func_name']
  },

  /**
   * 发起一个云调用（此接口通常不支持在本地环境中调用，只能在正式环境中调用）。
   * 
   * @param {object} options - 参数对象
   * @param {string} options.api_name - API 的名称，不要以 openapi 开头
   * @param {string} options.appid - 应用程序 ID
   * @param {object} options.data - 要发送的数据
   * @returns {Promise} 返回一个 Promise，resolve 时返回异步结果
   * 
   * @example
   *   const res = await utils.callOpenApi({api_name: '', appid: '', data: {}})
   */
  callOpenApi ({api_name, appid, data}) {
    const _ = this
    return new Promise(async (resolve, reject) => {
      const _ = this
      if (_.isEmpty(api_name) || _.isEmpty(appid) || _.isEmpty(data)) {
        reject({errno: 'utils.callOpenApi Failed', errMsg: '参数不能为空', data})
        return
      }

      // api_name不要以openapi开头
      if (api_name.startsWith('openapi')) {
        reject({errno: 'utils.callOpenApi Failed', errMsg: 'api_name不要以openapi开头', data})
        return
      }

      // api_name必须在config.json中配置
      const permissions = _.getConfig('permissions.openapi')
      if (!_.in(`openapi.${api_name}`, permissions)) {
        reject({errno: 'utils.callOpenApi Failed', errMsg: `${api_name}未在config.json的permissions.openapi中配置`, data})
        return
      }

      // 不支持本地调用
      if (_.isLocal()) {
        reject({errno: 'utils.callOpenApi Failed', errMsg: '不支持本地调用，请上传云函数后在正式环境中调用', data})
        return
      }

      const api_func = _.pickValue(_._cloud().openapi({appid}), api_name)

      if (!api_func) {
        reject({errno: 'utils.callOpenApi Failed', errMsg: `api_name:${api_name}不存在`, data})
        return
      } else {
        const res = await api_func(data)
        resolve(res)
      }

    })
  },


  /* === 日志 === */

  /**
   * 获取日志记录器实例。根据环境不同，返回不同的日志处理器。
   * - 在本地环境或管理员模式下，返回console。
   * - 在正式运行环境下，返回云端日志管理器。
   * @returns {Object} 日志记录器实例，具有info, log, warn, 和 error方法。
   */
  _logger() {
    const _ = this
    return _.isLocal() ? console : _._cloud().logger()
  },

  /**
   * 将输入参数转换为对象形式。如果参数已经是对象，则直接返回；否则，转换为包含原始数据的对象。
   * @param {any} o - 要转换的原始数据。
   * @returns {Object} 转换后的对象。
   */
  _logToObj (o) {
    return this.isObject(o) ? o : { please_use_obj: o }
  },

  /**
   * 打印日志信息。此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj_msg - 要记录的消息对象。
   */
  log(obj_msg) {
    const _ = this
    obj_msg = _._logToObj(_.jsonDeepcopy(obj_msg))
    _._logger().log(obj_msg) 
  },

  /**
   * 打印信息级别的日志。与log方法类似，确保消息数据在打印前进行深拷贝，以保证数据的准确性。
   * @param {Object} obj_msg - 要记录的信息级别的消息对象。
   */
  info(obj_msg) {
    const _ = this
    obj_msg = _._logToObj(_.jsonDeepcopy(obj_msg))
    _._logger().info(obj_msg)
  },

  /**
   * 打印警告级别的日志。此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj_msg - 要记录的警告级别的消息对象。
   */
  warn(obj_msg) {
    const _ = this
    obj_msg = _._logToObj(_.jsonDeepcopy(obj_msg))
    _._logger().warn(obj_msg) 
  },

  /**
   * 打印错误级别的日志。此方法确保日志数据以对象形式记录，并进行深拷贝以防止在异步打印过程中数据被修改。
   * @param {Object} obj_msg - 要记录的错误级别的消息对象。
   */
  error(obj_msg) {
    const _ = this
    obj_msg = _._logToObj(_.jsonDeepcopy(obj_msg))
    _._logger().error(obj_msg) 
  },

  /**
   * 将云函数中的event和context记录到log集合中（云端）
   * @param {Object} options 包含以下属性的对象:
   *   - {Object} event - 云函数的event参数
   *   - {Object} context - 云函数的context参数
   *   - {string} [title=''] - 标题，可选
   */
  logEventContext ({event, context, title = ''} = {}) {
    const _ = this
    const coll = 'log'
    event = _.deepCopy(event)
    context = _.deepCopy(context)
    if (!_.isEmpty(context)) {
      context.environment = _.fromJsonString(context.environment)
      context.environment.TCB_CONTEXT_CNFG = _.fromJsonString(context.environment.TCB_CONTEXT_CNFG)
    }
    _.addDoc(coll, {event, context, title, time: _.dateToString()})
  },

  /**
   * 将日志数据记录到数据库的特定集合中。这通常用于持久化重要的日志信息。
   * @param {string} title - 日志标题，用于标识或简单描述这条日志信息。
   * @param {Object} obj - 日志内容对象，将被深拷贝以保持数据在写入前的完整性。
   */
  async logToColl (title, obj) {
    const _ = this
    //obj = _.deepCopy(obj) // 如果觉得有必要，再加上这一句
    const id = await _.addDoc('log', {title, obj, time: _.dateToString()})
    return id
  },

  /**
   * 清空log集合（云端）
   */
  clearLog () {
    const _ = this
    const coll = 'log'
    const $ = _.command()
    _.removeMatch(coll, {_id: $.exists(true)})
  },


  /* === 数据库 === */

  /**
   * 获取数据库查询指令
   * @returns {Object} 数据库查询指令对象
   */
  command: () => DB.command,

  /**
   * 获取聚合查询指令
   * @returns {Object} 聚合查询指令对象
   */
  aggregate: () => DB.command.aggregate,

  /**
   * 获取指定集合的引用，建议使用此方法代替默认的collection方法以避免误操作线上数据库
   * @param {string} c - 集合的名称
   * @returns {CollectionReference} 指定集合的引用
   */
  coll (c) {
    const _ = this
    return _._db().collection(_._collName(c)) // 此文件中只有这里可以写collection
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
   * 获取指定集合中的最多1000条数据
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} c - 集合名称
   *   - {Object} w - 查询条件，默认为{}，如：{status: '未完成'}
   *   - {number} page_num - 页码，从0开始，默认为0
   *   - {number|null} page_size - 每页大小，如果未指定，则使用默认的PAGE_SIZE
   *   - {string} only - 仅返回的字段，默认为空
   *   - {string} except - 不返回的字段，默认为空
   *   - {boolean} created - 是否添加创建时间，默认为false
   *   - {Object|string} order_by - 排序规则。可以是简单的字符串或复杂的有序对象。
   *     - 当仅需根据某个字段升序排序时，可以直接写字段名，如：'rank'
   *     - 当需要使用多个字段或降序时，需用有序对象，如：{a: 'asc', b: 'desc', 'c.d.e': 1}
   *       - 升序可以写为：'asc'、1 或 true
   *       - 降序可以写为：'desc'、0 或 false
   * @returns {Promise<Array>} 返回一个Promise，其解析结果为一个数组，包含了查询到的数据
   * 
   * 说明
   * 1. 当查询条件w={}时，where不会过滤任何数据
   * 2. 一次query.get仅消耗一次调用次数
   */
  docs ({c, w = {}, page_num = 0, page_size = null, only = '', except = '', created = false, order_by = {} } = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      let query = _.coll(c)
        .where(w) // 当w={}时，where不会过滤任何数据
        .skip(page_num * PAGE_SIZE)
        .limit(page_size || PAGE_SIZE)
        .field(_._makeField(only, except))

      if (!_.isEmpty(order_by)) {
        order_by = _._prepareOrderBy(order_by)
        for (let k in order_by) {
          query = query.orderBy(k, order_by[k])
        }
      }

      // 一次query.get仅消耗一次调用次数
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
   * 获取指定集合中的所有数据
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} c - 集合名称
   *   - {Object} match - 匹配条件，默认为{}
   *   - {Object} project - 项目筛选条件，默认为{}
   *   - {Object} sort - 排序规则，默认为{_id: 1}
   *   - {number} page_size - 每页大小，默认为10000
   * @returns {Promise<Array>} 返回一个Promise，其解析结果为一个数组，包含了查询到的数据
   * 
   * 说明
   * 1. 该函数一般用于数据量不大且不想实现分页的情况
   * 2. 若每个文档的平均大小较大，可缩小page_size的值（云端单次读取超过50M会报错）
   * 3. 尽量使用only、except缩小单次读取的数据量（以免超过50M）
   * 4. 先执行project，再执行sort
   * 5. 本函数使用aggregate读数据库，每次默认读取10000条，多次读取合并返回
   */
  allDocs ({c, match = {}, project = {}, sort = {_id: 1}, page_size = 10000} = {}) {
    const _ = this
    if (!_.isEmpty(sort)) {
      sort = _._prepareSort(sort)
    }
    return new Promise(async (resolve, reject) => {
      let result = []
      let has_more = true
      let page_num = 0

      while (has_more) {
        let query = _.agg(c).match(match)

        if (!_.isEmpty(project)) { query = query.project(project) }

        query = query.sort(sort).skip(page_num * page_size).limit(page_size)

        try {
          let res = await query.end()
          result = result.concat(res.list)
          has_more = res.list.length === page_size
          page_num++
        } catch (e) {
          reject({errno: 'allDoc Failed', errMsg: `query查询出错`, e})
          return
        }

      }

      resolve(result)

    })
  },

  /**
   * 更新指定的文档
   * 此函数检查指定的文档ID，并根据提供的数据进行更新。它返回一个布尔值，指示更新是否成功执行。
   * 如果文档存在并且内容更新，则返回true。如果文档不存在或内容未发生变化，则返回false。
   * 
   * @param {string} c - 集合名称
   * @param {string} id - 文档ID，用于定位需要更新的文档
   * @param {Object} d - 包含更新数据的对象，支持点表示法更新嵌套字段，如：{'a.b.c': 1}
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功更新。true表示更新成功，false表示失败。
   * 
   * @example
   *   const success = await utils.updateDoc('todo', 'id123456', {status: '已完成'})
   *   if (success) {
   *     console.log('更新成功')
   *   } else {
   *     console.log('无法更新，可能是由于文档不存在或数据未变更')
   *   }
   */
  updateDoc (c, id, d) {
    const _ = this
    return new Promise((resolve, reject) => {
      _._doc(c, id)
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
   * 批量更新文档。
   * 注意事项：
   *   - 此函数不支持使用 $.set() 替换整个对象。
   *   - 如果更新值为undefined，则对应字段会被删除。
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 匹配被更新文档的条件。
   * @param {Object} d - 需要更新的数据，支持点表示法，如：{'a.b.c': 1}。
   * @returns {Promise<Number>} 返回一个 Promise 对象，解析为更新的文档数量。
   */
  updateMatch(c, w, d) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (_.isEmpty(w)) {
        reject({errno: 'updateMatch Failed', errMsg: `w不能为空`})
      } else {
        _.coll(c)
          .where(w)
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
      _._doc(c, id)
        .set({data: d})
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
   * @returns {Promise<boolean>} Promise对象，解析返回是否成功删除。true表示删除成功，false表示失败。
   */
  removeDoc (c, id) {
    const _ = this
    return new Promise((resolve, reject) => {
      _._doc(c, id)
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
   * 批量删除匹配条件的文档
   * @param {string} c - 集合名称。
   * @param {Object} w - 匹配被删除的文档的条件。
   * @returns {Promise<number>} 返回一个代表被删除文档数量的Promise对象。
   */
  removeMatch(c, w) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (_.isEmpty(w)) {
        reject({errno: 'removeMatch Failed', errMsg: `w不能为空`})
      } else {
        _.coll(c)
          .where(w)
          .remove()
          .then(res => {
            resolve(res.stats.removed)
          })
          .catch(reject)
      }
    })
  },

  /**
   * 根据id获取数据
   * 
   * @param {string} c - 集合名称。
   * @param {string} id - 文档的ID。
   * @param {Object} options 包含以下属性的对象:
   *   - {string} only - 仅返回的字段，多个字段用逗号分隔，如：'title, content'。
   *   - {string} except - 不返回的字段。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getDoc(c, id, {only = '', except = ''} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).doc(id)
        .field(_._makeField(only, except))
        .get()
        .then(res => {
          resolve(res.data)
        })
        .catch(e => {
          resolve(null)
        })
    })
  },

  /**
   * 通过查询条件获取第一个匹配的文档
   * 
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * 
   * @returns {Promise<Object|null>} Promise对象，解析为文档或null。
   */
  getOne(c, w) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).where(w).limit(1).get()
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
   * 向指定集合中添加一个文档
   * 
   * @param {string} c - 集合的名称
   * @param {Object} d - 要添加的文档数据
   * @returns {Promise<string>} Promise对象，解析返回新文档的ID
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
   * 批量插入数据到指定的集合中（只有云端可以批量插入）
   * @param {string} c - 集合名称
   * @param {Array} doc_list - 需要插入的文档列表
   * @returns {Promise<Object>} 返回一个Promise，其解析结果为一个对象，包含了插入的文档的ID列表和文档数量
   *
   * 调用次数
   *   1. 本函数每调用一次只消耗一次调用次数
   * 
   * @example
   * // 使用示例
   * utils.addDocList('coll', [doc1, doc2, ...])
   *   .then(({ids, len}) => console.log(ids, len))
   */
  addDocList(c, doc_list) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).add({ data: doc_list })
        .then(res => {
          resolve({ids: res._ids, len: res._ids.length})
        })
        .catch(e => {
          reject(e)
        })
    })
  },

  /**
   * 将一个todo添加到'all_todo'集合中
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} app - 应用名称
   *   - {string} action - 动作
   *   - {string} value - 值
   * @returns {Promise<DocumentReference>} 返回一个Promise，其解析结果为一个引用，指向新添加的文档 
   * 
   * @example
   * utils.addTodo({ app: 'appName', action: 'actionName', value: 'value' })
   */
  addTodo({app, action, value} = {}){
    const _ = this
    return _.addDoc('all_todo', {app, action, is_local: _.isLocal(), value, status: 'wait'})
  },

  /**
   * 将一个文件添加到'all_file'集合中
   * @param {Object} options - 包含以下属性的对象:
   *   - {string} app - 应用名称
   *   - {string} c - 集合名称
   *   - {string} doc_id - 文档ID
   *   - {string} file_id - 文件ID
   *   - {string} file_path - 文件路径
   *   - {number} size_m - 文件大小，单位为MB
   *   - {string} _openid - 用户的openID，默认为空
   * @returns {Promise<DocumentReference>} 返回一个Promise，其解析结果为一个引用，指向新添加的文档 
   */
  addFile({app, c, doc_id, file_id, file_path, size_m, _openid = ''} = {}){
    const _ = this
    const created = _.serverDate()
    let data = {app, c, doc_id, file_id, file_path, size_m, _openid, created}
    if (_.isLocal()) { data.is_local = true }
    return _.addDoc('all_file', data)
  },

  /**
   * 根据集合名和条件判断数据是否存在。
   * @param {string} c - 集合名称。
   * @param {string|Object} w_or_id - 查询条件或文档ID。
   * @returns {Promise<boolean>} 返回一个布尔值的Promise，表示数据是否存在。
   */
  exists(c, w_or_id) {
    const _ = this
    return new Promise((resolve) => {
      // 传入的条件是id
      if (_.isString(w_or_id)) {
        _.coll(c).doc(w_or_id).get()
          .then(res => {
            resolve(true)
          })
          .catch(e => {
            resolve(false)
          })
      } else {
        _.coll(c).where(w_or_id).limit(1).get()
          .then(res => {
            if (res.data.length > 0) {
              resolve(true)
            } else {
              resolve(false)
            }
          })

      }
    })
  },

  /**
   * 获取集合中满足条件的文档数量。
   * @param {string} c - 集合名称。
   * @param {Object} w - 查询条件。
   * @returns {Promise<number>} 返回文档数量的Promise。
   */
  count (c, w = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).where(w).count()
        .then(res => {
          resolve(res.total)
        })
        .catch(e => {
          reject(e)
        })
    })
  },

  /**
   * 获取指定集合中的最大index值加一
   * @param {string} c - 集合名称
   * @returns {Promise<number>} 返回一个Promise，其解析结果为一个整数，表示下一个index值。如果集合中没有数据，则返回0
   * 
   * 说明
   * 1. 此函数一般用于递增生成订单号
   * 2. 前端一般不使用此类函数
   * 3. 注意：此函数无法解决并发冲突问题，微信api无法在原子操作中实现max_index+1
   */
  getNextIndex (c) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c).orderBy('index', 'desc').limit(1).get()
        .then(res => {
          if (res.data.length > 0) {
            resolve(res.data[0].index + 1)
          } else {
            resolve(0)
          }
        })
        .catch(e => {
          reject(e)
        })
    })
  },

  /**
   * 获取集合中某字段的最大值。
   * @param {string} c - 集合名称。
   * @param {string} feild - 字段名称，支持点表示法。
   * @param {Object} options
   *   - {Object} w - 查询条件，默认为空对象。
   *   - {any} default_value - 如果没有符合条件的文档，返回的默认值，默认为null。
   *   - {string} _order_by - 排序方式，'asc'表示升序，'desc'表示降序，默认为'desc'。
   * @returns {Promise<any>} 如果有符合条件的文档，返回字段的最大值，否则返回默认值或null。
   * @example
   * let max_value = await utils.getMaxFeild(c, feild, {default_value: 0})
   */
  getMaxFeild (c, feild, {w = {}, default_value = null, _order_by = 'desc'} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.coll(c)
        .where(w)
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
  getMinFeild (c, feild, {w = {}, default_value = null} = {}) {
    return this.getMaxFeild(c, feild, {w, default_value, _order_by: 'asc'})
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
   * 将字符串转换为PascalCase（首字母大写）格式。
   *
   * @param {string} str - 待转换的字符串，单词之间由下划线('_')分隔。
   * @returns {string} 返回转换后的字符串，每个单词的首字母大写，无下划线('_')。
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
    return /^1[3-9]\d\*{4}\d{4}$/.test(s);
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
   * 判断输入是否为对象或数组。
   * @param {*} i - 待检查的输入。
   * @returns {boolean} 如果输入是对象或数组，则返回true，否则返回false。
   */
  isObjectOrArray(i){
    const _ = this
    return _.isObject(i) || _.isArray(i)
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
   * 判断值是否为字符串
   * 
   * @param {*} i - 要判断的值
   * @returns {boolean} 如果值为字符串，返回true；否则返回false
   */
  isString(i){
    return typeof i === 'string' || i instanceof String
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
   * 深度拷贝，会忽略undefined、null。
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
  allKeyMap (obj, key, fn) {
    const _ = this
    if (_.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        _.allKeyMap(obj[i], key, fn)
      }
    } else if (_.isObject(obj)) {
      for (let k in obj) {
        if (k === key) {
          obj[k] = fn(obj[k], obj)
          if (obj[k] === undefined) {
            obj[k] = null
          }
        } else if (typeof obj[k] === 'object') {
          _.allKeyMap(obj[k], key, fn)
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


  /*  === 数组、列表  === */

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
   * 获取云数据库的当前日期和时间，可以指定秒、分钟和天数的偏移量。
   * 
   * @param {Object} offsetObject - 包含偏移量的对象
   *   - seconds - 秒偏移量
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
   * 从数据_id中获取时间，返回Date对象
   * 
   * 系统使用什么时区，就返回什么时区的时间（以插入数据时的时区决定）。
   * 建议在云函数中把时区转换为上海时区，即添加 TZ=Asia/Shanghai 配置。
   * 
   * @param {string} id - 数据的_id
   * @returns {Date} 从_id中解析出的时间
   */
  getTimeFromId (id) {
    // 从id中获得UTC毫秒
    let t = parseInt(id.substring(8, 16), 16) * 1000
    // 返回当前时区的时间
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


  // === 随机函数 ===

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
   * 生成一个随机UUID
   * @returns {string} 返回生成的UUID
   */
  randomUUID () {
    return UUID.v4()
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


  /* === 文件、云存储 === */

  /**
   * 获取文件的临时URL（所有用户可读时URL是长期有效，否则有效期只有10分钟）
   * @param {Array.<string>} file_ids - 文件id数组，数量不能超过50个（微信限制）
   * @returns {Promise<Array.<Object>>} 返回一个Promise，解析后的结果是一个对象数组，每个对象包含file_id和temp_file_url
   * @example
   * utils.getTempFileURL(['file_id1', 'file_id2'])
   * .then(file_list => {
   *   console.log(file_list) // [{file_id, temp_file_url}, ...]
   * })
   */
  getTempFileURL (file_ids) {
    const _ = this
    return new Promise(async (resolve, reject) => {
      const res = await _._cloud().getTempFileURL({
        fileList: file_ids,
      })
      const file_list = res.fileList.map((item) => ({
        file_id: item.fileID,
        temp_file_url: item.tempFileURL,
      }))
      resolve(file_list)
    })
  },

  /**
   * 根据文件路径名，用require获取action_module，传入参数省去前面的actions/和后面的.js
   * @param {string} action - 文件路径名，不包含前缀'actions/'和后缀'.js'
   * @returns {Object} 返回一个action_module对象
   * @example
   *   return await utils.requireAction('dev/Abc').main(event, context)
   */
  requireAction (action) {
    const _ = this
    _.assert(!action.startsWith('actions/'), 'action不能以actions/开头')
    _.assert(!action.endsWith('.js'), 'action不能以.js结尾')
    _.assert(_.fileExists(`actions/${action}.js`), `actions/${action}.js文件必须存在`)
    return require(`actions/${action}.js`) // path以./或../开头是相对路径，否则是绝对路径
  },

  /**
   * 同步读取文件内容
   * @param {string} file - 文件路径
   * @returns {string} 返回文件的内容
   */
  readFile (file) {
    return FS.readFileSync(file).toString()
  },

  /**
   * 读取Json文件
   * @param {string} file - 文件路径
   * @returns {Object} 返回文件解析后的对象
   */
  readJsonFile (file) {
    return JSON.parse(this.readFile(file))
  },

  /**
   * 同步写入文件内容
   * @param {string} file - 文件的路径
   * @param {string} data - 需要写入的数据
   * @example
   * utils.writeFile('./path/to/file', 'data to write')
   */
  writeFile (file, data) {
    FS.writeFileSync(file, data)
  },

  /**
   * 删除云存储文件，返回删除成功的file_id数组
   * @param {Array.<string>} file_ids - 需要删除的文件的id数组，数量不能超过50个（API限制）
   * @returns {Promise<Array.<string>>} 返回一个Promise，解析后的结果是已删除的file_id数组
   *
   * 注意
   *   1. 当图片已经被删除了，重复执行时依然会返回这张图片的file_id
   *
   * @example
   *   const deleted_file_ids = await utils.deleteCloudFiles([file_id1, file_id2])
   */
  deleteCloudFiles (file_ids) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (file_ids.length <= 50) {
        _._cloud().deleteFile({
          fileList: file_ids,
        })
          .then(res => {
            // 0表示删除成功, -503003表示文件不存在
            const deleted_file_ids = res.fileList.filter(f => [0, -503003].includes(f.status)).map(f => f.fileID)
            resolve(deleted_file_ids)
          })
          .catch(reject)
      } else {
        reject({errno: 'deleteCloudFiles Failed', errMsg: 'file_ids不可以超过50条', length: file_ids.length})
      }
    })
  },

  /**
   * 根据文档id，删除all_file集合中的数据以及云存储中的文件
   * @param {string} doc_id - 文档的id
   * @returns {Promise<boolean>} 返回一个Promise，如果全部删除成功则解析为true，否则为false
   * @example
   * utils.deleteDocAllFiles('doc_id1')
   * .then(result => {
   *   console.log(result) // true if all files are successfully deleted
   * })
   */
  async deleteDocAllFiles (doc_id) {
    const _ = this
    const $ = _.command()

    // 获得待删除的文件列表,因为api一次最多可以删除50条,所以每次返回50条
    const getFileIds = async () => {
      const res = await _.coll('all_file').where({doc_id}).limit(50).get()
      return res.data.map(i => i.file_id)
    }

    let file_ids = await getFileIds(doc_id)

    while (file_ids.length > 0) {
      // 删除云存储中的文件
      let deleted = await _.deleteCloudFiles(file_ids)
      // 删除all_file中的数据
      await _.coll('all_file').where({file_id: $.in(deleted)}).remove()
      file_ids = await getFileIds(doc_id)
    }

    return true
  },

  /**
   * 传入文件名称filename，返回保存文件的路径，本地返回 ~/tmp/filename, 云端返回 /tmp/filename
   * @param {string} filename - 文件名称，支持带路径，如 a/b/c.txt
   * @returns {string} 返回文件的保存路径
   * @example
   * let path = utils.tmpFilePath('a/b/c.txt')
   * console.log(path) // ~/tmp/a/b/c.txt or /tmp/a/b/c.txt
   */
  tmpFilePath (filename) {
    const _ = this
    let tmp_dir = _.isLocal() ? './tmp' : '/tmp'

    // 把filename中的目录移动到tmp_dir中，filename仅保留文件名
    if (filename.includes('/')) {
      tmp_dir = `${tmp_dir}/${_.rpartition(filename, '/')[0]}`
      filename = _.rpartition(filename, '/')[2]
    }

    if (!FS.existsSync(tmp_dir)) {
      FS.mkdirSync(tmp_dir)
    }

    return PATH.join(tmp_dir, filename)
  },

  /**
   * 判断本地文件是否存在（同步）
   * @param {string} file_path - 文件的路径
   * @returns {boolean} 如果文件存在则返回true，否则为false
   * @example
   * let exists = utils.fileExists('./path/to/file')
   * console.log(exists) // true if file exists
   */
  fileExists (file_path) {
    return FS.existsSync(file_path)
  },

  /**
   * 获得文件的大小（单位：MB）
   * @param {string} file_path - 文件的路径
   * @returns {number} 返回文件的大小（单位：MB）
   * @example
   * let size = utils.fileSizeM('./path/to/file')
   * console.log(size) // size of the file in MB
   */
  fileSizeM (file_path) {
    const _ = this
    return _.round2(FS.statSync(file_path).size / 1024 / 1024)
  },


  /* === 网络 === */

  /**
   * 发起GET请求获取网页内容。
   *
   * @param {string} url - 需要请求的网页URL。
   * @returns {Promise} 如果请求成功，返回一个Promise对象，其结果为网页内容。如果请求失败，返回的Promise对象会被拒绝，并带有错误信息。
   *
   * @example
   * utils.requestPageBody('https://www.example.com')
   * console.log()
   */
  requestPageBody(url) {
    const _ = this
    return new Promise((resolve, reject) => {
      REQUEST(url, (error, response, body) => {
        if (response.statusCode === 200) {
          resolve(body)
        } else {
          reject({errno: 'getPageContent Failed', errMsg: '获取网页内容失败'})
        }
      })
    })
  },

  /**
   * 用指定的URL下载图片，保存到/tmp/uuid路径，并返回文件路径。
   *
   * @param {string} url - 图片的URL。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {Object} modules - 模块，如JIMP模块。
   *   - {string} image_type - 图片类型，如果指定，将转换图片格式。
   *   - {number} max_width - 图片最大宽度，如果指定，将压缩图片。
   *   - {number} quality - 图片质量，用于压缩图片。
   * @returns {Promise} 如果下载成功，返回一个Promise对象，其结果为文件路径。如果下载失败，返回的Promise对象会被拒绝，并带有错误信息。
   *
   * 说明
   *   1. 使用image_type转换图片格式时，需要在modules中传入JIMP模块。例如：
   *       ```javascript
   *       npm install --save jimp
   *       utils.js之外文件
   *       顶部：const JIMP = require('jimp')
   *       调用：utils.downTempFile(url, {modules: {JIMP})
   *       ```
   *   2. 注意jimp不支持webp，其他库依赖二进制文件，无法在云函数中使用。
   *   3. 注意文件仅在用户本次call云函数中有效
   *   4. 文件路径不带后缀名（本函数不判断文件类型）。
   *
   * @example
   *   utils.downTempFile('https://www.example.com/image.jpg', { image_type: 'png', max_width: 800, quality: 80 })
   *   console.log()
   */
  downTempFile (url, { modules = null, image_type = null, max_width = null, quality = null } = {}) {
    const _ = this
    const tmp_path = '/tmp/down_files' // 微信只允许保存在 /tmp/ 目录下

    if (!FS.existsSync(tmp_path)) { FS.mkdirSync(tmp_path) }

    return new Promise((resolve, reject) => {

      REQUEST(url, { encoding: 'binary', method: 'GET'  },
        async (err, res, body) => {

          if (err || res.statusCode !== 200) {
            reject({errno: 'downTempFile Failed', errMsg: err, res})
            return
          }

          let file_path = `${tmp_path}/${_.randomUUID()}`

          if (image_type && _.in(image_type, ALLOWED_IMAGE_TYPES)) {

            // 使用 jimp 加载图片数据
            const image = await modules.JIMP.read(Buffer.from(body, 'binary'))

            // 根据max_width压缩图片
            if (max_width && image.bitmap.width > max_width) {
              image.resize(max_width, modules.JIMP.AUTO)
            }

            // 根据quality压缩图片
            image.quality(quality || 100)

            // 写入文件
            file_path = `${file_path}.${image_type}`
            await image.writeAsync(file_path)
            resolve(file_path)

          } else {
            // 如果没有指定image_type，直接写入文件
            FS.writeFileSync(file_path, body, 'binary')
            resolve(file_path)
          }

        })

    })

  },

  /**
   * 获取图片文件的类型，返回jpg、png等，如果不是图片则返回空字符串。
   *
   * @param {string} file_path - 图片文件的路径。
   * @returns {Promise} 返回一个Promise对象，其结果为文件类型。例如：'jpg'、'png'等。
   *
   * 说明
   *   1. 本函数依赖file-type库，可以通过`npm i --save file-type`安装。
   *
   * @example
   *   utils.getImageFileType('/tmp/my_image.jpg')
   *   console.log()
   */
  async getImageFileType (file_path) {
    const _ = this
    const FileType = await import('file-type')
    const file_stream = FS.createReadStream(file_path)
    let file_type = await FileType.fileTypeFromStream(file_stream)
    file_type = (file_type?.ext || '').toLowerCase()
    return file_type
  },

  /**
   * 下载图片到本地，上传到云存储，删除本地图片，并在all_file集合中插入数据。
   * 保存在云端的路径为：`${app}/${c}/${doc_id}/${image_uuid}.${file_type}`
   *
   * @param {string} app - 应用名称。
   * @param {string} c - 集合名称。
   * @param {string} doc_id - 文档ID。
   * @param {string} url - 图片的URL。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {Object} modules - 模块，如JIMP模块。
   *   - {string} _openid - 用户的openid。
   *   - {number} max_size_m - 最大允许上传的文件大小，单位M，默认为10M。
   *   - {string} image_type - 图片类型，如果指定，将转换图片格式。
   *   - {number} quality - 图片质量，用于压缩图片。
   *   - {number} max_width - 图片最大宽度，如果指定，将压缩图片。
   * @returns {Promise} 如果操作成功，返回一个Promise对象，其结果为文件ID。如果操作失败，返回的Promise对象会被拒绝，并带有错误信息。
   *
   * 注意：
   *   1. 本函数依赖file-type库，可以通过`npm i --save file-type`安装。
   *   2. 如果图片上传成功，已有fileID，但函数抛出异常，需要手动删除图片。
   *   3. 执行完毕后会删除本地临时图片, 所以/tmp目录中没有文件
   */
  downImageAndUploadToCloud (app, c, doc_id, url,
    {modules = null, _openid = null, max_size_m = 10, image_type = null, quality = null, max_width = null} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.downTempFile(url, {modules, image_type, quality, max_width})
        .then(async file_path => {
          // 图片成功下载到本地

          const file_stream = FS.createReadStream(file_path) // 流只能被读取一次
          const size_m = _.fileSizeM(file_path)
          let file_type, file_name
          const last = _.rpartition(file_path, '.')[2]

          // file_path末尾是.jpg .webp等时，直接从file_path中获取文件类型
          if (_.in(last, ALLOWED_IMAGE_TYPES)) {
            file_type = last
            file_name = _.rpartition(file_path, '/')[2]
          } else {
            file_type = await _.getImageFileType(file_path)
            file_name = _.rpartition(file_path, '/')[2] + '.' + file_type
          }

          // file_type必须在ALLOWED_IMAGE_TYPES中
          if (!_.in(file_type, ALLOWED_IMAGE_TYPES)) {
            FS.unlinkSync(file_path)
            reject({errno: 'downImageAndUploadToCloud Failed', errMsg: '文件类型不正确'})
            return
          }
          const cloud_path = `${app}/${_._collName(c)}/${doc_id}/${file_name}`

          // 图片大小超过限制
          if (size_m > max_size_m) {
            FS.unlinkSync(file_path)
            reject({errno: 'downImageAndUploadToCloud Failed', errMsg: '图片大小超过限制'})
            return
          }

          _._cloud().uploadFile({
            cloudPath: cloud_path,
            fileContent: file_stream,
          })
            .then(res => {
              // 图片上传成功

              if (res.statusCode === -1 || res.fileID) {

                const file_id  = res.fileID
                // 关联doc与fileID，确保删除doc时可删除图片文件
                _.addFile({app, c, doc_id: doc_id, file_id, size_m, file_path: cloud_path})
                  .then(() => {
                    resolve({file_id})
                  })
                  .catch(e => {
                    reject({errno: 'downImageAndUploadToCloud Failed 1', errMsg: '写入all_file失败', e})
                  })

              } else {
                reject({errno: 'downImageAndUploadToCloud Failed 2', errMsg: res})
              }
            })
            .catch(e => {
              reject({errno: 'downImageAndUploadToCloud Failed 3', errMsg: e})
            })
            .finally(() => {
              // 删除本地临时图片
              FS.unlinkSync(file_path)
            })

        })
    })
  },

  /**
   * 从网络上下载图片，上传到云存储，然后删除本地图片。不写all_file。
   *
   * @param {string} url - 图片的URL。
   * @param {string} cloud_path - 云存储路径。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {Object} modules - 模块，如JIMP模块。
   *   - {number} max_size_m - 最大允许上传的文件大小，单位M，默认为10M。
   *   - {string} image_type - 图片类型，如果指定，将转换图片格式。
   *   - {number} quality - 图片质量，用于压缩图片。
   *   - {number} max_width - 图片最大宽度，如果指定，将压缩图片。
   * @returns {Promise} 如果操作成功，返回一个Promise对象，其结果为文件ID。如果操作失败，返回的Promise对象会被拒绝，并带有错误信息。
   *
   * 注意：
   *   1. 本函数依赖file-type库，可以通过`npm i --save file-type`安装。
   *   2. 本函数不会写入任何数据库，
   *   3. 图片名称 cloud_path 需要自己指定 (开头无/)
   *   4. 函数会在cloud_path后面添加文件后缀
   */
  downImageAndUploadToCloud_simple (url, cloud_path,
    {modules = null, max_size_m = 10, image_type = null, quality = null, max_width = null} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      _.downTempFile(url, {modules, image_type, quality, max_width})
        .then(async file_path => {
          // 图片成功下载到本地

          const file_stream = FS.createReadStream(file_path)
          const size_m = _.fileSizeM(file_path)

          // file_path末尾是.jpg .webp等时，直接从file_path中获取文件类型
          const last = _.rpartition(file_path, '.')[2]
          if (_.in(last, ALLOWED_IMAGE_TYPES)) {
            cloud_path = `${cloud_path}.${last}`
          } else {
            const file_type = await _.getImageFileType(file_path)
            cloud_path = `${cloud_path}.${file_type}`
          }

          // 图片大小超过限制
          if (size_m > max_size_m) {
            FS.unlinkSync(file_path)
            reject({errno: 'downImageAndUploadToCloud_simple Failed', errMsg: '图片大小超过限制'})
            return
          }

          _._cloud().uploadFile({
            cloudPath: cloud_path,
            fileContent: file_stream,
          })
            .then(res => {
              // 图片上传成功
              if (res.statusCode === -1 || res.fileID) {
                resolve({file_id: res.fileID})
              } else {
                reject({errno: 'downImageAndUploadToCloud_simple Failed 1', errMsg: res})
              }
            })
            .catch(e => {
              reject({errno: 'downImageAndUploadToCloud_simple Failed 2', errMsg: e})
            })
            .finally(() => {
              // 删除本地临时图片
              FS.unlinkSync(file_path)
            })

        })

    })
  },

  /**
   * 上传文件到云存储。不写all_file。
   *
   * @param {Object} options - 参数，包含以下属性:
   *   - {string} file_path - 文件的本地路径。
   *   - {string} app - 应用名称。
   *   - {string} cloud_path - 云存储路径。
   *   - {number} max_size_m - 最大允许上传的文件大小，单位M，默认为10M。
   * @returns {Promise} 如果操作成功，返回一个Promise对象，其结果为文件ID。如果操作失败，返回的Promise对象会被拒绝，并带有错误信息。
   *
   * 注意：
   *   1. 上传的文件无法保存_openid字段，因此无法判断是哪个用户上传的。
   *   2. 文件最终会保存在云端的 ${app}/${cloud_path}
   *   3. 这里上传的文件无法保存_openid字段，因此无法判断是哪个用户上传的
   */
  uploadFileToCloud ({file_path, app, cloud_path, max_size_m = 10} = {}) {
    const _ = this
    return new Promise((resolve, reject) => {
      // app不能为空，cloud_path不能以/开头
      if (_.isEmpty(app)) {
        reject({errno: 'uploadFileToCloud Failed', errMsg: `传入参数错误，app不能为空`})
        return
      }
      if (cloud_path.startsWith('/')) {
        reject({errno: 'uploadFileToCloud Failed', errMsg: `传入参数错误，cloud_path不能以/开头。cloud_path:${cloud_path}`})
        return
      }
      // 判断文件是否存在
      if (!_.fileExists(file_path)) {
        reject({errno: 'uploadFileToCloud Failed', errMsg: `上传的文件不存在。file_path:${file_path}`})
        return
      }

      // 判断文件大小是否超过max_size_m
      const size_m = _.fileSizeM(file_path)
      if (size_m > max_size_m) {
        reject({errno: 'uploadFileToCloud Failed', errMsg: `上传的文件大小超过限制。file_path:${file_path}`})
        return
      }

      _._cloud().uploadFile({
        cloudPath: `${app}/${cloud_path}`,
        fileContent: FS.createReadStream(file_path),
      })
        .then(res => {
          // 图片上传成功
          if (res.statusCode === -1 || res.fileID) {
            resolve({file_id: res.fileID})
          } else {
            reject({errno: 'uploadFileToCloud Failed 1', errMsg: res})
          }
        })
        .catch(e => {
          reject({errno: 'uploadFileToCloud Failed 2', errMsg: e})
        })

    })

  },

  /**
   * 向微信服务器发起鉴黄请求，返回请求记录的_id（请求失败返回null）。
   *
   * @param {Object} options - 参数，包含以下属性:
   *   - {string} appid - 发起鉴黄请求的appid。
   *   - {string} _openid - 发起鉴黄请求的用户的openid，此用户需在近两小时访问过小程序。
   *   - {string} image_url - 需要鉴黄的图片url，通过前端wx.cloud.CDN获得（而不是通过file_id获得）。
   *   - {string} notice_name - 通知名称，接到通知时会执行 actions/name/{notice_name}.js 的Action。
   *   - {Object} notice_data - 通知数据，MediaCheck Action会收到此数据。
   *   - {number} scene - 场景值，1表示资料，2表示评论，3表示论坛，4表示社交日志，默认为1。
   * @returns {Promise} 返回一个Promise对象，其结果为请求记录的_id（请求失败返回null）。
   *
   * 注意：
   *   1. 需要在微信开发者工具中开启通知，让all_notice云函数能接到通知。
   *   2. 需要在all_notice云函数中实现对应小程序的MediaCheck Action。
   *   3. 通常来说调用此接口时app会有2个值，需要为dev和具体app分别实现Action。
   *   4. 一定要确保图片已经上传到云存储并拿到了file_id。
   *   5. 识别的文件大小不能超过10M（接口限制）。
   *   6. 会向all_notice写一个记录，并返回此记录的_id（请求失败返回null）
   *
   * 等待鉴黄结果的all_notice为：
   *     {
   *       app       : 'draw',
   *       name      : 'draw_project_image',
   *       trace_id  : '鉴黄请求返回的的trace_id',
   *       msg_id    : '', // 留空
   *       status    : 'wait',
   *       _openid   : '上传图片的用户openid',
   *       created   : utils.serverDate(),
   *       data: {
   *         project_image_id: '',
   *         file_id: '云存储中图片的file_id',
   *       },
   *     }
   */
  async wxCheckImage ({appid, _openid, image_url, notice_name, notice_data, scene = 1} = {}) {
    const _ = this
    const app = _.appName(appid)

    _.assert(!_.isLocal(), 'wxCheckImage只能在正式环境中调用')
    _.assert(!_.isAnyEmpty(appid, app, _openid, image_url, notice_name), 'utils.wxCheckImage Failed，参数必须全部不为空')

    const check_data = {
      media_url:    image_url,
      media_type:   2,          // 2表示图片
      version:      2,          // 当前版本号
      openid:       _openid,
      scene,
    }

    // 发起鉴黄请求。拿到trace_id，用于后续查询鉴黄结果
    const res = await _.callOpenApi({api_name: 'security.mediaCheckAsync', appid, data: check_data})
    const trace_id = res.traceId // 文档中写的是trace_id，实际返回的是traceId

    if (_.isEmpty(trace_id)) {
      await _.logToColl('draw_user UploadImage trace_id is empty', {appid, _openid, image_url, notice_name})
      return null
    }

    const notice_doc = {
      app,
      action    : 'MediaCheck',
      name      : notice_name,
      trace_id,
      msg_id    : '', // 等待通知没有msg_id
      status    : 'wait',
      _openid,
      created   : _.serverDate(),
      data      : notice_data,
    }

    return await _.addDoc('all_notice', notice_doc)

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


  /* === admin管理员 === */

  /**
   * 判断是否为管理员。
   *
   * @param {string} [openid] - 待检查的openid，默认为当前用户的openid。
   * @returns {Promise} 返回一个Promise对象，如果openid对应的用户是管理员，其结果为true，否则为false。
   */
  isAdmin (openid = null) {
    const _ = this
    return new Promise((resolve, reject) => {
      if (openid === null) {
        openid = _.openid()
      }
      _.assert(openid, 'openid不能为空')
      _.getOne('all_setting', {app: 'all', key: 'admin_users'})
        .then(setting => {
          if (setting?.value?.admins) {
            resolve(setting.value.admins.includes(openid))
          } else {
            resolve(false)
          }
        })
        .catch(reject)
    })
  },

  /**
   * 设置应用设置。
   *
   * @param {string} app - 应用名称。
   * @param {string} key - 设置的键。
   * @param {*} value - 设置的值。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {string} [name='default'] - 设置的名称，默认为'default'。
   */
  setAppSetting (app, key, value, { name = 'default' } = {}) {
    const _ = this
    const c = 'app_setting'
    _.getOne(c, {app, name})
      .then(doc => {
        if (doc) {
          _.updateDoc(c, doc._id, {[key]: value})
        } else {
          _.addDoc(c, {app, name, [key]: value})
        }
      })
  },

  /**
   * 向应用设置中添加一个值。
   *
   * @param {string} app - 应用名称。
   * @param {string} key - 设置的键。
   * @param {*} value - 设置的值。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {string} [name='default'] - 设置的名称，默认为'default'。
   */
  pushAppSetting (app, key, value, { name = 'default' } = {}) {
    const _ = this
    const $ = _.command()
    const c = 'app_setting'
    _.getOne(c, {app, name})
      .then(doc => {
        if (doc) {
          _.updateDoc(c, doc._id, {[key]: $.push(value)})
        } else {
          _.addDoc(c, {app, name, [key]: [value]})
        }
      })
  },

  /**
   * 获取应用设置的值。
   *
   * @param {string} app - 应用名称。
   * @param {string} key - 设置的键。
   * @param {Object} [options] - 可选参数，包含以下属性:
   *   - {string} [name='default'] - 设置的名称，默认为'default'。
   * @returns {Promise} 返回一个Promise对象，其结果为应用设置的值，如果没有找到对应的设置，其结果为null。
   *
   * 调用次数
   *   云端的getAppSetting不会利用缓存，每次消耗一次调用次数
   */
  getAppSetting (app, key, { name = 'default' } = {}) {
    const _ = this
    const c = 'app_setting'
    return new Promise((resolve, reject) => {
      _.getOne(c, {app, name})
        .then(doc => {
          if (doc) {
            resolve(doc[key])
          } else {
            resolve(null)
          }
        })
        .catch(reject)
    })
  },


  // === 字符串签名 ===

  /**
   * 使用secret_key config签名。
   * 需先在云函数的config.json中添加booster_secret_key_alterable字符串。
   * 这里的alterable表示此key可以随时修改，数据库中不会保存此key生成的签名。
   *
   * @param {string} data_str - 待签名的数据字符串。
   * @returns {string} 返回签名结果。
   */
  alterableSign (data_str) {
    const _ = this
    const crypto = require('crypto') // 内置库
    const secret_key = _.getConfig('booster_secret_key_alterable')
    if (!secret_key) {
      throw new Error('请在config中添加booster_secret_key_alterable字符串')
    }
    return crypto.createHmac('sha256', secret_key).update(data_str).digest('hex')
  },

  /**
   * 验证数据签名。
   *
   * @param {string} data_str - 待验证的数据字符串。
   * @param {string} sign - 待验证的签名。
   * @returns {boolean} 如果签名验证成功，返回true，否则返回false。
   */
  verifyAlterableSign (data_str, sign) {
    const _ = this
    return _.alterableSign(data_str) === sign    
  },

  /**
   * 使用手机号数据签名。
   * 传入数据格式：{country_code, phone_number, timestamp}
   *
   * @param {Object} data - 待签名的数据，包含以下属性:
   *   - {string} country_code - 国家代码。
   *   - {string} pure_phone_number - 纯手机号，不包含国家代码。
   *   - {number} timestamp - 时间戳。
   * @returns {string} 返回签名结果。
   */
  signPhoneNumber (data) {
    const _ = this
    // 传入的三个参数都不能为空
    _.assert(!_.isEmpty(data.country_code), 'country_code不能为空')
    _.assert(!_.isEmpty(data.pure_phone_number), 'pure_phone_number不能为空')
    _.assert(!_.isEmpty(data.timestamp), 'timestamp不能为空')
    const data_str = `${data.country_code}${data.pure_phone_number}${data.timestamp}`
    return _.alterableSign(data_str)
  },

  /**
   * 验证手机号数据签名。
   * data格式：{country_code, pure_phone_number, timestamp, phone_sign}
   * 当前时间超过data.timestamp+time_diff时，返回false。
   *
   * @param {Object} data - 待验证的数据，包含以下属性:
   *   - {string} country_code - 国家代码。
   *   - {string} pure_phone_number - 纯手机号，不包含国家代码。
   *   - {number} timestamp - 时间戳。
   *   - {string} phone_sign - 手机号数据签名。
   * @param {number} time_diff - 允许的时间偏差，单位为秒。
   * @returns {boolean} 如果签名验证成功且当前时间未超过timestamp+time_diff，返回true，否则返回false。
   */
  verifyPhoneNumber (data, time_diff) {
    const _ = this
    const sign = _.signPhoneNumber(data)
    _.assert(_.isPositiveInt(time_diff), 'time_diff错误')
    // 当前时间超过timestamp+time_diff时，返回false
    if (_.timestampSeconds() > data.timestamp + time_diff )  {
      return false
    } else {
      return sign === data.phone_sign
    }
  },


  /* === 私有辅助 === */

  /* 是否在微信开发者工具中运行
  */
  _is_local: null,

  /**
   * 获取云函数的名称
   * @returns {string} 返回云函数的名称
   */
  _cloudFuncName () {
    return CONFIG["booster_func_name"]
  },

  /**
   * 返回数据库访问对象
   * 
   * @returns {Object} 数据库访问对象
   */
  _db () {
    return DB
  },

  /**
   * 生产环境下给集合名称添加p_前缀(all_前缀的集合除外)
   * 
   * @param {string} c - 集合名
   * @returns {string} 添加前缀后的集合名
   */
  _collName (c) {
    if( !this.isLocal() && !c.startsWith('all_') ) {
      c = 'p_' + c
    }
    return c
  },

  /**
   * 获取云服务对象
   * @returns {Cloud} 返回云服务对象
   */
  _cloud () {
    return CLOUD
  },

  /**
   * 获取指定集合中的一个文档
   * @param {string} c - 集合名称
   * @param {string} id - 文档ID
   * @returns {DocumentReference} 返回指向指定集合中的一个文档的引用
   */
  _doc (c, id) {
    return this.coll(c).doc(id)
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
      // 抛出异常
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

  /* 常用的字符集合
  */
  _characters: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',


  /* === 其他 === */

  /**
   * 等待指定的毫秒数。
   * 
   * @param {number} ms - 毫秒数
   * @returns {Promise} 返回一个 Promise，会在指定的毫秒数后 resolve
   * 
   * @example
   * await utils.sleep(1000) // 等待1秒，注意必须使用await
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
   * 断言正式环境中的环境变量（在local环境下拿不到正确的context.environment）。
   *
   * @param {Object} context - 环境上下文。
   */
  assertEnv (context) {
    const _ = this
    if (!_.isLocal()) {
      let env = _.fromJsonString(context.environment)
      _.assert(env.TZ === 'Asia/Shanghai', '请在云函数中设置环境变量TZ=Asia/Shanghai')
      _.assert(context.namespace === _.getConfig('booster_cloud_env_id'), '请在config中设置正确的booster_cloud_env_id')
      _.assert(_.in(env.WX_APPID, _.getConfig('booster_app_list')), `appid ${env.WX_APPID} 不在booster_app_list中`)
      _.assert(context.function_name === _.getConfig('booster_func_name'), '请在config中设置正确的booster_func_name')
      _.assert(!_.isEmpty(_.getConfig('booster_super_dev_openid')), '请在config中设置booster_super_dev_openid')
    }
  },

  /**
   * 断言app名称是否在配置文件的booster_app_list中。
   *
   * @param {string} app - 待检查的app名称。
   */
  assertApp (app) {
    const _ = this
    _.assert(_.in(app, Object.values(_.getConfig('booster_app_list'))), `app ${app} 不在booster_app_list中`)
  },

  /**
   * 判断app名称是否在配置文件的booster_app_list中。
   *
   * @param {string} app - 待检查的app名称。
   * @returns {boolean} 如果app名称在配置文件的booster_app_list中，返回true，否则返回false。
   */
  isAppInList (app) {
    const _ = this
    return _.in(app, Object.values(_.getConfig('booster_app_list')))
  },

  /**
   * 打印一个对象的所有keys，但不进行递归
   * @param {Object} obj - 需要打印keys的对象
   * @example
   * utils.printObjKeys({a: 1, b: 2})
   */
  printObjKeys(obj){
    const _ = this
    let keys = []
    for (let key in obj) {
      keys.push(key)
    }
    _.log({obj_keys: keys})
  },

}

Object.assign(exports, utils)
