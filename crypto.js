class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.sharedSecrets = new Map(); // contactId -> shared secret
    }

    // 生成身份密钥对
    generateIdentity() {
        this.keyPair = nacl.box.keyPair();
        return {
            publicKey: nacl.util.encodeBase64(this.keyPair.publicKey),
            privateKey: nacl.util.encodeBase64(this.keyPair.secretKey),
            did: this.generateDID(this.keyPair.publicKey)
        };
    }

    // 生成DID
    generateDID(publicKey) {
        const hash = nacl.util.encodeBase64(publicKey.slice(0, 16));
        return `did:peer:1:${hash}`;
    }

    // 导出公钥（安全）
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
            if (!decrypted) throw new Error('解密失败');
            
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
            if (!decrypted) throw new Error('自毁消息解密失败');
            
            return nacl.util.encodeUTF8(decrypted);
        } catch (error) {
            return null;
        }
    }

    // 安全擦除内存中的密钥
    secureWipe() {
        if (this.keyPair) {
            // 覆盖密钥内存
            nacl.memzero(this.keyPair.secretKey);
            nacl.memzero(this.keyPair.publicKey);
        }
        this.keyPair = null;
        this.sharedSecrets.clear();
    }
}