import _createClass from "@babel/runtime/helpers/createClass";
import { filter } from 'rxjs/operators';
import { clone, validateCouchDBString, ucfirst, nextTick, generateId, promiseSeries } from './util';
import RxDocument from './rx-document';
import { createRxQuery } from './rx-query';
import { isInstanceOf as isInstanceOfRxSchema, createRxSchema } from './rx-schema';
import { createChangeEvent } from './rx-change-event';
import { newRxError, newRxTypeError, pluginMissing } from './rx-error';
import { mustMigrate, createDataMigrator } from './data-migrator';
import Crypter from './crypter';
import createDocCache from './doc-cache';
import createQueryCache from './query-cache';
import createChangeEventBuffer from './change-event-buffer';
import overwritable from './overwritable';
import { runPluginHooks } from './hooks';
export var RxCollection =
/*#__PURE__*/
function () {
  function RxCollection(database, name, schema) {
    var pouchSettings = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
    var migrationStrategies = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};
    var methods = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : {};
    var attachments = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : {};
    var options = arguments.length > 7 && arguments[7] !== undefined ? arguments[7] : {};
    var statics = arguments.length > 8 && arguments[8] !== undefined ? arguments[8] : {};
    this._isInMemory = false;
    this.destroyed = false;
    this.database = database;
    this.name = name;
    this.schema = schema;
    this._migrationStrategies = migrationStrategies;
    this._pouchSettings = pouchSettings;
    this._methods = methods; // orm of documents

    this._attachments = attachments; // orm of attachments

    this.options = options;
    this._atomicUpsertQueues = new Map();
    this._statics = statics;
    this._docCache = createDocCache();
    this._queryCache = createQueryCache(); // defaults

    this.synced = false;
    this.hooks = {};
    this._subs = [];
    this._repStates = [];
    this.pouch = null; // this is needed to preserve this name

    _applyHookFunctions(this);
  }

  var _proto = RxCollection.prototype;

  _proto.prepare = function prepare() {
    var _this = this;

    this.pouch = this.database._spawnPouchDB(this.name, this.schema.version, this._pouchSettings);

    if (this.schema.doKeyCompression()) {
      this._keyCompressor = overwritable.createKeyCompressor(this.schema);
    } // we trigger the non-blocking things first and await them later so we can do stuff in the mean time


    var spawnedPouchPromise = this.pouch.info(); // resolved when the pouchdb is useable

    var createIndexesPromise = _prepareCreateIndexes(this, spawnedPouchPromise);

    this._dataMigrator = createDataMigrator(this, this._migrationStrategies);
    this._crypter = Crypter.create(this.database.password, this.schema);
    this._observable$ = this.database.$.pipe(filter(function (event) {
      return event.data.col === _this.name;
    }));
    this._changeEventBuffer = createChangeEventBuffer(this);

    this._subs.push(this._observable$.pipe(filter(function (cE) {
      return !cE.data.isLocal;
    })).subscribe(function (cE) {
      // when data changes, send it to RxDocument in docCache
      var doc = _this._docCache.get(cE.data.doc);

      if (doc) doc._handleChangeEvent(cE);
    }));

    return Promise.all([spawnedPouchPromise, createIndexesPromise]);
  }
  /**
   * merge the prototypes of schema, orm-methods and document-base
   * so we do not have to assing getters/setters and orm methods to each document-instance
   */
  ;

  _proto.getDocumentPrototype = function getDocumentPrototype() {
    if (!this._getDocumentPrototype) {
      var schemaProto = this.schema.getDocumentPrototype();
      var ormProto = getDocumentOrmPrototype(this);
      var baseProto = RxDocument.basePrototype;
      var proto = {};
      [schemaProto, ormProto, baseProto].forEach(function (obj) {
        var props = Object.getOwnPropertyNames(obj);
        props.forEach(function (key) {
          var desc = Object.getOwnPropertyDescriptor(obj, key);
          /**
           * When enumerable is true, it will show on console.dir(instance)
           * To not polute the output, only getters and methods are enumerable
           */

          var enumerable = true;
          if (key.startsWith('_') || key.endsWith('_') || key.startsWith('$') || key.endsWith('$')) enumerable = false;

          if (typeof desc.value === 'function') {
            // when getting a function, we automatically do a .bind(this)
            Object.defineProperty(proto, key, {
              get: function get() {
                return desc.value.bind(this);
              },
              enumerable: enumerable,
              configurable: false
            });
          } else {
            desc.enumerable = enumerable;
            desc.configurable = false;
            if (desc.writable) desc.writable = false;
            Object.defineProperty(proto, key, desc);
          }
        });
      });
      this._getDocumentPrototype = proto;
    }

    return this._getDocumentPrototype;
  };

  _proto.getDocumentConstructor = function getDocumentConstructor() {
    if (!this._getDocumentConstructor) {
      this._getDocumentConstructor = RxDocument.createRxDocumentConstructor(this.getDocumentPrototype());
    }

    return this._getDocumentConstructor;
  }
  /**
   * checks if a migration is needed
   * @return {Promise<boolean>}
   */
  ;

  _proto.migrationNeeded = function migrationNeeded() {
    return mustMigrate(this._dataMigrator);
  }
  /**
   * @param {number} [batchSize=10] amount of documents handled in parallel
   * @return {Observable} emits the migration-status
   */
  ;

  _proto.migrate = function migrate() {
    var batchSize = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 10;
    return this._dataMigrator.migrate(batchSize);
  }
  /**
   * does the same thing as .migrate() but returns promise
   * @param {number} [batchSize=10] amount of documents handled in parallel
   * @return {Promise} resolves when finished
   */
  ;

  _proto.migratePromise = function migratePromise() {
    var batchSize = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 10;
    return this._dataMigrator.migratePromise(batchSize);
  }
  /**
   * wrappers for Pouch.put/get to handle keycompression etc
   */
  ;

  _proto._handleToPouch = function _handleToPouch(docData) {
    var data = clone(docData);
    data = this._crypter.encrypt(data);
    data = this.schema.swapPrimaryToId(data);
    if (this.schema.doKeyCompression()) data = this._keyCompressor.compress(data);
    return data;
  };

  _proto._handleFromPouch = function _handleFromPouch(docData) {
    var noDecrypt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
    var data = clone(docData);
    data = this.schema.swapIdToPrimary(data);
    if (this.schema.doKeyCompression()) data = this._keyCompressor.decompress(data);
    if (noDecrypt) return data;
    data = this._crypter.decrypt(data);
    return data;
  }
  /**
   * every write on the pouchdb
   * is tunneld throught this function
   * @param {object} obj
   * @param {boolean} [overwrite=false] if true, it will overwrite existing document
   * @return {Promise}
   */
  ;

  _proto._pouchPut = function _pouchPut(obj) {
    var _this2 = this;

    var overwrite = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
    obj = this._handleToPouch(obj);
    return this.database.lockedRun(function () {
      return _this2.pouch.put(obj);
    })["catch"](function (e) {
      if (overwrite && e.status === 409) {
        return _this2.database.lockedRun(function () {
          return _this2.pouch.get(obj._id);
        }).then(function (exist) {
          obj._rev = exist._rev;
          return _this2.database.lockedRun(function () {
            return _this2.pouch.put(obj);
          });
        });
      } else throw e;
    });
  }
  /**
   * get document from pouchdb by its _id
   * @param  {string} key _id of the document
   * @return {Promise<object>} the document
   */
  ;

  _proto._pouchGet = function _pouchGet(key) {
    var _this3 = this;

    return this.pouch.get(key).then(function (doc) {
      return _this3._handleFromPouch(doc);
    });
  }
  /**
   * wrapps pouch-find
   * @param {RxQuery} rxQuery
   * @param {?number} limit overwrites the limit
   * @param {?boolean} noDecrypt if true, decryption will not be made
   * @return {Object[]} array with documents-data
   */
  ;

  _proto._pouchFind = function _pouchFind(rxQuery, limit) {
    var _this4 = this;

    var noDecrypt = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
    var compressedQueryJSON = rxQuery.keyCompress();
    if (limit) compressedQueryJSON.limit = limit;
    return this.database.lockedRun(function () {
      return _this4.pouch.find(compressedQueryJSON);
    }).then(function (docsCompressed) {
      var docs = docsCompressed.docs.map(function (doc) {
        return _this4._handleFromPouch(doc, noDecrypt);
      });
      return docs;
    });
  }
  /**
   * create a RxDocument-instance from the jsonData
   * @param {Object} json documentData
   * @return {RxDocument}
   */
  ;

  _proto._createDocument = function _createDocument(json) {
    // return from cache if exsists
    var id = json[this.schema.primaryPath];

    var cacheDoc = this._docCache.get(id);

    if (cacheDoc) return cacheDoc;
    var doc = RxDocument.createWithConstructor(this.getDocumentConstructor(), this, json);

    this._docCache.set(id, doc);

    this._runHooksSync('post', 'create', json, doc);

    runPluginHooks('postCreateRxDocument', doc);
    return doc;
  }
  /**
   * create RxDocument from the docs-array
   * @return {Promise<RxDocument[]>} documents
   */
  ;

  _proto._createDocuments = function _createDocuments(docsJSON) {
    var _this5 = this;

    return docsJSON.map(function (json) {
      return _this5._createDocument(json);
    });
  }
  /**
   * returns observable
   */
  ;

  _proto.$emit = function $emit(changeEvent) {
    return this.database.$emit(changeEvent);
  }
  /**
   * @param {Object|RxDocument} json data or RxDocument if temporary
   * @param {RxDocument} doc which was created
   * @return {Promise<RxDocument>}
   */
  ;

  _proto.insert = function insert(json) {
    var _this6 = this;

    // inserting a temporary-document
    var tempDoc = null;

    if (RxDocument.isInstanceOf(json)) {
      tempDoc = json;

      if (!json._isTemporary) {
        throw newRxError('COL1', {
          data: json
        });
      }

      json = json.toJSON();
    }

    json = clone(json);
    json = this.schema.fillObjectWithDefaults(json);

    if (json._id && this.schema.primaryPath !== '_id') {
      throw newRxError('COL2', {
        data: json
      });
    } // fill _id


    if (this.schema.primaryPath === '_id' && !json._id) json._id = generateId();
    var newDoc = tempDoc;
    return this._runHooks('pre', 'insert', json).then(function () {
      _this6.schema.validate(json);

      return _this6._pouchPut(json);
    }).then(function (insertResult) {
      json[_this6.schema.primaryPath] = insertResult.id;
      json._rev = insertResult.rev;

      if (tempDoc) {
        tempDoc._dataSync$.next(json);
      } else newDoc = _this6._createDocument(json);

      return _this6._runHooks('post', 'insert', json, newDoc);
    }).then(function () {
      // event
      var emitEvent = createChangeEvent('INSERT', _this6.database, _this6, newDoc, json);

      _this6.$emit(emitEvent);

      return newDoc;
    });
  }
  /**
   * same as insert but overwrites existing document with same primary
   * @return {Promise<RxDocument>}
   */
  ;

  _proto.upsert = function upsert(json) {
    var _this7 = this;

    json = clone(json);
    var primary = json[this.schema.primaryPath];

    if (!primary) {
      throw newRxError('COL3', {
        primaryPath: this.schema.primaryPath,
        data: json
      });
    }

    return this.findOne(primary).exec().then(function (existing) {
      if (existing) {
        json._rev = existing._rev;
        return existing.atomicUpdate(function () {
          return json;
        }).then(function () {
          return existing;
        });
      } else {
        return _this7.insert(json);
      }
    });
  }
  /**
   * upserts to a RxDocument, uses atomicUpdate if document already exists
   * @param  {object}  json
   * @return {Promise}
   */
  ;

  _proto.atomicUpsert = function atomicUpsert(json) {
    var _this8 = this;

    json = clone(json);
    var primary = json[this.schema.primaryPath];

    if (!primary) {
      throw newRxError('COL4', {
        data: json
      });
    } // ensure that it wont try 2 parallel runs


    var queue;

    if (!this._atomicUpsertQueues.has(primary)) {
      queue = Promise.resolve();
    } else {
      queue = this._atomicUpsertQueues.get(primary);
    }

    queue = queue.then(function () {
      return _atomicUpsertEnsureRxDocumentExists(_this8, primary, json);
    }).then(function (wasInserted) {
      if (!wasInserted.inserted) {
        return _atomicUpsertUpdate(wasInserted.doc, json).then(function () {
          return nextTick();
        }) // tick here so the event can propagate
        .then(function () {
          return wasInserted.doc;
        });
      } else return wasInserted.doc;
    });

    this._atomicUpsertQueues.set(primary, queue);

    return queue;
  }
  /**
   * takes a mongoDB-query-object and returns the documents
   * @param  {object} queryObj
   * @return {RxDocument[]} found documents
   */
  ;

  _proto.find = function find(queryObj) {
    if (typeof queryObj === 'string') {
      throw newRxError('COL5', {
        queryObj: queryObj
      });
    }

    var query = createRxQuery('find', queryObj, this);
    return query;
  };

  _proto.findOne = function findOne(queryObj) {
    var query;

    if (typeof queryObj === 'string') {
      query = createRxQuery('findOne', {
        _id: queryObj
      }, this);
    } else query = createRxQuery('findOne', queryObj, this);

    if (typeof queryObj === 'number' || Array.isArray(queryObj)) {
      throw newRxTypeError('COL6', {
        queryObj: queryObj
      });
    }

    return query;
  }
  /**
   * export to json
   * @param {boolean} decrypted if true, all encrypted values will be decrypted
   */
  ;

  _proto.dump = function dump() {
    throw pluginMissing('json-dump');
  }
  /**
   * imports the json-data into the collection
   * @param {Array} exportedJSON should be an array of raw-data
   */
  ;

  _proto.importDump = function importDump() {
    throw pluginMissing('json-dump');
  }
  /**
   * waits for external changes to the database
   * and ensures they are emitted to the internal RxChangeEvent-Stream
   * TODO this can be removed by listening to the pull-change-events of the RxReplicationState
   */
  ;

  _proto.watchForChanges = function watchForChanges() {
    throw pluginMissing('watch-for-changes');
  }
  /**
   * sync with another database
   */
  ;

  _proto.sync = function sync() {
    throw pluginMissing('replication');
  }
  /**
   * sync with a GraphQL endpoint
   */
  ;

  _proto.syncGraphQL = function syncGraphQL() {
    throw pluginMissing('replication-graphql');
  }
  /**
   * Create a replicated in-memory-collection
   */
  ;

  _proto.inMemory = function inMemory() {
    throw pluginMissing('in-memory');
  }
  /**
   * HOOKS
   */
  ;

  _proto.addHook = function addHook(when, key, fun) {
    var parallel = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

    if (typeof fun !== 'function') {
      throw newRxTypeError('COL7', {
        key: key,
        when: when
      });
    }

    if (!HOOKS_WHEN.includes(when)) {
      throw newRxTypeError('COL8', {
        key: key,
        when: when
      });
    }

    if (!HOOKS_KEYS.includes(key)) {
      throw newRxError('COL9', {
        key: key
      });
    }

    if (when === 'post' && key === 'create' && parallel === true) {
      throw newRxError('COL10', {
        when: when,
        key: key,
        parallel: parallel
      });
    } // bind this-scope to hook-function


    var boundFun = fun.bind(this);
    var runName = parallel ? 'parallel' : 'series';
    this.hooks[key] = this.hooks[key] || {};
    this.hooks[key][when] = this.hooks[key][when] || {
      series: [],
      parallel: []
    };
    this.hooks[key][when][runName].push(boundFun);
  };

  _proto.getHooks = function getHooks(when, key) {
    try {
      return this.hooks[key][when];
    } catch (e) {
      return {
        series: [],
        parallel: []
      };
    }
  }
  /**
   * @return {Promise<void>}
   */
  ;

  _proto._runHooks = function _runHooks(when, key, data, instance) {
    var hooks = this.getHooks(when, key);
    if (!hooks) return Promise.resolve(); // run parallel: false

    var tasks = hooks.series.map(function (hook) {
      return function () {
        return hook(data, instance);
      };
    });
    return promiseSeries(tasks) // run parallel: true
    .then(function () {
      return Promise.all(hooks.parallel.map(function (hook) {
        return hook(data, instance);
      }));
    });
  }
  /**
   * does the same as ._runHooks() but with non-async-functions
   */
  ;

  _proto._runHooksSync = function _runHooksSync(when, key, data, instance) {
    var hooks = this.getHooks(when, key);
    if (!hooks) return;
    hooks.series.forEach(function (hook) {
      return hook(data, instance);
    });
  }
  /**
   * creates a temporaryDocument which can be saved later
   * @param {Object} docData
   * @return {RxDocument}
   */
  ;

  _proto.newDocument = function newDocument() {
    var docData = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    docData = this.schema.fillObjectWithDefaults(docData);
    var doc = RxDocument.createWithConstructor(this.getDocumentConstructor(), this, docData);
    doc._isTemporary = true;

    this._runHooksSync('post', 'create', docData, doc);

    return doc;
  }
  /**
   * returns a promise that is resolved when the collection gets destroyed
   * @return {Promise}
   */
  ;

  _proto.destroy = function destroy() {
    if (this.destroyed) return;
    this._onDestroyCall && this._onDestroyCall();

    this._subs.forEach(function (sub) {
      return sub.unsubscribe();
    });

    this._changeEventBuffer && this._changeEventBuffer.destroy();

    this._queryCache.destroy();

    this._repStates.forEach(function (sync) {
      return sync.cancel();
    });

    delete this.database.collections[this.name];
    this.destroyed = true;
  }
  /**
   * remove all data
   * @return {Promise}
   */
  ;

  _proto.remove = function remove() {
    return this.database.removeCollection(this.name);
  };

  _createClass(RxCollection, [{
    key: "$",
    get: function get() {
      return this._observable$;
    }
  }, {
    key: "insert$",
    get: function get() {
      return this.$.pipe(filter(function (cE) {
        return cE.data.op === 'INSERT';
      }));
    }
  }, {
    key: "update$",
    get: function get() {
      return this.$.pipe(filter(function (cE) {
        return cE.data.op === 'UPDATE';
      }));
    }
  }, {
    key: "remove$",
    get: function get() {
      return this.$.pipe(filter(function (cE) {
        return cE.data.op === 'REMOVE';
      }));
    }
    /**
     * only emits the change-events that change something with the documents
     */

  }, {
    key: "docChanges$",
    get: function get() {
      if (!this.__docChanges$) {
        this.__docChanges$ = this.$.pipe(filter(function (cEvent) {
          return ['INSERT', 'UPDATE', 'REMOVE'].includes(cEvent.data.op);
        }));
      }

      return this.__docChanges$;
    }
  }, {
    key: "onDestroy",
    get: function get() {
      var _this9 = this;

      if (!this._onDestroy) this._onDestroy = new Promise(function (res) {
        return _this9._onDestroyCall = res;
      });
      return this._onDestroy;
    }
  }]);

  return RxCollection;
}();
/**
 * checks if the migrationStrategies are ok, throws if not
 * @param  {RxSchema} schema
 * @param  {Object} migrationStrategies
 * @throws {Error|TypeError} if not ok
 * @return {boolean}
 */

var checkMigrationStrategies = function checkMigrationStrategies(schema, migrationStrategies) {
  // migrationStrategies must be object not array
  if (typeof migrationStrategies !== 'object' || Array.isArray(migrationStrategies)) {
    throw newRxTypeError('COL11', {
      schema: schema
    });
  } // for every previousVersion there must be strategy


  if (schema.previousVersions.length !== Object.keys(migrationStrategies).length) {
    throw newRxError('COL12', {
      have: Object.keys(migrationStrategies),
      should: schema.previousVersions
    });
  } // every strategy must have number as property and be a function


  schema.previousVersions.map(function (vNr) {
    return {
      v: vNr,
      s: migrationStrategies[vNr + 1 + '']
    };
  }).filter(function (strat) {
    return typeof strat.s !== 'function';
  }).forEach(function (strat) {
    throw newRxTypeError('COL13', {
      version: strat.v,
      type: typeof strat,
      schema: schema
    });
  });
  return true;
};

var HOOKS_WHEN = ['pre', 'post'];
var HOOKS_KEYS = ['insert', 'save', 'remove', 'create'];
var hooksApplied = false;
/**
 * adds the hook-functions to the collections prototype
 * this runs only once
 */

function _applyHookFunctions(collection) {
  if (hooksApplied) return; // already run

  hooksApplied = true;
  var colProto = Object.getPrototypeOf(collection);
  HOOKS_KEYS.forEach(function (key) {
    HOOKS_WHEN.map(function (when) {
      var fnName = when + ucfirst(key);

      colProto[fnName] = function (fun, parallel) {
        return this.addHook(when, key, fun, parallel);
      };
    });
  });
}
/**
 * returns all possible properties of a RxCollection-instance
 * @return {string[]} property-names
 */


var _properties = null;
export function properties() {
  if (!_properties) {
    var pseudoInstance = new RxCollection();
    var ownProperties = Object.getOwnPropertyNames(pseudoInstance);
    var prototypeProperties = Object.getOwnPropertyNames(Object.getPrototypeOf(pseudoInstance));
    _properties = [].concat(ownProperties, prototypeProperties);
  }

  return _properties;
}
/**
 * checks if the given static methods are allowed
 * @param  {{}} statics [description]
 * @throws if not allowed
 */

var checkOrmMethods = function checkOrmMethods(statics) {
  Object.entries(statics).forEach(function (_ref) {
    var k = _ref[0],
        v = _ref[1];

    if (typeof k !== 'string') {
      throw newRxTypeError('COL14', {
        name: k
      });
    }

    if (k.startsWith('_')) {
      throw newRxTypeError('COL15', {
        name: k
      });
    }

    if (typeof v !== 'function') {
      throw newRxTypeError('COL16', {
        name: k,
        type: typeof k
      });
    }

    if (properties().includes(k) || RxDocument.properties().includes(k)) {
      throw newRxError('COL17', {
        name: k
      });
    }
  });
};
/**
 * @return {Promise}
 */


function _atomicUpsertUpdate(doc, json) {
  return doc.atomicUpdate(function (innerDoc) {
    json._rev = innerDoc._rev;
    innerDoc._data = json;
    return innerDoc._data;
  }).then(function () {
    return doc;
  });
}
/**
 * ensures that the given document exists
 * @param  {string}  primary
 * @param  {any}  json
 * @return {Promise<{ doc: RxDocument, inserted: boolean}>} promise that resolves with new doc and flag if inserted
 */


function _atomicUpsertEnsureRxDocumentExists(rxCollection, primary, json) {
  return rxCollection.findOne(primary).exec().then(function (doc) {
    if (!doc) {
      return rxCollection.insert(json).then(function (newDoc) {
        return {
          doc: newDoc,
          inserted: true
        };
      });
    } else {
      return {
        doc: doc,
        inserted: false
      };
    }
  });
}
/**
 * returns the prototype-object
 * that contains the orm-methods,
 * used in the proto-merge
 * @return {{}}
 */


export function getDocumentOrmPrototype(rxCollection) {
  var proto = {};
  Object.entries(rxCollection._methods).forEach(function (_ref2) {
    var k = _ref2[0],
        v = _ref2[1];
    proto[k] = v;
  });
  return proto;
}
/**
 * creates the indexes in the pouchdb
 */

function _prepareCreateIndexes(rxCollection, spawnedPouchPromise) {
  return Promise.all(rxCollection.schema.indexes.map(function (indexAr) {
    var compressedIdx = indexAr.map(function (key) {
      if (!rxCollection.schema.doKeyCompression()) return key;else return rxCollection._keyCompressor.transformKey('', '', key.split('.'));
    });
    return spawnedPouchPromise.then(function () {
      return rxCollection.pouch.createIndex({
        index: {
          fields: compressedIdx
        }
      });
    });
  }));
}
/**
 * creates and prepares a new collection
 * @param  {RxDatabase}  database
 * @param  {string}  name
 * @param  {RxSchema}  schema
 * @param  {?Object}  [pouchSettings={}]
 * @param  {?Object}  [migrationStrategies={}]
 * @return {Promise<RxCollection>} promise with collection
 */


export function create(_ref3) {
  var database = _ref3.database,
      name = _ref3.name,
      schema = _ref3.schema,
      _ref3$pouchSettings = _ref3.pouchSettings,
      pouchSettings = _ref3$pouchSettings === void 0 ? {} : _ref3$pouchSettings,
      _ref3$migrationStrate = _ref3.migrationStrategies,
      migrationStrategies = _ref3$migrationStrate === void 0 ? {} : _ref3$migrationStrate,
      _ref3$autoMigrate = _ref3.autoMigrate,
      autoMigrate = _ref3$autoMigrate === void 0 ? true : _ref3$autoMigrate,
      _ref3$statics = _ref3.statics,
      statics = _ref3$statics === void 0 ? {} : _ref3$statics,
      _ref3$methods = _ref3.methods,
      methods = _ref3$methods === void 0 ? {} : _ref3$methods,
      _ref3$attachments = _ref3.attachments,
      attachments = _ref3$attachments === void 0 ? {} : _ref3$attachments,
      _ref3$options = _ref3.options,
      options = _ref3$options === void 0 ? {} : _ref3$options;
  validateCouchDBString(name); // ensure it is a schema-object

  if (!isInstanceOfRxSchema(schema)) schema = createRxSchema(schema);
  checkMigrationStrategies(schema, migrationStrategies); // check ORM-methods

  checkOrmMethods(statics);
  checkOrmMethods(methods);
  checkOrmMethods(attachments);
  Object.keys(methods).filter(function (funName) {
    return schema.topLevelFields.includes(funName);
  }).forEach(function (funName) {
    throw newRxError('COL18', {
      funName: funName
    });
  });
  var collection = new RxCollection(database, name, schema, pouchSettings, migrationStrategies, methods, attachments, options, statics);
  return collection.prepare().then(function () {
    // ORM add statics
    Object.entries(statics).forEach(function (_ref4) {
      var funName = _ref4[0],
          fun = _ref4[1];
      return collection.__defineGetter__(funName, function () {
        return fun.bind(collection);
      });
    });
    var ret = Promise.resolve();
    if (autoMigrate) ret = collection.migratePromise();
    return ret;
  }).then(function () {
    runPluginHooks('createRxCollection', collection);
    return collection;
  });
}
export function isInstanceOf(obj) {
  return obj instanceof RxCollection;
}
export default {
  create: create,
  properties: properties,
  isInstanceOf: isInstanceOf,
  RxCollection: RxCollection
};