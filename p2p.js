class P2PNetwork {
    constructor() {
        this.peer = null;
        this.connections = new Map();
        this.messageHandlers = new Map();
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.pendingIdentityRequests = new Map();
        this.currentIdentity = null;
    }

    async init(identity) {
        await this.storage.init();
        
        this.crypto.currentUser = identity;
        this.currentIdentity = identity;
        
        const peerId = identity.peerId;
        
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
                if (error.type === 'unavailable-id') {
                    this.handleUnavailableId(identity).then(resolve).catch(reject);
                } else {
                    reject(error);
                }
            });
        });
    }

    async handleUnavailableId(identity) {
        console.log('ID被占用，生成新的身份...');
        const newIdentity = this.crypto.generateIdentity();
        await this.storage.saveIdentity(newIdentity);
        return this.init(newIdentity);
    }

    setupConnectionHandlers() {
        this.peer.on('connection', (conn) => {
            console.log('收到连接请求:', conn.peer);
            
            conn.on('open', async () => {
                this.connections.set(conn.peer, conn);
                this.setupMessageHandler(conn);
                await this.sendIdentity(conn);
                
                this.pendingIdentityRequests.set(conn.peer, {
                    conn: conn,
                    timestamp: Date.now(),
                    resolved: false
                });
            });

            conn.on('close', () => {
                this.connections.delete(conn.peer);
                this.pendingIdentityRequests.delete(conn.peer);
            });

            conn.on('error', (error) => {
                console.error('连接错误:', error);
            });
        });
    }

    async connectToPeer(peerId) {
        if (this.connections.has(peerId)) {
            console.log('已经连接到该用户');
            return this.connections.get(peerId);
        }

        const existingContact = await this.storage.get('contacts', peerId);
        if (existingContact && existingContact.publicKey) {
            console.log('联系人信息已存在，直接使用');
        }

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
                await this.sendIdentity(conn);
                
                this.pendingIdentityRequests.set(peerId, {
                    conn: conn,
                    timestamp: Date.now(),
                    resolved: false
                });
                
                resolve(conn);
            });

            conn.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            conn.on('close', () => {
                clearTimeout(timeout);
                this.connections.delete(peerId);
                this.pendingIdentityRequests.delete(peerId);
            });
        });
    }

    setupMessageHandler(conn) {
        conn.on('data', async (data) => {
            try {
                await this.handleMessage(conn.peer, data);
            } catch (error) {
                console.error('消息处理错误:', error);
            }
        });
    }

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

    async handleIdentity(peerId, data) {
        console.log('收到身份信息来自:', peerId, data);
        
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

        const contact = {
            peerId: data.peerId,
            did: data.did,
            publicKey: data.publicKey,
            connected: true,
            lastSeen: Date.now(),
            identityVerified: true
        };

        await this.storage.saveContact(contact);
        
        const pendingRequest = this.pendingIdentityRequests.get(peerId);
        if (pendingRequest) {
            pendingRequest.resolved = true;
            this.pendingIdentityRequests.set(peerId, pendingRequest);
        }

        await this.sendIdentityAck(peerId);
        
        this.emit('contact-identity-ready', contact);
        this.emit('contact-connected', contact);
        
        console.log('身份交换完成:', peerId);
    }

    async sendIdentityAck(peerId) {
        const ackMsg = {
            type: 'identity-ack',
            peerId: this.currentIdentity.peerId,
            timestamp: Date.now()
        };
        
        await this.send(peerId, ackMsg);
    }

    async handleIdentityAck(peerId, data) {
        console.log('收到身份确认来自:', peerId);
        
        const contact = await this.storage.get('contacts', peerId);
        if (contact) {
            contact.identityVerified = true;
            await this.storage.saveContact(contact);
            this.emit('contact-identity-ready', contact);
        }
    }

    async isContactReady(peerId) {
        const contact = await this.storage.get('contacts', peerId);
        return contact && contact.publicKey && contact.identityVerified;
    }

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

    async send(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            conn.send(data);
            return true;
        }
        return false;
    }

    async sendMessage(peerId, message, selfDestruct = false, ttlHours = 24) {
        try {
            await this.waitForContactReady(peerId);
        } catch (error) {
            throw new Error(`联系人身份未就绪: ${error.message}`);
        }

        const contact = await this.storage.get('contacts', peerId);
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

    async handleChatMessage(peerId, data) {
        const contact = await this.storage.get('contacts', peerId);
        if (!contact || !contact.publicKey) {
            console.error('收到消息但联系人公钥不存在:', peerId);
            await this.sendIdentity(this.connections.get(peerId));
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

    async handleSelfDestructMessage(peerId, data) {
        const contact = await this.storage.get('contacts', peerId);
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
            contact: { peerId: peerId }, 
            message 
        });
    }

    async handleDestroyCommand(peerId, data) {
        console.log('收到销毁命令来自:', peerId);
        
        await this.storage.destroyContactData(peerId);
        
        this.emit('data-destroyed', peerId);
        
        await this.send(peerId, {
            type: 'destroy-ack',
            target: peerId,
            timestamp: Date.now()
        });
    }

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

    destroy() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        
        if (this.peer) {
            this.peer.destroy();
        }
        
        this.crypto.secureWipe();
    }
}
