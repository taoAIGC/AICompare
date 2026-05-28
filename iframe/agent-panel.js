(function() {
    const AgentCatalog = window.AICompareAgentCatalog || {};
    const AgentPromptUtils = window.AICompareAgentPromptUtils || {};
    const state = {
        agentId: '',
        panelId: '',
        messages: [],
        isLoading: false,
        localDraft: '',
        pendingAttachments: []
    };

    const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

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

    function escapeHtmlAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function normalizeMarkdownLineBreaks(value) {
        return String(value ?? '').replace(/\r\n?/g, '\n');
    }

    function escapeRegExp(value) {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function sanitizeUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        if (/^(https?:|mailto:)/i.test(value)) {
            return value;
        }
        return '';
    }

    function renderInlineMarkdown(text) {
        const source = String(text ?? '');
        const codeTokens = [];
        let html = escapeHtml(source);

        html = html.replace(/`([^`\n]+)`/g, (_, code) => {
            const token = `__AGENT_CODE_${codeTokens.length}__`;
            codeTokens.push(`<code>${code}</code>`);
            return token;
        });

        html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
            const safeUrl = sanitizeUrl(url);
            if (!safeUrl) {
                return escapeHtml(`![${alt}](${url})`);
            }
            const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
            return `<img src="${escapeHtmlAttribute(safeUrl)}" alt="${escapeHtmlAttribute(alt)}"${titleAttr}>`;
        });

        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
            const safeUrl = sanitizeUrl(url);
            if (!safeUrl) {
                return `[${label}](${url})`;
            }
            const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
            return `<a href="${escapeHtmlAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
        });

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
        html = html.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        codeTokens.forEach((markup, index) => {
            html = html.replace(new RegExp(escapeRegExp(`__AGENT_CODE_${index}__`), 'g'), markup);
        });

        return html;
    }

    function renderMarkdownToHtml(markdown) {
        const source = normalizeMarkdownLineBreaks(markdown).trim();
        if (!source) {
            return '';
        }

        const lines = source.split('\n');
        const blocks = [];
        let paragraphLines = [];
        let listType = null;
        let listItems = [];
        let inCodeBlock = false;
        let codeFence = '';
        let codeLang = '';
        let codeLines = [];
        let blockquoteLines = [];

        function flushParagraph() {
            if (!paragraphLines.length) return;
            blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('<br>'))}</p>`);
            paragraphLines = [];
        }

        function flushList() {
            if (!listType || !listItems.length) {
                listType = null;
                listItems = [];
                return;
            }
            const tag = listType === 'ol' ? 'ol' : 'ul';
            const itemsHtml = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('');
            blocks.push(`<${tag}>${itemsHtml}</${tag}>`);
            listType = null;
            listItems = [];
        }

        function flushBlockquote() {
            if (!blockquoteLines.length) return;
            const content = renderMarkdownToHtml(blockquoteLines.join('\n'));
            blocks.push(`<blockquote>${content}</blockquote>`);
            blockquoteLines = [];
        }

        function flushCodeBlock() {
            if (!inCodeBlock) return;
            const languageClass = codeLang ? ` class="language-${escapeHtmlAttribute(codeLang)}"` : '';
            blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            inCodeBlock = false;
            codeFence = '';
            codeLang = '';
            codeLines = [];
        }

        for (const line of lines) {
            if (inCodeBlock) {
                if (line.startsWith(codeFence)) {
                    flushCodeBlock();
                } else {
                    codeLines.push(line);
                }
                continue;
            }

            const fenceMatch = line.match(/^(```+|~~~+)\s*([\w-]+)?\s*$/);
            if (fenceMatch) {
                flushParagraph();
                flushList();
                flushBlockquote();
                inCodeBlock = true;
                codeFence = fenceMatch[1];
                codeLang = String(fenceMatch[2] || '').trim();
                codeLines = [];
                continue;
            }

            const trimmed = line.trim();
            if (!trimmed) {
                flushParagraph();
                flushList();
                flushBlockquote();
                continue;
            }

            const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
            if (blockquoteMatch) {
                flushParagraph();
                flushList();
                blockquoteLines.push(blockquoteMatch[1]);
                continue;
            }
            flushBlockquote();

            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                flushParagraph();
                flushList();
                const level = headingMatch[1].length;
                blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
                continue;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushParagraph();
                flushList();
                blocks.push('<hr>');
                continue;
            }

            const orderedListMatch = line.match(/^\s*\d+\.\s+(.+)$/);
            if (orderedListMatch) {
                flushParagraph();
                if (listType && listType !== 'ol') {
                    flushList();
                }
                listType = 'ol';
                listItems.push(orderedListMatch[1].trim());
                continue;
            }

            const unorderedListMatch = line.match(/^\s*[-*+]\s+(.+)$/);
            if (unorderedListMatch) {
                flushParagraph();
                if (listType && listType !== 'ul') {
                    flushList();
                }
                listType = 'ul';
                listItems.push(unorderedListMatch[1].trim());
                continue;
            }

            flushList();
            paragraphLines.push(trimmed);
        }

        flushBlockquote();
        flushParagraph();
        flushList();
        flushCodeBlock();

        return blocks.join('');
    }

    function renderMessageContent(message = {}) {
        const content = String(message.content || '');
        const role = String(message.role || 'assistant').trim();
        if (!content) {
            return '';
        }
        if (role === 'assistant' && !message.isError) {
            return `<div class="agent-message-content agent-markdown">${renderMarkdownToHtml(content)}</div>`;
        }
        return `<div class="agent-message-content">${escapeHtml(content)}</div>`;
    }

    function t(key, fallback = '', substitutions = undefined) {
        try {
            return chrome?.i18n?.getMessage?.(key, substitutions) || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function formatFileSize(size) {
        const value = Number(size) || 0;
        if (value >= 1024 * 1024) {
            return `${(value / 1024 / 1024).toFixed(1)} MB`;
        }
        if (value >= 1024) {
            return `${Math.round(value / 1024)} KB`;
        }
        return `${value} B`;
    }

    function normalizeAttachment(rawAttachment = {}) {
        const name = String(rawAttachment.name || rawAttachment.fileName || '').trim();
        const type = String(rawAttachment.type || '').trim();
        const size = Math.max(0, Number(rawAttachment.size) || 0);
        const dataUrl = typeof rawAttachment.dataUrl === 'string' ? rawAttachment.dataUrl : '';
        const textContent = typeof rawAttachment.textContent === 'string' ? rawAttachment.textContent : '';
        const textPreview = typeof rawAttachment.textPreview === 'string' ? rawAttachment.textPreview : '';
        const fileId = typeof rawAttachment.fileId === 'string' ? rawAttachment.fileId.trim() : '';
        const uploadMode = typeof rawAttachment.uploadMode === 'string' ? rawAttachment.uploadMode.trim() : '';
        const mediaCategory = String(rawAttachment.mediaCategory || '').trim();
        if (!name) {
            return null;
        }
        return {
            id: String(rawAttachment.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            name,
            type,
            size,
            dataUrl,
            textContent,
            textPreview,
            fileId,
            uploadMode,
            mediaCategory,
            extractedAsText: rawAttachment.extractedAsText === true
        };
    }

    function setPendingAttachments(nextAttachments = []) {
        state.pendingAttachments = Array.isArray(nextAttachments)
            ? nextAttachments.map((item) => normalizeAttachment(item)).filter(Boolean)
            : [];
        renderPendingAttachments();
    }

    function renderAttachmentChips(attachments = [], tone = 'user') {
        const normalizedAttachments = Array.isArray(attachments)
            ? attachments.map((item) => normalizeAttachment(item)).filter(Boolean)
            : [];
        if (!normalizedAttachments.length) {
            return '';
        }

        const chips = normalizedAttachments.map((attachment) => {
            const meta = attachment.size > 0 ? ` · ${formatFileSize(attachment.size)}` : '';
            return `
                <span class="agent-message-attachment ${tone}">
                    <span aria-hidden="true">📎</span>
                    <span class="agent-message-attachment-name">${escapeHtml(attachment.name)}</span>
                    <span class="agent-message-attachment-meta">${escapeHtml(meta)}</span>
                </span>
            `;
        }).join('');

        return `<div class="agent-message-attachments">${chips}</div>`;
    }

    function renderMessages() {
        const container = document.getElementById('agentMessages');
        if (!container) return;

        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        state.messages.forEach((message) => {
            const item = document.createElement('div');
            item.className = `agent-message ${message.role || 'assistant'} ${message.isError ? 'error' : ''}`.trim();
            const contentHtml = renderMessageContent(message);
            const attachmentsHtml = renderAttachmentChips(message.attachments, message.role || 'user');
            item.innerHTML = `${contentHtml}${attachmentsHtml}`;
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

    function syncStaticUiText() {
        const sendButton = document.getElementById('agentSendButton');
        const attachmentButton = document.getElementById('agentAttachmentButton');
        if (sendButton) {
            sendButton.textContent = t('agentPanelSendButton', 'Send');
        }
        if (attachmentButton) {
            attachmentButton.title = t('fileUploadButtonTitle', 'Upload Files');
            attachmentButton.setAttribute('aria-label', t('fileUploadButtonTitle', 'Upload Files'));
            const image = attachmentButton.querySelector('img');
            if (image) {
                image.alt = t('fileUploadButtonAlt', 'Attachment');
            }
        }
    }

    function postToParent(payload) {
        try {
            window.parent.postMessage({
                type: 'AGENT_PANEL_EVENT',
                ...payload
            }, '*');
        } catch (_) {}
    }

    function stageAttachmentSourcesInParent(entries = []) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        try {
            const bridge = window.parent?.AICompareIframeAgentAttachmentBridge;
            if (bridge && typeof bridge.stageFilesFromPanel === 'function') {
                bridge.stageFilesFromPanel({
                    panelId: state.panelId,
                    agentId: state.agentId,
                    entries
                });
                return;
            }
        } catch (_) {}

        postToParent({
            panelId: state.panelId,
            agentId: state.agentId,
            event: 'pendingAttachmentFilesSelected',
            entries
        });
    }

    async function ensureAgentPanelCatalogReady() {
        if (typeof window.hydrateBundledAgentCatalogIfNeeded === 'function') {
            await window.hydrateBundledAgentCatalogIfNeeded().catch(() => false);
        }
        if (typeof AgentCatalog.ensureCatalogHydrated === 'function') {
            await AgentCatalog.ensureCatalogHydrated().catch(() => null);
        }
    }

    function initializeAgentPanelSkeleton() {
        state.agentId = getQueryParam('agentId');
        state.panelId = `agent:${state.agentId}`;
        renderMessages();
        syncInputPlaceholder();
        syncStaticUiText();
        renderPendingAttachments();
    }

    function renderPendingAttachments() {
        const container = document.getElementById('agentPendingAttachments');
        if (!container) return;

        const normalizedAttachments = Array.isArray(state.pendingAttachments)
            ? state.pendingAttachments.map((item) => normalizeAttachment(item)).filter(Boolean)
            : [];

        if (!normalizedAttachments.length) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = normalizedAttachments.map((attachment) => `
            <div class="agent-pending-attachment" data-attachment-id="${escapeHtml(attachment.id)}">
                <span aria-hidden="true">📎</span>
                <span class="agent-pending-attachment-name">${escapeHtml(attachment.name)}</span>
                <span class="agent-pending-attachment-meta">${escapeHtml(formatFileSize(attachment.size))}</span>
                <button
                    type="button"
                    class="agent-pending-attachment-remove"
                    data-attachment-id="${escapeHtml(attachment.id)}"
                    aria-label="${escapeHtml(t('agentPanelRemoveAttachment', 'Remove attachment'))}"
                    title="${escapeHtml(t('agentPanelRemoveAttachment', 'Remove attachment'))}"
                >×</button>
            </div>
        `).join('');
    }

    function removePendingAttachment(attachmentId) {
        const normalizedId = String(attachmentId || '').trim();
        if (!normalizedId) return;
        setPendingAttachments(
            state.pendingAttachments.filter((attachment) => String(attachment?.id || '').trim() !== normalizedId)
        );
        postToParent({
            panelId: state.panelId,
            agentId: state.agentId,
            event: 'pendingAttachmentsChanged',
            attachments: state.pendingAttachments
        });
    }

    async function buildAttachmentPayload(file) {
        if (!(file instanceof File)) {
            return null;
        }
        if (file.size > MAX_ATTACHMENT_SIZE) {
            throw new Error(t('agentPanelAttachmentTooLarge', 'Attachment is too large'));
        }
        if (typeof AgentPromptUtils.buildAttachmentPayloadFromSource === 'function') {
            return AgentPromptUtils.buildAttachmentPayloadFromSource(file, {
                maxTextLength: 12000,
                previewLength: 800
            });
        }

        const type = String(file.type || '').trim();
        return normalizeAttachment({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            type,
            size: file.size,
            mediaCategory: type.startsWith('image/') ? 'image' : 'binary'
        });
    }

    async function handleAttachmentSelection(event) {
        const files = Array.from(event?.target?.files || []);
        if (!files.length) {
            return;
        }

        const builtAttachments = [];
        const sourceEntries = [];
        for (const file of files) {
            try {
                const attachment = await buildAttachmentPayload(file);
                if (attachment) {
                    builtAttachments.push(attachment);
                    sourceEntries.push({
                        attachmentId: attachment.id,
                        file
                    });
                }
            } catch (error) {
                postToParent({
                    panelId: state.panelId,
                    agentId: state.agentId,
                    event: 'attachmentError',
                    error: error?.message || t('fileUploadFailedTitle', 'File upload failed')
                });
            }
        }

        if (builtAttachments.length > 0) {
            stageAttachmentSourcesInParent(sourceEntries);
            setPendingAttachments([
                ...state.pendingAttachments,
                ...builtAttachments
            ]);
            postToParent({
                panelId: state.panelId,
                agentId: state.agentId,
                event: 'pendingAttachmentsChanged',
                attachments: state.pendingAttachments
            });
        }

        if (event?.target) {
            event.target.value = '';
        }
    }

    function submitLocalMessage() {
        const input = document.getElementById('agentLocalInput');
        if (!input) return;
        const content = String(input.value || '').trim();
        const attachments = state.pendingAttachments.slice();
        if (!content && attachments.length === 0) return;
        postToParent({
            panelId: state.panelId,
            agentId: state.agentId,
            event: 'submitLocalMessage',
            content,
            attachments
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
        state.name = nextState.name || state.name;
        state.messages = Array.isArray(nextState.messages) ? nextState.messages : [];
        state.isLoading = nextState.isLoading === true;
        state.localDraft = typeof nextState.localDraft === 'string' ? nextState.localDraft : state.localDraft;
        setPendingAttachments(nextState.pendingAttachments);
        const input = document.getElementById('agentLocalInput');
        if (input) {
            input.value = state.localDraft || '';
        }
        renderMessages();
        syncInputPlaceholder();
    });

    document.addEventListener('DOMContentLoaded', async () => {
        initializeAgentPanelSkeleton();

        const sendButton = document.getElementById('agentSendButton');
        const input = document.getElementById('agentLocalInput');
        const attachmentButton = document.getElementById('agentAttachmentButton');
        const attachmentInput = document.getElementById('agentAttachmentInput');
        const pendingContainer = document.getElementById('agentPendingAttachments');

        if (sendButton) {
            sendButton.addEventListener('click', submitLocalMessage);
        }
        if (attachmentButton && attachmentInput) {
            attachmentButton.addEventListener('click', () => attachmentInput.click());
            attachmentInput.addEventListener('change', handleAttachmentSelection);
        }
        if (pendingContainer) {
            pendingContainer.addEventListener('click', (event) => {
                const removeButton = event.target.closest('.agent-pending-attachment-remove');
                if (!removeButton) return;
                removePendingAttachment(removeButton.dataset.attachmentId);
            });
        }
        if (input) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitLocalMessage();
                }
            });
            input.addEventListener('input', () => {
                state.localDraft = String(input.value || '');
                postToParent({
                    panelId: state.panelId,
                    agentId: state.agentId,
                    event: 'localDraftChanged',
                    draft: state.localDraft
                });
            });
        }

        ensureAgentPanelCatalogReady().then(() => {
            syncInputPlaceholder();
        }).catch((error) => {
            console.warn('技能面板预热目录失败:', error);
        });
    });
})();
