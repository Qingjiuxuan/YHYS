class P2PNetwork {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> connection
        this.messageHandlers = new Map();
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.currentUser = null;
    }

    // 初始化P2P网络
    async init(identity) {
        await this.storage.init();
        this.currentUser = identity;
        
        // 使用 peerId 而不是 did 来初始化 PeerJS
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
            debug: 0 // 减少日志输出
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                console.log('✅ P2P连接建立成功，ID:', id);
                this.setupConnectionHandlers();
                resolve(id);
            });

            this.peer.on('error', (error) => {
                console.error('❌ P2P错误:', error);
                
                // 如果是ID冲突，生成新的ID重试
                if (error.type === 'unavailable-id') {
                    console.log('ID被占用，正在生成新身份...');
                    this.handleUnavailableId().then(resolve).catch(reject);
                } else {
                    reject(error);
                }
            });
        });
    }

    // 处理ID不可用的情况
    async handleUnavailableId() {
        // 生成新的身份
        const newIdentity = this.crypto.generateIdentity();
        await this.storage.saveIdentity(newIdentity);
        this.currentUser = newIdentity;
        
        console.log('新身份生成:', newIdentity.peerId);
        
        // 重新初始化
        return this.init(newIdentity);
    }

    // 设置连接处理器
    setupConnectionHandlers() {
        this.peer.on('connection', (conn) => {
            console.log('🔗 收到连接请求:', conn.peer);
            
            conn.on('open', () => {
                console.log('✅ 连接已建立:', conn.peer);
                this.connections.set(conn.peer, conn);
                this.setupMessageHandler(conn);
                
                // 发送身份验证信息
                this.sendIdentity(conn);
            });

            conn.on('close', () => {
                console.log('❌ 连接关闭:', conn.peer);
                this.connections.delete(conn.peer);
                this.updateContactStatus(conn.peer, false);
            });

            conn.on('error', (error) => {
                console.error('连接错误:', error);
            });
        });
    }

    // 更新联系人状态
    async updateContactStatus(peerId, connected) {
        try {
            const contact = await this.storage.get('contacts', peerId);
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
    connectToPeer(peerId) {
        if (this.connections.has(peerId)) {
            console.log('已经连接到该用户');
            return this.connections.get(peerId);
        }

        console.log('正在连接到:', peerId);

        const conn = this.peer.connect(peerId, {
            reliable: true,
            serialization: 'json'
        });

        conn.on('open', () => {
            console.log('✅ 连接成功:', peerId);
            this.connections.set(peerId, conn);
            this.setupMessageHandler(conn);
            this.updateContactStatus(peerId, true);
            
            // 发送身份验证信息
            this.sendIdentity(conn);
        });

        conn.on('close', () => {
            console.log('❌ 连接断开:', peerId);
            this.connections.delete(peerId);
            this.updateContactStatus(peerId, false);
        });

        conn.on('error', (error) => {
            console.error('连接错误:', error);
        });

        return conn;
    }

    // 发送身份信息
    sendIdentity(conn) {
        if (!this.currentUser) {
            console.error('没有用户身份信息');
            return;
        }

        const identityMsg = {
            type: 'identity',
            did: this.currentUser.did,
            peerId: this.currentUser.peerId,
            publicKey: this.currentUser.publicKey,
            timestamp: Date.now()
        };
        
        console.log('发送身份信息:', identityMsg);
        conn.send(identityMsg);
    }

    // 设置消息处理器
    setupMessageHandler(conn) {
        conn.on('data', async (data) => {
            try {
                console.log('收到消息:', data.type, '来自:', conn.peer);
                await this.handleMessage(conn.peer, data);
            } catch (error) {
                console.error('消息处理错误:', error);
            }
        });
    }

    // 处理接收到的消息
    async handleMessage(peerId, data) {
        switch (data.type) {
            case 'identity':
                await this.handleIdentity(peerId, data);
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

            case 'destroy-ack':
                await this.handleDestroyAck(peerId, data);
                break;
                
            default:
                console.warn('未知消息类型:', data.type);
        }
    }

    // 处理身份消息
    async handleIdentity(peerId, data) {
        console.log('处理身份消息:', data);

        // 验证并保存联系人
        const contact = {
            peerId: peerId,
            did: data.did,
            publicKey: data.publicKey,
            connected: true,
            lastSeen: Date.now()
        };
        
        await this.storage.saveContact(contact);
        this.updateContactStatus(peerId, true);
        this.emit('contact-connected', contact);
    }

    // 处理聊天消息
    async handleChatMessage(peerId, data) {
        console.log('处理聊天消息:', data);

        const contact = await this.storage.get('contacts', peerId);
        if (!contact) {
            console.warn('收到未知联系人的消息，正在获取身份...');
            // 请求身份信息
            this.sendIdentity(this.connections.get(peerId));
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
        console.log('处理自毁消息:', data);

        const contact = await this.storage.get('contacts', peerId);
        if (!contact) {
            console.warn('收到未知联系人的自毁消息');
            return;
        }

        const message = {
            id: data.messageId,
            contactPeerId: peerId,
            content: '💣 自毁消息 (已加密)',
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

    // 处理销毁确认
    async handleDestroyAck(peerId, data) {
        console.log('收到销毁确认来自:', peerId);
        this.emit('destroy-acknowledged', peerId);
    }

    // 发送消息
    async send(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            try {
                conn.send(data);
                console.log('消息发送成功:', data.type, '到:', peerId);
                return true;
            } catch (error) {
                console.error('发送消息失败:', error);
                return false;
            }
        } else {
            console.warn('连接不存在或未打开:', peerId);
            return false;
        }
    }

    // 发送聊天消息
    async sendMessage(peerId, message, selfDestruct = false, ttlHours = 24) {
        const contact = await this.storage.get('contacts', peerId);
        if (!contact) {
            throw new Error('联系人不存在，请先添加联系人');
        }

        if (!contact.publicKey) {
            throw new Error('联系人公钥不存在，请等待身份交换完成');
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
                selfDestructKey: selfDestructKey,
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
        const sent = await this.send(peerId, messageData);
        
        if (sent && !selfDestruct) {
            // 保存发送的消息记录
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
            issuer: this.currentUser.peerId,
            target: peerId,
            timestamp: Date.now(),
            scope: 'all'
        };

        console.log('发送销毁命令到:', peerId);
        return await this.send(peerId, destroyCmd);
    }

    // 检查连接状态
    isConnected(peerId) {
        const conn = this.connections.get(peerId);
        return conn && conn.open;
    }

    // 获取所有连接的peer
    getConnectedPeers() {
        return Array.from(this.connections.keys());
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
                console.error('事件处理错误:', error);
            }
        });
    }

    // 销毁清理
    destroy() {
        console.log('正在销毁P2P网络...');
        
        // 关闭所有连接
        this.connections.forEach(conn => {
            try {
                conn.close();
            } catch (error) {
                console.error('关闭连接时出错:', error);
            }
        });
        this.connections.clear();
        
        // 销毁Peer实例
        if (this.peer) {
            this.peer.destroy();
        }
        
        // 清理加密数据
        this.crypto.secureWipe();
        
        console.log('P2P网络已销毁');
    }
}
