(function() {
    const AgentCatalog = window.AICompareAgentCatalog || {};
    const state = {
        agentId: '',
        panelId: '',
        messages: [],
        isLoading: false
    };

    function getQueryParam(name) {
        try {
            return new URLSearchParams(window.location.search).get(name) || '';
        } catch (_) {
            return '';
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case '\'': return '&#39;';
                default: return char;
            }
        });
    }

    function t(key, fallback = '', substitutions = undefined) {
        try {
            return chrome?.i18n?.getMessage?.(key, substitutions) || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function renderMessages() {
        const container = document.getElementById('agentMessages');
        if (!container) return;

        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        state.messages.forEach((message) => {
            const item = document.createElement('div');
            item.className = `agent-message ${message.role || 'assistant'} ${message.isError ? 'error' : ''}`.trim();
            item.innerHTML = escapeHtml(message.content || '');
            fragment.appendChild(item);
        });

        if (state.isLoading) {
            const loading = document.createElement('div');
            loading.className = 'agent-message assistant';
            loading.textContent = t('agentPanelThinking', 'thinking...');
            fragment.appendChild(loading);
        }

        container.appendChild(fragment);
        container.scrollTop = container.scrollHeight;
    }

    function syncInputPlaceholder() {
        const input = document.getElementById('agentLocalInput');
        if (!input) return;
        const fallbackAgent = typeof AgentCatalog.getAgentById === 'function'
            ? AgentCatalog.getAgentById(state.agentId)
            : null;
        const agentName = String(state.name || fallbackAgent?.name || '').trim();
        input.placeholder = agentName
            ? t('agentPanelFollowUpPlaceholderWithName', `Continue with ${agentName}`, [agentName])
            : t('agentPanelFollowUpPlaceholder', 'Ask a follow-up');
    }

    function postToParent(payload) {
        try {
            window.parent.postMessage({
                type: 'AGENT_PANEL_EVENT',
                ...payload
            }, '*');
        } catch (_) {}
    }

    function submitLocalMessage() {
        const input = document.getElementById('agentLocalInput');
        if (!input) return;
        const content = String(input.value || '').trim();
        if (!content) return;
        input.value = '';
        postToParent({
            panelId: state.panelId,
            agentId: state.agentId,
            event: 'submitLocalMessage',
            content
        });
    }

    function findUserMessageOccurrence(query, occurrenceIndex = 0) {
        const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim();
        if (!normalizedQuery) {
            return null;
        }

        let matchedCount = 0;
        const nodes = Array.from(document.querySelectorAll('.agent-message.user'));
        for (const node of nodes) {
            const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
            if (text !== normalizedQuery) continue;
            if (matchedCount === Math.max(0, Number(occurrenceIndex) || 0)) {
                return node;
            }
            matchedCount += 1;
        }

        return nodes.reverse().find((node) => {
            const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
            return text === normalizedQuery;
        }) || null;
    }

    window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'SCROLL_TO_PROMPT') {
            const matchedNode = findUserMessageOccurrence(data.query, data.occurrenceIndex);
            if (matchedNode) {
                matchedNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                matchedNode.classList.add('is-highlighted');
                window.setTimeout(() => matchedNode.classList.remove('is-highlighted'), 1800);
            }
            postToParent({
                type: 'SCROLL_TO_PROMPT_RESULT',
                requestId: data.requestId,
                siteName: state.agentId,
                found: Boolean(matchedNode)
            });
            return;
        }
        if (data.type !== 'AGENT_PANEL_STATE') return;
        const nextState = data.state || {};
        state.agentId = nextState.agentId || state.agentId;
        state.panelId = nextState.panelId || state.panelId;
        state.messages = Array.isArray(nextState.messages) ? nextState.messages : [];
        state.isLoading = nextState.isLoading === true;
        renderMessages();
        syncInputPlaceholder();
    });

    document.addEventListener('DOMContentLoaded', () => {
        state.agentId = getQueryParam('agentId');
        state.panelId = `agent:${state.agentId}`;
        renderMessages();
        syncInputPlaceholder();

        const sendButton = document.getElementById('agentSendButton');
        const input = document.getElementById('agentLocalInput');
        if (sendButton) {
            sendButton.textContent = t('agentPanelSendButton', 'Send');
        }
        if (sendButton) {
            sendButton.addEventListener('click', submitLocalMessage);
        }
        if (input) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitLocalMessage();
                }
            });
        }
    });
})();
