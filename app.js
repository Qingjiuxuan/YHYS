class P2PChatApp {
    constructor() {
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.network = new P2PNetwork();
        this.currentUser = null;
        this.activeContact = null;
        this.contactStatus = new Map(); // 跟踪联系人状态
        
        this.init();
    }

    async init() {
        try {
            await this.storage.init();
            
            const existingIdentity = await this.storage.getIdentity();
            if (existingIdentity) {
                this.currentUser = existingIdentity;
                this.crypto.currentUser = existingIdentity;
                this.showChatInterface();
                try {
                    await this.network.init(existingIdentity);
                    this.setupNetworkHandlers();
                    this.showNotification('应用初始化成功！');
                } catch (error) {
                    this.showNotification(`网络初始化失败: ${error.message}`);
                    // 如果网络初始化失败，重新生成身份
                    await this.generateIdentity();
                }
            } else {
                this.showIdentitySetup();
            }

            this.setupEventListeners();
        } catch (error) {
            this.showNotification(`应用启动失败: ${error.message}`);
        }
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

        // 回车添加联系人
        document.getElementById('contact-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addContact();
            }
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

        // 消息发送成功
        this.network.on('message-sent', (data) => {
            this.displayMessage(data.message, data.contact);
            this.updateContactsList();
        });

        // 联系人身份就绪
        this.network.on('contact-identity-ready', (contact) => {
            console.log('联系人身份就绪:', contact.peerId);
            this.contactStatus.set(contact.peerId, 'ready');
            this.updateContactsList();
            this.showNotification(`${contact.did || contact.peerId} 身份验证完成，可以开始聊天`);
            
            // 如果当前正在和这个联系人聊天，更新UI状态
            if (this.activeContact && this.activeContact.peerId === contact.peerId) {
                this.updateMessageInputState(true);
            }
        });

        // 联系人连接
        this.network.on('contact-connected', (contact) => {
            this.contactStatus.set(contact.peerId, 'connecting');
            this.updateContactsList();
            this.showNotification(`${contact.did || contact.peerId} 已连接，正在进行身份交换...`);
        });

        // 数据销毁处理
        this.network.on('data-destroyed', (peerId) => {
            this.removeContactFromUI(peerId);
            this.showNotification(`来自 ${peerId} 的数据已被销毁`);
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
            
            this.showNotification('身份创建成功！');
            
        } catch (error) {
            this.showNotification(`身份创建失败: ${error.message}`);
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

        // 检查是否已经是联系人
        const existingContact = await this.storage.get('contacts', contactInput);
        if (existingContact) {
            this.showNotification('该联系人已存在');
            this.selectContact(existingContact);
            return;
        }

        try {
            this.showNotification(`正在连接 ${contactInput}...`);
            
            // 创建临时联系人记录
            const tempContact = {
                peerId: contactInput,
                did: `等待身份交换...`,
                publicKey: null,
                connected: false,
                lastSeen: Date.now(),
                identityVerified: false
            };
            
            await this.storage.saveContact(tempContact);
            this.contactStatus.set(contactInput, 'connecting');
            this.updateContactsList();
            
            // 建立连接
            await this.network.connectToPeer(contactInput);
            
            document.getElementById('contact-id').value = '';
            this.showNotification(`已发起连接到 ${contactInput}，等待身份交换...`);
            
        } catch (error) {
            this.showNotification(`添加联系人失败: ${error.message}`);
            // 清理临时联系人
            await this.storage.delete('contacts', contactInput);
            this.contactStatus.delete(contactInput);
            this.updateContactsList();
        }
    }

    // 选择联系人
    async selectContact(contact) {
        this.activeContact = contact;
        this.updateContactsList();
        await this.loadMessages(contact.peerId);
        
        // 更新消息输入框状态
        const isReady = contact.publicKey && contact.identityVerified;
        this.updateMessageInputState(isReady);
        
        if (!isReady) {
            this.showNotification('联系人身份交换中，请等待...');
        }
    }

    // 更新消息输入框状态
    updateMessageInputState(enabled) {
        const messageText = document.getElementById('message-text');
        const sendButton = document.getElementById('send-message');
        const selfDestructCheck = document.getElementById('self-destruct');
        const ttlInput = document.getElementById('ttl');
        
        if (enabled) {
            messageText.disabled = false;
            messageText.placeholder = '输入消息... (支持自毁消息)';
            sendButton.disabled = false;
            selfDestructCheck.disabled = false;
            ttlInput.disabled = false;
        } else {
            messageText.disabled = true;
            messageText.placeholder = '等待身份交换完成...';
            sendButton.disabled = true;
            selfDestructCheck.disabled = true;
            ttlInput.disabled = true;
        }
    }

    // 发送消息
    async sendMessage() {
        if (!this.activeContact) {
            this.showNotification('请先选择联系人');
            return;
        }

        // 检查联系人是否就绪
        if (!this.activeContact.publicKey || !this.activeContact.identityVerified) {
            this.showNotification('联系人身份交换未完成，请等待...');
            return;
        }

        const messageText = document.getElementById('message-text').value.trim();
        if (!messageText) return;

        const selfDestruct = document.getElementById('self-destruct').checked;
        const ttlHours = parseInt(document.getElementById('ttl').value) || 24;

        try {
            this.showNotification('发送消息中...');
            
            await this.network.sendMessage(
                this.activeContact.peerId,
                messageText, 
                selfDestruct, 
                ttlHours
            );

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

            document.getElementById('message-text').value = '';
            this.showNotification('消息发送成功');
            
        } catch (error) {
            this.showNotification(`发送失败: ${error.message}`);
        }
    }

    // 显示消息
    displayMessage(message, contact) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        
        messageElement.className = `message ${message.direction} ${
            message.isSelfDestruct ? 'self-destruct' : ''
        }`;
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            <div class="message-time">${time}</div>
            ${message.isSelfDestruct ? '<div class="self-destruct-label">💣 自毁消息</div>' : ''}
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
            contactsList.innerHTML = '<div class="no-contacts">暂无联系人<br>在右侧输入对方ID添加联系人</div>';
            return;
        }
        
        contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            const status = this.contactStatus.get(contact.peerId) || 'unknown';
            
            contactElement.className = `contact-item ${
                this.activeContact && this.activeContact.peerId === contact.peerId ? 'active' : ''
            }`;
            
            // 确定显示状态
            let statusText = '🔴 离线';
            let statusClass = 'offline';
            
            if (contact.connected) {
                if (contact.publicKey && contact.identityVerified) {
                    statusText = '🟢 在线';
                    statusClass = 'online-ready';
                } else {
                    statusText = '🟡 交换身份中';
                    statusClass = 'online-connecting';
                }
            }
            
            const displayName = contact.did && contact.did !== '等待身份交换...' ? 
                contact.did.substring(0, 20) + (contact.did.length > 20 ? '...' : '') : 
                contact.peerId;
            
            contactElement.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name" title="${contact.did || contact.peerId}">${displayName}</div>
                    <div class="contact-status ${statusClass}">${statusText}</div>
                    ${!contact.publicKey ? '<div class="contact-warning">⚠️ 等待身份交换</div>' : ''}
                </div>
                <button class="destroy-contact" data-peerid="${contact.peerId}" title="删除联系人">🗑️</button>
            `;
            
            contactElement.addEventListener('click', () => {
                this.selectContact(contact);
            });
            
            const destroyBtn = contactElement.querySelector('.destroy-contact');
            destroyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.destroyContactData(contact.peerId);
            });
            
            contactsList.appendChild(contactElement);
        });
    }

    // 加载消息
    async loadMessages(contactPeerId = null) {
        const peerId = contactPeerId || (this.activeContact ? this.activeContact.peerId : null);
        if (!peerId) return;

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
                        console.log(`无法通知 ${contact.peerId}: ${error.message}`);
                    }
                }
            }

            // 销毁本地所有数据
            await this.storage.destroyAllData();
            this.network.destroy();
            this.crypto.secureWipe();
            
            this.showNotification('所有数据已安全销毁，页面即将刷新...');
            
            // 重新加载页面
            setTimeout(() => {
                location.reload();
            }, 2000);
            
        } catch (error) {
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 销毁特定联系人数据
    async destroyContactData(contactPeerId) {
        const contact = await this.storage.get('contacts', contactPeerId);
        const contactName = contact ? (contact.did || contact.peerId) : contactPeerId;
        
        if (!confirm(`确定要销毁与 ${contactName} 的所有聊天数据吗？`)) {
            return;
        }

        try {
            // 发送销毁命令
            try {
                await this.network.sendDestroyCommand(contactPeerId);
            } catch (error) {
                console.log(`无法通知对方: ${error.message}`);
            }
            
            // 销毁本地数据
            await this.storage.destroyContactData(contactPeerId);
            
            // 更新UI
            this.removeContactFromUI(contactPeerId);
            this.showNotification(`已销毁与 ${contactName} 的聊天数据`);
            
        } catch (error) {
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 从UI移除联系人
    removeContactFromUI(contactPeerId) {
        if (this.activeContact && this.activeContact.peerId === contactPeerId) {
            this.activeContact = null;
            document.getElementById('chat-messages').innerHTML = '<div class="no-messages">请选择一个联系人开始聊天</div>';
            this.updateMessageInputState(false);
        }
        this.updateContactsList();
    }

    // 显示通知
    showNotification(message) {
        // 移除已有的通知
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
            background: #2c3e50;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            z-index: 1000;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border-left: 4px solid #3498db;
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 4000);
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
        color: #7f8c8d;
        font-style: italic;
        line-height: 1.5;
    }
    
    .contact-info {
        flex: 1;
    }
    
    .contact-name {
        font-weight: 500;
        margin-bottom: 4px;
    }
    
    .contact-status {
        font-size: 12px;
    }
    
    .contact-status.online-ready {
        color: #27ae60;
    }
    
    .contact-status.online-connecting {
        color: #f39c12;
    }
    
    .contact-status.offline {
        color: #95a5a6;
    }
    
    .contact-warning {
        font-size: 11px;
        color: #e74c3c;
        margin-top: 2px;
    }
    
    .message-input textarea:disabled {
        background-color: #f8f9fa;
        color: #6c757d;
        cursor: not-allowed;
    }
    
    button:disabled {
        background-color: #6c757d;
        cursor: not-allowed;
    }
    
    button:disabled:hover {
        background-color: #6c757d;
    }
    
    .destroy-contact {
        background: #e74c3c;
        padding: 6px 10px;
        font-size: 12px;
        border-radius: 4px;
    }
    
    .destroy-contact:hover {
        background: #c0392b;
    }
    
    .self-destruct-label {
        font-size: 11px;
        color: #e74c3c;
        margin-top: 4px;
        font-weight: bold;
    }
`;
document.head.appendChild(style);

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
});
