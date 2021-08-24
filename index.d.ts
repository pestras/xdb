import { BehaviorSubject, Observable } from "rxjs";
/**
 * XDB create new database instance, manages connections status,
 * drop databases, creates stores
 */
export declare abstract class XDB {
    readonly name: string;
    protected _v: number;
    /**
     * XDB consturctor
     * @param name [string] Datebase name
     * @param _v [number?] Database version, defaults to 1
     */
    constructor(name: string, _v?: number);
    /** Db status behavior subject */
    protected _openSub: BehaviorSubject<any>;
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
    open(): Observable<void>;
    /** Close db connection */
    protected close(): void;
    /** Drop database */
    protected drop(): Observable<void>;
    /** Update database version */
    protected updateVersion(val: number): Observable<any>;
    /**
     * Create new object store
     * @param name [string] Store name
     * @param keyPath [string?] To create Object store list with unique identifier
     */
    protected createStore(name: string, keyPath?: string): void;
    /**
     * Delete store by name
     * @param name [string] Store name
     */
    protected dropStore(name: string): void;
    /** Db status emitter */
    readonly open$: Observable<any>;
    /** Db is open getter */
    get isOpen(): any;
    /** Db current version getter */
    get version(): number;
    /**
     * Create new database transaction
     * @param storeNames
     * @param mode
     * @returns [Observable<IDBTransaction>]
     */
    transaction(storeNames: string[], mode?: IDBTransactionMode): Observable<IDBTransaction>;
    /** Database transaction complete pipe */
    transComplete(): (source: Observable<IDBTransaction>) => Observable<void>;
    /** Current indexedDb live connections */
    private static Connections;
    /** IndexedDb supported static getter */
    static get Supported(): boolean;
    /**
     * Close all active connections
     * @param force [boolean?] default to false
     */
    static CloseAll(force?: boolean): void;
    /** Drop all databeses */
    static DropAll(): Observable<void[]>;
}
/**
 * Key value indexedDb store
 */
export declare class Store<T = any> {
    protected _db: XDB;
    readonly name: string;
    /**
     * Object store constructor
     * @param _db [XDB] Database instance
     * @param name [string] Store name
     */
    constructor(_db: XDB, name: string);
    /** Object store fields */
    protected _keys: Set<IDBValidKey>;
    /** Object store ready status behavior subject */
    protected _readySub: BehaviorSubject<boolean>;
    /** Ready status emitter */
    readonly ready$: Observable<boolean>;
    /** Ready status getter */
    get ready(): boolean;
    /**
     * Check if key exists
     * @param key [IDBValidKey] key name
     * @returns
     */
    hasKey(key: IDBValidKey): boolean;
    /**
     * Get key value
     * @param key [IDBValidKey] key name
     * @returns Observable\<U\>
     */
    get<U = T>(key: IDBValidKey): Observable<any>;
    /**
     * Update key value
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] key value
     * @param upsert [boolean?] create if not exists
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    update<U = T>(key: IDBValidKey, doc: Partial<U>, upsert?: boolean): Observable<void>;
    update<U = T>(key: IDBValidKey, doc: Partial<U>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
    /**
     * Delete value by key name
     * @param key [IDBValidKey] key name
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    delete(key: IDBValidKey): Observable<void>;
    delete(key: IDBValidKey, trans?: IDBTransaction): Observable<IDBTransaction>;
    /**
     * Clear store
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    clear(): Observable<void>;
    clear(trans: IDBTransaction): Observable<IDBTransaction>;
}
/**
 * List store by key path
 */
export declare class ListStore<T> extends Store<T> {
    readonly keyPath: IDBValidKey;
    /**
     * List Store constructor
     * @param _db [XDB] Database instance
     * @param name [string] Store name
     */
    constructor(_db: XDB, name: string, keyPath: IDBValidKey);
    /**
     * Get all valuse as array
     * @returns Observable\<T[]\>
     */
    getAll(): Observable<T[]>;
    /**
     * Update list store document
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] update value
     * @param upsert [boolean?] create if not exists
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    update(key: IDBValidKey, doc: Partial<T>, upsert?: boolean): Observable<void>;
    update(key: IDBValidKey, doc: Partial<T>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
    /**
     * Update multiple values at ones
     * @param doc [Partial\<T\[]>] update values array
     * @param upsert [boolean?] create if not exists
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    updateMany(docs: Partial<T>[], upsert?: boolean): Observable<void>;
    updateMany(docs: Partial<T>[], upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
    /**
     * Delete multiple documents at once
     * @param keys [Array\<IDBValidKey\>] array of key names
     * @param transaction [IDBTransaction?] db transaction to pipe current operation to
     * @returns [Observable]
     */
    deleteMany(keys: IDBValidKey[]): Observable<void>;
    deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<IDBTransaction>;
}
