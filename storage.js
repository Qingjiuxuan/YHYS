class SecureStorage {
    constructor() {
        this.dbName = 'P2PChatDB';
        this.version = 2;
        this.db = null;
        this.initialized = false;
        this.initPromise = null;
    }

    async init() {
        if (this.initialized && this.db) {
            return this.db;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            console.log('开始初始化数据库...');
            
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = (event) => {
                console.error('数据库打开失败:', event.target.error);
                this.initPromise = null;
                reject(new Error(`数据库初始化失败: ${event.target.error}`));
            };
            
            request.onsuccess = (event) => {
                console.log('数据库初始化成功');
                this.db = event.target.result;
                this.initialized = true;
                
                this.db.onerror = (event) => {
                    console.error('数据库错误:', event.target.error);
                };
                
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                console.log('数据库升级中，版本:', event.oldVersion, '->', event.newVersion);
                const db = event.target.result;
                
                if (event.oldVersion < 1) {
                    this.createStores(db);
                } else {
                    this.handleUpgrade(db, event.oldVersion, event.newVersion);
                }
            };
        });

        return this.initPromise;
    }

    createStores(db) {
        if (!db.objectStoreNames.contains('identity')) {
            db.createObjectStore('identity', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('contacts')) {
            db.createObjectStore('contacts', { keyPath: 'peerId' });
        }
        
        if (!db.objectStoreNames.contains('messages')) {
            const messageStore = db.createObjectStore('messages', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            messageStore.createIndex('contactPeerId', 'contactPeerId', { unique: false });
            messageStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('selfDestructMessages')) {
            const sdStore = db.createObjectStore('selfDestructMessages', { keyPath: 'id' });
            sdStore.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        console.log('所有对象存储创建完成');
    }

    handleUpgrade(db, oldVersion, newVersion) {
        console.log(`处理数据库升级: ${oldVersion} -> ${newVersion}`);
        
        if (oldVersion < 2) {
            this.createStores(db);
            console.log('数据库升级到版本2完成');
        }
    }

    async ensureInitialized() {
        if (!this.initialized || !this.db) {
            await this.init();
        }
        return true;
    }

    async saveContact(contact) {
        await this.ensureInitialized();
        
        if (!contact.peerId) {
            throw new Error('联系人必须包含 peerId');
        }

        console.log('保存联系人:', contact.peerId);
        return this.put('contacts', contact);
    }

    async getContact(peerId) {
        await this.ensureInitialized();
        return this.get('contacts', peerId);
    }

    async getContacts() {
        await this.ensureInitialized();
        return this.getAll('contacts');
    }

    async saveIdentity(identity) {
        await this.ensureInitialized();
        return this.put('identity', { id: 'user', ...identity });
    }

    async getIdentity() {
        await this.ensureInitialized();
        return this.get('identity', 'user');
    }

    async saveMessage(message) {
        await this.ensureInitialized();
        
        if (!message.contactPeerId) {
            throw new Error('消息必须包含 contactPeerId');
        }
        
        return this.put('messages', {
            ...message,
            timestamp: message.timestamp || Date.now()
        });
    }

    async getMessages(contactPeerId) {
        await this.ensureInitialized();
        const messages = await this.getAll('messages');
        return messages
            .filter(msg => msg.contactPeerId === contactPeerId)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    async saveSelfDestructMessage(messageId, messageData, ttlHours) {
        await this.ensureInitialized();
        const expiresAt = Date.now() + (ttlHours * 60 * 60 * 1000);
        return this.put('selfDestructMessages', {
            id: messageId,
            messageData,
            expiresAt,
            ttlHours
        });
    }

    async destroyContactData(contactPeerId) {
        await this.ensureInitialized();
        
        const messages = await this.getMessages(contactPeerId);
        for (const msg of messages) {
            await this.delete('messages', msg.id);
        }
        
        await this.delete('contacts', contactPeerId);
        
        console.log(`已销毁联系人 ${contactPeerId} 的所有数据`);
    }

    async destroyAllData() {
        await this.ensureInitialized();
        const storeNames = ['identity', 'contacts', 'messages', 'selfDestructMessages'];
        
        console.log('开始销毁所有数据...');
        
        for (const storeName of storeNames) {
            await this.clear(storeName);
        }
        
        this.db.close();
        const deleteRequest = indexedDB.deleteDatabase(this.dbName);
        
        return new Promise((resolve, reject) => {
            deleteRequest.onsuccess = () => {
                console.log('所有数据已安全销毁');
                this.db = null;
                this.initialized = false;
                this.initPromise = null;
                resolve();
            };
            
            deleteRequest.onerror = (event) => {
                console.error('删除数据库失败:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async put(storeName, data) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(new Error(`存储操作失败 (${storeName}): ${error.message}`));
            }
        });
    }

    async get(storeName, key) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(new Error(`获取操作失败 (${storeName}): ${error.message}`));
            }
        });
    }

    async getAll(storeName) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(new Error(`获取所有操作失败 (${storeName}): ${error.message}`));
            }
        });
    }

    async delete(storeName, key) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(new Error(`删除操作失败 (${storeName}): ${error.message}`));
            }
        });
    }

    async clear(storeName) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(new Error(`清空操作失败 (${storeName}): ${error.message}`));
            }
        });
    }

    async cleanupExpiredMessages() {
        await this.ensureInitialized();
        const now = Date.now();
        const store = this.db.transaction(['selfDestructMessages'], 'readwrite')
                            .objectStore('selfDestructMessages');
        const index = store.index('expiresAt');
        
        return new Promise((resolve) => {
            const requests = [];
            index.openCursor(IDBKeyRange.upperBound(now)).onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    requests.push(store.delete(cursor.primaryKey));
                    cursor.continue();
                } else {
                    Promise.all(requests).then(() => {
                        console.log(`清理了 ${requests.length} 条过期消息`);
                        resolve();
                    });
                }
            };
        });
    }

    getStatus() {
        return {
            initialized: this.initialized,
            db: !!this.db,
            initInProgress: !!this.initPromise
        };
    }
}
