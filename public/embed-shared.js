/* embed-shared.js - Shared logic for chat embed pages */

// Diagnostic: emit a beacon as soon as this file parses + executes, so the parent
// can distinguish "script never loaded" from "script loaded but init() never ran"
// from "init ran but notifyParent threw". The production 'embed-ready' event is
// still emitted later from EmbedShared.init().
try { window.parent.postMessage({type:'embed-script-loaded', at:'top-of-file', ts:Date.now()}, '*'); } catch(e){}

// Catch any uncaught error in the iframe and report to parent
window.addEventListener('error', function(ev) {
    try {
        window.parent.postMessage({
            type: 'embed-error',
            message: ev.message || String(ev),
            filename: ev.filename || '',
            lineno: ev.lineno || 0,
            colno: ev.colno || 0
        }, '*');
    } catch(e){}
});
window.addEventListener('unhandledrejection', function(ev) {
    try {
        window.parent.postMessage({
            type: 'embed-error',
            message: 'unhandledrejection: ' + (ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason)),
            filename: 'promise',
            lineno: 0,
            colno: 0
        }, '*');
    } catch(e){}
});

(function() {
    'use strict';

    var RECONNECT_MAX = 10;
    var PROJECT_NAME = '-home-rooted-robotics-software-agent-harness-directives-orchestration-execution-self-improving-system';

    window.EmbedShared = {
        // State
        token: null,
        ws: null,
        sessionId: null,
        context: null,
        config: null,
        estimatedTokens: 0,
        handlers: null,
        _reconnectAttempts: 0,
        _reconnectTimer: null,
        _initialized: false,

        /**
         * Initialize the embed shared layer.
         * @param {Object} handlers - Callback handlers for the specific embed page
         *   onMessage(data), onConnect(), onDisconnect(), onSessionCreated(sessionId),
         *   onClearMessages(), onHistoryLoaded(messages), onFocus(), onError(error)
         */
        init: function(handlers) {
            // Diagnostic beacon: fires if init() is actually reached
            try { window.parent.postMessage({type:'embed-init-called', at:'init-entry', ts:Date.now()}, '*'); } catch(e){}

            this.handlers = handlers || {};

            // Only set up postMessage listener once
            if (!this._initialized) {
                this._initialized = true;
                var self = this;
                window.addEventListener('message', function(event) {
                    self._handlePostMessage(event);
                });
            }

            // Notify parent we are ready to receive init
            this.notifyParent('embed-ready', {});
        },

        _handlePostMessage: function(event) {
            var msg = event.data;
            if (!msg || !msg.type) return;

            switch (msg.type) {
                case 'init':
                    this.token = msg.token || null;
                    this.sessionId = msg.sessionId || null;
                    this.context = msg.context || null;
                    this.config = msg.config || {};
                    this._reconnectAttempts = 0;
                    try { console.log('[EmbedShared] init', { sessionId: this.sessionId, loadHistory: msg.loadHistory, hasToken: !!this.token }); } catch(e) {}

                    if (this.token) {
                        this.connect();
                    }

                    // Load history whenever a sessionId is provided. Parent can opt out with loadHistory:false.
                    if (this.sessionId && msg.loadHistory !== false) {
                        var self = this;
                        this.loadHistory(this.sessionId, function(messages) {
                            try { console.log('[EmbedShared] init history loaded', { sessionId: self.sessionId, count: (messages || []).length }); } catch(e) {}
                            if (self.handlers.onHistoryLoaded) {
                                self.handlers.onHistoryLoaded(messages);
                            }
                        });
                    }
                    break;

                case 'switch-session':
                    this.sessionId = msg.sessionId || null;
                    this.context = msg.context || this.context;
                    this.estimatedTokens = 0;
                    try { console.log('[EmbedShared] switch-session', { sessionId: this.sessionId, loadHistory: msg.loadHistory }); } catch(e) {}

                    // Clear display via handler
                    if (this.handlers.onClearMessages) {
                        this.handlers.onClearMessages();
                    }

                    // Load history for the new session by default. Parent can opt out with loadHistory:false.
                    if (this.sessionId && msg.loadHistory !== false) {
                        var self2 = this;
                        this.loadHistory(this.sessionId, function(messages) {
                            try { console.log('[EmbedShared] switch-session history loaded', { sessionId: self2.sessionId, count: (messages || []).length }); } catch(e) {}
                            if (self2.handlers.onHistoryLoaded) {
                                self2.handlers.onHistoryLoaded(messages);
                            }
                        });
                    }
                    break;

                case 'send-message':
                    // Parent-driven send: text + optional images. Display user bubble + ship to WS.
                    var sendText = typeof msg.text === 'string' ? msg.text : '';
                    var sendImages = Array.isArray(msg.images) ? msg.images : undefined;
                    if (this.handlers.onUserMessage) {
                        try { this.handlers.onUserMessage(sendText, sendImages); } catch (e) {}
                    }
                    this.sendCommand(sendText, sendImages);
                    this.estimateTokens(sendText);
                    break;

                case 'slash-command':
                    var cmd = msg.command || '';
                    if (cmd === '/clear') {
                        this.sessionId = null;
                        this.estimatedTokens = 0;
                        if (this.handlers.onClearMessages) {
                            this.handlers.onClearMessages();
                        }
                        this.notifyParent('session-cleared', {});
                    } else {
                        // Forward unknown slash commands as regular commands
                        this.sendCommand(cmd);
                    }
                    break;

                case 'focus':
                    if (this.handlers.onFocus) {
                        this.handlers.onFocus();
                    }
                    break;
            }
        },

        connect: function() {
            if (!this.token) return;

            // Close existing connection
            if (this.ws) {
                try { this.ws.close(); } catch(e) {}
                this.ws = null;
            }

            var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsUrl = protocol + '//' + location.host + '/ws?token=' + encodeURIComponent(this.token);

            var self = this;
            var freshConnect = true;

            try {
                this.ws = new WebSocket(wsUrl);
            } catch (e) {
                if (self.handlers.onError) {
                    self.handlers.onError('WebSocket creation failed: ' + e.message);
                }
                return;
            }

            this.ws.onopen = function() {
                freshConnect = false;
                self._reconnectAttempts = 0;
                self.notifyParent('connection-status', { status: 'connected' });
                if (self.handlers.onConnect) {
                    self.handlers.onConnect();
                }
            };

            this.ws.onmessage = function(event) {
                var data;
                try {
                    data = JSON.parse(event.data);
                } catch (e) {
                    return; // Ignore non-JSON messages
                }

                // Handle session creation
                if (data.type === 'session-created' && data.sessionId) {
                    self.sessionId = data.sessionId;
                    self.notifyParent('session-created', { sessionId: data.sessionId });
                    if (self.handlers.onSessionCreated) {
                        self.handlers.onSessionCreated(data.sessionId);
                    }
                    return;
                }

                // Server emits authoritative token counts from SDK modelUsage after each
                // result message: { type:'token-budget', data:{used, total}, sessionId }
                // Forward to parent as context-update with the field names parent expects
                // (usedTokens/maxTokens) so the chat-v2 header progress bar can tick.
                if (data.type === 'token-budget' && data.data) {
                    var used = data.data.used || 0;
                    var total = data.data.total || 200000;
                    // Keep internal mirror so estimateTokens() bumps from the real baseline
                    self.estimatedTokens = used;
                    self.notifyParent('context-update', {
                        usedTokens: used,
                        maxTokens: total,
                        estimatedTokens: used,  // legacy field for older parent listeners
                        sessionId: self.sessionId
                    });
                    // Don't forward token-budget to page handler — it's a meta event
                    return;
                }

                // Forward to page handler
                if (self.handlers.onMessage) {
                    self.handlers.onMessage(data);
                }
            };

            this.ws.onclose = function(event) {
                self.ws = null;

                // Auth failure detection: close right after connect attempt
                if (freshConnect && (event.code === 1006 || event.code === 1008)) {
                    self.notifyParent('connection-status', { status: 'auth-expired' });
                    if (self.handlers.onError) {
                        self.handlers.onError('Authentication failed or expired');
                    }
                    return;
                }

                if (self.handlers.onDisconnect) {
                    self.handlers.onDisconnect();
                }
                self.notifyParent('connection-status', { status: 'disconnected' });

                // Auto-reconnect with exponential backoff
                if (self._reconnectAttempts < RECONNECT_MAX) {
                    var delay = Math.min(1000 * Math.pow(2, self._reconnectAttempts), 30000);
                    self._reconnectAttempts++;
                    self._reconnectTimer = setTimeout(function() {
                        self.notifyParent('connection-status', { status: 'reconnecting', attempt: self._reconnectAttempts });
                        self.connect();
                    }, delay);
                } else {
                    self.notifyParent('connection-status', { status: 'failed', reason: 'Max reconnect attempts reached' });
                    if (self.handlers.onError) {
                        self.handlers.onError('Connection lost. Max reconnect attempts reached.');
                    }
                }
            };

            this.ws.onerror = function() {
                // onclose will fire after this, handling reconnect there
            };
        },

        sendCommand: function(text, images) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                if (this.handlers.onError) {
                    this.handlers.onError('Not connected to server');
                }
                return;
            }

            var commandText = text || '';

            // If no session yet and context is provided, prepend context
            if (!this.sessionId && this.context) {
                commandText = '[Context: ' + this.context + ']\n\n' + commandText;
            }

            var payload = {
                type: 'claude-command',
                command: commandText,
                options: {
                    sessionId: this.sessionId || undefined,
                    model: (this.config && this.config.model) || 'sonnet',
                    permissionMode: (this.config && this.config.permissionMode) || 'default',
                    cwd: (this.config && this.config.cwd) || '/home/rooted-robotics/software/agent-harness/directives-orchestration-execution-self-improving-system'
                }
            };

            if (images && images.length > 0) {
                payload.images = images.map(function(dataUrl) {
                    // dataUrl format: data:image/png;base64,AAAA...
                    var parts = dataUrl.split(',');
                    var meta = parts[0] || '';
                    var mediaType = 'image/png';
                    var match = meta.match(/data:([^;]+)/);
                    if (match) mediaType = match[1];
                    return {
                        type: 'base64',
                        media_type: mediaType,
                        data: parts[1] || ''
                    };
                });
            }

            try {
                this.ws.send(JSON.stringify(payload));
            } catch (e) {
                if (this.handlers.onError) {
                    this.handlers.onError('Failed to send message: ' + e.message);
                }
            }
        },

        respondPermission: function(requestId, allowed) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            try {
                this.ws.send(JSON.stringify({
                    type: 'permission-response',
                    requestId: requestId,
                    allowed: !!allowed
                }));
            } catch (e) {
                // Silently fail permission response
            }
        },

        loadHistory: function(sessionId, callback) {
            if (!this.token || !sessionId) {
                try { console.warn('[EmbedShared] loadHistory skipped — no token or sessionId', { hasToken: !!this.token, sessionId: sessionId }); } catch(e) {}
                if (callback) callback([]);
                return;
            }

            var url = '/api/projects/' + encodeURIComponent(PROJECT_NAME) + '/sessions/' + encodeURIComponent(sessionId) + '/messages';
            try { console.log('[EmbedShared] loadHistory →', url); } catch(e) {}

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
            xhr.setRequestHeader('Accept', 'application/json');

            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        var messages = Array.isArray(data) ? data : (data.messages || []);
                        try { console.log('[EmbedShared] loadHistory ← 200', { count: messages.length, shape: Array.isArray(data) ? 'array' : 'object' }); } catch(e) {}
                        if (callback) callback(messages);
                    } catch (e) {
                        try { console.error('[EmbedShared] loadHistory parse error', e); } catch(_) {}
                        if (callback) callback([]);
                    }
                } else {
                    try { console.warn('[EmbedShared] loadHistory ← non-200', xhr.status, xhr.responseText && xhr.responseText.slice(0, 200)); } catch(e) {}
                    if (callback) callback([]);
                }
            };

            xhr.onerror = function() {
                try { console.error('[EmbedShared] loadHistory network error'); } catch(e) {}
                if (callback) callback([]);
            };

            xhr.send();
        },

        notifyParent: function(type, data) {
            var message = { type: type };
            if (data) {
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        message[key] = data[key];
                    }
                }
            }
            try {
                window.parent.postMessage(message, '*');
            } catch (e) {
                // Cannot communicate with parent
            }
        },

        // Optimistic token bump — fires immediately after user input / streamed assistant
        // text so the UI ticks without waiting for the server's real count at turn end.
        // Server's `token-budget` message later overwrites with the authoritative value.
        estimateTokens: function(text) {
            if (!text) return;
            this.estimatedTokens += Math.ceil(text.length / 4);
            var maxTokens = 200000;
            this.notifyParent('context-update', {
                usedTokens: this.estimatedTokens,
                maxTokens: maxTokens,
                estimatedTokens: this.estimatedTokens,  // legacy field for older parent listeners
                sessionId: this.sessionId
            });
        },

        destroy: function() {
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }
            if (this.ws) {
                try { this.ws.close(); } catch(e) {}
                this.ws = null;
            }
            this.token = null;
            this.sessionId = null;
            this.context = null;
            this._initialized = false;
        }
    };
})();
