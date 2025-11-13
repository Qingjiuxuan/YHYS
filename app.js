class P2PChatApp {
    constructor() {
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.network = new P2PNetwork();
        this.currentUser = null;
        this.activeContact = null;
        
        this.init();
    }

    async init() {
        // 初始化存储
        try {
            await this.storage.init();
        } catch (error) {
            console.error('存储初始化失败:', error);
            this.showNotification('存储初始化失败，请检查浏览器设置');
            return;
        }
        
        // 检查现有身份
        const existingIdentity = await this.storage.getIdentity();
        if (existingIdentity) {
            this.currentUser = existingIdentity;
            this.crypto.currentUser = existingIdentity;
            this.showChatInterface();
            try {
                await this.network.init(existingIdentity);
                this.showNotification('网络连接已建立');
            } catch (error) {
                console.error('网络初始化失败:', error);
                this.showNotification('网络连接失败，但可以离线使用');
            }
        } else {
            this.showIdentitySetup();
        }

        this.setupEventListeners();
        this.setupNetworkHandlers();
        
        // 定期清理过期消息
        setInterval(() => {
            this.storage.cleanupExpiredMessages();
        }, 60000); // 每分钟检查一次
    }

    setupEventListeners() {
        // 身份生成
        document.getElementById('generate-identity').addEventListener('click', () => {
            this.generateIdentity();
        });

        // 开始聊天
        document.getElementById('start-chat').addEventListener('click', () => {
            this.showChatInterface();
        });

        // 添加联系人
        document.getElementById('add-contact').addEventListener('click', () => {
            this.addContact();
        });

        // 发送消息
        document.getElementById('send-message').addEventListener('click', () => {
            this.sendMessage();
        });

        // 回车发送消息
        document.getElementById('message-text').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 销毁所有数据
        document.getElementById('destroy-all').addEventListener('click', () => {
            this.destroyAllData();
        });
    }

    setupNetworkHandlers() {
        // 消息接收处理
        this.network.on('message-received', (data) => {
            this.displayMessage(data.message, data.contact);
            this.updateContactsList();
        });

        // 数据销毁处理
        this.network.on('data-destroyed', (peerId) => {
            this.removeContactFromUI(peerId);
            this.showNotification(`来自 ${peerId} 的数据已被销毁`);
        });

        // 联系人连接
        this.network.on('contact-connected', (contact) => {
            this.showNotification(`${contact.did || contact.peerId} 已连接`);
            this.updateContactsList();
        });

        // 消息发送成功
        this.network.on('message-sent', (data) => {
            this.displayMessage(data.message, data.contact);
            this.updateContactsList();
        });
    }

    // 生成新身份
    async generateIdentity() {
        try {
            const identity = this.crypto.generateIdentity();
            this.currentUser = identity;
            this.crypto.currentUser = identity;
            
            await this.storage.saveIdentity(identity);
            
            // 显示身份信息
            document.getElementById('user-did').textContent = identity.did;
            document.getElementById('identity-display').classList.remove('hidden');
            
            // 初始化网络
            try {
                await this.network.init(identity);
                this.showNotification('身份创建成功！网络已连接');
            } catch (error) {
                console.error('网络初始化失败:', error);
                this.showNotification('身份创建成功！但网络连接失败，可以离线使用');
            }
        } catch (error) {
            console.error('身份生成失败:', error);
            this.showNotification('身份创建失败: ' + error.message);
        }
    }

    // 显示身份设置界面
    showIdentitySetup() {
        document.getElementById('identity-setup').classList.add('active');
        document.getElementById('chat-interface').classList.remove('active');
    }

    // 显示聊天界面
    showChatInterface() {
        document.getElementById('identity-setup').classList.remove('active');
        document.getElementById('chat-interface').classList.add('active');
        
        if (this.currentUser) {
            document.getElementById('current-user').textContent = this.currentUser.did;
        }
        this.loadContacts();
    }

    // 添加联系人
    async addContact() {
        const contactInput = document.getElementById('contact-id').value.trim();
        if (!contactInput) {
            this.showNotification('请输入联系人ID');
            return;
        }

        // 验证ID格式（基本检查）
        if (contactInput.length < 5 || contactInput.length > 63) {
            this.showNotification('ID长度应在5-63字符之间');
            return;
        }

        try {
            // 检查是否已存在该联系人
            const existingContacts = await this.storage.getContacts();
            const existingContact = existingContacts.find(c => c.peerId === contactInput);
            if (existingContact) {
                this.showNotification('该联系人已存在');
                return;
            }

            // 连接到对方
            const conn = this.network.connectToPeer(contactInput);
            
            // 临时联系人信息，实际信息将在身份交换后更新
            const contact = {
                peerId: contactInput,
                did: contactInput, // 临时，等待身份交换
                publicKey: null,
                connected: false,
                lastSeen: Date.now()
            };
            
            await this.storage.saveContact(contact);
            this.updateContactsList();
            document.getElementById('contact-id').value = '';
            
            this.showNotification(`已添加联系人: ${contactInput}`);
            
            // 自动选择新添加的联系人
            this.selectContact(contact);
            
        } catch (error) {
            console.error('添加联系人失败:', error);
            this.showNotification(`添加联系人失败: ${error.message}`);
        }
    }

    // 发送消息
    async sendMessage() {
        if (!this.activeContact) {
            this.showNotification('请先选择联系人');
            return;
        }

        const messageText = document.getElementById('message-text').value.trim();
        if (!messageText) {
            this.showNotification('请输入消息内容');
            return;
        }

        const selfDestruct = document.getElementById('self-destruct').checked;
        const ttlHours = parseInt(document.getElementById('ttl').value) || 24;

        try {
            const sent = await this.network.sendMessage(
                this.activeContact.peerId,
                messageText, 
                selfDestruct, 
                ttlHours
            );

            if (sent) {
                // 如果是普通消息，立即显示
                if (!selfDestruct) {
                    const message = {
                        contactPeerId: this.activeContact.peerId,
                        content: messageText,
                        direction: 'sent',
                        timestamp: Date.now()
                    };
                    
                    this.displayMessage(message, this.activeContact);
                    await this.storage.saveMessage(message);
                }

                // 清空输入框
                document.getElementById('message-text').value = '';
                this.showNotification('消息发送成功');
            } else {
                this.showNotification('消息发送失败，对方可能离线');
                
                // 即使发送失败，也在本地显示（带失败标记）
                const message = {
                    contactPeerId: this.activeContact.peerId,
                    content: messageText + ' (发送失败)',
                    direction: 'sent',
                    timestamp: Date.now(),
                    failed: true
                };
                
                this.displayMessage(message, this.activeContact);
                await this.storage.saveMessage(message);
            }
            
        } catch (error) {
            console.error('发送消息失败:', error);
            this.showNotification(`发送失败: ${error.message}`);
        }
    }

    // 显示消息
    displayMessage(message, contact) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        
        let messageClass = `message ${message.direction}`;
        if (message.isSelfDestruct) {
            messageClass += ' self-destruct';
        }
        if (message.failed) {
            messageClass += ' failed';
        }
        
        messageElement.className = messageClass;
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        let content = this.escapeHtml(message.content);
        
        if (message.isSelfDestruct) {
            content = '💣 ' + content;
        }
        if (message.failed) {
            content = '❌ ' + content;
        }
        
        messageElement.innerHTML = `
            <div class="message-content">${content}</div>
            <div class="message-time">${time}</div>
            ${message.isSelfDestruct ? '<div class="self-destruct-label">自毁消息</div>' : ''}
        `;
        
        // 如果是自毁消息，添加点击解密功能
        if (message.isSelfDestruct && message.selfDestructData) {
            messageElement.addEventListener('click', () => {
                this.decryptSelfDestructMessage(message, messageElement);
            });
            messageElement.style.cursor = 'pointer';
        }
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // 解密自毁消息
    async decryptSelfDestructMessage(message, messageElement) {
        try {
            const decrypted = this.crypto.decryptWithSelfDestructKey(
                message.selfDestructData, 
                message.selfDestructData.selfDestructKey
            );
            
            if (decrypted) {
                messageElement.querySelector('.message-content').textContent = decrypted;
                messageElement.classList.remove('self-destruct');
                messageElement.style.cursor = 'default';
                
                // 更新存储的消息
                message.content = decrypted;
                message.isSelfDestruct = false;
                await this.storage.saveMessage(message);
            } else {
                this.showNotification('解密失败，消息可能已过期');
            }
        } catch (error) {
            console.error('解密自毁消息失败:', error);
            this.showNotification('解密失败');
        }
    }

    // 加载联系人
    async loadContacts() {
        this.updateContactsList();
    }

    // 更新联系人列表UI
    async updateContactsList() {
        const contacts = await this.storage.getContacts();
        const contactsList = document.getElementById('contacts-list');
        
        contactsList.innerHTML = '';
        
        if (contacts.length === 0) {
            contactsList.innerHTML = '<div class="no-contacts">暂无联系人</div>';
            return;
        }
        
        contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = `contact-item ${
                this.activeContact && this.activeContact.peerId === contact.peerId ? 'active' : ''
            }`;
            
            // 显示 DID 或 PeerId
            const displayId = contact.did && contact.did !== contact.peerId ? contact.did : contact.peerId;
            const shortId = displayId.length > 20 ? displayId.substring(0, 20) + '...' : displayId;
            
            contactElement.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name" title="${displayId}">${shortId}</div>
                    <div class="contact-status ${contact.connected ? 'online' : 'offline'}">
                        ${contact.connected ? '🟢 在线' : '🔴 离线'}
                    </div>
                </div>
                <button class="destroy-contact" data-peerid="${contact.peerId}">🗑️</button>
            `;
            
            contactElement.addEventListener('click', () => {
                this.selectContact(contact);
            });
            
            // 销毁单个联系人数据
            const destroyBtn = contactElement.querySelector('.destroy-contact');
            destroyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.destroyContactData(contact.peerId);
            });
            
            contactsList.appendChild(contactElement);
        });
    }

    // 选择联系人
    async selectContact(contact) {
        this.activeContact = contact;
        this.updateContactsList();
        await this.loadMessages(contact.peerId);
        
        // 更新聊天区域标题
        const displayId = contact.did && contact.did !== contact.peerId ? contact.did : contact.peerId;
        this.showNotification(`已选择联系人: ${displayId}`);
    }

    // 加载消息
    async loadMessages(contactPeerId = null) {
        const peerId = contactPeerId || (this.activeContact ? this.activeContact.peerId : null);
        if (!peerId) return;

        try {
            const messages = await this.storage.getMessages(peerId);
            const messagesContainer = document.getElementById('chat-messages');
            
            messagesContainer.innerHTML = '';
            
            if (messages.length === 0) {
                messagesContainer.innerHTML = '<div class="no-messages">暂无消息，开始聊天吧！</div>';
                return;
            }
            
            messages.forEach(message => {
                this.displayMessage(message, { peerId });
            });
        } catch (error) {
            console.error('加载消息失败:', error);
            this.showNotification('加载消息失败');
        }
    }

    // 销毁所有数据
    async destroyAllData() {
        if (!confirm('⚠️ 这将永久销毁所有聊天数据，包括你的身份！此操作不可撤销。确定继续吗？')) {
            return;
        }

        try {
            // 向所有在线联系人发送销毁命令
            const contacts = await this.storage.getContacts();
            for (const contact of contacts) {
                if (contact.connected) {
                    try {
                        await this.network.sendDestroyCommand(contact.peerId);
                    } catch (error) {
                        console.error('发送销毁命令失败:', error);
                    }
                }
            }

            // 销毁本地所有数据
            await this.storage.destroyAllData();
            this.network.destroy();
            this.crypto.secureWipe();
            
            this.showNotification('所有数据已销毁，页面将重新加载');
            
            // 重新加载页面
            setTimeout(() => {
                location.reload();
            }, 2000);
            
        } catch (error) {
            console.error('销毁数据失败:', error);
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 销毁特定联系人数据
    async destroyContactData(contactPeerId) {
        const contact = await this.storage.get('contacts', contactPeerId);
        const displayName = contact ? (contact.did || contact.peerId) : contactPeerId;
        
        if (!confirm(`确定要销毁与 ${displayName} 的所有聊天数据吗？`)) {
            return;
        }

        try {
            // 发送销毁命令
            if (contact && contact.connected) {
                await this.network.sendDestroyCommand(contactPeerId);
            }
            
            // 销毁本地数据
            await this.storage.destroyContactData(contactPeerId);
            
            // 更新UI
            this.removeContactFromUI(contactPeerId);
            this.showNotification(`已销毁与 ${displayName} 的聊天数据`);
            
        } catch (error) {
            console.error('销毁联系人数据失败:', error);
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 从UI移除联系人
    removeContactFromUI(contactPeerId) {
        if (this.activeContact && this.activeContact.peerId === contactPeerId) {
            this.activeContact = null;
            document.getElementById('chat-messages').innerHTML = '<div class="no-messages">请选择联系人开始聊天</div>';
        }
        this.updateContactsList();
    }

    // 显示通知
    showNotification(message) {
        // 移除现有通知
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => {
            document.body.removeChild(notification);
        });

        // 创建新通知
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            z-index: 1000;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 3000);
    }

    // HTML转义
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    .no-contacts, .no-messages {
        text-align: center;
        padding: 40px 20px;
        color: #666;
        font-style: italic;
    }
    
    .contact-info {
        flex: 1;
    }
    
    .contact-name {
        font-weight: bold;
        margin-bottom: 5px;
    }
    
    .contact-status {
        font-size: 12px;
    }
    
    .contact-status.online {
        color: #27ae60;
    }
    
    .contact-status.offline {
        color: #95a5a6;
    }
    
    .message.failed {
        opacity: 0.7;
        border: 1px dashed #e74c3c;
    }
    
    .self-destruct-label {
        font-size: 10px;
        color: #e74c3c;
        margin-top: 5px;
    }
`;
document.head.appendChild(style);

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
});
