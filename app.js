class P2PChatApp {
    constructor() {
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.network = new P2PNetwork();
        this.currentUser = null;
        this.activeContact = null;
        this.contactStatus = new Map();
        this.initialized = false;
        
        this.init();
    }

    async init() {
        try {
            console.log('应用初始化开始...');
            
            // 显示加载状态
            this.showLoading('正在初始化应用...');
            
            // 先初始化存储
            await this.storage.init();
            console.log('存储初始化完成');
            
            // 检查现有身份
            const existingIdentity = await this.storage.getIdentity();
            
            if (existingIdentity) {
                console.log('发现现有身份:', existingIdentity.peerId);
                this.currentUser = existingIdentity;
                this.crypto.currentUser = existingIdentity;
                
                this.showChatInterface();
                try {
                    this.showLoading('正在连接网络...');
                    await this.network.init(existingIdentity);
                    this.setupNetworkHandlers();
                    console.log('网络初始化完成');
                    this.hideLoading();
                } catch (error) {
                    console.error('网络初始化失败:', error);
                    this.showNotification(`网络初始化失败: ${error.message}`);
                    // 如果网络初始化失败，重新生成身份
                    await this.generateIdentity();
                }
            } else {
                console.log('未发现现有身份，显示设置界面');
                this.showIdentitySetup();
                this.hideLoading();
            }

            this.setupEventListeners();
            this.initialized = true;
            console.log('应用初始化完成');
            
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.hideLoading();
            this.showNotification(`应用初始化失败: ${error.message}`);
            
            // 显示错误界面
            this.showErrorScreen(error.message);
        }
    }

    // 显示加载状态
    showLoading(message = '加载中...') {
        let loadingEl = document.getElementById('loading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'loading';
            loadingEl.innerHTML = `
                <div class="loading-overlay">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">${message}</div>
                </div>
            `;
            document.body.appendChild(loadingEl);
        }
        loadingEl.style.display = 'block';
    }

    // 隐藏加载状态
    hideLoading() {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    }

    // 显示错误界面
    showErrorScreen(errorMessage) {
        const appContainer = document.querySelector('.app-container');
        appContainer.innerHTML = `
            <div class="error-screen">
                <h1>😕 初始化失败</h1>
                <div class="error-card">
                    <p>应用初始化过程中出现错误：</p>
                    <code class="error-message">${errorMessage}</code>
                    <div class="error-actions">
                        <button id="retry-init">重试</button>
                        <button id="clear-data" class="danger">清除所有数据并重试</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('retry-init').addEventListener('click', () => {
            location.reload();
        });

        document.getElementById('clear-data').addEventListener('click', async () => {
            try {
                this.showLoading('正在清除数据...');
                await this.storage.destroyAllData();
                location.reload();
            } catch (error) {
                this.showNotification(`清除数据失败: ${error.message}`);
                this.hideLoading();
            }
        });
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
            this.showLoading('正在生成身份...');
            
            const identity = this.crypto.generateIdentity();
            this.currentUser = identity;
            this.crypto.currentUser = identity;
            
            await this.storage.saveIdentity(identity);
            
            // 显示身份信息
            document.getElementById('user-did').textContent = identity.did;
            document.getElementById('identity-display').classList.remove('hidden');
            
            // 初始化网络
            try {
                this.showLoading('正在初始化网络...');
                await this.network.init(identity);
                this.setupNetworkHandlers();
                this.hideLoading();
                this.showNotification('身份创建成功！');
            } catch (error) {
                console.error('网络初始化失败:', error);
                this.hideLoading();
                this.showNotification(`网络初始化失败: ${error.message}`);
                throw error;
            }
            
        } catch (error) {
            console.error('生成身份失败:', error);
            this.hideLoading();
            this.showNotification(`身份创建失败: ${error.message}`);
            throw error;
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
        
        document.getElementById('current-user').textContent = this.currentUser.did;
        this.loadContacts();
        this.updateMessageInputState(false);
    }

    // 验证 PeerId 格式
    isValidPeerId(peerId) {
        if (!peerId || peerId.length < 1 || peerId.length > 64) {
            return false;
        }
        
        const validPattern = /^[a-zA-Z0-9\-_]+$/;
        return validPattern.test(peerId);
    }

    // 添加联系人
    async addContact() {
        // 检查应用是否已初始化
        if (!this.initialized) {
            this.showNotification('应用尚未初始化完成，请稍后重试');
            return;
        }

        const contactInput = document.getElementById('contact-id').value.trim();
        if (!contactInput) {
            this.showNotification('请输入联系人ID');
            return;
        }

        // 检查输入格式
        if (!this.isValidPeerId(contactInput)) {
            this.showNotification('联系人ID格式无效，请检查输入');
            return;
        }

        // 检查是否已经是联系人
        try {
            const existingContact = await this.storage.getContact(contactInput);
            if (existingContact) {
                this.showNotification('该联系人已存在');
                this.selectContact(existingContact);
                return;
            }
        } catch (error) {
            console.error('检查联系人存在性失败:', error);
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
            console.error('添加联系人失败:', error);
            this.showNotification(`添加联系人失败: ${error.message}`);
            
            // 清理临时联系人
            try {
                await this.storage.delete('contacts', contactInput);
            } catch (deleteError) {
                console.error('清理临时联系人失败:', deleteError);
            }
            
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
            contactsList.innerHTML = '<div class="no-contacts">暂无联系人<br><small>在右侧输入框添加联系人</small></div>';
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
                    statusText = '🟡 交换身份中...';
                    statusClass = 'online-connecting';
                }
            }
            
            const displayId = contact.did && contact.did !== '等待身份交换...' ? 
                contact.did : contact.peerId;
            
            contactElement.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name">${displayId}</div>
                    <div class="contact-status ${statusClass}">${statusText}</div>
                    ${!contact.publicKey ? '<div class="contact-warning">⚠️ 身份交换中</div>' : ''}
                </div>
                <button class="destroy-contact" data-peerid="${contact.peerId}">🗑️</button>
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
        const did = contactPeerId || (this.activeContact ? this.activeContact.peerId : null);
        if (!did) return;

        const messages = await this.storage.getMessages(did);
        const messagesContainer = document.getElementById('chat-messages');
        
        messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="no-messages">
                    <h3>开始聊天</h3>
                    <p>这是你与 ${this.activeContact?.did || this.activeContact?.peerId} 的对话</p>
                    <p>发送消息开始聊天吧！</p>
                </div>
            `;
            return;
        }
        
        messages.forEach(message => {
            this.displayMessage(message, { peerId: did });
        });
    }

    // 销毁所有数据
    async destroyAllData() {
        if (!confirm('⚠️ 这将永久销毁所有聊天数据，包括你的身份！此操作不可撤销。确定继续吗？')) {
            return;
        }

        try {
            this.showLoading('正在销毁数据...');
            
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
            
            // 重新加载页面
            location.reload();
            
        } catch (error) {
            this.hideLoading();
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 销毁特定联系人数据
    async destroyContactData(contactPeerId) {
        const contact = await this.storage.getContact(contactPeerId);
        const contactName = contact?.did || contact?.peerId || contactPeerId;
        
        if (!confirm(`确定要销毁与 ${contactName} 的所有聊天数据吗？`)) {
            return;
        }

        try {
            // 发送销毁命令
            try {
                await this.network.sendDestroyCommand(contactPeerId);
            } catch (error) {
                console.error('发送销毁命令失败:', error);
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
            document.getElementById('chat-messages').innerHTML = '';
            this.updateMessageInputState(false);
        }
        this.contactStatus.delete(contactPeerId);
        this.updateContactsList();
    }

    // 显示通知
    showNotification(message, duration = 3000) {
        // 移除现有的通知
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => {
            document.body.removeChild(notification);
        });

        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // 显示动画
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // 自动隐藏
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, duration);
    }

    // HTML转义
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
});
