class P2PChatApp {
    constructor() {
        this.crypto = new CryptoManager();
        this.storage = new SecureStorage();
        this.network = new P2PNetwork();
        this.currentUser = null;
        this.activeContact = null;
        this.deferredPrompt = null;
        
        this.init();
    }

    async init() {
        // 初始化存储
        await this.storage.init();
        
        // 检查现有身份
        const existingIdentity = await this.storage.getIdentity();
        if (existingIdentity) {
            this.currentUser = existingIdentity;
            this.showChatInterface();
            await this.network.init(existingIdentity);
        } else {
            this.showIdentitySetup();
        }

        this.setupEventListeners();
        this.setupNetworkHandlers();
        this.setupMobileFeatures();
        
        // 定期清理过期自毁消息
        setInterval(() => {
            this.storage.cleanupExpiredMessages();
        }, 60000); // 每分钟检查一次
    }

    setupMobileFeatures() {
        // 防止双击缩放
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // 移动端键盘处理
        this.setupKeyboardHandling();
        
        // PWA安装提示
        this.setupPWA();
        
        // 移动端网络状态监听
        this.setupNetworkMonitoring();
        
        // 触摸反馈优化
        this.setupTouchFeedback();
        
        // 防止页面滚动
        this.preventPullToRefresh();
    }

    setupKeyboardHandling() {
        const messageInput = document.getElementById('message-text');
        const messagesContainer = document.getElementById('chat-messages');
        
        messageInput.addEventListener('focus', () => {
            // 键盘弹出时滚动到底部
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 300);
        });

        // 点击消息区域隐藏键盘
        messagesContainer.addEventListener('touchstart', () => {
            if (document.activeElement === messageInput) {
                messageInput.blur();
            }
        });
    }

    setupPWA() {
        // 检测是否可安装PWA
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            // 延迟显示安装提示，避免干扰用户体验
            setTimeout(() => {
                this.showInstallPrompt();
            }, 5000);
        });
        
        window.addEventListener('appinstalled', () => {
            this.showNotification('应用已安装到桌面');
            this.deferredPrompt = null;
        });

        // 注册Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(() => console.log('Service Worker 注册成功'))
                .catch(err => console.log('Service Worker 注册失败:', err));
        }
    }

    showInstallPrompt() {
        // 只在移动端显示安装提示
        if (this.isMobileDevice() && this.deferredPrompt && !this.getInstalledStatus()) {
            const installBtn = document.createElement('button');
            installBtn.textContent = '📱 安装应用到桌面';
            installBtn.className = 'install-prompt';
            installBtn.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #667eea;
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 25px;
                font-size: 14px;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            
            installBtn.addEventListener('click', () => {
                this.installPWA();
                document.body.removeChild(installBtn);
            });
            
            // 10秒后自动隐藏
            setTimeout(() => {
                if (document.body.contains(installBtn)) {
                    document.body.removeChild(installBtn);
                }
            }, 10000);
            
            document.body.appendChild(installBtn);
        }
    }

    async installPWA() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                this.setInstalledStatus(true);
                this.showNotification('应用安装成功');
            }
            this.deferredPrompt = null;
        }
    }

    setInstalledStatus(installed) {
        localStorage.setItem('p2p-chat-installed', installed);
    }

    getInstalledStatus() {
        return localStorage.getItem('p2p-chat-installed') === 'true';
    }

    setupNetworkMonitoring() {
        // 监听网络状态变化
        window.addEventListener('online', () => {
            this.showNotification('网络已连接');
            this.updateConnectionStatus(true);
            this.tryReconnectContacts();
        });
        
        window.addEventListener('offline', () => {
            this.showNotification('网络连接已断开');
            this.updateConnectionStatus(false);
        });

        // 初始网络状态检查
        this.updateConnectionStatus(navigator.onLine);
    }

    updateConnectionStatus(online) {
        const statusElement = document.getElementById('connection-status') || this.createConnectionStatusElement();
        statusElement.textContent = online ? '🟢 在线' : '🔴 离线';
        statusElement.style.background = online ? '#2ecc71' : '#e74c3c';
    }

    createConnectionStatusElement() {
        const statusElement = document.createElement('div');
        statusElement.id = 'connection-status';
        statusElement.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: #2ecc71;
            color: white;
            padding: 6px 12px;
            border-radius: 15px;
            font-size: 12px;
            z-index: 1000;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(statusElement);
        return statusElement;
    }

    setupTouchFeedback() {
        // 为所有按钮添加触摸反馈
        document.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'BUTTON') {
                e.target.style.transform = 'scale(0.95)';
                e.target.style.transition = 'transform 0.1s';
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (e.target.tagName === 'BUTTON') {
                e.target.style.transform = 'scale(1)';
            }
        }, { passive: true });
    }

    preventPullToRefresh() {
        // 防止下拉刷新
        let startY;
        document.addEventListener('touchstart', (e) => {
            startY = e.touches[0].pageY;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            const y = e.touches[0].pageY;
            // 如果向下滑动并且已经在顶部，阻止默认行为
            if (y > startY && window.scrollY <= 0) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    async tryReconnectContacts() {
        const contacts = await this.storage.getContacts();
        let reconnected = 0;
        
        for (const contact of contacts) {
            if (!contact.connected) {
                try {
                    await this.network.connectToPeer(contact.did);
                    reconnected++;
                } catch (error) {
                    console.log(`重连 ${contact.did} 失败:`, error);
                }
            }
        }
        
        if (reconnected > 0) {
            this.showNotification(`已重新连接 ${reconnected} 个联系人`);
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

        // 移动端：滑动删除联系人
        this.setupSwipeGestures();
    }

    setupSwipeGestures() {
        let startX, startY;
        const contactsList = document.getElementById('contacts-list');

        contactsList.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        contactsList.addEventListener('touchmove', (e) => {
            if (!startX || !startY) return;

            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            const diffX = startX - x;
            const diffY = startY - y;

            // 检测左滑手势
            if (Math.abs(diffX) > Math.abs(diffY) && diffX > 50) {
                const contactElement = e.target.closest('.contact-item');
                if (contactElement) {
                    this.showSwipeDeleteOption(contactElement);
                }
            }
        }, { passive: true });

        contactsList.addEventListener('touchend', () => {
            startX = null;
            startY = null;
        }, { passive: true });
    }

    showSwipeDeleteOption(contactElement) {
        const did = contactElement.querySelector('.contact-name').textContent;
        
        // 创建滑动删除确认
        const deleteConfirm = document.createElement('div');
        deleteConfirm.className = 'swipe-delete-confirm';
        deleteConfirm.innerHTML = `
            <div class="swipe-content">
                <p>删除联系人 ${did}？</p>
                <div class="swipe-actions">
                    <button class="cancel-swipe">取消</button>
                    <button class="confirm-delete danger">删除</button>
                </div>
            </div>
        `;
        
        deleteConfirm.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            padding: 20px;
        `;
        
        const content = deleteConfirm.querySelector('.swipe-content');
        content.style.cssText = `
            background: white;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            max-width: 300px;
            width: 100%;
        `;
        
        deleteConfirm.querySelector('.cancel-swipe').addEventListener('click', () => {
            document.body.removeChild(deleteConfirm);
        });
        
        deleteConfirm.querySelector('.confirm-delete').addEventListener('click', () => {
            this.destroyContactData(did);
            document.body.removeChild(deleteConfirm);
        });
        
        // 点击背景关闭
        deleteConfirm.addEventListener('click', (e) => {
            if (e.target === deleteConfirm) {
                document.body.removeChild(deleteConfirm);
            }
        });
        
        document.body.appendChild(deleteConfirm);
    }

    setupNetworkHandlers() {
        // 消息接收处理
        this.network.on('message-received', (data) => {
            this.displayMessage(data.message, data.contact);
            this.updateContactsList();
            
            // 移动端：显示通知（如果应用在后台）
            if (document.hidden) {
                this.showPushNotification(data.contact, data.message);
            }
        });

        // 数据销毁处理
        this.network.on('data-destroyed', (peerDid) => {
            this.removeContactFromUI(peerDid);
            this.showNotification(`来自 ${peerDid} 的数据已被销毁`);
        });

        // 联系人连接
        this.network.on('contact-connected', (contact) => {
            this.showNotification(`${contact.did} 已连接`);
            this.updateContactsList();
        });

        // 消息发送成功
        this.network.on('message-sent', (data) => {
            this.displayMessage(data.message, data.contact);
            this.updateContactsList();
        });
    }

    showPushNotification(contact, message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`新消息来自 ${contact.did}`, {
                body: message.content.length > 50 ? 
                    message.content.substring(0, 50) + '...' : message.content,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'p2p-chat'
            });
        }
    }

    // 请求通知权限
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                this.showNotification('已启用消息通知');
            }
        }
    }

    // 生成新身份
    async generateIdentity() {
        try {
            const identity = this.crypto.generateIdentity();
            this.currentUser = identity;
            
            await this.storage.saveIdentity(identity);
            
            // 显示身份信息
            document.getElementById('user-did').textContent = identity.did;
            document.getElementById('identity-display').classList.remove('hidden');
            
            // 初始化网络
            await this.network.init(identity);
            
            this.showNotification('身份创建成功');
            
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
        
        document.getElementById('current-user').textContent = this.currentUser.did;
        this.loadContacts();
        this.loadMessages();
        
        // 请求通知权限
        this.requestNotificationPermission();
    }

    // 添加联系人
    async addContact() {
        const contactDid = document.getElementById('contact-id').value.trim();
        if (!contactDid) {
            this.showNotification('请输入联系人ID');
            return;
        }

        // 验证DID格式
        if (!contactDid.startsWith('did:peer:1:')) {
            this.showNotification('请输入有效的DID格式 (did:peer:1:...)');
            return;
        }

        // 不能添加自己
        if (contactDid === this.currentUser.did) {
            this.showNotification('不能添加自己为联系人');
            return;
        }

        try {
            // 检查是否已存在
            const existingContact = await this.storage.get('contacts', contactDid);
            if (existingContact) {
                this.showNotification('该联系人已存在');
                return;
            }

            // 连接到对方
            const conn = this.network.connectToPeer(contactDid);
            
            // 添加到联系人列表
            const contact = {
                did: contactDid,
                publicKey: null, // 将在身份交换后获取
                connected: false,
                lastSeen: Date.now(),
                addedAt: Date.now()
            };
            
            await this.storage.saveContact(contact);
            this.updateContactsList();
            document.getElementById('contact-id').value = '';
            
            this.showNotification(`已添加联系人: ${contactDid}`);
            
            // 自动选择新添加的联系人
            this.selectContact(contact);
            
        } catch (error) {
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
        if (!messageText) return;

        // 移动端：发送后立即隐藏键盘
        document.getElementById('message-text').blur();

        const selfDestruct = document.getElementById('self-destruct').checked;
        const ttlHours = parseInt(document.getElementById('ttl').value) || 24;

        // 移动端：显示发送中状态
        this.showSendingState(true);

        try {
            const sent = await this.network.sendMessage(
                this.activeContact.did, 
                messageText, 
                selfDestruct, 
                ttlHours
            );

            if (sent) {
                if (!selfDestruct) {
                    const message = {
                        contactDid: this.activeContact.did,
                        content: messageText,
                        direction: 'sent',
                        timestamp: Date.now(),
                        status: 'sent'
                    };
                    
                    this.displayMessage(message, this.activeContact);
                    await this.storage.saveMessage(message);
                }

                // 清空输入框
                document.getElementById('message-text').value = '';
                
                // 移动端：震动反馈
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            } else {
                this.showNotification('发送失败：对方可能离线');
            }
            
        } catch (error) {
            this.showNotification(`发送失败: ${error.message}`);
        } finally {
            this.showSendingState(false);
        }
    }

    showSendingState(sending) {
        const sendBtn = document.getElementById('send-message');
        const messageText = document.getElementById('message-text');
        
        if (sending) {
            sendBtn.disabled = true;
            sendBtn.textContent = '发送中...';
            messageText.disabled = true;
        } else {
            sendBtn.disabled = false;
            sendBtn.textContent = '发送';
            messageText.disabled = false;
        }
    }

    // 显示消息
    displayMessage(message, contact) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        
        messageElement.className = `message ${message.direction} ${
            message.isSelfDestruct ? 'self-destruct' : ''
        } ${message.status || ''}`;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', minute: '2-digit' 
        });
        
        let content = this.escapeHtml(message.content);
        
        // 如果是自毁消息，显示解密按钮
        if (message.isSelfDestruct && message.direction === 'received') {
            content = `
                <div class="self-destruct-message">
                    <div class="self-destruct-placeholder">💣 加密自毁消息</div>
                    <button class="decrypt-self-destruct" data-message='${JSON.stringify(message)}'>
                        点击解密
                    </button>
                </div>
            `;
        }
        
        messageElement.innerHTML = `
            <div class="message-content">${content}</div>
            <div class="message-meta">
                <span class="message-time">${time}</span>
                ${message.status === 'sent' ? '<span class="message-status">✓</span>' : ''}
            </div>
        `;
        
        // 添加解密按钮事件
        if (message.isSelfDestruct && message.direction === 'received') {
            const decryptBtn = messageElement.querySelector('.decrypt-self-destruct');
            decryptBtn.addEventListener('click', () => {
                this.decryptSelfDestructMessage(message);
            });
        }
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // 添加消息进入动画
        setTimeout(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        }, 10);
    }

    // 解密自毁消息
    async decryptSelfDestructMessage(message) {
        try {
            const decrypted = this.crypto.decryptWithSelfDestructKey(
                message.selfDestructData, 
                message.selfDestructData.selfDestructKey
            );
            
            if (decrypted) {
                // 更新消息显示
                const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
                if (messageElement) {
                    messageElement.querySelector('.message-content').textContent = decrypted;
                    messageElement.querySelector('.decrypt-self-destruct').remove();
                }
                
                // 更新存储的消息
                message.content = decrypted;
                message.isSelfDestruct = false;
                await this.storage.saveMessage(message);
                
                this.showNotification('消息已解密');
            } else {
                this.showNotification('解密失败');
            }
        } catch (error) {
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
            contactsList.innerHTML = `
                <div class="empty-contacts">
                    <p>暂无联系人</p>
                    <p class="hint">添加联系人开始聊天</p>
                </div>
            `;
            return;
        }
        
        contacts.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        
        contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = `contact-item ${
                this.activeContact && this.activeContact.did === contact.did ? 'active' : ''
            }`;
            
            const lastSeen = contact.lastSeen ? 
                this.formatLastSeen(contact.lastSeen) : '从未在线';
                
            contactElement.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name">${this.shortenDid(contact.did)}</div>
                    <div class="contact-status ${contact.connected ? 'online' : 'offline'}">
                        ${contact.connected ? '🟢 在线' : `🔴 ${lastSeen}`}
                    </div>
                </div>
                <button class="destroy-contact" data-did="${contact.did}">🗑️</button>
            `;
            
            contactElement.addEventListener('click', (e) => {
                if (!e.target.classList.contains('destroy-contact')) {
                    this.selectContact(contact);
                }
            });
            
            // 销毁单个联系人数据
            const destroyBtn = contactElement.querySelector('.destroy-contact');
            destroyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.destroyContactData(contact.did);
            });
            
            contactsList.appendChild(contactElement);
        });
    }

    shortenDid(did) {
        if (did.length > 20) {
            return did.substring(0, 10) + '...' + did.substring(did.length - 8);
        }
        return did;
    }

    formatLastSeen(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        return `${days}天前`;
    }

    // 选择联系人
    async selectContact(contact) {
        this.activeContact = contact;
        this.updateContactsList();
        await this.loadMessages(contact.did);
        
        // 移动端：在聊天界面隐藏联系人列表
        if (this.isMobileDevice()) {
            this.toggleContactsPanel(false);
        }
    }

    // 移动端：切换联系人面板显示
    toggleContactsPanel(show) {
        const contactsPanel = document.querySelector('.contacts-panel');
        const chatArea = document.querySelector('.chat-area');
        
        if (show) {
            contactsPanel.style.display = 'block';
            chatArea.style.display = 'none';
        } else {
            contactsPanel.style.display = 'none';
            chatArea.style.display = 'flex';
        }
    }

    // 加载消息
    async loadMessages(contactDid = null) {
        const did = contactDid || (this.activeContact ? this.activeContact.did : null);
        if (!did) return;

        const messages = await this.storage.getMessages(did);
        const messagesContainer = document.getElementById('chat-messages');
        
        messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="empty-messages">
                    <p>还没有消息</p>
                    <p class="hint">发送第一条消息开始对话</p>
                </div>
            `;
            return;
        }
        
        messages.forEach(message => {
            this.displayMessage(message, { did });
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
                    await this.network.sendDestroyCommand(contact.did);
                }
            }

            // 销毁本地所有数据
            await this.storage.destroyAllData();
            this.network.destroy();
            this.crypto.secureWipe();
            
            // 清除PWA安装状态
            this.setInstalledStatus(false);
            
            // 重新加载页面
            location.reload();
            
        } catch (error) {
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 销毁特定联系人数据
    async destroyContactData(contactDid) {
        if (!confirm(`确定要销毁与 ${contactDid} 的所有聊天数据吗？`)) {
            return;
        }

        try {
            // 发送销毁命令
            await this.network.sendDestroyCommand(contactDid);
            
            // 销毁本地数据
            await this.storage.destroyContactData(contactDid);
            
            // 更新UI
            this.removeContactFromUI(contactDid);
            this.showNotification(`已销毁与 ${contactDid} 的聊天数据`);
            
        } catch (error) {
            this.showNotification(`销毁失败: ${error.message}`);
        }
    }

    // 从UI移除联系人
    removeContactFromUI(contactDid) {
        if (this.activeContact && this.activeContact.did === contactDid) {
            this.activeContact = null;
            document.getElementById('chat-messages').innerHTML = `
                <div class="empty-messages">
                    <p>选择联系人开始聊天</p>
                </div>
            `;
        }
        this.updateContactsList();
    }

    // 显示通知
    showNotification(message, duration = 3000) {
        // 移除现有通知
        const existingNotification = document.querySelector('.mobile-notification');
        if (existingNotification) {
            document.body.removeChild(existingNotification);
        }

        const notification = document.createElement('div');
        notification.className = 'mobile-notification';
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 14px 20px;
            border-radius: 25px;
            z-index: 1000;
            font-size: 14px;
            max-width: 80%;
            text-align: center;
            backdrop-filter: blur(10px);
            animation: slideDown 0.3s ease;
        `;
        
        // 添加CSS动画
        if (!document.querySelector('#notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                
                .empty-contacts, .empty-messages {
                    text-align: center;
                    padding: 40px 20px;
                    color: #666;
                }
                
                .empty-contacts .hint, .empty-messages .hint {
                    font-size: 14px;
                    margin-top: 8px;
                    opacity: 0.7;
                }
                
                .contact-info {
                    flex: 1;
                }
                
                .message-meta {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 4px;
                    font-size: 12px;
                    opacity: 0.7;
                }
                
                .self-destruct-message {
                    text-align: center;
                }
                
                .decrypt-self-destruct {
                    background: #ff6b6b;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 15px;
                    margin-top: 8px;
                    font-size: 12px;
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, duration);
    }

    // 工具函数
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               window.innerWidth < 768;
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
    
    // 移动端：添加返回按钮处理
    if (window.chatApp.isMobileDevice()) {
        let backButtonPressed = false;
        
        // 监听安卓返回按钮
        window.addEventListener('popstate', (e) => {
            if (!backButtonPressed) {
                // 如果在聊天界面，返回联系人列表
                const chatArea = document.querySelector('.chat-area');
                const contactsPanel = document.querySelector('.contacts-panel');
                
                if (chatArea.style.display !== 'none') {
                    chatArea.style.display = 'none';
                    contactsPanel.style.display = 'block';
                    e.preventDefault();
                    backButtonPressed = true;
                    
                    setTimeout(() => {
                        backButtonPressed = false;
                    }, 1000);
                }
            }
        });
    }
});

// 添加移动端CSS样式
const mobileStyles = `
@media (max-width: 767px) {
    .chat-container {
        position: relative;
        overflow: hidden;
    }
    
    .contacts-panel, .chat-area {
        transition: transform 0.3s ease;
    }
    
    .show-contacts .contacts-panel {
        transform: translateX(0);
    }
    
    .show-contacts .chat-area {
        transform: translateX(100%);
    }
    
    .show-chat .contacts-panel {
        transform: translateX(-100%);
    }
    
    .show-chat .chat-area {
        transform: translateX(0);
    }
    
    .contact-item {
        position: relative;
        overflow: hidden;
    }
    
    .swipe-actions {
        display: flex;
        gap: 10px;
        margin-top: 15px;
    }
    
    .swipe-actions button {
        flex: 1;
        padding: 10px;
        font-size: 14px;
    }
    
    .cancel-swipe {
        background: #95a5a6;
    }
}

/* 深色模式优化 */
@media (prefers-color-scheme: dark) {
    .mobile-notification {
        background: rgba(255,255,255,0.9) !important;
        color: #333 !important;
    }
}

/* 高性能动画 */
.message {
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
}

.contact-item {
    transition: background-color 0.2s ease;
}

/* 移动端优化滚动 */
.messages-container {
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
}

.contacts-list {
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
}
`;

// 注入移动端样式
const styleSheet = document.createElement('style');
styleSheet.textContent = mobileStyles;
document.head.appendChild(styleSheet);