class P2PNetwork {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // did -> connection
        this.messageHandlers = new Map();
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
    }

    // 初始化P2P网络
    async init(identity) {
        await this.storage.init();
        
        this.peer = new Peer(identity.did, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:0.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' }
                ]
            }
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                console.log('P2P连接建立，ID:', id);
                this.setupConnectionHandlers();
                resolve(id);
            });

            this.peer.on('error', (error) => {
                console.error('P2P错误:', error);
                reject(error);
            });
        });
    }

    // 设置连接处理器
    setupConnectionHandlers() {
        this.peer.on('connection', (conn) => {
            console.log('收到连接请求:', conn.peer);
            
            conn.on('open', () => {
                this.connections.set(conn.peer, conn);
                this.setupMessageHandler(conn);
            });

            conn.on('close', () => {
                this.connections.delete(conn.peer);
            });

            conn.on('error', (error) => {
                console.error('连接错误:', error);
            });
        });
    }

    // 连接到其他用户
    connectToPeer(peerDid) {
        if (this.connections.has(peerDid)) {
            console.log('已经连接到该用户');
            return this.connections.get(peerDid);
        }

        const conn = this.peer.connect(peerDid, {
            reliable: true,
            serialization: 'json'
        });

        conn.on('open', () => {
            this.connections.set(peerDid, conn);
            this.setupMessageHandler(conn);
            
            // 发送身份验证
            this.sendIdentity(conn);
        });

        conn.on('close', () => {
            this.connections.delete(peerDid);
        });

        return conn;
    }

    // 发送身份信息
    sendIdentity(conn) {
        const identityMsg = {
            type: 'identity',
            publicKey: this.crypto.getPublicKey(),
            timestamp: Date.now()
        };
        
        conn.send(identityMsg);
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

    // 处理接收到的消息
    async handleMessage(peerDid, data) {
        switch (data.type) {
            case 'identity':
                await this.handleIdentity(peerDid, data);
                break;
                
            case 'message':
                await this.handleChatMessage(peerDid, data);
                break;
                
            case 'self-destruct-message':
                await this.handleSelfDestructMessage(peerDid, data);
                break;
                
            case 'destroy-command':
                await this.handleDestroyCommand(peerDid, data);
                break;
                
            default:
                console.warn('未知消息类型:', data.type);
        }
    }

    // 处理身份消息
    async handleIdentity(peerDid, data) {
        // 验证并保存联系人
        const contact = {
            did: peerDid,
            publicKey: data.publicKey,
            connected: true,
            lastSeen: Date.now()
        };
        
        await this.storage.saveContact(contact);
        this.emit('contact-connected', contact);
    }

    // 处理聊天消息
    async handleChatMessage(peerDid, data) {
        const contact = await this.storage.get('contacts', peerDid);
        if (!contact) {
            console.warn('收到未知联系人的消息');
            return;
        }

        // 解密消息
        const decrypted = this.crypto.decryptMessage(data, contact.publicKey);
        if (!decrypted) {
            console.error('消息解密失败');
            return;
        }

        // 保存消息
        const message = {
            contactDid: peerDid,
            content: decrypted,
            direction: 'received',
            timestamp: data.timestamp,
            encrypted: data
        };

        await this.storage.saveMessage(message);
        this.emit('message-received', { contact, message });
    }

    // 处理自毁消息
    async handleSelfDestructMessage(peerDid, data) {
        const message = {
            id: data.messageId,
            contactDid: peerDid,
            content: '自毁消息 (点击解密)',
            direction: 'received',
            timestamp: data.timestamp,
            isSelfDestruct: true,
            selfDestructData: data
        };

        await this.storage.saveMessage(message);
        this.emit('message-received', { 
            contact: { did: peerDid }, 
            message 
        });
    }

    // 处理销毁命令
    async handleDestroyCommand(peerDid, data) {
        console.log('收到销毁命令来自:', peerDid);
        
        // 立即销毁与该用户相关的所有数据
        await this.storage.destroyContactData(peerDid);
        
        // 通知UI更新
        this.emit('data-destroyed', peerDid);
        
        // 发送确认
        this.send(peerDid, {
            type: 'destroy-ack',
            target: peerDid,
            timestamp: Date.now()
        });
    }

    // 发送消息
    async send(peerDid, data) {
        const conn = this.connections.get(peerDid);
        if (conn && conn.open) {
            conn.send(data);
            return true;
        }
        return false;
    }

    // 发送聊天消息
    async sendMessage(peerDid, message, selfDestruct = false, ttlHours = 24) {
        const contact = await this.storage.get('contacts', peerDid);
        if (!contact) {
            throw new Error('联系人不存在');
        }

        let messageData;
        
        if (selfDestruct) {
            // 自毁消息
            const selfDestructKey = this.crypto.generateSelfDestructKey();
            const encrypted = this.crypto.encryptWithSelfDestructKey(message, selfDestructKey);
            
            messageData = {
                type: 'self-destruct-message',
                messageId: 'sd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                encrypted: encrypted.encrypted,
                nonce: encrypted.nonce,
                selfDestructKey: selfDestructKey, // 注意：这应该用接收方的公钥加密
                ttlHours: ttlHours,
                timestamp: Date.now()
            };

            // 保存自毁消息元数据
            await this.storage.saveSelfDestructMessage(
                messageData.messageId, 
                messageData, 
                ttlHours
            );
        } else {
            // 普通加密消息
            messageData = {
                type: 'message',
                ...this.crypto.encryptMessage(message, contact.publicKey)
            };
        }

        // 发送消息
        const sent = await this.send(peerDid, messageData);
        
        if (sent && !selfDestruct) {
            // 保存发送的消息记录
            const localMessage = {
                contactDid: peerDid,
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
    async sendDestroyCommand(peerDid) {
        const destroyCmd = {
            type: 'destroy-command',
            issuer: this.peer.id,
            target: peerDid,
            timestamp: Date.now(),
            scope: 'all'
        };

        return await this.send(peerDid, destroyCmd);
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
        handlers.forEach(handler => handler(data));
    }

    // 销毁清理
    destroy() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        
        if (this.peer) {
            this.peer.destroy();
        }
        
        this.crypto.secureWipe();
    }
}