class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.sharedSecrets = new Map();
        this.currentUser = null;
    }

    // 生成身份密钥对 - 修复版本
    generateIdentity() {
        // 使用 TweetNaCl 生成密钥对
        this.keyPair = nacl.box.keyPair();
        
        // 生成符合 PeerJS 要求的 ID 格式
        const peerId = this.generatePeerId(this.keyPair.publicKey);
        
        // 生成显示用的 DID
        const did = this.generateDisplayDID(this.keyPair.publicKey);
        
        const identity = {
            publicKey: nacl.util.encodeBase64(this.keyPair.publicKey),
            privateKey: nacl.util.encodeBase64(this.keyPair.secretKey),
            did: did,
            peerId: peerId
        };
        
        this.currentUser = identity;
        return identity;
    }

    // 生成符合 PeerJS 要求的 ID
    generatePeerId(publicKey) {
        // 取公钥的前16字节
        const keyBytes = publicKey.slice(0, 16);
        let base64 = nacl.util.encodeBase64(keyBytes);
        
        // 替换 PeerJS 不允许的字符
        base64 = base64
            .replace(/\+/g, '-')  // + -> -
            .replace(/\//g, '_')  // / -> _
            .replace(/=/g, '');   // 移除 =
        
        // 确保以字母开头（PeerJS 要求）
        if (!/^[a-zA-Z]/.test(base64)) {
            base64 = 'user' + base64;  // 添加前缀
        }
        
        // 限制长度在 64 字符以内
        return base64.substring(0, 63);
    }

    // 生成显示用的 DID（仅用于显示）
    generateDisplayDID(publicKey) {
        const keyBytes = publicKey.slice(0, 8); // 只取前8字节用于显示
        const hash = nacl.util.encodeBase64(keyBytes)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        return `did:peer:1:${hash.substring(0, 12)}`;
    }

    // 获取公钥
    getPublicKey() {
        return this.keyPair ? nacl.util.encodeBase64(this.keyPair.publicKey) : null;
    }

    // 计算共享密钥
    computeSharedSecret(theirPublicKeyBase64) {
        const theirPublicKey = nacl.util.decodeBase64(theirPublicKeyBase64);
        const sharedSecret = nacl.box.before(theirPublicKey, this.keyPair.secretKey);
        return nacl.util.encodeBase64(sharedSecret);
    }

    // 加密消息
    encryptMessage(message, recipientPublicKey) {
        const sharedSecret = this.computeSharedSecret(recipientPublicKey);
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const messageBytes = nacl.util.decodeUTF8(message);
        
        const encrypted = nacl.box.after(messageBytes, nonce, nacl.util.decodeBase64(sharedSecret));
        return {
            encrypted: nacl.util.encodeBase64(encrypted),
            nonce: nacl.util.encodeBase64(nonce),
            timestamp: Date.now()
        };
    }

    // 解密消息
    decryptMessage(encryptedData, senderPublicKey) {
        try {
            const sharedSecret = this.computeSharedSecret(senderPublicKey);
            const nonce = nacl.util.decodeBase64(encryptedData.nonce);
            const encrypted = nacl.util.decodeBase64(encryptedData.encrypted);
            
            const decrypted = nacl.box.open.after(encrypted, nonce, nacl.util.decodeBase64(sharedSecret));
            if (!decrypted) {
                throw new Error('解密失败');
            }
            
            return nacl.util.encodeUTF8(decrypted);
        } catch (error) {
            console.error('解密错误:', error);
            return null;
        }
    }

    // 生成自毁消息密钥
    generateSelfDestructKey() {
        return nacl.util.encodeBase64(nacl.randomBytes(32));
    }

    // 用自毁密钥加密
    encryptWithSelfDestructKey(message, selfDestructKey) {
        const key = nacl.util.decodeBase64(selfDestructKey);
        const nonce = nacl.randomBytes(24);
        const messageBytes = nacl.util.decodeUTF8(message);
        
        const encrypted = nacl.secretbox(messageBytes, nonce, key);
        return {
            encrypted: nacl.util.encodeBase64(encrypted),
            nonce: nacl.util.encodeBase64(nonce),
            type: 'self-destruct'
        };
    }

    // 用自毁密钥解密
    decryptWithSelfDestructKey(encryptedData, selfDestructKey) {
        try {
            const key = nacl.util.decodeBase64(selfDestructKey);
            const nonce = nacl.util.decodeBase64(encryptedData.nonce);
            const encrypted = nacl.util.decodeBase64(encryptedData.encrypted);
            
            const decrypted = nacl.secretbox.open(encrypted, nonce, key);
            if (!decrypted) {
                throw new Error('自毁消息解密失败');
            }
            
            return nacl.util.encodeUTF8(decrypted);
        } catch (error) {
            console.error('自毁消息解密错误:', error);
            return null;
        }
    }

    // 签名消息（可选功能）
    signMessage(message) {
        if (!this.keyPair) {
            throw new Error('没有可用的密钥对');
        }
        
        const messageBytes = nacl.util.decodeUTF8(message);
        const signature = nacl.sign.detached(messageBytes, this.keyPair.secretKey);
        return nacl.util.encodeBase64(signature);
    }

    // 验证签名（可选功能）
    verifySignature(message, signature, publicKey) {
        try {
            const messageBytes = nacl.util.decodeUTF8(message);
            const signatureBytes = nacl.util.decodeBase64(signature);
            const publicKeyBytes = nacl.util.decodeBase64(publicKey);
            
            return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
        } catch (error) {
            console.error('验证签名错误:', error);
            return false;
        }
    }

    // 安全擦除内存中的密钥
    secureWipe() {
        if (this.keyPair) {
            // 覆盖密钥内存区域
            try {
                // 对于 Uint8Array，我们可以填充零来覆盖
                this.keyPair.secretKey.fill(0);
                this.keyPair.publicKey.fill(0);
            } catch (e) {
                console.warn('安全擦除时出错:', e);
            }
        }
        this.keyPair = null;
        this.sharedSecrets.clear();
        this.currentUser = null;
    }

    // 从存储的数据加载身份
    loadIdentity(identityData) {
        if (!identityData || !identityData.privateKey) {
            throw new Error('无效的身份数据');
        }

        try {
            const privateKey = nacl.util.decodeBase64(identityData.privateKey);
            const publicKey = nacl.util.decodeBase64(identityData.publicKey);
            
            this.keyPair = {
                secretKey: privateKey,
                publicKey: publicKey
            };
            
            this.currentUser = identityData;
            return true;
        } catch (error) {
            console.error('加载身份失败:', error);
            return false;
        }
    }

    // 检查是否已初始化
    isInitialized() {
        return this.keyPair !== null && this.currentUser !== null;
    }

    // 获取当前用户信息
    getCurrentUser() {
        return this.currentUser;
    }

    // 导出密钥（用于备份，要小心！）
    exportKeys() {
        if (!this.isInitialized()) {
            throw new Error('身份未初始化');
        }
        
        return {
            publicKey: this.currentUser.publicKey,
            privateKey: this.currentUser.privateKey,
            did: this.currentUser.did,
            peerId: this.currentUser.peerId
        };
    }
}

// 如果你在浏览器控制台看到 "nacl is not defined" 错误，
// 请确保在 crypto.js 之前加载了 TweetNaCl 库
