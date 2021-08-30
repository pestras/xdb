// Copyright (c) 2021 Pestras
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT
import { BehaviorSubject, Observable, of } from "rxjs";
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
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
        if (this.isOpen)
            return;
        let req = indexedDB.open(this.name, this.version);
        req.addEventListener('success', () => {
            this._db = req.result;
            this._openSub.next(true);
        });
        req.addEventListener('error', () => {
            this._openSub.next(false);
            this.onError(req.error);
        });
        req.addEventListener('blocked', () => {
            this._openSub.next(false);
            this.onBlock();
        });
        req.addEventListener('upgradeneeded', (e) => {
            this._db = req.result;
            this.onUpgrade(e.oldVersion);
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
        let req = indexedDB.deleteDatabase(this.name);
        req.addEventListener('success', () => {
            this._openSub.next(false);
        });
        req.addEventListener('error', () => {
            this.onError(req.error);
        });
    }
    /** Update database version */
    updateVersion(val) {
        if (this._v === val)
            return;
        if (this.isOpen) {
            this.close();
            this._v = val;
            return this.open();
        }
        else {
            return;
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
     * @returns IDBTransaction
     */
    transaction(storeNames, mode) {
        if (this.isOpen)
            return this._db.transaction(storeNames, mode);
        throw (new Error(`${this.name} db is closed`));
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
        for (let [name, db] of XDB.Connections.entries()) {
            db.drop();
            XDB.Connections.delete(name);
        }
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
        this._readySub = new BehaviorSubject(null);
        /** Error listner  */
        // Public members
        // ---------------------------------------------------------------------------
        /** Ready status emitter */
        this.ready$ = this._readySub.pipe(filter(ready => typeof ready === 'boolean'), distinctUntilChanged());
        this._db.open$
            .pipe(filter(open => open), map(() => this._db.transaction([this.name], 'readonly')))
            .subscribe(trans => {
            let req = trans.objectStore(this.name).getAllKeys();
            req.addEventListener('success', () => {
                this._keys = new Set(req.result);
                this._readySub.next(true);
            });
            req.addEventListener('error', () => {
                this._db.onError(req.error);
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
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readonly');
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
    }
    /**
     * Update key value
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] key value
     * @param upsert [boolean?] create if not exists
     * @returns [Observable]
     */
    update(key, doc, upsert = true) {
        if (!upsert && !this._keys.has(key))
            return of();
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readwrite');
            let os = trans.objectStore(this.name);
            let req;
            if (this.hasKey(key))
                req = os.put(doc, key);
            else if (upsert)
                req = os.add(doc, key);
            else {
                subscriber.next();
                subscriber.complete();
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
    }
    /**
     * Delete value by key name
     * @param key [IDBValidKey] key name
     * @returns [Observable]
     */
    delete(key) {
        if (!this._keys.has(key))
            return of();
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readwrite');
            let req = trans.objectStore(this.name).delete(key);
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
    }
    /**
     * Clear store
     * @returns [Observable]
     */
    clear() {
        if (this._keys.size === 0)
            return of();
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readwrite');
            let req = trans.objectStore(this.name).clear();
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
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readonly');
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
    }
    /**
     * Update list store document
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] update value
     * @param upsert [boolean?] create if not exists
     * @returns [Observable]
     */
    update(key, doc, upsert = true) {
        doc[this.keyPath] = key;
        return super.update(key, doc, upsert);
    }
    /**
     * Update multiple values at ones
     * @param doc [Partial\<T\[]>] update values array
     * @param upsert [boolean?] create if not exists
     * @returns [Observable]
     */
    updateMany(docs, upsert = true) {
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readwrite');
            for (let doc of docs)
                if (this.hasKey(doc[this.keyPath]))
                    trans.objectStore(this.name).put(doc);
                else if (upsert)
                    trans.objectStore(this.name).add(doc);
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
    }
    /**
     * Delete multiple documents at once
     * @param keys [Array\<IDBValidKey\>] array of key names
     * @returns [Observable]
     */
    deleteMany(keys) {
        return new Observable(subscriber => {
            let trans = this._db.transaction([this.name], 'readwrite');
            keys = keys.filter(key => !this.hasKey(key));
            for (let key of keys)
                trans.objectStore(this.name).delete(key);
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
    }
}
//# sourceMappingURL=index.js.map