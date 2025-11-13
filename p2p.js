class P2PNetwork {
    constructor() {
        this.peer = null;
        this.connections = new Map();
        this.messageHandlers = new Map();
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.pendingIdentityRequests = new Map();
        this.initialized = false;
        this.currentIdentity = null;
    }

    // 初始化P2P网络
    async init(identity) {
        if (this.initialized) {
            console.log('网络已经初始化');
            return this.peer.id;
        }

        // 确保存储已初始化
        try {
            await this.storage.init();
        } catch (error) {
            console.error('存储初始化失败:', error);
            throw new Error(`网络初始化失败: ${error.message}`);
        }

        // 设置当前用户信息
        this.crypto.currentUser = identity;
        this.currentIdentity = identity;
        
        const peerId = identity.peerId;
        
        console.log('正在初始化P2P网络，ID:', peerId);
        
        this.peer = new Peer(peerId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:0.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' }
                ]
            },
            debug: 2
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('P2P网络初始化超时'));
            }, 15000);

            this.peer.on('open', (id) => {
                clearTimeout(timeout);
                console.log('P2P连接建立，ID:', id);
                this.setupConnectionHandlers();
                this.initialized = true;
                resolve(id);
            });

            this.peer.on('error', (error) => {
                clearTimeout(timeout);
                console.error('P2P错误:', error);
                
                if (error.type === 'unavailable-id') {
                    this.handleUnavailableId(identity).then(resolve).catch(reject);
                } else {
                    reject(new Error(`P2P初始化失败: ${error.message}`));
                }
            });
        });
    }

    // 处理ID不可用的情况
    async handleUnavailableId(identity) {
        console.log('ID被占用，生成新的身份...');
        
        // 生成新的身份
        const newIdentity = this.crypto.generateIdentity();
        await this.storage.saveIdentity(newIdentity);
        
        // 重新初始化
        return this.init(newIdentity);
    }

    // 设置连接处理器
    setupConnectionHandlers() {
        this.peer.on('connection', (conn) => {
            console.log('收到连接请求:', conn.peer);
            
            conn.on('open', async () => {
                this.connections.set(conn.peer, conn);
                this.setupMessageHandler(conn);
                
                // 立即发送身份信息
                await this.sendIdentity(conn);
                
                console.log('新连接已建立:', conn.peer);
            });

            conn.on('close', () => {
                console.log('连接关闭:', conn.peer);
                this.connections.delete(conn.peer);
                this.pendingIdentityRequests.delete(conn.peer);
                
                // 更新联系人状态
                this.updateContactStatus(conn.peer, false);
            });

            conn.on('error', (error) => {
                console.error('连接错误:', error);
                this.connections.delete(conn.peer);
                this.pendingIdentityRequests.delete(conn.peer);
            });
        });
    }

    // 更新联系人状态
    async updateContactStatus(peerId, connected) {
        try {
            const contact = await this.storage.getContact(peerId);
            if (contact) {
                contact.connected = connected;
                contact.lastSeen = Date.now();
                await this.storage.saveContact(contact);
                
                this.emit('contact-status-changed', contact);
            }
        } catch (error) {
            console.error('更新联系人状态失败:', error);
        }
    }

    // 连接到其他用户
    async connectToPeer(peerId) {
        if (this.connections.has(peerId)) {
            console.log('已经连接到该用户');
            return this.connections.get(peerId);
        }

        // 检查是否已有该联系人的完整信息
        const existingContact = await this.storage.getContact(peerId);
        
        const conn = this.peer.connect(peerId, {
            reliable: true,
            serialization: 'json'
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('连接超时'));
            }, 10000);

            conn.on('open', async () => {
                clearTimeout(timeout);
                console.log('连接已建立:', peerId);
                
                this.connections.set(peerId, conn);
                this.setupMessageHandler(conn);
                
                // 立即发送身份信息
                await this.sendIdentity(conn);
                
                // 标记为等待身份交换完成
                this.pendingIdentityRequests.set(peerId, {
                    conn: conn,
                    timestamp: Date.now(),
                    resolved: false
                });
                
                // 更新联系人状态
                await this.updateContactStatus(peerId, true);
                
                resolve(conn);
            });

            conn.on('error', (error) => {
                clearTimeout(timeout);
                console.error('连接错误:', error);
                reject(error);
            });

            conn.on('close', () => {
                clearTimeout(timeout);
                this.connections.delete(peerId);
                this.pendingIdentityRequests.delete(peerId);
                this.updateContactStatus(peerId, false);
            });
        });
    }

    // 设置消息处理器
    setupMessageHandler(conn) {
        conn.on('data', async (data) => {
            try {
                await this.handleMessage(conn.peer, data);
            } catch (error) {
                console.error('消息处理错误:', error);
            }
        });
    }

    // 发送身份信息
    async sendIdentity(conn) {
        if (!this.currentIdentity) {
            console.error('当前用户身份未设置');
            return;
        }

        const identityMsg = {
            type: 'identity',
            peerId: this.currentIdentity.peerId,
            did: this.currentIdentity.did,
            publicKey: this.currentIdentity.publicKey,
            timestamp: Date.now(),
            signature: this.signIdentity(this.currentIdentity)
        };
        
        console.log('发送身份信息给:', conn.peer);
        conn.send(identityMsg);
    }

    // 签名身份信息
    signIdentity(identity) {
        const data = JSON.stringify({
            peerId: identity.peerId,
            did: identity.did,
            publicKey: identity.publicKey,
            timestamp: Date.now()
        });
        
        const dataBytes = nacl.util.decodeUTF8(data);
        const signature = nacl.sign.detached(dataBytes, this.crypto.keyPair.secretKey);
        return nacl.util.encodeBase64(signature);
    }

    // 验证身份签名
    verifyIdentity(data, signature, publicKey) {
        try {
            const dataBytes = nacl.util.decodeUTF8(JSON.stringify(data));
            const signatureBytes = nacl.util.decodeBase64(signature);
            const publicKeyBytes = nacl.util.decodeBase64(publicKey);
            
            return nacl.sign.detached.verify(dataBytes, signatureBytes, publicKeyBytes);
        } catch (error) {
            console.error('身份验证失败:', error);
            return false;
        }
    }

    // 处理接收到的消息
    async handleMessage(peerId, data) {
        console.log('收到消息:', data.type, '来自:', peerId);
        
        switch (data.type) {
            case 'identity':
                await this.handleIdentity(peerId, data);
                break;
                
            case 'identity-ack':
                await this.handleIdentityAck(peerId, data);
                break;
                
            case 'message':
                await this.handleChatMessage(peerId, data);
                break;
                
            case 'self-destruct-message':
                await this.handleSelfDestructMessage(peerId, data);
                break;
                
            case 'destroy-command':
                await this.handleDestroyCommand(peerId, data);
                break;
                
            default:
                console.warn('未知消息类型:', data.type);
        }
    }

    // 处理身份信息
    async handleIdentity(peerId, data) {
        console.log('收到身份信息来自:', peerId, data);
        
        // 验证身份签名
        const isValid = this.verifyIdentity(
            {
                peerId: data.peerId,
                did: data.did,
                publicKey: data.publicKey,
                timestamp: data.timestamp
            },
            data.signature,
            data.publicKey
        );

        if (!isValid) {
            console.error('身份信息验证失败:', peerId);
            return;
        }

        // 保存或更新联系人信息
        const contact = {
            peerId: data.peerId,
            did: data.did,
            publicKey: data.publicKey,
            connected: true,
            lastSeen: Date.now(),
            identityVerified: true
        };

        await this.storage.saveContact(contact);
        
        // 标记身份交换完成
        const pendingRequest = this.pendingIdentityRequests.get(peerId);
        if (pendingRequest) {
            pendingRequest.resolved = true;
            this.pendingIdentityRequests.set(peerId, pendingRequest);
        }

        // 发送身份确认
        await this.sendIdentityAck(peerId);
        
        // 通知应用层
        this.emit('contact-identity-ready', contact);
        this.emit('contact-connected', contact);
        
        console.log('身份交换完成:', peerId);
    }

    // 发送身份确认
    async sendIdentityAck(peerId) {
        const ackMsg = {
            type: 'identity-ack',
            peerId: this.currentIdentity.peerId,
            timestamp: Date.now()
        };
        
        await this.send(peerId, ackMsg);
    }

    // 处理身份确认
    async handleIdentityAck(peerId, data) {
        console.log('收到身份确认来自:', peerId);
        
        // 更新联系人状态
        const contact = await this.storage.getContact(peerId);
        if (contact) {
            contact.identityVerified = true;
            await this.storage.saveContact(contact);
            
            // 通知应用层
            this.emit('contact-identity-ready', contact);
        }
    }

    // 处理聊天消息
    async handleChatMessage(peerId, data) {
        const contact = await this.storage.getContact(peerId);
        if (!contact || !contact.publicKey) {
            console.error('收到消息但联系人公钥不存在:', peerId);
            // 请求重新发送身份信息
            const conn = this.connections.get(peerId);
            if (conn) {
                await this.sendIdentity(conn);
            }
            return;
        }

        const decrypted = this.crypto.decryptMessage(data, contact.publicKey);
        if (!decrypted) {
            console.error('消息解密失败');
            return;
        }

        const message = {
            contactPeerId: peerId,
            content: decrypted,
            direction: 'received',
            timestamp: data.timestamp,
            encrypted: data
        };

        await this.storage.saveMessage(message);
        this.emit('message-received', { contact, message });
    }

    // 处理自毁消息
    async handleSelfDestructMessage(peerId, data) {
        const contact = await this.storage.getContact(peerId);
        if (!contact) {
            console.error('收到自毁消息但联系人不存在:', peerId);
            return;
        }

        const message = {
            id: data.messageId,
            contactPeerId: peerId,
            content: '自毁消息 (点击解密)',
            direction: 'received',
            timestamp: data.timestamp,
            isSelfDestruct: true,
            selfDestructData: data
        };

        await this.storage.saveMessage(message);
        this.emit('message-received', { 
            contact: contact, 
            message 
        });
    }

    // 处理销毁命令
    async handleDestroyCommand(peerId, data) {
        console.log('收到销毁命令来自:', peerId);
        
        // 立即销毁与该用户相关的所有数据
        await this.storage.destroyContactData(peerId);
        
        // 通知UI更新
        this.emit('data-destroyed', peerId);
        
        // 发送确认
        this.send(peerId, {
            type: 'destroy-ack',
            target: peerId,
            timestamp: Date.now()
        });
    }

    // 发送消息
    async send(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            conn.send(data);
            return true;
        }
        return false;
    }

    // 检查联系人身份是否就绪
    async isContactReady(peerId) {
        const contact = await this.storage.getContact(peerId);
        return contact && contact.publicKey && contact.identityVerified;
    }

    // 等待联系人身份就绪
    async waitForContactReady(peerId, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkReady = async () => {
                if (await this.isContactReady(peerId)) {
                    resolve(true);
                    return;
                }
                
                if (Date.now() - startTime > timeout) {
                    reject(new Error('等待身份交换超时'));
                    return;
                }
                
                setTimeout(checkReady, 500);
            };
            
            checkReady();
        });
    }

    // 发送聊天消息
    async sendMessage(peerId, message, selfDestruct = false, ttlHours = 24) {
        // 等待身份交换完成
        try {
            await this.waitForContactReady(peerId);
        } catch (error) {
            throw new Error(`联系人身份未就绪: ${error.message}`);
        }

        const contact = await this.storage.getContact(peerId);
        if (!contact || !contact.publicKey) {
            throw new Error('联系人公钥不存在');
        }

        let messageData;
        
        if (selfDestruct) {
            const selfDestructKey = this.crypto.generateSelfDestructKey();
            const encrypted = this.crypto.encryptWithSelfDestructKey(message, selfDestructKey);
            
            messageData = {
                type: 'self-destruct-message',
                messageId: 'sd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                encrypted: encrypted.encrypted,
                nonce: encrypted.nonce,
                selfDestructKey: selfDestructKey,
                ttlHours: ttlHours,
                timestamp: Date.now()
            };

            await this.storage.saveSelfDestructMessage(
                messageData.messageId, 
                messageData, 
                ttlHours
            );
        } else {
            messageData = {
                type: 'message',
                ...this.crypto.encryptMessage(message, contact.publicKey)
            };
        }

        const sent = await this.send(peerId, messageData);
        
        if (sent && !selfDestruct) {
            const localMessage = {
                contactPeerId: peerId,
                content: message,
                direction: 'sent',
                timestamp: messageData.timestamp
            };
            
            await this.storage.saveMessage(localMessage);
            this.emit('message-sent', { contact, message: localMessage });
        }

        return sent;
    }

    // 发送销毁命令
    async sendDestroyCommand(peerId) {
        const destroyCmd = {
            type: 'destroy-command',
            issuer: this.peer.id,
            target: peerId,
            timestamp: Date.now(),
            scope: 'all'
        };

        return await this.send(peerId, destroyCmd);
    }

    // 事件系统
    on(event, handler) {
        if (!this.messageHandlers.has(event)) {
            this.messageHandlers.set(event, []);
        }
        this.messageHandlers.get(event).push(handler);
    }

    emit(event, data) {
        const handlers = this.messageHandlers.get(event) || [];
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                console.error(`事件处理错误 (${event}):`, error);
            }
        });
    }

    // 销毁清理
    destroy() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        this.pendingIdentityRequests.clear();
        this.messageHandlers.clear();
        
        if (this.peer) {
            this.peer.destroy();
        }
        
        this.crypto.secureWipe();
        this.initialized = false;
    }

    // 获取网络状态
    getStatus() {
        return {
            initialized: this.initialized,
            peerId: this.peer ? this.peer.id : null,
            connections: this.connections.size,
            pendingIdentityRequests: this.pendingIdentityRequests.size
        };
    }
}
