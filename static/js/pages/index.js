document.addEventListener('DOMContentLoaded', function() {
    const powerBtn = document.getElementById('power-btn');
    const controlStatusIndicator = document.getElementById('control-status-indicator');
    const controlStatusText = document.getElementById('control-status-text');
    const logContainer = document.getElementById('log-container');
    const autoScrollToggle = document.getElementById('auto-scroll-toggle');
    const inviteContainer = document.getElementById('invite-container');
    const inviteLink = document.getElementById('invite-link');
    const copyInviteBtn = document.getElementById('copy-invite');

    let eventSource;
    let statusInterval;

    // --- Main Setup ---
    checkBotStatus();
    loadServers();

    async function loadServers() {
        const container = document.getElementById('servers-list');
        try {
            const res = await fetch('/api/servers/');
            const servers = await res.json();
            const filtered = servers.filter(s => !s.server_name.toLowerCase().includes('direct message'));
            if (filtered.length === 0) {
                container.innerHTML = '<p class="server-list-state">No servers registered yet.</p>';
                return;
            }
            container.innerHTML = filtered.map(s => `
                <div class="server-list-row">
                    <div class="server-list-row-main">
                        <i class="fas fa-server server-list-icon"></i>
                        <span class="server-list-name">${s.server_name}</span>
                    </div>
                    <a href="/servers" class="server-list-link">channels →</a>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p class="server-list-state server-list-state-error">Failed to load servers.</p>';
        }
    }
    setupLogStream();
    statusInterval = setInterval(checkBotStatus, 10000);

    function burstPoll() {
        clearInterval(statusInterval);
        checkBotStatus();
        let count = 0;
        const burst = setInterval(() => {
            checkBotStatus();
            if (++count >= 3) {
                clearInterval(burst);
                statusInterval = setInterval(checkBotStatus, 10000);
            }
        }, 2000);
    }

    // --- Event Listeners ---

    powerBtn.addEventListener('click', function() {
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
                checkBotStatus();
            });
    }

    function deactivateBot() {
        // Optimistic UI Update: Set to 'stopping' immediately
        updateStatus('stopping');

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
                checkBotStatus();
            });
    }

    function checkBotStatus() {
        fetch('/api/discord/status')
            .then(response => response.json())
            .then(data => {
                updateStatus(data.status);
                if (data.status === 'active') {
                    if (!inviteLink.value) fetchInviteLink();
                } else {
                    inviteContainer.classList.add('hidden');
                    inviteLink.value = '';
                }
            })
            .catch(error => {
                console.error('Failed to fetch status:', error);
                updateStatus('crashed'); // Assume crashed if we can't get status
            });
    }

    // Update bot status UI
    function updateStatus(status) {
        // Store current status on the button for easier logic
        powerBtn.dataset.status = status;

        // Reset all classes
        const allStatusClasses = ['status-active', 'status-inactive', 'status-starting', 'status-stopping', 'status-crashed'];
        controlStatusIndicator.classList.remove(...allStatusClasses);
        powerBtn.classList.remove('power-btn--active', 'power-btn--inactive', 'power-btn--crashed');

        powerBtn.disabled = false; // Enable by default

        switch (status) {
            case 'active':
                controlStatusIndicator.classList.add('status-active');
                controlStatusText.textContent = 'Active';
                powerBtn.innerHTML = '<i class="fas fa-power-off mr-2"></i> Deactivate';
                powerBtn.classList.add('power-btn--active');
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
                powerBtn.classList.add('power-btn--crashed');
                break;
            default: // 'inactive'
                controlStatusIndicator.classList.add('status-inactive');
                controlStatusText.textContent = 'Inactive';
                powerBtn.innerHTML = '<i class="fas fa-power-off mr-2"></i> Activate';
                powerBtn.classList.add('power-btn--inactive');
                break;
        }
    }

    // Set up log stream connection
    function setupLogStream() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/discord/stream-logs');

        eventSource.onmessage = function(e) {
            addLogEntry(e.data);

            // Check for status updates in logs
            if (e.data.includes('Bot starting up')) {
                updateStatus('starting');
            } else if (e.data.includes('Bot has shut down cleanly') || e.data.includes('Bot crashed')) {
                updateStatus('inactive');
                inviteContainer.classList.add('hidden');
            } else if (e.data.includes('Logged in as')) {
                updateStatus('active');
                fetchInviteLink();
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
        logEntry.className = 'console-log-entry';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'console-log-time';
        timeSpan.textContent = `[${timeString}]`;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'console-log-message';
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
