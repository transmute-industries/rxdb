"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.checkFieldNameRegex = checkFieldNameRegex;
exports.validateFieldsDeep = validateFieldsDeep;
exports.checkSchema = checkSchema;
exports["default"] = exports.hooks = exports.rxdb = void 0;

var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));

var _objectPath = _interopRequireDefault(require("object-path"));

var _rxDocument = _interopRequireDefault(require("../rx-document"));

var _rxError = require("../rx-error");

var _rxSchema = require("../rx-schema");

/**
 * does additional checks over the schema-json
 * to ensure nothing is broken or not supported
 */

/**
 * checks if the fieldname is allowed
 * this makes sure that the fieldnames can be transformed into javascript-vars
 * and does not conquer the observe$ and populate_ fields
 * @param  {string} fieldName
 * @throws {Error}
 */
function checkFieldNameRegex(fieldName) {
  if (fieldName === '') return;
  if (fieldName === '_id') return;

  if (['properties', 'language'].includes(fieldName)) {
    throw (0, _rxError.newRxError)('SC23', {
      fieldName: fieldName
    });
  }

  var regexStr = '^[a-zA-Z](?:[[a-zA-Z0-9_]*]?[a-zA-Z0-9])?$';
  var regex = new RegExp(regexStr);

  if (!fieldName.match(regex)) {
    throw (0, _rxError.newRxError)('SC1', {
      regex: regexStr,
      fieldName: fieldName
    });
  }
}
/**
 * validate that all schema-related things are ok
 * @param  {object} jsonSchema
 * @return {boolean} true always
 */


function validateFieldsDeep(jsonSchema) {
  function checkField(fieldName, schemaObj, path) {
    if (typeof fieldName === 'string' && (0, _typeof2["default"])(schemaObj) === 'object' && !Array.isArray(schemaObj)) checkFieldNameRegex(fieldName); // 'item' only allowed it type=='array'

    if (schemaObj.hasOwnProperty('item') && schemaObj.type !== 'array') {
      throw (0, _rxError.newRxError)('SC2', {
        fieldName: fieldName
      });
    }
    /**
     * required fields cannot be set via 'required: true',
     * but must be set via required: []
     */


    if (schemaObj.hasOwnProperty('required') && typeof schemaObj.required === 'boolean') {
      throw (0, _rxError.newRxError)('SC24', {
        fieldName: fieldName
      });
    } // if ref given, must be type=='string' or type=='array' with string-items


    if (schemaObj.hasOwnProperty('ref')) {
      switch (schemaObj.type) {
        case 'string':
          break;

        case 'array':
          if (!schemaObj.items || !schemaObj.items.type || schemaObj.items.type !== 'string') {
            throw (0, _rxError.newRxError)('SC3', {
              fieldName: fieldName
            });
          }

          break;

        default:
          throw (0, _rxError.newRxError)('SC4', {
            fieldName: fieldName
          });
      }
    } // if primary is ref, throw


    if (schemaObj.hasOwnProperty('ref') && schemaObj.primary) {
      throw (0, _rxError.newRxError)('SC5', {
        fieldName: fieldName
      });
    }

    var isNested = path.split('.').length >= 2; // nested only

    if (isNested) {
      if (schemaObj.primary) {
        throw (0, _rxError.newRxError)('SC6', {
          path: path,
          primary: schemaObj.primary
        });
      }

      if (schemaObj["default"]) {
        throw (0, _rxError.newRxError)('SC7', {
          path: path
        });
      }
    } // first level


    if (!isNested) {
      // check underscore fields
      if (fieldName.charAt(0) === '_') {
        if (fieldName === '_id' && schemaObj.primary) {
          return;
        }

        throw (0, _rxError.newRxError)('SC8', {
          fieldName: fieldName
        });
      }
    }
  }

  function traverse(currentObj, currentPath) {
    if ((0, _typeof2["default"])(currentObj) !== 'object') return;

    for (var attributeName in currentObj) {
      if (!currentObj.properties) {
        checkField(attributeName, currentObj[attributeName], currentPath);
      }

      var nextPath = currentPath;
      if (attributeName !== 'properties') nextPath = nextPath + '.' + attributeName;
      traverse(currentObj[attributeName], nextPath);
    }
  }

  traverse(jsonSchema, '');
  return true;
}
/**
 * does the checking
 * @param  {object} jsonId json-object like in json-schema-standard
 * @throws {Error} if something is not ok
 */


function checkSchema(jsonID) {
  // check _rev
  if (jsonID.properties._rev) {
    throw (0, _rxError.newRxError)('SC10', {
      schema: jsonID
    });
  } // check version


  if (!jsonID.hasOwnProperty('version') || typeof jsonID.version !== 'number' || jsonID.version < 0) {
    throw (0, _rxError.newRxError)('SC11', {
      version: jsonID.version
    });
  }

  validateFieldsDeep(jsonID);
  var primaryPath;
  Object.keys(jsonID.properties).forEach(function (key) {
    var value = jsonID.properties[key]; // check primary

    if (value.primary) {
      if (primaryPath) {
        throw (0, _rxError.newRxError)('SC12', {
          value: value
        });
      }

      primaryPath = key;

      if (value.index) {
        throw (0, _rxError.newRxError)('SC13', {
          value: value
        });
      }

      if (value.unique) {
        throw (0, _rxError.newRxError)('SC14', {
          value: value
        });
      }

      if (value.encrypted) {
        throw (0, _rxError.newRxError)('SC15', {
          value: value
        });
      }

      if (value.type !== 'string') {
        throw (0, _rxError.newRxError)('SC16', {
          value: value
        });
      }
    } // check if RxDocument-property


    if (_rxDocument["default"].properties().includes(key)) {
      throw (0, _rxError.newRxError)('SC17', {
        key: key
      });
    }
  }); // check format of jsonID.compoundIndexes

  if (jsonID.compoundIndexes) {
    if (!Array.isArray(jsonID.compoundIndexes)) {
      throw (0, _rxError.newRxError)('SC18', {
        compoundIndexes: jsonID.compoundIndexes
      });
    }

    jsonID.compoundIndexes.forEach(function (ar) {
      if (!Array.isArray(ar)) {
        throw (0, _rxError.newRxError)('SC19', {
          compoundIndexes: jsonID.compoundIndexes
        });
      }

      ar.forEach(function (str) {
        if (typeof str !== 'string') {
          throw (0, _rxError.newRxError)('SC20', {
            compoundIndexes: jsonID.compoundIndexes
          });
        }
      });
    });
  } // check that indexes are string or number


  (0, _rxSchema.getIndexes)(jsonID).reduce(function (a, b) {
    return a.concat(b);
  }, []).filter(function (elem, pos, arr) {
    return arr.indexOf(elem) === pos;
  }) // unique
  .map(function (key) {
    var path = 'properties.' + key.replace(/\./g, '.properties.');

    var schemaObj = _objectPath["default"].get(jsonID, path);

    if (!schemaObj || (0, _typeof2["default"])(schemaObj) !== 'object') {
      throw (0, _rxError.newRxError)('SC21', {
        key: key
      });
    }

    return {
      key: key,
      schemaObj: schemaObj
    };
  }).filter(function (index) {
    return index.schemaObj.type !== 'string' && index.schemaObj.type !== 'integer' && index.schemaObj.type !== 'number';
  }).forEach(function (index) {
    throw (0, _rxError.newRxError)('SC22', {
      key: index.key,
      type: index.schemaObj.type
    });
  });
}

var rxdb = true;
exports.rxdb = rxdb;
var hooks = {
  preCreateRxSchema: checkSchema
};
exports.hooks = hooks;
var _default = {
  rxdb: rxdb,
  hooks: hooks
};
exports["default"] = _default;

//# sourceMappingURL=schema-check.js.map