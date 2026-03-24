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
    return chrome?.i18n?.getMessage?.(key) || fallback;
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

document.addEventListener('DOMContentLoaded', () => {
    initializeI18n();
    renderContactInfo();
});
