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
export abstract class XDB {

  // XDB Constructor
  // ---------------------------------------------------------------------------
  /**
   * XDB consturctor
   * @param name [string] Datebase name
   * @param _v [number?] Database version, defaults to 1
   */
  constructor(readonly name: string, protected _v: number = 1) {

    /** if indexedDb not supported throw error */
    if (!XDB.Supported) {
      this.onError(new Error('indexeddb not supported'));
      return null;
    }

    if (XDB.Connections.has(this.name)) {
      let db = XDB.Connections.get(this.name);
      if (this._v !== db.version) db._v = this._v;
      return db;
    } else {
      XDB.Connections.set(this.name, this);
    }
  }

  // Protected Members
  // ---------------------------------------------------------------------------
  /** Db status behavior subject */
  protected _openSub = new BehaviorSubject(null);
  /** Current db instance */
  protected _db: IDBDatabase;

  /**
   * Db on upgrade listener
   * @param version [number] Db version
   */
  protected abstract onUpgrade(version: number): void;

  /**
   * Db on error listener
   * @param err Error
   */
  protected abstract onError(err: Error): void;

  /** Db on block listener */
  protected abstract onBlock(): void;

  /** Open Database connection */
  open() {
    return new Observable<void>(subscriber => {
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

      req.addEventListener('upgradeneeded', (e: IDBVersionChangeEvent) => {
        this._db = req.result;
        this.onUpgrade(e.oldVersion);
      });
    });
  }

  /** Close db connection */
  protected close() {
    this._db && this._db.close();
    this._db = null;
    this._openSub.next(false);
  }

  /** Drop database */
  protected drop() {
    this.close();
    XDB.Connections.delete(this.name);
    return new Observable<void>(subscriber => {
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
  protected updateVersion(val: number) {
    if (this._v === val) return of(null);
    if (this.isOpen) {
      this.close();
      this._v = val;
      return this.open();
    } else {
      return of(null);
    }
  }

  /**
   * Create new object store
   * @param name [string] Store name
   * @param keyPath [string?] To create Object store list with unique identifier
   */
  protected createStore(name: string, keyPath?: string): void {
    if (this._db.objectStoreNames.contains(name)) return;
    if (!keyPath) this._db.createObjectStore(name);
    else this._db.createObjectStore(name, { keyPath: keyPath });
  }

  /**
   * Delete store by name
   * @param name [string] Store name
   */
  protected dropStore(name: string): void {
    if (!this._db.objectStoreNames.contains(name)) return;
    this._db.deleteObjectStore(name);
  }

  // Public Members
  // ---------------------------------------------------------------------------
  /** Db status emitter */
  public readonly open$ = this._openSub.pipe(filter(open => typeof open === "boolean"), distinctUntilChanged());

  /** Db is open getter */
  public get isOpen() { return this._openSub.getValue(); }

  /** Db current version getter */
  public get version() { return this._v; };

  /**
   * Create new database transaction
   * @param storeNames 
   * @param mode 
   * @returns [Observable<IDBTransaction>]
   */
  public transaction(storeNames: string[], mode?: IDBTransactionMode) {
    return this.isOpen ? of(this._db.transaction(storeNames, mode)) : throwError(new Error(`${this.name} db is closed`));
  }

  /** Database transaction complete pipe */
  public transComplete() {
    return (source: Observable<IDBTransaction>) => {
      return new Observable<void>(subscriber => {
        return source.subscribe({
          next(trans) {
            trans.oncomplete = function () {
              subscriber.next();
              subscriber.complete();
            }
            trans.onerror = function () {
              subscriber.error(trans.error);
              subscriber.complete();
            }
            trans.onabort = function () {
              subscriber.error('aborted');
              subscriber.complete();
            }
          },
          error(err) { subscriber.error(err); subscriber.complete() },
          complete() { subscriber.complete() }
        });
      });
    }
  }

  // Static Members
  // ---------------------------------------------------------------------------
  /** Current indexedDb live connections */
  private static Connections = new Map<string, XDB>();

  /** IndexedDb supported static getter */
  static get Supported() { return !!window.indexedDB; }

  /**
   * Close all active connections
   * @param force [boolean?] default to false
   */
  static CloseAll(force = false) {
    for (let db of XDB.Connections.values()) db.close();
  }

  /** Drop all databeses */
  static DropAll() {
    let obs: Observable<void>[] = [];
    for (let db of XDB.Connections.values()) obs.push(db.drop());
    return forkJoin(obs);
  }
}

/**
 * Key value indexedDb store 
 */
export class Store<T = any> {

  // XDB Constructor
  // ---------------------------------------------------------------------------
  /**
   * Object store constructor
   * @param _db [XDB] Database instance
   * @param name [string] Store name
   */
  constructor(
    protected _db: XDB,
    public readonly name: string
  ) {
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

  // Protected members
  // ---------------------------------------------------------------------------
  /** Object store fields */
  protected _keys = new Set<IDBValidKey>();
  /** Object store ready status behavior subject */
  protected _readySub = new BehaviorSubject<boolean>(null);

  // Public members
  // ---------------------------------------------------------------------------
  /** Ready status emitter */
  public readonly ready$ = this._readySub.pipe(filter(ready => typeof ready === 'boolean'), distinctUntilChanged());

  /** Ready status getter */
  public get ready() { return this._readySub.getValue(); }

  /**
   * Check if key exists
   * @param key [IDBValidKey] key name
   * @returns 
   */
  public hasKey(key: IDBValidKey) {
    return this._keys.has(key);
  }

  /**
   * Get key value
   * @param key [IDBValidKey] key name
   * @returns Observable\<U\>
   */
  public get<U = T>(key: IDBValidKey) {
    if (!this._keys.has(key))
      return of(null);

    return this._db.transaction([this.name], 'readonly')
      .pipe(switchMap(trans => {
        return new Observable<T>(subscriber => {
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

  /**
   * Update key value
   * @param key [IDBValidKey] key name
   * @param doc [Partial\<T\>] key value
   * @param upsert [boolean?] create if not exists
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public update<U = T>(key: IDBValidKey, doc: Partial<U>, upsert?: boolean): Observable<void>;
  public update<U = T>(key: IDBValidKey, doc: Partial<U>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  public update<U = T>(key: IDBValidKey, doc: Partial<U>, upsert = true, trans?: IDBTransaction): Observable<any> {

    if (!upsert && !this._keys.has(key))
      return EMPTY;

    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');

    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        let os = trans.objectStore(this.name);
        let req: IDBRequest;

        if (this.hasKey(key)) req = os.put(doc, key);
        else if (upsert) req = os.add(doc, key);
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

  /**
   * Delete value by key name
   * @param key [IDBValidKey] key name
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public delete(key: IDBValidKey): Observable<void>;
  public delete(key: IDBValidKey, trans?: IDBTransaction): Observable<IDBTransaction>;
  public delete(key: IDBValidKey, trans?: IDBTransaction): Observable<any> {

    if (!this._keys.has(key))
      return EMPTY;

    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');

    return trans$.pipe(switchMap(trans => {
      if (!this.hasKey(key)) return of(trans);
      return new Observable<any>(subscriber => {
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

  /**
   * Clear store
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public clear(): Observable<void>;
  public clear(trans: IDBTransaction): Observable<IDBTransaction>;
  public clear(trans?: IDBTransaction): Observable<any> {

    if (this._keys.size === 0)
      return EMPTY;

    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');

    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
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
export class ListStore<T> extends Store<T> {

  // XDB Constructor
  // ---------------------------------------------------------------------------
  /**
   * List Store constructor
   * @param _db [XDB] Database instance
   * @param name [string] Store name
   */
  constructor(
    _db: XDB,
    name: string,
    public readonly keyPath: IDBValidKey
  ) {
    super(_db, name);
  }

  /**
   * Get all valuse as array
   * @returns Observable\<T[]\>
   */
  public getAll() {
    return this._db.transaction([this.name], 'readonly').pipe(switchMap(trans => {
      return new Observable<T[]>(subscriber => {
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

  /**
   * Update list store document
   * @param key [IDBValidKey] key name
   * @param doc [Partial\<T\>] update value
   * @param upsert [boolean?] create if not exists
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public update(key: IDBValidKey, doc: Partial<T>, upsert?: boolean): Observable<void>
  public update(key: IDBValidKey, doc: Partial<T>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>
  public update(key: IDBValidKey, doc: Partial<T>, upsert = true, trans?: IDBTransaction): Observable<any> {
    (<any>doc)[<string>this.keyPath] = key;
    return super.update(key, doc, upsert, trans);
  }

  /**
   * Update multiple values at ones
   * @param doc [Partial\<T\[]>] update values array
   * @param upsert [boolean?] create if not exists
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public updateMany(docs: Partial<T>[], upsert?: boolean): Observable<void>;
  public updateMany(docs: Partial<T>[], upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  public updateMany(docs: Partial<T>[], upsert = true, trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        for (let doc of docs)
          if (this.hasKey((<any>doc)[<string>this.keyPath])) trans.objectStore(this.name).put(doc);
          else if (upsert) trans.objectStore(this.name).add(doc);

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        trans.addEventListener('complete', () => {
          if (upsert) for (let doc of docs) this._keys.add((<any>doc)[<string>this.keyPath]);
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

  /**
   * Delete multiple documents at once
   * @param keys [Array\<IDBValidKey\>] array of key names
   * @param transaction [IDBTransaction?] db transaction to pipe current operation to
   * @returns [Observable]
   */
  public deleteMany(keys: IDBValidKey[]): Observable<void>;
  public deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<IDBTransaction>;
  public deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        keys = keys.filter(key => !this.hasKey(key));
        for (let key of keys) trans.objectStore(this.name).delete(key);

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        trans.addEventListener('complete', () => {
          for (let key of keys) this._keys.delete(key);
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