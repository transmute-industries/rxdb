import express from 'express';
import corsFn from 'cors';

import PouchDB from '../pouch-db';
import {
    newRxError
} from '../rx-error';

import Core from '../core';
import ReplicationPlugin from './replication';
Core.plugin(ReplicationPlugin);

import RxDBWatchForChangesPlugin from './watch-for-changes';
Core.plugin(RxDBWatchForChangesPlugin);

let ExpressPouchDB;
try {
    ExpressPouchDB = require('express-pouchdb');
} catch (error) {
    console.error(
        'Since version 8.4.0 the module \'express-pouchdb\' is not longer delivered with RxDB.\n' +
        'You can install it with \'npm install express-pouchdb\''
    );
}

// we have to clean up after tests so there is no stupid logging
// @link https://github.com/pouchdb/pouchdb-server/issues/226
const PouchdbAllDbs = require('pouchdb-all-dbs');
PouchdbAllDbs(PouchDB);

const APP_OF_DB = new WeakMap();
const SERVERS_OF_DB = new WeakMap();
const DBS_WITH_SERVER = new WeakSet();


const normalizeDbName = function (db) {
    const splitted = db.name.split('/').filter(str => str !== '');
    return splitted.pop();
};

const getPrefix = function (db) {
    const splitted = db.name.split('/').filter(str => str !== '');
    splitted.pop(); // last was the name
    if (splitted.length === 0) return '';
    let ret = splitted.join('/') + '/';
    if (db.name.startsWith('/')) ret = '/' + ret;
    return ret;
};

/**
 * tunnel requests so collection-names can be used as paths
 */
function tunnelCollectionPath(db, path, app, colName) {
    db[colName].watchForChanges();
    const pathWithSlash = path.endsWith('/') ? path : path + '/';
    const collectionPath = pathWithSlash + colName;
    app.use(collectionPath, function (req, res, next) {
        if (req.baseUrl === collectionPath) {
            const to = normalizeDbName(db) + '-rxdb-0-' + colName;
            const toFull = req.originalUrl.replace(collectionPath, pathWithSlash + to);
            req.originalUrl = toFull;
        }
        next();
    });
}

export function spawnServer({
    path = '/db',
    port = 3000,
    cors = false
}) {
    const db = this;
    if (!SERVERS_OF_DB.has(db))
        SERVERS_OF_DB.set(db, []);

    const pseudo = PouchDB.defaults({
        adapter: db.adapter,
        prefix: getPrefix(db)
    });

    const app = express();
    APP_OF_DB.set(db, app);

    // tunnel requests so collection-names can be used as paths
    Object.keys(db.collections).forEach(colName => tunnelCollectionPath(db, path, app, colName));

    // show error if collection is created afterwards
    DBS_WITH_SERVER.add(db);

    if (cors) {
        app.use(corsFn({
            'origin': function (origin, callback) {
                const originToSend = origin || '*';
                callback(null, originToSend);
            },
            'credentials': true,
            'methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        }));
    }

    app.use(path, ExpressPouchDB(pseudo));

    const server = app.listen(port);
    SERVERS_OF_DB.get(db).push(server);

    return {
        app,
        server
    };
}

/**
 * when a server is created, no more collections can be spawned
 */
function ensureNoMoreCollections(args) {
    if (DBS_WITH_SERVER.has(args.database)) {
        const err = newRxError(
            'S1', {
                collection: args.name,
                database: args.database.name
            }
        );
        throw err;
    }
}

/**
 * runs when the database gets destroyed
 */
export function onDestroy(db) {
    if (SERVERS_OF_DB.has(db))
        SERVERS_OF_DB.get(db).forEach(server => server.close());
}


export const rxdb = true;
export const prototypes = {
    RxDatabase: (proto) => {
        proto.server = spawnServer;
    }
};

export const hooks = {
    preDestroyRxDatabase: onDestroy,
    preCreateRxCollection: ensureNoMoreCollections
};

export const overwritable = {};

export default {
    rxdb,
    prototypes,
    overwritable,
    hooks,
    spawnServer
};
