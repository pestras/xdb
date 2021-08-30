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
    protected _openSub: BehaviorSubject<boolean>;
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
    /** Db on drop listener */
    protected onOpen?(): void;
    /** Db on drop listener */
    protected onDrop?(): void;
    /** Db on block listener */
    protected abstract onBlock(): void;
    /** Open Database connection */
    open(): void;
    /** Close db connection */
    protected close(): void;
    /** Drop database */
    protected drop(): void;
    /** Update database version */
    protected updateVersion(val: number): void;
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
    readonly open$: Observable<boolean>;
    /** Db is open getter */
    get isOpen(): boolean;
    /** Db current version getter */
    get version(): number;
    /**
     * Create new database transaction
     * @param storeNames
     * @param mode
     * @returns IDBTransaction
     */
    transaction(storeNames: string[], mode?: IDBTransactionMode): IDBTransaction;
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
    static DropAll(): void;
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
    /**
     * Get key value
     * @returns Observable\<U\>
     */
    get(): Observable<T>;
    /**
     * Update key value
     * @param doc [Partial\<T\>] key value
     * @returns [Observable]
     */
    update(doc: Partial<T>): Observable<any>;
    /**
     * Clear store
     * @returns [Observable]
     */
    clear(): Observable<void>;
}
/**
 * List store by key path
 */
export declare class ListStore<T> {
    protected _db: XDB;
    readonly name: string;
    readonly keyPath: IDBValidKey;
    /**
     * List Store constructor
     * @param _db [XDB] Database instance
     * @param name [string] Store name
     */
    constructor(_db: XDB, name: string, keyPath: IDBValidKey);
    /**
     * Get key value
     * @returns Observable\<U\>
     */
    get(key: IDBValidKey): Observable<T>;
    /**
     * Get all valuse as array
     * @returns Observable\<T[]\>
     */
    getAll(): Observable<T[]>;
    /**
     * Update key value
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] key value
     * @returns [Observable]
     */
    add(key: IDBValidKey, doc: Partial<T>): Observable<any>;
    /**
     * Update multiple values at ones
     * @param doc [Partial\<T\[]>] update values array
     * @returns [Observable]
     */
    addMany(docs: Partial<T>[]): Observable<any>;
    /**
     * Update key value
     * @param key [IDBValidKey] key name
     * @param doc [Partial\<T\>] key value
     * @returns [Observable]
     */
    update(key: IDBValidKey, doc: Partial<T>): Observable<any>;
    /**
     * Update multiple values at ones
     * @param doc [Partial\<T\[]>] update values array
     * @returns [Observable]
     */
    updateMany(docs: Partial<T>[]): Observable<any>;
    replaceAll(docs: Partial<T>[]): Observable<void>;
    /**
     * Delete value by key name
     * @param key [IDBValidKey] key name
     * @returns [Observable]
     */
    delete(key: IDBValidKey): Observable<void>;
    /**
     * Delete multiple documents at once
     * @param keys [Array\<IDBValidKey\>] array of key names
     * @returns [Observable]
     */
    deleteMany(keys: IDBValidKey[]): Observable<void>;
    /**
     * Clear store
     * @returns [Observable]
     */
    clear(): Observable<void>;
}
