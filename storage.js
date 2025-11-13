class SecureStorage {
    constructor() {
        this.dbName = 'P2PChatDB';
        this.version = 1;
        this.db = null;
    }

    // 初始化数据库
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 创建身份存储
                if (!db.objectStoreNames.contains('identity')) {
                    db.createObjectStore('identity', { keyPath: 'id' });
                }
                
                // 创建联系人存储
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'did' });
                }
                
                // 创建消息存储
                if (!db.objectStoreNames.contains('messages')) {
                    const messageStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    messageStore.createIndex('contactDid', 'contactDid', { unique: false });
                    messageStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // 创建自毁消息存储
                if (!db.objectStoreNames.contains('selfDestructMessages')) {
                    const sdStore = db.createObjectStore('selfDestructMessages', { keyPath: 'id' });
                    sdStore.createIndex('expiresAt', 'expiresAt', { unique: false });
                }
            };
        });
    }

    // 保存身份
    async saveIdentity(identity) {
        return this.put('identity', { id: 'user', ...identity });
    }

    // 获取身份
    async getIdentity() {
        return this.get('identity', 'user');
    }

    // 保存联系人
    async saveContact(contact) {
        return this.put('contacts', contact);
    }

    // 获取所有联系人
    async getContacts() {
        return this.getAll('contacts');
    }

    // 保存消息
    async saveMessage(message) {
        return this.put('messages', {
            ...message,
            timestamp: message.timestamp || Date.now()
        });
    }

    // 获取联系人消息
    async getMessages(contactDid) {
        const messages = await this.getAll('messages');
        return messages.filter(msg => msg.contactDid === contactDid)
                      .sort((a, b) => a.timestamp - b.timestamp);
    }

    // 保存自毁消息
    async saveSelfDestructMessage(messageId, messageData, ttlHours) {
        const expiresAt = Date.now() + (ttlHours * 60 * 60 * 1000);
        return this.put('selfDestructMessages', {
            id: messageId,
            messageData,
            expiresAt,
            ttlHours
        });
    }

    // 清理过期的自毁消息
    async cleanupExpiredMessages() {
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
                    Promise.all(requests).then(resolve);
                }
            };
        });
    }

    // 销毁所有数据（不可恢复）
    async destroyAllData() {
        const storeNames = ['identity', 'contacts', 'messages', 'selfDestructMessages'];
        
        for (const storeName of storeNames) {
            await this.clear(storeName);
        }
        
        // 强制删除数据库
        this.db.close();
        const deleteRequest = indexedDB.deleteDatabase(this.dbName);
        
        return new Promise((resolve) => {
            deleteRequest.onsuccess = () => {
                console.log('所有数据已安全销毁');
                resolve();
            };
        });
    }

    // 销毁特定联系人的数据
    async destroyContactData(contactDid) {
        // 删除消息
        const messages = await this.getMessages(contactDid);
        for (const msg of messages) {
            await this.delete('messages', msg.id);
        }
        
        // 删除联系人
        await this.delete('contacts', contactDid);
    }

    // 通用数据库操作方法
    put(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    get(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    clear(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}