function createContactItem(label, value, href) {
    const item = document.createElement('article');
    item.className = 'contact-item';

    const labelEl = document.createElement('div');
    labelEl.className = 'contact-item-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const valueEl = href ? document.createElement('a') : document.createElement('div');
    valueEl.className = href ? 'contact-item-link' : 'contact-item-value';
    valueEl.textContent = value;

    if (href) {
        valueEl.href = href;
        valueEl.target = '_blank';
        valueEl.rel = 'noopener noreferrer';
    }

    item.appendChild(valueEl);
    return item;
}

function t(key, fallback = '') {
    return window.RuntimeI18n?.getMessage?.(key) || chrome?.i18n?.getMessage?.(key) || fallback;
}

function initializeI18n() {
    document.title = t('contactLink', 'Contact Me');

    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        const message = t(key);
        if (message) {
            element.textContent = message;
        }
    });
}

function parseSimpleMarkdown(markdown) {
    const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n');
    const entryMatch = normalizedMarkdown.match(/<!-- RELEASE_ENTRY:START -->([\s\S]*?)<!-- RELEASE_ENTRY:END -->/);
    const source = entryMatch ? entryMatch[1] : normalizedMarkdown;
    const lines = source.split('\n');
    const fragments = [];
    let currentList = null;
    let shouldRender = false;

    function closeList() {
        if (currentList) {
            fragments.push(currentList);
            currentList = null;
        }
    }

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) {
            closeList();
            return;
        }

        if (/^<!--/.test(line)) {
            return;
        }

        if (/^- Change range:/i.test(line) || /^- Generated at:/i.test(line)) {
            return;
        }

        if (/^##\s+/.test(line)) {
            closeList();
            shouldRender = false;
            return;
        }

        if (/^###\s+/.test(line)) {
            closeList();
            const heading = document.createElement('h4');
            heading.className = 'changelog-heading-secondary';
            heading.textContent = line.replace(/^###\s+/, '').trim();
            fragments.push(heading);
            shouldRender = true;
            return;
        }

        if (!shouldRender) {
            return;
        }

        if (/^[-*]\s+/.test(line)) {
            if (!currentList) {
                currentList = document.createElement('ul');
                currentList.className = 'changelog-list';
            }

            const item = document.createElement('li');
            item.textContent = line.replace(/^[-*]\s+/, '').trim();
            currentList.appendChild(item);
            return;
        }

        closeList();
        const paragraph = document.createElement('p');
        paragraph.className = 'changelog-paragraph';
        paragraph.textContent = line;
        fragments.push(paragraph);
    });

    closeList();
    return fragments;
}

async function renderChangeLog() {
    const changelogContent = document.getElementById('changelogContent');
    if (!changelogContent) return;

    changelogContent.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'contact-empty';
    loading.textContent = t('contactChangelogLoading', 'Loading latest updates...');
    changelogContent.appendChild(loading);

    try {
        const url = chrome.runtime.getURL('docs/release-notes/history.md');
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const markdown = await response.text();
        changelogContent.innerHTML = '';

        const fragments = parseSimpleMarkdown(markdown);
        if (!fragments.length) {
            const empty = document.createElement('div');
            empty.className = 'contact-empty';
            empty.textContent = t('contactChangelogEmpty', 'No update notes are available yet.');
            changelogContent.appendChild(empty);
            return;
        }

        fragments.forEach((fragment) => changelogContent.appendChild(fragment));
    } catch (error) {
        changelogContent.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'contact-empty';
        empty.textContent = t('contactChangelogLoadFailed', 'Failed to load the latest updates.');
        changelogContent.appendChild(empty);
    }
}

async function renderContactInfo() {
    const contactList = document.getElementById('contactList');
    if (!contactList) return;

    try {
        const contact = await window.AppConfigManager.getContactInfo();
        const items = [
            { label: t('contactWechatLabel', 'WeChat'), value: contact.wechat },
            { label: t('contactGithubLabel', 'GitHub'), value: contact.github, href: contact.github },
            { label: t('contactEmailLabel', 'Email'), value: contact.email, href: contact.email ? `mailto:${contact.email}` : '' }
        ].filter(item => item.value);

        contactList.innerHTML = '';

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'contact-empty';
            empty.textContent = t('contactEmpty', 'No contact information has been configured in appConfig.json yet.');
            contactList.appendChild(empty);
            return;
        }

        items.forEach((item) => {
            contactList.appendChild(createContactItem(item.label, item.value, item.href));
        });
    } catch (error) {
        contactList.innerHTML = '';

        const empty = document.createElement('div');
        empty.className = 'contact-empty';
        empty.textContent = t('contactLoadFailed', 'Failed to load contact information. Please check appConfig.json.');
        contactList.appendChild(empty);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.RuntimeI18n?.initializeRuntimeI18n) {
        await window.RuntimeI18n.initializeRuntimeI18n();
    }

    initializeI18n();
    renderContactInfo();
    renderChangeLog();
});

if (typeof window !== 'undefined') {
    window.addEventListener('runtime-language-changed', () => {
        initializeI18n();
        renderContactInfo();
        renderChangeLog();
    });
}
