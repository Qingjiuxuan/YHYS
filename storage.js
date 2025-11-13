class SecureStorage {
    constructor() {
        this.dbName = 'P2PChatDB';
        this.version = 2; // 版本号升级到2，因为修改了数据结构
        this.db = null;
    }

    // 初始化数据库
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => {
                console.error('数据库打开失败:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('数据库初始化成功');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                console.log('数据库升级中...');
                const db = event.target.result;
                
                // 删除旧的对象存储（如果存在）
                if (db.objectStoreNames.contains('identity')) {
                    db.deleteObjectStore('identity');
                }
                if (db.objectStoreNames.contains('contacts')) {
                    db.deleteObjectStore('contacts');
                }
                if (db.objectStoreNames.contains('messages')) {
                    db.deleteObjectStore('messages');
                }
                if (db.objectStoreNames.contains('selfDestructMessages')) {
                    db.deleteObjectStore('selfDestructMessages');
                }
                
                // 创建新的对象存储
                
                // 身份存储
                const identityStore = db.createObjectStore('identity', { keyPath: 'id' });
                console.log('创建身份存储');
                
                // 联系人存储 - 使用 peerId 作为主键
                const contactsStore = db.createObjectStore('contacts', { keyPath: 'peerId' });
                contactsStore.createIndex('did', 'did', { unique: false });
                console.log('创建联系人存储');
                
                // 消息存储
                const messageStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                messageStore.createIndex('contactPeerId', 'contactPeerId', { unique: false });
                messageStore.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('创建消息存储');
                
                // 自毁消息存储
                const sdStore = db.createObjectStore('selfDestructMessages', { keyPath: 'id' });
                sdStore.createIndex('expiresAt', 'expiresAt', { unique: false });
                console.log('创建自毁消息存储');
            };
        });
    }

    // 保存身份信息
    async saveIdentity(identity) {
        try {
            await this.put('identity', { 
                id: 'user', 
                ...identity 
            });
            console.log('身份信息保存成功');
            return true;
        } catch (error) {
            console.error('保存身份信息失败:', error);
            return false;
        }
    }

    // 获取身份信息
    async getIdentity() {
        try {
            const identity = await this.get('identity', 'user');
            console.log('获取身份信息成功');
            return identity;
        } catch (error) {
            console.error('获取身份信息失败:', error);
            return null;
        }
    }

    // 保存联系人
    async saveContact(contact) {
        try {
            await this.put('contacts', contact);
            console.log('联系人保存成功:', contact.peerId);
            return true;
        } catch (error) {
            console.error('保存联系人失败:', error);
            return false;
        }
    }

    // 获取所有联系人
    async getContacts() {
        try {
            const contacts = await this.getAll('contacts');
            console.log('获取联系人列表成功，数量:', contacts.length);
            return contacts || [];
        } catch (error) {
            console.error('获取联系人列表失败:', error);
            return [];
        }
    }

    // 根据 peerId 获取特定联系人
    async getContact(peerId) {
        try {
            const contact = await this.get('contacts', peerId);
            return contact;
        } catch (error) {
            console.error('获取联系人失败:', error);
            return null;
        }
    }

    // 保存消息
    async saveMessage(message) {
        try {
            // 确保消息有时间戳
            if (!message.timestamp) {
                message.timestamp = Date.now();
            }
            
            await this.put('messages', message);
            console.log('消息保存成功');
            return true;
        } catch (error) {
            console.error('保存消息失败:', error);
            return false;
        }
    }

    // 获取与特定联系人的所有消息
    async getMessages(contactPeerId) {
        try {
            const allMessages = await this.getAll('messages');
            const contactMessages = allMessages.filter(msg => msg.contactPeerId === contactPeerId)
                                             .sort((a, b) => a.timestamp - b.timestamp);
            console.log(`获取与 ${contactPeerId} 的消息成功，数量:`, contactMessages.length);
            return contactMessages;
        } catch (error) {
            console.error('获取消息失败:', error);
            return [];
        }
    }

    // 获取所有消息（用于调试）
    async getAllMessages() {
        try {
            const messages = await this.getAll('messages');
            return messages || [];
        } catch (error) {
            console.error('获取所有消息失败:', error);
            return [];
        }
    }

    // 保存自毁消息
    async saveSelfDestructMessage(messageId, messageData, ttlHours) {
        try {
            const expiresAt = Date.now() + (ttlHours * 60 * 60 * 1000);
            await this.put('selfDestructMessages', {
                id: messageId,
                messageData: messageData,
                expiresAt: expiresAt,
                ttlHours: ttlHours,
                createdAt: Date.now()
            });
            console.log('自毁消息保存成功:', messageId);
            return true;
        } catch (error) {
            console.error('保存自毁消息失败:', error);
            return false;
        }
    }

    // 获取自毁消息
    async getSelfDestructMessage(messageId) {
        try {
            const message = await this.get('selfDestructMessages', messageId);
            return message;
        } catch (error) {
            console.error('获取自毁消息失败:', error);
            return null;
        }
    }

    // 清理过期的自毁消息
    async cleanupExpiredMessages() {
        try {
            const now = Date.now();
            const store = this.db.transaction(['selfDestructMessages'], 'readwrite')
                                .objectStore('selfDestructMessages');
            const index = store.index('expiresAt');
            
            let deletedCount = 0;
            
            return new Promise((resolve) => {
                const request = index.openCursor(IDBKeyRange.upperBound(now));
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        deletedCount++;
                        cursor.continue();
                    } else {
                        console.log(`清理了 ${deletedCount} 条过期的自毁消息`);
                        resolve(deletedCount);
                    }
                };
                
                request.onerror = () => {
                    console.error('清理自毁消息失败');
                    resolve(0);
                };
            });
        } catch (error) {
            console.error('清理自毁消息时出错:', error);
            return 0;
        }
    }

    // 销毁所有数据（不可恢复）
    async destroyAllData() {
        try {
            console.log('开始销毁所有数据...');
            
            const storeNames = ['identity', 'contacts', 'messages', 'selfDestructMessages'];
            
            // 逐个清空所有存储
            for (const storeName of storeNames) {
                await this.clear(storeName);
                console.log(`已清空: ${storeName}`);
            }
            
            // 关闭数据库连接
            this.db.close();
            
            // 删除整个数据库
            const deleteRequest = indexedDB.deleteDatabase(this.dbName);
            
            return new Promise((resolve, reject) => {
                deleteRequest.onsuccess = () => {
                    console.log('所有数据已安全销毁');
                    this.db = null;
                    resolve();
                };
                
                deleteRequest.onerror = () => {
                    console.error('删除数据库失败');
                    reject(deleteRequest.error);
                };
                
                deleteRequest.onblocked = () => {
                    console.log('数据库删除被阻塞，可能还有其他连接');
                    // 重试
                    setTimeout(() => {
                        indexedDB.deleteDatabase(this.dbName);
                    }, 1000);
                };
            });
        } catch (error) {
            console.error('销毁数据时出错:', error);
            throw error;
        }
    }

    // 销毁特定联系人的数据
    async destroyContactData(contactPeerId) {
        try {
            console.log(`销毁联系人数据: ${contactPeerId}`);
            
            // 删除该联系人的所有消息
            const messages = await this.getMessages(contactPeerId);
            for (const msg of messages) {
                await this.delete('messages', msg.id);
            }
            
            // 删除联系人
            await this.delete('contacts', contactPeerId);
            
            console.log(`已销毁与 ${contactPeerId} 的所有数据`);
            return true;
        } catch (error) {
            console.error('销毁联系人数据失败:', error);
            return false;
        }
    }

    // 获取数据库信息（用于调试）
    async getDatabaseInfo() {
        try {
            const identity = await this.getIdentity();
            const contacts = await this.getContacts();
            const allMessages = await this.getAllMessages();
            
            return {
                hasIdentity: !!identity,
                contactsCount: contacts.length,
                messagesCount: allMessages.length,
                identity: identity ? {
                    hasPeerId: !!identity.peerId,
                    hasDid: !!identity.did,
                    peerId: identity.peerId,
                    did: identity.did
                } : null
            };
        } catch (error) {
            console.error('获取数据库信息失败:', error);
            return {
                hasIdentity: false,
                contactsCount: 0,
                messagesCount: 0,
                error: error.message
            };
        }
    }

    // ========== 通用数据库操作方法 ==========

    // 添加或更新数据
    put(storeName, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    console.error(`put操作失败 - ${storeName}:`, request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error(`put操作异常 - ${storeName}:`, error);
                reject(error);
            }
        });
    }

    // 获取数据
    get(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    console.error(`get操作失败 - ${storeName}:`, request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error(`get操作异常 - ${storeName}:`, error);
                reject(error);
            }
        });
    }

    // 获取所有数据
    getAll(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => {
                    console.error(`getAll操作失败 - ${storeName}:`, request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error(`getAll操作异常 - ${storeName}:`, error);
                reject(error);
            }
        });
    }

    // 删除数据
    delete(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);
                
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error(`delete操作失败 - ${storeName}:`, request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error(`delete操作异常 - ${storeName}:`, error);
                reject(error);
            }
        });
    }

    // 清空存储
    clear(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error(`clear操作失败 - ${storeName}:`, request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error(`clear操作异常 - ${storeName}:`, error);
                reject(error);
            }
        });
    }
}

// 导出类，以便在其他文件中使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecureStorage;
}
