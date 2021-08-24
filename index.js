// Copyright (c) 2021 Pestras
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT
import { BehaviorSubject, EMPTY, forkJoin, Observable, of, throwError } from "rxjs";
import { distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
/**
 * XDB create new database instance, manages connections status,
 * drop databases, creates stores
 */
export class XDB {
    // XDB Constructor
    // ---------------------------------------------------------------------------
    /**
     * XDB consturctor
     * @param name [string] Datebase name
     * @param _v [number?] Database version, defaults to 1
     */
    constructor(name, _v = 1) {
        this.name = name;
        this._v = _v;
        // Protected Members
        // ---------------------------------------------------------------------------
        /** Db status behavior subject */
        this._openSub = new BehaviorSubject(null);
        // Public Members
        // ---------------------------------------------------------------------------
        /** Db status emitter */
        this.open$ = this._openSub.pipe(filter(open => typeof open === "boolean"), distinctUntilChanged());
        /** if indexedDb not supported throw error */
        if (!XDB.Supported) {
            this.onError(new Error('indexeddb not supported'));
            return null;
        }
        if (XDB.Connections.has(this.name)) {
            let db = XDB.Connections.get(this.name);
            if (this._v !== db.version)
                db._v = this._v;
            return db;
        }
        else {
            XDB.Connections.set(this.name, this);
        }
    }
    /** Open Database connection */
    open() {
        return new Observable(subscriber => {
            if (this.isOpen) {
                subscriber.next();
                subscriber.complete();
                return;
            }
            let req = indexedDB.open(this.name, this.version);
            req.addEventListener('success', () => {
                this._db = req.result;
                this._openSub.next(true);
                subscriber.next();
                subscriber.complete();
            });
            req.addEventListener('error', () => {
                this._openSub.next(false);
                this.onError(req.error);
                subscriber.error(req.error);
                subscriber.complete();
            });
            req.addEventListener('blocked', () => {
                this._openSub.next(false);
                this.onBlock();
                subscriber.error(new Error(`db ${self.name} is blocked`));
                subscriber.complete();
            });
            req.addEventListener('upgradeneeded', (e) => {
                this._db = req.result;
                this.onUpgrade(e.oldVersion);
            });
        });
    }
    /** Close db connection */
    close() {
        this._db && this._db.close();
        this._db = null;
        this._openSub.next(false);
    }
    /** Drop database */
    drop() {
        this.close();
        XDB.Connections.delete(this.name);
        return new Observable(subscriber => {
            let req = indexedDB.deleteDatabase(this.name);
            req.addEventListener('success', () => {
                subscriber.next();
                subscriber.complete();
            });
            req.addEventListener('error', () => {
                subscriber.error(req.error);
                subscriber.complete();
            });
        });
    }
    /** Update database version */
    updateVersion(val) {
        if (this._v === val)
            return of(null);
        if (this.isOpen) {
            this.close();
            this._v = val;
            return this.open();
        }
        else {
            return of(null);
        }
    }
    /**
     * Create new object store
     * @param name [string] Store name
     * @param keyPath [string?] To create Object store list with unique identifier
     */
    createStore(name, keyPath) {
        if (this._db.objectStoreNames.contains(name))
            return;
        if (!keyPath)
            this._db.createObjectStore(name);
        else
            this._db.createObjectStore(name, { keyPath: keyPath });
    }
    /**
     * Delete store by name
     * @param name [string] Store name
     */
    dropStore(name) {
        if (!this._db.objectStoreNames.contains(name))
            return;
        this._db.deleteObjectStore(name);
    }
    /** Db is open getter */
    get isOpen() { return this._openSub.getValue(); }
    /** Db current version getter */
    get version() { return this._v; }
    ;
    /**
     * Create new database transaction
     * @param storeNames
     * @param mode
     * @returns [Observable<IDBTransaction>]
     */
    transaction(storeNames, mode) {
        return this.isOpen ? of(this._db.transaction(storeNames, mode)) : throwError(new Error(`${this.name} db is closed`));
    }
    /** Database transaction complete pipe */
    transComplete() {
        return (source) => {
            return new Observable(subscriber => {
                return source.subscribe({
                    next(trans) {
                        trans.oncomplete = function () {
                            subscriber.next();
                            subscriber.complete();
                        };
                        trans.onerror = function () {
                            subscriber.error(trans.error);
                            subscriber.complete();
                        };
                        trans.onabort = function () {
                            subscriber.error('aborted');
                            subscriber.complete();
                        };
                    },
                    error(err) { subscriber.error(err); subscriber.complete(); },
                    complete() { subscriber.complete(); }
                });
            });
        };
    }
    /** IndexedDb supported static getter */
    static get Supported() { return !!window.indexedDB; }
    /**
     * Close all active connections
     * @param force [boolean?] default to false
     */
    static CloseAll(force = false) {
        for (let db of XDB.Connections.values())
            db.close();
    }
    /** Drop all databeses */
    static DropAll() {
        let obs = [];
        for (let db of XDB.Connections.values())
            obs.push(db.drop());
        return forkJoin(obs);
    }
}
// Static Members
// ---------------------------------------------------------------------------
/** Current indexedDb live connections */
XDB.Connections = new Map();
/**
 * Key value indexedDb store
 */
export class Store {
    // XDB Constructor
    // ---------------------------------------------------------------------------
    /**
     * Object store constructor
     * @param _db [XDB] Database instance
     * @param name [string] Store name
     */
    constructor(_db, name) {
        this._db = _db;
        this.name = name;
        // Protected members
        // ---------------------------------------------------------------------------
        /** Object store fields */
        this._keys = new Set();
        /** Object store ready status behavior subject */
        this._readySub = new BehaviorSubject(false);
        // Public members
        // ---------------------------------------------------------------------------
        /** Ready status emitter */
        this.ready$ = this._readySub.pipe(distinctUntilChanged());
        this._db.open$
            .pipe(filter(open => open), switchMap(() => this._db.transaction([this.name], 'readonly')))
            .subscribe(trans => {
            let req = trans.objectStore(this.name).getAllKeys();
            req.addEventListener('success', () => {
                this._keys = new Set(req.result);
                this._readySub.next(true);
            });
            req.addEventListener('error', () => {
                throw req.error;
            });
        });
    }
    /** Ready status getter */
    get ready() { return this._readySub.getValue(); }
    /**
     * Check if key exists
     * @param key [IDBValidKey] key name
     * @returns
     */
    hasKey(key) {
        return this._keys.has(key);
    }
    /**
     * Get key value
     * @param key [IDBValidKey] key name
     * @returns Observable\<U\>
     */
    get(key) {
        if (!this._keys.has(key))
            return of(null);
        return this._db.transaction([this.name], 'readonly')
            .pipe(switchMap(trans => {
            return new Observable(subscriber => {
                let req = trans.objectStore(this.name).get(key);
                req.addEventListener('success', () => {
                    subscriber.next(req.result);
                    subscriber.complete();
                });
                req.addEventListener('error', () => {
                    subscriber.error(req.error);
                    subscriber.complete();
                });
            });
        }));
    }
    update(key, doc, upsert = true, trans) {
        if (!upsert && !this._keys.has(key))
            return EMPTY;
        let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
        return trans$.pipe(switchMap(trans => {
            return new Observable(subscriber => {
                let os = trans.objectStore(this.name);
                let req;
                if (this.hasKey(key))
                    req = os.put(doc, key);
                else if (upsert)
                    req = os.add(doc, key);
                else {
                    subscriber.next(trans);
                    subscriber.complete();
                }
                if (trans) {
                    subscriber.next(trans);
                    subscriber.complete();
                    return;
                }
                req.addEventListener('success', () => {
                    this._keys.add(key);
                    subscriber.next();
                    subscriber.complete();
                });
                req.addEventListener('error', () => {
                    subscriber.error(req.error);
                    subscriber.complete();
                });
            });
        }));
    }
    delete(key, trans) {
        if (!this._keys.has(key))
            return EMPTY;
        let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
        return trans$.pipe(switchMap(trans => {
            if (!this.hasKey(key))
                return of(trans);
            return new Observable(subscriber => {
                let req = trans.objectStore(this.name).delete(key);
                if (trans) {
                    subscriber.next(trans);
                    subscriber.complete();
                    return;
                }
                req.addEventListener('success', () => {
                    this._keys.delete(key);
                    subscriber.next();
                    subscriber.complete();
                });
                req.addEventListener('error', () => {
                    subscriber.error(req.error);
                    subscriber.complete();
                });
            });
        }));
    }
    clear(trans) {
        if (this._keys.size === 0)
            return EMPTY;
        let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
        return trans$.pipe(switchMap(trans => {
            return new Observable(subscriber => {
                let req = trans.objectStore(this.name).clear();
                if (trans) {
                    subscriber.next(trans);
                    subscriber.complete();
                    return;
                }
                req.addEventListener('success', () => {
                    this._keys.clear();
                    subscriber.next();
                    subscriber.complete();
                });
                req.addEventListener('error', () => {
                    subscriber.error(req.error);
                    subscriber.complete();
                });
            });
        }));
    }
}
/**
 * List store by key path
 */
export class ListStore extends Store {
    // XDB Constructor
    // ---------------------------------------------------------------------------
    /**
     * List Store constructor
     * @param _db [XDB] Database instance
     * @param name [string] Store name
     */
    constructor(_db, name, keyPath) {
        super(_db, name);
        this.keyPath = keyPath;
    }
    /**
     * Get all valuse as array
     * @returns Observable\<T[]\>
     */
    getAll() {
        return this._db.transaction([this.name], 'readonly').pipe(switchMap(trans => {
            return new Observable(subscriber => {
                let req = trans.objectStore(this.name).getAll();
                req.addEventListener('success', () => {
                    subscriber.next(req.result);
                    subscriber.complete();
                });
                req.addEventListener('error', () => {
                    subscriber.error(req.error);
                    subscriber.complete();
                });
            });
        }));
    }
    update(key, doc, upsert = true, trans) {
        doc[this.keyPath] = key;
        return super.update(key, doc, upsert, trans);
    }
    updateMany(docs, upsert = true, trans) {
        let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
        return trans$.pipe(switchMap(trans => {
            return new Observable(subscriber => {
                for (let doc of docs)
                    if (this.hasKey(doc[this.keyPath]))
                        trans.objectStore(this.name).put(doc);
                    else if (upsert)
                        trans.objectStore(this.name).add(doc);
                if (trans) {
                    subscriber.next(trans);
                    subscriber.complete();
                    return;
                }
                trans.addEventListener('complete', () => {
                    if (upsert)
                        for (let doc of docs)
                            this._keys.add(doc[this.keyPath]);
                    subscriber.next();
                    subscriber.complete();
                });
                trans.addEventListener('error', () => {
                    subscriber.error(trans.error);
                    subscriber.complete();
                });
            });
        }));
    }
    deleteMany(keys, trans) {
        let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
        return trans$.pipe(switchMap(trans => {
            return new Observable(subscriber => {
                keys = keys.filter(key => !this.hasKey(key));
                for (let key of keys)
                    trans.objectStore(this.name).delete(key);
                if (trans) {
                    subscriber.next(trans);
                    subscriber.complete();
                    return;
                }
                trans.addEventListener('complete', () => {
                    for (let key of keys)
                        this._keys.delete(key);
                    subscriber.next();
                    subscriber.complete();
                });
                trans.addEventListener('error', () => {
                    subscriber.error(trans.error);
                    subscriber.complete();
                });
            });
        }));
    }
}
//# sourceMappingURL=index.js.map