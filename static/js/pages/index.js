document.addEventListener('DOMContentLoaded', function() {
    const powerBtn = document.getElementById('power-btn');
    const controlStatusIndicator = document.getElementById('control-status-indicator');
    const controlStatusText = document.getElementById('control-status-text');
    const logContainer = document.getElementById('log-container');
    const autoScrollToggle = document.getElementById('auto-scroll-toggle');
    const inviteContainer = document.getElementById('invite-container');
    const inviteLink = document.getElementById('invite-link');
    const copyInviteBtn = document.getElementById('copy-invite');
    let currentUserRole = 'guest';

    let eventSource;
    let statusInterval;
    let logStreamStatusDebounce = null;

    /** Tell navbar to refresh bot status (optional optimistic label before API catches up). */
    function notifyNavbarBotStatus(detail) {
        window.dispatchEvent(new CustomEvent('bot-status-refresh', { detail: detail || {} }));
    }

    function canControlBot() {
        return currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    // --- Main Setup ---
    fetch('/api/auth-status')
        .then(r => r.json())
        .then(d => {
            currentUserRole = d?.current_user?.role || (d?.panel_auth_enabled ? 'guest' : 'super_admin');
            if (!canControlBot()) {
                powerBtn.disabled = true;
                powerBtn.classList.add('opacity-60', 'cursor-not-allowed');
                powerBtn.title = 'Read-only: insufficient permissions';
            }
        })
        .catch(() => {})
        .finally(() => {
            checkBotStatus();
            loadServers();
            if (canControlBot()) {
                setupLogStream();
            }
            statusInterval = setInterval(checkBotStatus, DASHBOARD_STATUS_INTERVAL_MS);
        });

    async function loadServers() {
        const container = document.getElementById('servers-list');
        try {
            const res = await fetch('/api/servers/');
            const servers = await res.json();
            const filtered = servers.filter(s => !s.server_name.toLowerCase().includes('direct message'));
            if (filtered.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-sm col-span-full">No servers registered yet.</p>';
                return;
            }
            container.innerHTML = filtered.map(s => `
                <div class="flex items-center justify-between py-1.5">
                    <div class="flex items-center gap-2 min-w-0">
                        <i class="fas fa-server text-gray-500 text-xs flex-shrink-0"></i>
                        <span class="text-gray-300 text-sm truncate">${s.server_name}</span>
                    </div>
                    <a href="/servers" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap ml-2">channels →</a>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p class="text-red-500 text-sm col-span-full">Failed to load servers.</p>';
        }
    }
    // After Activate/Deactivate: 5 status checks — now, then every 2s — then back to 10s (dashboard-only).
    const DASHBOARD_STATUS_INTERVAL_MS = 10000;
    const BURST_POLL_INTERVAL_MS = 2000;
    const BURST_POLL_EXTRA_COUNT = 4; // +1 immediate = 5 total

    function burstPoll() {
        clearInterval(statusInterval);
        checkBotStatus(true);
        let count = 0;
        const burst = setInterval(() => {
            checkBotStatus(true);
            if (++count >= BURST_POLL_EXTRA_COUNT) {
                clearInterval(burst);
                statusInterval = setInterval(checkBotStatus, DASHBOARD_STATUS_INTERVAL_MS);
            }
        }, BURST_POLL_INTERVAL_MS);
    }

    // --- Event Listeners ---

    powerBtn.addEventListener('click', function() {
        if (!canControlBot()) {
            return;
        }
        if (powerBtn.dataset.status === 'active') {
            deactivateBot();
            burstPoll();
        } else if (powerBtn.dataset.status === 'inactive' || powerBtn.dataset.status === 'crashed') {
            activateBot();
            burstPoll();
        }
        // Do nothing if it's starting or stopping
    });

    copyInviteBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(inviteLink.value)
            .then(() => {
                const originalIcon = copyInviteBtn.innerHTML;
                copyInviteBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { copyInviteBtn.innerHTML = originalIcon; }, 2000);
            });
    });

    autoScrollToggle.addEventListener('change', function() {
        if (this.checked) {
            scrollToBottom();
        }
    });

    // --- Core Functions ---

    function activateBot() {
        // Optimistic UI Update: Set to 'starting' immediately for instant feedback
        updateStatus('starting');
        notifyNavbarBotStatus({ optimistic: 'starting' });

        fetch('/api/discord/activate', { method: 'POST' })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => Promise.reject(err));
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    addLogEntry('Bot activation initiated...');
                }
            })
            .catch(error => {
                addLogEntry(`Error activating bot: ${error.detail || error.message}`);
                // Revert UI if API call fails
                checkBotStatus(true);
            });
    }

    function deactivateBot() {
        // Optimistic UI Update: Set to 'stopping' immediately
        updateStatus('stopping');
        notifyNavbarBotStatus({ optimistic: 'stopping' });

        fetch('/api/discord/deactivate', { method: 'POST' })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => Promise.reject(err));
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    addLogEntry('Sending shutdown signal to bot...');
                }
            })
            .catch(error => {
                addLogEntry(`Error deactivating bot: ${error.detail || error.message}`);
                // Revert UI if API call fails
                checkBotStatus(true);
            });
    }

    function checkBotStatus(syncNavbar) {
        fetch('/api/discord/status')
            .then(async (response) => {
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data || typeof data.status !== 'string') {
                    console.warn('Bot status unavailable:', response.status, data);
                    if (syncNavbar) notifyNavbarBotStatus();
                    return;
                }
                updateStatus(data.status);
                if (syncNavbar) notifyNavbarBotStatus();
                if (data.status === 'active') {
                    if (!inviteLink.value) fetchInviteLink();
                } else {
                    inviteContainer.classList.add('hidden');
                    inviteLink.value = '';
                }
            })
            .catch((error) => {
                console.error('Failed to fetch status:', error);
                updateStatus('crashed');
                if (syncNavbar) notifyNavbarBotStatus();
            });
    }

    // Update bot status UI
    function updateStatus(status) {
        // Store current status on the button for easier logic
        powerBtn.dataset.status = status;

        // Reset all classes
        const allStatusClasses = ['status-active', 'status-inactive', 'status-starting', 'status-stopping', 'status-crashed'];
        controlStatusIndicator.classList.remove(...allStatusClasses);
        powerBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-gray-800', 'hover:bg-gray-700', 'bg-yellow-600');

        powerBtn.disabled = !canControlBot();

        switch (status) {
            case 'active':
                controlStatusIndicator.classList.add('status-active');
                controlStatusText.textContent = 'Active';
                powerBtn.innerHTML = '<i class="fas fa-power-off mr-2"></i> Deactivate';
                powerBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                break;
            case 'starting':
                controlStatusIndicator.classList.add('status-starting');
                controlStatusText.textContent = 'Starting';
                powerBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Starting...';
                powerBtn.disabled = true;
                break;
            case 'stopping':
                controlStatusIndicator.classList.add('status-stopping');
                controlStatusText.textContent = 'Stopping';
                powerBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Stopping...';
                powerBtn.disabled = true;
                break;
            case 'crashed':
                controlStatusIndicator.classList.add('status-crashed');
                controlStatusText.textContent = 'Crashed';
                powerBtn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i> Restart';
                powerBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
                break;
            default: // 'inactive'
                controlStatusIndicator.classList.add('status-inactive');
                controlStatusText.textContent = 'Inactive';
                powerBtn.innerHTML = '<i class="fas fa-power-off mr-2"></i> Activate';
                powerBtn.classList.add('bg-gray-800', 'hover:bg-gray-700');
                break;
        }
        if (!canControlBot()) {
            powerBtn.classList.add('opacity-60', 'cursor-not-allowed');
        }
    }

    // Set up log stream connection
    function setupLogStream() {
        if (!canControlBot()) return;
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/discord/stream-logs');

        eventSource.onmessage = function(e) {
            addLogEntry(e.data);

            // Do not drive UI status from log text: the stream replays the last ~10 file lines on
            // connect, so old "shut down" / "crashed" lines would flash Inactive while the bot is Active.
            // Use /api/discord/status as the single source of truth when logs hint at a transition.
            const hint =
                e.data.includes('Bot starting up')
                || e.data.includes('Bot has shut down cleanly')
                || e.data.includes('Bot crashed')
                || e.data.includes('Logged in as');
            if (hint) {
                if (logStreamStatusDebounce) clearTimeout(logStreamStatusDebounce);
                logStreamStatusDebounce = setTimeout(() => {
                    logStreamStatusDebounce = null;
                    checkBotStatus(true);
                }, 120);
            }
        };

        eventSource.onerror = function() {
            addLogEntry('Connection to log stream lost. Attempting to reconnect...');
            setTimeout(setupLogStream, 5000);
        };
    }

    // Add log entry to the container
    function addLogEntry(message) {
        const now = new Date();
        const timeString = now.toLocaleTimeString();

        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry py-2 text-sm';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'text-gray-500 mr-2';
        timeSpan.textContent = `[${timeString}]`;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'text-gray-300';
        messageSpan.textContent = message;

        logEntry.appendChild(timeSpan);
        logEntry.appendChild(messageSpan);

        logContainer.appendChild(logEntry);

        // Auto-scroll if enabled
        if (autoScrollToggle.checked) {
            scrollToBottom();
        }

        // Clear "waiting for logs" message if it exists
        if (logContainer.firstChild && logContainer.firstChild.textContent === 'Waiting for logs...') {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    // Scroll to bottom of log container
    function scrollToBottom() {
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Fetch bot invite link
    function fetchInviteLink() {
        fetch('/api/discord/invite')
            .then(response => response.json())
            .then(data => {
                if (data.status === 'active' && data.invite) {
                    inviteLink.value = data.invite;
                    inviteContainer.classList.remove('hidden');
                }
            });
    }
});
